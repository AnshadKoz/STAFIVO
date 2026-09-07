import 'dart:developer' as developer;
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../services/worker_context.dart';
import '../theme/stafivo_colors.dart';

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
  final _scrollController = ScrollController();

  static const _pageSize = 20;

  bool _loading = true;
  bool _loadingMore = false;
  bool _hasMore = true;
  String? _error;
  int _offset = 0;
  List<Map<String, dynamic>> _logs = [];
  String _filter = 'all'; // 'all' | 'in' | 'out' | 'month'

  bool _initialized = false; // race-condition guard

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  /// Auto-trigger load-more when within 200 px of bottom.
  void _onScroll() {
    if (_scrollController.position.pixels >=
        _scrollController.position.maxScrollExtent - 200) {
      _loadMore();
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final ctx = context.read<WorkerContext>();
    if (ctx.isLoaded && !_initialized) {
      _initialized = true;
      _loadInitial();
    }
  }

  Future<String?> _resolveWorkerId() async {
    // WorkerContext is guaranteed loaded by didChangeDependencies guard.
    return context.read<WorkerContext>().workerId;
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
      developer.log('AttendanceHistory._loadMore: $e',
          name: 'AttendanceHistory');
      if (!mounted) return;
      setState(() => _loadingMore = false);
    }
  }

  // ── Client-side filtering ──────────────────────────────────────────────────
  List<Map<String, dynamic>> _applyFilter(List<Map<String, dynamic>> logs) {
    final now = DateTime.now();
    return logs.where((log) {
      final action = log['action']?.toString() ?? '';
      switch (_filter) {
        case 'in':
          return action == 'IN';
        case 'out':
          return action == 'OUT';
        case 'month':
          final dt = DateTime.tryParse(
                  log['timestamp_utc']?.toString() ?? '')
              ?.toLocal();
          return dt != null &&
              dt.year == now.year &&
              dt.month == now.month;
        default:
          return true;
      }
    }).toList();
  }

  // ── Session pairing (used only for 'session' filter) ──────────────────────
  // Logs arrive descending. A typical shift = OUT at index i, IN at index i+1.
  // Unmatched entries are kept as incomplete sessions.
  List<_SessionPair> _buildSessions(List<Map<String, dynamic>> logs) {
    final sessions = <_SessionPair>[];
    int i = 0;
    while (i < logs.length) {
      final action = logs[i]['action']?.toString() ?? '';
      if (action == 'OUT' &&
          i + 1 < logs.length &&
          logs[i + 1]['action'] == 'IN') {
        sessions.add(_SessionPair(inLog: logs[i + 1], outLog: logs[i]));
        i += 2;
      } else {
        sessions.add(_SessionPair(
          inLog: action == 'IN' ? logs[i] : null,
          outLog: action == 'OUT' ? logs[i] : null,
        ));
        i++;
      }
    }
    return sessions;
  }

  // ── Summary stats (computed from loaded logs) ──────────────────────────────
  int get _monthlyCheckIns {
    final now = DateTime.now();
    return _logs.where((log) {
      if (log['action'] != 'IN') return false;
      final dt = DateTime.tryParse(
              log['timestamp_utc']?.toString() ?? '')
          ?.toLocal();
      return dt != null && dt.year == now.year && dt.month == now.month;
    }).length;
  }

  int get _totalCheckIns =>
      _logs.where((l) => l['action'] == 'IN').length;

  String? get _lastCheckInStr {
    for (final log in _logs) {
      if (log['action'] != 'IN') continue;
      final dt =
          DateTime.tryParse(log['timestamp_utc']?.toString() ?? '')
              ?.toLocal();
      if (dt != null) {
        return '${_p(dt.day)}/${_p(dt.month)}  ${_p(dt.hour)}:${_p(dt.minute)}';
      }
    }
    return null;
  }

  static String _p(int n) => n.toString().padLeft(2, '0');

  // ── Build ──────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
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
              onPressed: _loadInitial,
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
    // ── Session view ──────────────────────────────────────────────────────────
    if (_filter == 'session') {
      final sessions = _buildSessions(_logs);
      final grouped = <String, List<_SessionPair>>{};
      for (final s in sessions) {
        final label = _dateLabel(
            (s.inLog ?? s.outLog)?['timestamp_utc']?.toString());
        grouped.putIfAbsent(label, () => []).add(s);
      }
      final dateKeys = grouped.keys.toList();

      return RefreshIndicator(
        onRefresh: _loadInitial,
        color: StafivoColors.primary,
        child: CustomScrollView(
          controller: _scrollController,
          physics: const AlwaysScrollableScrollPhysics(),
          slivers: [
            SliverToBoxAdapter(child: _buildHeader()),
            SliverToBoxAdapter(child: _buildFilterBar()),
            if (sessions.isEmpty)
              SliverFillRemaining(child: _emptyState())
            else ...[
              for (final dateKey in dateKeys) ...[
                SliverToBoxAdapter(child: _buildDateHeader(dateKey)),
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 0),
                  sliver: SliverList(
                    delegate: SliverChildBuilderDelegate(
                      (ctx, i) => Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: _SessionCard(session: grouped[dateKey]![i]),
                      ),
                      childCount: grouped[dateKey]!.length,
                    ),
                  ),
                ),
              ],
              SliverToBoxAdapter(child: _buildFooter()),
            ],
          ],
        ),
      );
    }

    // ── Individual log view (all / in / out / month) ───────────────────────
    final filtered = _applyFilter(_logs);

    // Group by date label (Today / Yesterday / DD Mon YYYY)
    final grouped = <String, List<Map<String, dynamic>>>{};
    for (final log in filtered) {
      final label = _dateLabel(log['timestamp_utc']?.toString());
      grouped.putIfAbsent(label, () => []).add(log);
    }
    final dateKeys = grouped.keys.toList();

    return RefreshIndicator(
      onRefresh: _loadInitial,
      color: StafivoColors.primary,
      child: CustomScrollView(
        controller: _scrollController,
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          // ── Gradient header + summary ───────────────────────────────────
          SliverToBoxAdapter(child: _buildHeader()),

          // ── Filter chips ────────────────────────────────────────────────
          SliverToBoxAdapter(child: _buildFilterBar()),

          // ── Empty state ─────────────────────────────────────────────────
          if (filtered.isEmpty)
            SliverFillRemaining(child: _emptyState())
          else ...[
            // ── Date-grouped log cards ──────────────────────────────────
            for (final dateKey in dateKeys) ...[
              SliverToBoxAdapter(child: _buildDateHeader(dateKey)),
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 0),
                sliver: SliverList(
                  delegate: SliverChildBuilderDelegate(
                    (ctx, i) => Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: _LogCard(log: grouped[dateKey]![i]),
                    ),
                    childCount: grouped[dateKey]!.length,
                  ),
                ),
              ),
            ],

            // ── Footer ──────────────────────────────────────────────────
            SliverToBoxAdapter(child: _buildFooter()),
          ],
        ],
      ),
    );
  }

  // ── Gradient header ────────────────────────────────────────────────────────
  Widget _buildHeader() {
    return Container(
      width: double.infinity,
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          colors: [Color(0xFF0F3D91), Color(0xFF1E63FF)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Attendance History',
              style: TextStyle(
                color: Colors.white,
                fontSize: 20,
                fontWeight: FontWeight.w800,
                letterSpacing: 0.2,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              'Your punch-in / punch-out record',
              style: TextStyle(
                color: Colors.white.withValues(alpha: 0.7),
                fontSize: 13,
              ),
            ),
            const SizedBox(height: 18),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  _SummaryPill(
                    icon: Icons.login_rounded,
                    label: 'This Month',
                    value: '$_monthlyCheckIns check-ins',
                  ),
                  const SizedBox(width: 10),
                  _SummaryPill(
                    icon: Icons.history_rounded,
                    label: 'All Time',
                    value: '$_totalCheckIns total',
                  ),
                  if (_lastCheckInStr != null) ...[
                    const SizedBox(width: 10),
                    _SummaryPill(
                      icon: Icons.access_time_rounded,
                      label: 'Last In',
                      value: _lastCheckInStr!,
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ── Filter bar ─────────────────────────────────────────────────────────────
  Widget _buildFilterBar() {
    return Container(
      color: Colors.white,
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: [
            _FilterChip(
                label: 'All',
                value: 'all',
                current: _filter,
                onTap: (v) => setState(() => _filter = v)),
            const SizedBox(width: 8),
            _FilterChip(
                label: 'Check-In',
                value: 'in',
                current: _filter,
                onTap: (v) => setState(() => _filter = v)),
            const SizedBox(width: 8),
            _FilterChip(
                label: 'Check-Out',
                value: 'out',
                current: _filter,
                onTap: (v) => setState(() => _filter = v)),
            const SizedBox(width: 8),
            _FilterChip(
                label: 'This Month',
                value: 'month',
                current: _filter,
                onTap: (v) => setState(() => _filter = v)),
            const SizedBox(width: 8),
            _FilterChip(
                label: 'Session',
                value: 'session',
                current: _filter,
                onTap: (v) => setState(() => _filter = v)),
          ],
        ),
      ),
    );
  }

  // ── Date section header ────────────────────────────────────────────────────
  Widget _buildDateHeader(String label) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
      child: Row(
        children: [
          Text(
            label,
            style: const TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: StafivoColors.textSecondary,
              letterSpacing: 0.5,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(child: Container(height: 1, color: const Color(0xFFE2E8F0))),
        ],
      ),
    );
  }

  // ── Footer ─────────────────────────────────────────────────────────────────
  Widget _buildFooter() {
    if (_loadingMore) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 20),
        child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
      );
    }
    if (!_hasMore) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 20),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.check_circle_outline_rounded,
                size: 14, color: StafivoColors.textMuted),
            const SizedBox(width: 6),
            const Text('All records loaded',
                style:
                    TextStyle(fontSize: 12, color: StafivoColors.textMuted)),
          ],
        ),
      );
    }
    return const SizedBox(height: 20);
  }

  // ── Date label helper ──────────────────────────────────────────────────────
  static String _dateLabel(String? tsRaw) {
    if (tsRaw == null) return 'Unknown';
    final dt = DateTime.tryParse(tsRaw)?.toLocal();
    if (dt == null) return 'Unknown';
    final today = DateTime.now();
    final d = DateTime(dt.year, dt.month, dt.day);
    final t = DateTime(today.year, today.month, today.day);
    if (d == t) return 'Today';
    if (d == t.subtract(const Duration(days: 1))) return 'Yesterday';
    return '${_p(dt.day)} ${_monthName(dt.month)} ${dt.year}';
  }

  static String _monthName(int m) => const [
        'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
      ][m - 1];

  Widget _emptyState() {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.history_rounded,
              size: 56,
              color: StafivoColors.textMuted.withValues(alpha: 0.5)),
          const SizedBox(height: 12),
          const Text('No records found',
              style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w600,
                  color: StafivoColors.textSecondary)),
        ],
      ),
    );
  }
}

