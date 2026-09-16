import 'dart:developer' as developer;
import 'dart:io';
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:file_picker/file_picker.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:uuid/uuid.dart';
import '../services/worker_context.dart';
import '../theme/stafivo_colors.dart';

/// Documents Screen — view and delete worker documents.
///
/// DELETE order: storage first, DB second. If storage fails, DB preserved.
/// Uses WorkerContext to avoid re-fetching worker profile.
class DocumentsScreen extends StatefulWidget {
  const DocumentsScreen({super.key});

  @override
  State<DocumentsScreen> createState() => _DocumentsScreenState();
}

class _DocumentsScreenState extends State<DocumentsScreen> {
  final _client = Supabase.instance.client;

  static const _bucket = 'worker-docs';
  static const _signedUrlExpiry = 3600;

  bool _loading = true;
  bool _uploading = false; // isolated upload-in-progress guard
  String? _error;
  List<Map<String, dynamic>> _documents = [];

  static const _maxFileSizeBytes = 5 * 1024 * 1024; // 5 MB

  bool _initialized = false; // race-condition guard

  @override
  void initState() {
    super.initState();
    // _load() is triggered from didChangeDependencies once WorkerContext is ready.
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final ctx = context.read<WorkerContext>();
    if (ctx.isLoaded && !_initialized) {
      _initialized = true;
      _load();
    }
  }

