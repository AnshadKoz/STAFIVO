import 'dart:developer' as developer;
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
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
  String? _error;
  List<Map<String, dynamic>> _documents = [];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<String?> _resolveWorkerId() async {
    final ctx = context.read<WorkerContext>();
    if (ctx.isLoaded && ctx.workerId != null) return ctx.workerId;
    await ctx.load();
    return ctx.workerId;
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

  Future<void> _delete(Map<String, dynamic> doc) async {
    final storagePath = doc['storage_path']?.toString() ?? '';
    final docId = doc['id']?.toString() ?? '';
    // 1. Storage first
    try {
      await _client.storage.from(_bucket).remove([storagePath]);
    } catch (e) {
      developer.log('Storage delete failed (preserving DB): $e', name: 'DocumentsScreen');
      _showSnack('Could not delete file from storage.', isError: true);
      return; // DO NOT delete DB
    }
    // 2. DB only if storage succeeded
    try {
      await _client.from('worker_documents').delete().eq('id', docId);
    } catch (e) {
      developer.log('DB delete failed after storage delete: $e', name: 'DocumentsScreen');
      _showSnack('File removed but record cleanup failed.', isError: true);
    }
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
        Container(
          padding: const EdgeInsets.all(14),
          margin: const EdgeInsets.only(bottom: 16),
          decoration: BoxDecoration(
            color: StafivoColors.infoBg,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: StafivoColors.info.withValues(alpha: 0.3)),
          ),
          child: const Row(
            children: [
              Icon(Icons.info_outline_rounded, color: StafivoColors.info, size: 18),
              SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Document upload is available on the web dashboard. Files uploaded there appear here.',
                  style: TextStyle(fontSize: 12, color: StafivoColors.info),
                ),
              ),
            ],
          ),
        ),
        for (final (kind, label, icon) in categories) ...[
          _CategorySection(
            kind: kind,
            label: label,
            icon: icon,
            docs: byKind[kind] ?? [],
            onDelete: _confirmDelete,
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
  });
  final String kind;
  final String label;
  final IconData icon;
  final List<Map<String, dynamic>> docs;
  final void Function(Map<String, dynamic>) onDelete;

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
              message: 'Tap to view signed URL',
              child: IconButton(
                icon: const Icon(Icons.link_rounded,
                    size: 20, color: StafivoColors.info),
                onPressed: () => ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Text(signedUrl,
                        maxLines: 2, overflow: TextOverflow.ellipsis),
                    action: SnackBarAction(label: 'OK', onPressed: () {}),
                    duration: const Duration(seconds: 6),
                  ),
                ),
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