// ── Session pair data model ───────────────────────────────────────────────────

class _SessionPair {
  const _SessionPair({this.inLog, this.outLog});
  final Map<String, dynamic>? inLog;
  final Map<String, dynamic>? outLog;

  bool get isComplete => inLog != null && outLog != null;

  /// Duration of the shift. Null if incomplete or times can't be parsed.
  Duration? get duration {
    if (!isComplete) return null;
    final inDt = DateTime.tryParse(inLog!['timestamp_utc']?.toString() ?? '');
    final outDt = DateTime.tryParse(outLog!['timestamp_utc']?.toString() ?? '');
    if (inDt == null || outDt == null) return null;
    final diff = outDt.difference(inDt);
    return diff.isNegative ? null : diff;
  }
}

// ── Session Card ──────────────────────────────────────────────────────────────

class _SessionCard extends StatelessWidget {
  const _SessionCard({required this.session});
  final _SessionPair session;

  @override
  Widget build(BuildContext context) {
    final inDt = _toLocal(session.inLog?['timestamp_utc']);
    final outDt = _toLocal(session.outLog?['timestamp_utc']);
    final dur = session.duration;
    final hasGps = (session.inLog?['gps_lat'] ?? session.outLog?['gps_lat']) != null;

    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: const Color(0xFFE2E8F0)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.04),
            blurRadius: 10,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(18),
        child: IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Navy left-border stripe for sessions
              Container(width: 4, color: const Color(0xFF0F3D91)),