  Future<String?> _resolveWorkerId() async {
    // WorkerContext is guaranteed loaded by didChangeDependencies guard.
    return context.read<WorkerContext>().workerId;
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final workerId = await _resolveWorkerId();
      if (workerId == null) throw Exception('Worker profile not found');

      final rows = await _client
          .from('worker_documents')
          .select('id, kind, storage_path, original_name, created_at')
          .eq('worker_id', workerId)
          .order('created_at', ascending: false);

      final docs = List<Map<String, dynamic>>.from(rows as List);
      // Generate signed URLs concurrently
      final decorated = await Future.wait(docs.map((doc) async {
        try {
          final url = await _client.storage
              .from(_bucket)
              .createSignedUrl(
                  doc['storage_path']?.toString() ?? '', _signedUrlExpiry);
          return {...doc, 'signed_url': url};
        } catch (_) {
          return {...doc, 'signed_url': null};
        }
      }));

      if (!mounted) return;
      setState(() {
        _documents = decorated;
        _loading = false;
      });
    } catch (e, st) {
      developer.log('DocumentsScreen._load: $e',
          name: 'DocumentsScreen', error: e, stackTrace: st);
      if (!mounted) return;
      setState(() {
        _error = 'Failed to load documents. Pull to retry.';
        _loading = false;
      });
    }
  }

  Future<void> _upload(String kind) async {
    // Prevent double-tap during an active upload
    if (_uploading) return;

    try {
      developer.log('[docs] picking file', name: 'DocumentsScreen');
      final result = await FilePicker.platform.pickFiles(
        type: FileType.custom,
        allowedExtensions: ['pdf', 'jpg', 'jpeg', 'png'],
      );

      if (result == null || result.files.isEmpty) return;

      final file = result.files.first;
      final path = file.path;
      if (path == null) return;

      // ── Task 1: File size guard (5 MB) ───────────────────────────────────
      if ((file.size) > _maxFileSizeBytes) {
        _showSnack('File too large. Maximum size is 5MB.', isError: true);
        return;
      }

      final workerId = await _resolveWorkerId();
      if (!mounted) return;
      if (workerId == null) {
        _showSnack('Worker profile not found', isError: true);
        return;
      }

      // ── Task 2: Network guard (pre-upload) ───────────────────────────────
      try {
        final _ = await InternetAddress.lookup('supabase.com')
            .timeout(const Duration(seconds: 5));
      } on SocketException {
        if (!mounted) return;
        showDialog(
          context: context,
          builder: (_) => AlertDialog(
            title: const Text('No Internet Connection'),
            content: const Text('Please turn on mobile data or Wi-Fi.'),
            shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(16)),
            actions: [
              TextButton(
                  onPressed: () => Navigator.pop(context),
                  child: const Text('OK')),
            ],
          ),
        );
        return;
      } on TimeoutException {
        if (!mounted) return;
        showDialog(
          context: context,
          builder: (_) => AlertDialog(
            title: const Text('No Internet Connection'),
            content: const Text('Please turn on mobile data or Wi-Fi.'),
            shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(16)),
            actions: [
              TextButton(
                  onPressed: () => Navigator.pop(context),
                  child: const Text('OK')),
            ],
          ),
        );
        return;
      }

      // ── Task 3: Set uploading state (disables button) ────────────────────
      if (!mounted) return;
      setState(() => _uploading = true);

      developer.log('[docs] uploading to storage', name: 'DocumentsScreen');
      final uuid = const Uuid().v4();
      final safeName = file.name.replaceAll(RegExp(r'[^a-zA-Z0-9.\-]'), '_');
      final storagePath = '$workerId/$uuid-$safeName';

      await _client.storage.from(_bucket).upload(storagePath, File(path));
      developer.log('[docs] upload success path=$storagePath',
          name: 'DocumentsScreen');

      developer.log('[docs] inserting db record', name: 'DocumentsScreen');
      await _client.from('worker_documents').insert({
        'worker_id': workerId,
        'kind': kind,
        'storage_path': storagePath,
        'original_name': file.name,
      });
      developer.log('[docs] insert success', name: 'DocumentsScreen');

      if (!mounted) return;
      _showSnack('Document uploaded successfully.');
      await _load();
    } catch (e) {
      developer.log('[docs] upload failed: $e', name: 'DocumentsScreen');
      // ── Task 4: Friendly error — no raw exception exposed ────────────────
      if (!mounted) return;
      _showSnack('Upload failed. Please check your connection and try again.',
          isError: true);
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  Future<void> _delete(Map<String, dynamic> doc) async {
    final storagePath = doc['storage_path']?.toString() ?? '';
    final docId = doc['id']?.toString() ?? '';
    // 1. Storage first
    try {
      await _client.storage.from(_bucket).remove([storagePath]);
    } catch (e) {
      developer.log('Storage delete failed (preserving DB): $e',
          name: 'DocumentsScreen');
      if (!mounted) return; // Task 6: mounted guard
      _showSnack('Could not delete file from storage.', isError: true);
      return; // DO NOT delete DB
    }
    // 2. DB only if storage succeeded
    try {
      await _client.from('worker_documents').delete().eq('id', docId);
    } catch (e) {
      developer.log('DB delete failed after storage delete: $e',
          name: 'DocumentsScreen');
      if (!mounted) return; // Task 6: mounted guard
      _showSnack('File removed but record cleanup failed.', isError: true);
      return;
    }
    if (!mounted) return; // Task 6: mounted guard
    _showSnack('Document deleted.');
    await _load();
  }

  void _confirmDelete(Map<String, dynamic> doc) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Document',
            style: TextStyle(fontWeight: FontWeight.w700)),
        content: Text(
            'Delete "${doc['original_name'] ?? 'this document'}"?\nThis cannot be undone.'),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: StafivoColors.error,
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10)),
            ),
            onPressed: () {
              Navigator.pop(ctx);
              _delete(doc);
            },
            child: const Text('Delete'),
          ),
        ],
      ),
    );
  }

  void _showSnack(String msg, {bool isError = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(msg),
      backgroundColor: isError ? StafivoColors.error : StafivoColors.success,
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ));
  }

  // ── Build ───────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    // Wait for WorkerContext before rendering — prevents false error on first open.
    final ctx = context.watch<WorkerContext>();
    if (!ctx.isLoaded) {
      return const Scaffold(
        backgroundColor: Color(0xFFF8FAFC),
        body: SafeArea(child: Center(child: CircularProgressIndicator())),
      );
    }

    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      body: SafeArea(
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : _error != null
                ? _buildError()
                : _buildContent(),
      ),
    );
  }

  Widget _buildError() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 72,
              height: 72,
              decoration: BoxDecoration(
                color: const Color(0xFFFFEDED),
                borderRadius: BorderRadius.circular(20),
              ),
              child: const Icon(Icons.error_outline_rounded,
                  size: 36, color: Color(0xFFE53935)),
            ),
            const SizedBox(height: 20),
            Text(_error!,
                textAlign: TextAlign.center,
                style: const TextStyle(
                    color: Color(0xFF1E293B),
                    fontSize: 15,
                    fontWeight: FontWeight.w600)),
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: _load,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('Try Again'),
              style: FilledButton.styleFrom(
                backgroundColor: StafivoColors.primary,
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildContent() {
    final byKind = <String, List<Map<String, dynamic>>>{};
    for (final doc in _documents) {
      final kind = doc['kind']?.toString() ?? 'other';
      byKind.putIfAbsent(kind, () => []).add(doc);
    }

    const categories = [
      (
        kind: 'bank_passbook',
        label: 'Bank Passbook',
        icon: Icons.account_balance_rounded,
        color: Color(0xFF0EA5E9),
        bg: Color(0xFFE0F7FF),
      ),
      (
        kind: 'health_card',
        label: 'Health Card',
        icon: Icons.health_and_safety_rounded,
        color: Color(0xFF22C55E),
        bg: Color(0xFFEFFFF5),
      ),
      (
        kind: 'other',
        label: 'Other Documents',
        icon: Icons.folder_rounded,
        color: Color(0xFF7C3AED),
        bg: Color(0xFFF3E8FF),
      ),
    ];

    final totalDocs = _documents.length;

    return RefreshIndicator(
      onRefresh: _load,
      color: StafivoColors.primary,
      child: CustomScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          // ── Gradient header ─────────────────────────────────────────────
          SliverToBoxAdapter(
            child: Container(
              width: double.infinity,
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  colors: [Color(0xFF0F3D91), Color(0xFF1E63FF)],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
              ),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 20, 20, 28),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'My Documents',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 20,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 0.2,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Securely store and access your files',
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.7),
                        fontSize: 13,
                      ),
                    ),
                    const SizedBox(height: 18),
                    // Stats row
                    Row(
                      children: [
                        _HeaderPill(
                          icon: Icons.folder_copy_rounded,
                          label: 'Total Files',
                          value: '$totalDocs',
                        ),
                        const SizedBox(width: 10),
                        _HeaderPill(
                          icon: Icons.category_rounded,
                          label: 'Categories',
                          value: '${byKind.length} of 3',
                        ),
                        if (_uploading) ...[
                          const SizedBox(width: 10),
                          _HeaderPill(
                            icon: Icons.cloud_upload_rounded,
                            label: 'Uploading',
                            value: '…',
                          ),
                        ],
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),

          // ── Category sections ────────────────────────────────────────────
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(16, 20, 16, 32),
            sliver: SliverList(
              delegate: SliverChildListDelegate([
                for (final cat in categories) ...[
                  _CategorySection(
                    kind: cat.kind,
                    label: cat.label,
                    icon: cat.icon,
                    iconColor: cat.color,
                    iconBg: cat.bg,
                    docs: byKind[cat.kind] ?? [],
                    onDelete: _confirmDelete,
                    onUpload: _uploading ? null : () => _upload(cat.kind),
                  ),
                  const SizedBox(height: 14),
                ],
              ]),
            ),
          ),
        ],
      ),
    );
  }
}

