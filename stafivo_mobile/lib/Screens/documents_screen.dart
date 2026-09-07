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
import '../widgets/async_state_widget.dart';
import '../widgets/stafivo_app_bar.dart';

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
    setState(() { _loading = true; _error = null; });
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
              .createSignedUrl(doc['storage_path']?.toString() ?? '', _signedUrlExpiry);
          return {...doc, 'signed_url': url};
        } catch (_) {
          return {...doc, 'signed_url': null};
        }
      }));

      if (!mounted) return;
      setState(() { _documents = decorated; _loading = false; });
    } catch (e, st) {
      developer.log('DocumentsScreen._load: $e', name: 'DocumentsScreen', error: e, stackTrace: st);
      if (!mounted) return;
      setState(() { _error = 'Failed to load documents. Pull to retry.'; _loading = false; });
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
            content: const Text(
                'Please turn on mobile data or Wi-Fi.'),
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
            content: const Text(
                'Please turn on mobile data or Wi-Fi.'),
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
      developer.log('[docs] upload success path=$storagePath', name: 'DocumentsScreen');

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
      _showSnack('Upload failed. Please check your connection and try again.', isError: true);
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
      developer.log('Storage delete failed (preserving DB): $e', name: 'DocumentsScreen');
      if (!mounted) return; // Task 6: mounted guard
      _showSnack('Could not delete file from storage.', isError: true);
      return; // DO NOT delete DB
    }
    // 2. DB only if storage succeeded
    try {
      await _client.from('worker_documents').delete().eq('id', docId);
    } catch (e) {
      developer.log('DB delete failed after storage delete: $e', name: 'DocumentsScreen');
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
        title: const Text('Delete Document'),
        content: Text(
            'Delete "${doc['original_name'] ?? 'this document'}"?\nThis cannot be undone.'),
        shape:
            RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(
                backgroundColor: StafivoColors.error),
            onPressed: () { Navigator.pop(ctx); _delete(doc); },
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

  @override
  Widget build(BuildContext context) {
    // Wait for WorkerContext before rendering — prevents false error on first open.
    final ctx = context.watch<WorkerContext>();
    if (!ctx.isLoaded) {
      return Scaffold(
        appBar: stafivoAppBar(context, 'My Documents', implyLeading: false),
        body: const SafeArea(child: Center(child: CircularProgressIndicator())),
      );
    }

    return Scaffold(
      appBar: stafivoAppBar(context, 'My Documents', implyLeading: false),
      backgroundColor: StafivoColors.background,
      body: SafeArea(
        child: AsyncStateWidget(
          loading: _loading,
          error: _error,
          onRetry: _load,
          child: RefreshIndicator(onRefresh: _load, child: _buildContent()),
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
      ('bank_passbook', 'Bank Passbook', Icons.account_balance_rounded),
      ('health_card', 'Health Card', Icons.health_and_safety_rounded),
      ('other', 'Other', Icons.folder_rounded),
    ];
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        for (final (kind, label, icon) in categories) ...[
          _CategorySection(
            kind: kind,
            label: label,
            icon: icon,
            docs: byKind[kind] ?? [],
            onDelete: _confirmDelete,
            // Task 3: pass uploading flag so button can be disabled
            onUpload: _uploading ? null : () => _upload(kind),
          ),
          const SizedBox(height: 16),
        ],
      ],
    );
  }
}

class _CategorySection extends StatelessWidget {
  const _CategorySection({
    required this.kind,
    required this.label,
    required this.icon,
    required this.docs,
    required this.onDelete,
    required this.onUpload,
  });
  final String kind;
  final String label;
  final IconData icon;
  final List<Map<String, dynamic>> docs;
  final void Function(Map<String, dynamic>) onDelete;
  // Task 3: nullable — null disables the button during upload
  final VoidCallback? onUpload;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: StafivoColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 20, color: StafivoColors.primary),
              const SizedBox(width: 10),
              Text(label,
                  style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      color: StafivoColors.textPrimary)),
              if (docs.isNotEmpty) ...[
                const SizedBox(width: 8),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: StafivoColors.infoBg,
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text('${docs.length}',
                      style: const TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w700,
                          color: StafivoColors.info)),
                ),
              ],
              const Spacer(),
              // Task 3: show progress spinner when uploading, else upload icon
              if (onUpload == null)
                const Padding(
                  padding: EdgeInsets.all(12),
                  child: SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                )
              else
                IconButton(
                  icon: const Icon(Icons.upload_rounded, size: 20, color: StafivoColors.primary),
                  onPressed: onUpload,
                  tooltip: 'Upload $label',
                ),
            ],
          ),
          const SizedBox(height: 12),
          if (docs.isEmpty)
            const Text('No files yet.',
                style:
                    TextStyle(fontSize: 12, color: StafivoColors.textMuted))
          else
            ...docs.map((doc) =>
                _DocumentTile(doc: doc, onDelete: () => onDelete(doc))),
        ],
      ),
    );
  }
}

class _DocumentTile extends StatelessWidget {
  const _DocumentTile({required this.doc, required this.onDelete});
  final Map<String, dynamic> doc;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final name = doc['original_name']?.toString() ?? 'Document';
    final tsRaw = doc['created_at']?.toString();
    final dt = tsRaw != null ? DateTime.tryParse(tsRaw)?.toLocal() : null;
    final dateStr = dt != null ? '${dt.day}/${dt.month}/${dt.year}' : '';
    final signedUrl = doc['signed_url']?.toString();

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: StafivoColors.background,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: StafivoColors.border),
      ),
      child: Row(
        children: [
          const Icon(Icons.insert_drive_file_rounded,
              size: 20, color: StafivoColors.textMuted),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(name,
                    style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: StafivoColors.textPrimary),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis),
                if (dateStr.isNotEmpty)
                  Text(dateStr,
                      style: const TextStyle(
                          fontSize: 11, color: StafivoColors.textMuted)),
              ],
            ),
          ),
          if (signedUrl != null)
            Tooltip(
              message: 'Tap to view document',
              child: IconButton(
                icon: const Icon(Icons.link_rounded,
                    size: 20, color: StafivoColors.info),
                onPressed: () async {
                  developer.log('[docs] opening signed url', name: 'DocumentsScreen');
                  // Task 5: validate URI before attempting launch
                  Uri? uri;
                  try {
                    uri = Uri.parse(signedUrl);
                    if (!uri.hasScheme || !uri.hasAuthority) throw const FormatException('invalid uri');
                  } catch (_) {
                    developer.log('[docs] launch failed — invalid uri', name: 'DocumentsScreen');
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
                },
              ),
            ),
          IconButton(
            icon: const Icon(Icons.delete_outline_rounded,
                size: 20, color: StafivoColors.error),
            onPressed: onDelete,
            tooltip: 'Delete',
          ),
        ],
      ),
    );
  }
}