              Expanded(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // ── Header row ──────────────────────────────────────
                      Row(
                        children: [
                          Container(
                            width: 36,
                            height: 36,
                            decoration: BoxDecoration(
                              color: const Color(0xFFEEF4FF),
                              borderRadius: BorderRadius.circular(10),
                            ),
                            child: const Icon(Icons.work_history_rounded,
                                color: Color(0xFF0F3D91), size: 18),
                          ),
                          const SizedBox(width: 10),
                          const Text(
                            'Work Session',
                            style: TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w700,
                              color: Color(0xFF0F172A),
                            ),
                          ),
                          const Spacer(),
                          // Total hours pill
                          if (dur != null)
                            Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 10, vertical: 5),
                              decoration: BoxDecoration(
                                gradient: const LinearGradient(
                                  colors: [
                                    Color(0xFF0F3D91),
                                    Color(0xFF1E63FF)
                                  ],
                                  begin: Alignment.topLeft,
                                  end: Alignment.bottomRight,
                                ),
                                borderRadius: BorderRadius.circular(10),
                              ),
                              child: Text(
                                _fmtDuration(dur),
                                style: const TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w800,
                                  color: Colors.white,
                                ),
                              ),
                            )
                          else
                            Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 10, vertical: 5),
                              decoration: BoxDecoration(
                                color: const Color(0xFFFFF3CD),
                                borderRadius: BorderRadius.circular(10),
                              ),
                              child: const Text(
                                'Incomplete',
                                style: TextStyle(
                                  fontSize: 11,
                                  fontWeight: FontWeight.w700,
                                  color: Color(0xFFB45309),
                                ),
                              ),
                            ),
                        ],
                      ),

                      const SizedBox(height: 14),
                      Container(height: 1, color: const Color(0xFFF1F5F9)),
                      const SizedBox(height: 14),

                      // ── Check-In / Check-Out rows ───────────────────────
                      _timeRow(
                        icon: Icons.login_rounded,
                        label: 'Check In',
                        time: _fmtTime(inDt),
                        date: _fmtDate(inDt),
                        color: const Color(0xFF22C55E),
                        bg: const Color(0xFFEFFFF5),
                        missing: inDt == null,
                      ),
                      const SizedBox(height: 10),
                      _timeRow(
                        icon: Icons.logout_rounded,
                        label: 'Check Out',
                        time: _fmtTime(outDt),
                        date: _fmtDate(outDt),
                        color: const Color(0xFFEF4444),
                        bg: const Color(0xFFFFEDED),
                        missing: outDt == null,
                      ),

                      // ── GPS pill ────────────────────────────────────────
                      if (hasGps)
                        Padding(
                          padding: const EdgeInsets.only(top: 10),
                          child: _Pill(
                            icon: Icons.location_on_rounded,
                            label: 'GPS Verified',
                            color: const Color(0xFF0EA5E9),
                            bg: const Color(0xFFE0F7FF),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _timeRow({
    required IconData icon,
    required String label,
    required String time,
    required String date,
    required Color color,
    required Color bg,
    required bool missing,
  }) {
    return Row(
      children: [
        Container(
          width: 32,
          height: 32,
          decoration: BoxDecoration(
              color: missing ? const Color(0xFFF1F5F9) : bg,
              borderRadius: BorderRadius.circular(9)),
          child: Icon(icon,
              color: missing ? const Color(0xFF94A3B8) : color, size: 16),
        ),
        const SizedBox(width: 10),
        Text(
          label,
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: missing
                ? const Color(0xFF94A3B8)
                : const Color(0xFF475569),
          ),
        ),
        const Spacer(),
        if (missing)
          const Text('—',
              style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: Color(0xFF94A3B8)))
        else
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                time,
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w800,
                  color: color,
                ),
              ),
              Text(
                date,
                style: const TextStyle(
                  fontSize: 10,
                  color: Color(0xFF94A3B8),
                ),
              ),
            ],
          ),
      ],
    );
  }

  static DateTime? _toLocal(dynamic ts) =>
      ts == null ? null : DateTime.tryParse(ts.toString())?.toLocal();

  static String _fmtTime(DateTime? dt) {
    if (dt == null) return '—';
    return '${_p(dt.hour)}:${_p(dt.minute)}';
  }

  static String _fmtDate(DateTime? dt) {
    if (dt == null) return '';
    return '${_p(dt.day)}/${_p(dt.month)}/${dt.year}';
  }

  static String _fmtDuration(Duration d) {
    final h = d.inHours;
    final m = d.inMinutes % 60;
    return h > 0 ? '${h}h ${m}m' : '${m}m';
  }

  static String _p(int n) => n.toString().padLeft(2, '0');
}