// ── Header pill ───────────────────────────────────────────────────────────────

class _HeaderPill extends StatelessWidget {
  const _HeaderPill(
      {required this.icon, required this.label, required this.value});
  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, color: Colors.white70, size: 11),
              const SizedBox(width: 4),
              Text(label,
                  style: TextStyle(
                      color: Colors.white.withValues(alpha: 0.7),
                      fontSize: 10,
                      fontWeight: FontWeight.w500)),
            ],
          ),
          const SizedBox(height: 2),
          Text(value,
              style: const TextStyle(
                  color: Colors.white,
                  fontSize: 13,
                  fontWeight: FontWeight.w800)),
        ],
      ),
    );
  }
}

// ── Category section card ─────────────────────────────────────────────────────

class _CategorySection extends StatelessWidget {
  const _CategorySection({
    required this.kind,
    required this.label,
    required this.icon,
    required this.iconColor,
    required this.iconBg,
    required this.docs,
    required this.onDelete,
    required this.onUpload,
  });
  final String kind;
  final String label;
  final IconData icon;
  final Color iconColor;
  final Color iconBg;
  final List<Map<String, dynamic>> docs;
  final void Function(Map<String, dynamic>) onDelete;
  final VoidCallback? onUpload; // null = uploading in progress

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFFE2E8F0)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.04),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // ── Header row ───────────────────────────────────────────────────
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 12, 12),
            child: Row(
              children: [
                Container(
                  width: 42,
                  height: 42,
                  decoration: BoxDecoration(
                    color: iconBg,
                    borderRadius: BorderRadius.circular(13),
                  ),
                  child: Icon(icon, color: iconColor, size: 22),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(label,
                          style: const TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w700,
                              color: Color(0xFF0F172A))),
                      Text(
                        docs.isEmpty
                            ? 'No files yet'
                            : '${docs.length} file${docs.length == 1 ? '' : 's'}',
                        style: const TextStyle(
                            fontSize: 11,
                            color: StafivoColors.textSecondary),
                      ),
                    ],
                  ),
                ),
                // File count badge
                if (docs.isNotEmpty)
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: iconBg,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text('${docs.length}',
                        style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                            color: iconColor)),
                  ),
                const SizedBox(width: 8),
                // Upload button / spinner
                if (onUpload == null)
                  const Padding(
                    padding: EdgeInsets.all(10),
                    child: SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                  )
                else
                  Material(
                    color: iconBg,
                    borderRadius: BorderRadius.circular(12),
                    child: InkWell(
                      onTap: onUpload,
                      borderRadius: BorderRadius.circular(12),
                      child: Padding(
                        padding: const EdgeInsets.all(10),
                        child: Icon(Icons.upload_rounded,
                            size: 20, color: iconColor),
                      ),
                    ),
                  ),
              ],
            ),
          ),

          // ── Divider ──────────────────────────────────────────────────────
          Container(height: 1, color: const Color(0xFFF1F5F9)),

          // ── File list or empty state ──────────────────────────────────────
          if (docs.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 18, horizontal: 16),
              child: Row(
                children: [
                  Icon(Icons.cloud_upload_outlined,
                      size: 16,
                      color: StafivoColors.textMuted.withValues(alpha: 0.6)),
                  const SizedBox(width: 8),
                  const Text('Tap ↑ to upload your first file',
                      style: TextStyle(
                          fontSize: 12, color: StafivoColors.textMuted)),
                ],
              ),
            )
          else
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
              child: Column(
                children: docs
                    .map((doc) => _DocumentTile(
                          doc: doc,
                          accentColor: iconColor,
                          onDelete: () => onDelete(doc),
                        ))
                    .toList(),
              ),
            ),
        ],
      ),
    );
  }
}

