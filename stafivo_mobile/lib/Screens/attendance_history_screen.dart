import 'dart:developer' as developer;
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../services/worker_context.dart';
import '../theme/stafivo_colors.dart';
import '../widgets/async_state_widget.dart';
import '../widgets/stafivo_app_bar.dart';

/// Attendance History — paginated, read-only view of attendance_logs.
/// Uses WorkerContext to avoid re-fetching worker profile.
class AttendanceHistoryScreen extends StatefulWidget {
  const AttendanceHistoryScreen({super.key});

  @override
  State<AttendanceHistoryScreen> createState() =>
      _AttendanceHistoryScreenState();
}

class _AttendanceHistoryScreenState extends State<AttendanceHistoryScreen> {
  final _client = Supabase.instance.client;

  static const _pageSize = 20;

  bool _loading = true;
  bool _loadingMore = false;
  bool _hasMore = true;
  String? _error;
  int _offset = 0;
  List<Map<String, dynamic>> _logs = [];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadInitial());
  }

  Future<String?> _resolveWorkerId() async {
    // Use cached context first — avoids a DB round-trip on every view
    final ctx = context.read<WorkerContext>();
    if (ctx.isLoaded && ctx.workerId != null) return ctx.workerId;
    await ctx.load();
    return ctx.workerId;
  }

  Future<void> _loadInitial() async {
    setState(() {
      _loading = true;
      _error = null;
      _offset = 0;
      _logs = [];
      _hasMore = true;
    });
    try {
      final workerId = await _resolveWorkerId();
      if (workerId == null) throw Exception('Worker profile not found');
      final rows = await _client
          .from('attendance_logs')
          .select('action, timestamp_utc, gps_lat, gps_lng, source')
          .eq('worker_id', workerId)
          .order('timestamp_utc', ascending: false)
          .range(0, _pageSize - 1);
      final data = List<Map<String, dynamic>>.from(rows as List);
      if (!mounted) return;
      setState(() {
        _logs = data;
        _offset = data.length;
        _hasMore = data.length == _pageSize;
        _loading = false;
      });
    } catch (e, st) {
      developer.log('AttendanceHistory._loadInitial: $e',
          name: 'AttendanceHistory', error: e, stackTrace: st);
      if (!mounted) return;
      setState(() {
        _error = 'Failed to load attendance. Pull to retry.';
        _loading = false;
      });
    }
  }

  Future<void> _loadMore() async {
    if (!_hasMore || _loadingMore) return;
    final workerId = context.read<WorkerContext>().workerId;
    if (workerId == null) return;
    setState(() => _loadingMore = true);
    try {
      final rows = await _client
          .from('attendance_logs')
          .select('action, timestamp_utc, gps_lat, gps_lng, source')
          .eq('worker_id', workerId)
          .order('timestamp_utc', ascending: false)
          .range(_offset, _offset + _pageSize - 1);
      final data = List<Map<String, dynamic>>.from(rows as List);
      if (!mounted) return;
      setState(() {
        _logs.addAll(data);
        _offset += data.length;
        _hasMore = data.length == _pageSize;
        _loadingMore = false;
      });
    } catch (e) {
      developer.log('AttendanceHistory._loadMore: $e', name: 'AttendanceHistory');
      if (!mounted) return;
      setState(() => _loadingMore = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: stafivoAppBar(context, 'Attendance History', implyLeading: false),
      backgroundColor: StafivoColors.background,
      body: SafeArea(
        child: AsyncStateWidget(
          loading: _loading,
          error: _error,
          onRetry: _loadInitial,
          empty: !_loading && _error == null && _logs.isEmpty,
          emptyMessage: 'No attendance records yet.',
          emptyIcon: Icons.history_rounded,
          child: RefreshIndicator(
            onRefresh: _loadInitial,
            child: ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: _logs.length + 1, // +1 for footer
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (context, i) {
                if (i == _logs.length) return _buildFooter();
                return _LogCard(log: _logs[i]);
              },
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildFooter() {
    if (_loadingMore) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 16),
        child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
      );
    }
    if (!_hasMore) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 16),
        child: Center(
          child: Text('All records loaded',
              style: TextStyle(fontSize: 12, color: StafivoColors.textMuted)),
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Center(
        child: OutlinedButton.icon(
          onPressed: _loadMore,
          icon: const Icon(Icons.expand_more_rounded, size: 18),
          label: const Text('Load More'),
          style: OutlinedButton.styleFrom(
            foregroundColor: StafivoColors.primary,
            side: const BorderSide(color: StafivoColors.primary),
            shape:
                RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          ),
        ),
      ),
    );
  }
}

// ── Log Card ──────────────────────────────────────────────────────────────────

class _LogCard extends StatelessWidget {
  const _LogCard({required this.log});
  final Map<String, dynamic> log;

  @override
  Widget build(BuildContext context) {
    final action = log['action']?.toString() ?? '—';
    final isIn = action == 'IN';
    final tsRaw = log['timestamp_utc']?.toString();
    final dt = tsRaw != null ? DateTime.tryParse(tsRaw)?.toLocal() : null;
    final timeStr = dt != null
        ? '${_pad(dt.day)}/${_pad(dt.month)}/${dt.year}  ${_pad(dt.hour)}:${_pad(dt.minute)}'
        : '—';
    final source = log['source']?.toString();
    final lat = log['gps_lat'];
    final lng = log['gps_lng'];

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: StafivoColors.border),
      ),
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: isIn ? StafivoColors.successBg : StafivoColors.errorBg,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Center(
              child: Text(action,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                    color: isIn ? StafivoColors.success : StafivoColors.error,
                  )),
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(isIn ? 'Checked In' : 'Checked Out',
                    style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                        color: StafivoColors.textPrimary)),
                const SizedBox(height: 3),
                Text(timeStr,
                    style: const TextStyle(
                        fontSize: 12, color: StafivoColors.textSecondary)),
                if (lat != null && lng != null) ...[
                  const SizedBox(height: 3),
                  Text(
                    '${(lat as num).toStringAsFixed(5)}, ${(lng as num).toStringAsFixed(5)}',
                    style: const TextStyle(
                        fontSize: 11, color: StafivoColors.textMuted),
                  ),
                ],
              ],
            ),
          ),
          if (source == 'manager')
            Container(
              padding:
                  const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: StafivoColors.infoBg,
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Text('Manager',
                  style: TextStyle(
                      fontSize: 10,
                      color: StafivoColors.info,
                      fontWeight: FontWeight.w600)),
            ),
        ],
      ),
    );
  }

  static String _pad(int n) => n.toString().padLeft(2, '0');
}