// ── Log Card ──────────────────────────────────────────────────────────────────

class _LogCard extends StatelessWidget {
  const _LogCard({required this.log});
  final Map<String, dynamic> log;

  @override
  Widget build(BuildContext context) {
    final action = log['action']?.toString() ?? '';
    final isIn = action == 'IN';
    final dt = DateTime.tryParse(
            log['timestamp_utc']?.toString() ?? '')
        ?.toLocal();
    final hasGps = log['gps_lat'] != null && log['gps_lng'] != null;
    final source = log['source']?.toString();

    final accentColor =
        isIn ? const Color(0xFF22C55E) : const Color(0xFFEF4444);
    final iconBg =
        isIn ? const Color(0xFFEFFFF5) : const Color(0xFFFFEDED);
    final iconColor =
        isIn ? const Color(0xFF22C55E) : const Color(0xFFEF4444);

    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: const Color(0xFFE2E8F0)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.04),
            blurRadius: 10,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(18),
        child: IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Colored left-border accent stripe
              Container(width: 4, color: accentColor),

              // Card content
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(14, 14, 14, 14),
                  child: Row(
                    children: [
                      // Action icon badge
                      Container(
                        width: 44,
                        height: 44,
                        decoration: BoxDecoration(
                          color: iconBg,
                          borderRadius: BorderRadius.circular(13),
                        ),
                        child: Icon(
                          isIn
                              ? Icons.login_rounded
                              : Icons.logout_rounded,
                          color: iconColor,
                          size: 22,
                        ),
                      ),
                      const SizedBox(width: 12),

                      // Text column
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text(
                              isIn ? 'Checked In' : 'Checked Out',
                              style: const TextStyle(
                                fontSize: 14,
                                fontWeight: FontWeight.w700,
                                color: Color(0xFF0F172A),
                              ),
                            ),
                            const SizedBox(height: 3),
                            Text(
                              _formatDateTime(dt),
                              style: const TextStyle(
                                fontSize: 12,
                                color: StafivoColors.textSecondary,
                              ),
                            ),
                            if (hasGps || source == 'manager')
                              Padding(
                                padding: const EdgeInsets.only(top: 7),
                                child: Wrap(
                                  spacing: 6,
                                  runSpacing: 4,
                                  children: [
                                    if (hasGps)
                                      _Pill(
                                        icon: Icons.location_on_rounded,
                                        label: 'GPS Verified',
                                        color: const Color(0xFF0EA5E9),
                                        bg: const Color(0xFFE0F7FF),
                                      ),
                                    if (source == 'manager')
                                      _Pill(
                                        icon: Icons.admin_panel_settings_rounded,
                                        label: 'Manager',
                                        color: const Color(0xFF7C3AED),
                                        bg: const Color(0xFFF3E8FF),
                                      ),
                                  ],
                                ),
                              ),
                          ],
                        ),
                      ),

                      // Right-side time block
                      Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Text(
                            _formatTime(dt),
                            style: TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.w800,
                              color: accentColor,
                            ),
                          ),
                          Text(
                            isIn ? 'IN' : 'OUT',
                            style: TextStyle(
                              fontSize: 10,
                              fontWeight: FontWeight.w700,
                              color: accentColor.withValues(alpha: 0.7),
                              letterSpacing: 0.8,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  static String _formatTime(DateTime? dt) {
    if (dt == null) return '—:——';
    return '${_p(dt.hour)}:${_p(dt.minute)}';
  }

  static String _formatDateTime(DateTime? dt) {
    if (dt == null) return '—';
    return '${_p(dt.day)}/${_p(dt.month)}/${dt.year}  ${_p(dt.hour)}:${_p(dt.minute)}';
  }

  static String _p(int n) => n.toString().padLeft(2, '0');
}

// ── Small reusable widgets ────────────────────────────────────────────────────

class _Pill extends StatelessWidget {
  const _Pill({
    required this.icon,
    required this.label,
    required this.color,
    required this.bg,
  });
  final IconData icon;
  final String label;
  final Color color;
  final Color bg;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration:
          BoxDecoration(color: bg, borderRadius: BorderRadius.circular(8)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: color, size: 11),
          const SizedBox(width: 4),
          Text(label,
              style: TextStyle(
                  fontSize: 10, fontWeight: FontWeight.w600, color: color)),
        ],
      ),
    );
  }
}

class _SummaryPill extends StatelessWidget {
  const _SummaryPill({
    required this.icon,
    required this.label,
    required this.value,
  });
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
                  fontSize: 12,
                  fontWeight: FontWeight.w700)),
        ],
      ),
    );
  }
}

class _FilterChip extends StatelessWidget {
  const _FilterChip({
    required this.label,
    required this.value,
    required this.current,
    required this.onTap,
  });
  final String label;
  final String value;
  final String current;
  final ValueChanged<String> onTap;

  @override
  Widget build(BuildContext context) {
    final selected = current == value;
    return GestureDetector(
      onTap: () => onTap(value),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        decoration: BoxDecoration(
          color: selected ? StafivoColors.primary : const Color(0xFFF1F5F9),
          borderRadius: BorderRadius.circular(20),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: selected ? Colors.white : StafivoColors.textSecondary,
          ),
        ),
      ),
    );
  }
}