// ── Document tile ─────────────────────────────────────────────────────────────

class _DocumentTile extends StatelessWidget {
  const _DocumentTile({
    required this.doc,
    required this.accentColor,
    required this.onDelete,
  });
  final Map<String, dynamic> doc;
  final Color accentColor;
  final VoidCallback onDelete;

  // Detect file type from extension
  static ({IconData icon, Color color, Color bg}) _fileType(String name) {
    final ext = name.split('.').last.toLowerCase();
    return switch (ext) {
      'pdf' => (
          icon: Icons.picture_as_pdf_rounded,
          color: const Color(0xFFEF4444),
          bg: const Color(0xFFFFEDED),
        ),
      'jpg' || 'jpeg' || 'png' => (
          icon: Icons.image_rounded,
          color: const Color(0xFF0EA5E9),
          bg: const Color(0xFFE0F7FF),
        ),
      _ => (
          icon: Icons.insert_drive_file_rounded,
          color: const Color(0xFF64748B),
          bg: const Color(0xFFF1F5F9),
        ),
    };
  }

  static String _formatDate(String? tsRaw) {
    if (tsRaw == null) return '';
    final dt = DateTime.tryParse(tsRaw)?.toLocal();
    if (dt == null) return '';
    return '${dt.day}/${dt.month}/${dt.year}';
  }

  @override
  Widget build(BuildContext context) {
    final name = doc['original_name']?.toString() ?? 'Document';
    final dateStr = _formatDate(doc['created_at']?.toString());
    final signedUrl = doc['signed_url']?.toString();
    final ft = _fileType(name);

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: Row(
        children: [
          // File type icon
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 12, 0, 12),
            child: Container(
              width: 38,
              height: 38,
              decoration: BoxDecoration(
                color: ft.bg,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(ft.icon, color: ft.color, size: 20),
            ),
          ),
          const SizedBox(width: 12),

          // Name + date
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: Color(0xFF0F172A)),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                if (dateStr.isNotEmpty)
                  Text(dateStr,
                      style: const TextStyle(
                          fontSize: 10,
                          color: StafivoColors.textSecondary)),
              ],
            ),
          ),

          // Action buttons
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (signedUrl != null)
                Tooltip(
                  message: 'View document',
                  child: Material(
                    color: Colors.transparent,
                    child: InkWell(
                      onTap: () => _launchUrl(context, signedUrl),
                      borderRadius: BorderRadius.circular(10),
                      child: Padding(
                        padding: const EdgeInsets.all(10),
                        child: Icon(Icons.open_in_new_rounded,
                            size: 18, color: accentColor),
                      ),
                    ),
                  ),
                ),
              Tooltip(
                message: 'Delete',
                child: Material(
                  color: Colors.transparent,
                  child: InkWell(
                    onTap: onDelete,
                    borderRadius: BorderRadius.circular(10),
                    child: const Padding(
                      padding: EdgeInsets.all(10),
                      child: Icon(Icons.delete_outline_rounded,
                          size: 18, color: Color(0xFFEF4444)),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 4),
            ],
          ),
        ],
      ),
    );
  }

  Future<void> _launchUrl(BuildContext context, String rawUrl) async {
    developer.log('[docs] opening signed url', name: 'DocumentsScreen');
    // Task 5: validate URI before attempting launch
    Uri? uri;
    try {
      uri = Uri.parse(rawUrl);
      if (!uri.hasScheme || !uri.hasAuthority) {
        throw const FormatException('invalid uri');
      }
    } catch (_) {
      developer.log('[docs] launch failed — invalid uri',
          name: 'DocumentsScreen');
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not open document link')),
        );
      }
      return;
    }
    try {
      if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
        developer.log('[docs] launch failed', name: 'DocumentsScreen');
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Could not open document link')),
          );
        }
      }
    } catch (e) {
      developer.log('[docs] launch failed', name: 'DocumentsScreen', error: e);
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not open document link')),
        );
      }
    }
  }
}
