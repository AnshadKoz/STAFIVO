import 'dart:developer' as developer;
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../services/worker_context.dart';
import '../theme/stafivo_colors.dart';
import '../widgets/stafivo_app_bar.dart';
import 'worker_shell.dart';

/// Worker Dashboard — personal overview screen.
/// Uses WorkerContext for profile/rates (no extra fetch).
/// Separately fetches: face enrollment status, attendance stats, weekly/monthly hours.
class WorkerDashboardScreen extends StatefulWidget {
  const WorkerDashboardScreen({super.key});

  @override
  State<WorkerDashboardScreen> createState() => _WorkerDashboardScreenState();
}

class _WorkerDashboardScreenState extends State<WorkerDashboardScreen> {
  final _client = Supabase.instance.client;

  bool _loading = true;
  String? _error;

  bool _faceEnrolled = false;
  String? _lastCheckIn;
  int _totalCheckIns = 0;
  double _weeklyHours = 0;
  double _monthlyHours = 0;

  bool _initialized = false; // race-condition guard

  @override
  void initState() {
    super.initState();
    // _loadData() is triggered from didChangeDependencies once WorkerContext is ready.
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final ctx = context.read<WorkerContext>();
    if (ctx.isLoaded && !_initialized) {
      _initialized = true;
      _loadData();
    }
  }

  Future<void> _loadData() async {
    setState(() { _loading = true; _error = null; });
    try {
      // WorkerContext is guaranteed loaded by didChangeDependencies guard.
      final ctx = context.read<WorkerContext>();
      if (ctx.workerId == null) throw Exception('Worker profile not found');
      final workerId = ctx.workerId!;

      // Face enrollment
      bool faceEnrolled = false;
      try {
        final profileRow = await _client
            .from('face_profiles')
            .select('worker_id')
            .eq('worker_id', workerId)
            .maybeSingle();
        faceEnrolled = profileRow != null;
      } catch (e) {
        developer.log('Dashboard: face_profiles check failed: $e', name: 'WorkerDashboard');
      }

      // Attendance: last check-in + total count
      String? lastCheckIn;
      int totalCheckIns = 0;
      try {
        final lastRow = await _client
            .from('attendance_logs')
            .select('timestamp_utc')
            .eq('worker_id', workerId)
            .eq('action', 'IN')
            .order('timestamp_utc', ascending: false)
            .limit(1)
            .maybeSingle();
        if (lastRow != null) {
          final ts = lastRow['timestamp_utc']?.toString();
          if (ts != null) {
            final dt = DateTime.tryParse(ts)?.toLocal();
            if (dt != null) {
              lastCheckIn =
                  '${_pad(dt.day)}/${_pad(dt.month)}/${dt.year}  ${_pad(dt.hour)}:${_pad(dt.minute)}';
            }
          }
        }
        final countRows = await _client
            .from('attendance_logs')
            .select('id')
            .eq('worker_id', workerId)
            .eq('action', 'IN');
        totalCheckIns = (countRows as List).length;
      } catch (e) {
        developer.log('Dashboard: attendance fetch failed: $e', name: 'WorkerDashboard');
      }

      // Weekly / Monthly hours from worker_daily_hours
      double weeklyHours = 0;
      double monthlyHours = 0;
      try {
        final now = DateTime.now().toUtc();
        final weekStart = now.subtract(Duration(days: now.weekday - 1));
        final monthStart = DateTime.utc(now.year, now.month, 1);
        final todayStr = now.toIso8601String().substring(0, 10);
        final weekStartStr = weekStart.toIso8601String().substring(0, 10);
        final monthStartStr = monthStart.toIso8601String().substring(0, 10);

        final weekRows = await _client
            .from('worker_daily_hours')
            .select('hours_worked')
            .eq('worker_id', workerId)
            .gte('work_date', weekStartStr)
            .lte('work_date', todayStr);
        weeklyHours = (weekRows as List)
            .map((r) => (r['hours_worked'] as num? ?? 0).toDouble())
            .fold(0.0, (a, b) => a + b);

        final monthRows = await _client
            .from('worker_daily_hours')
            .select('hours_worked')
            .eq('worker_id', workerId)
            .gte('work_date', monthStartStr)
            .lte('work_date', todayStr);
        monthlyHours = (monthRows as List)
            .map((r) => (r['hours_worked'] as num? ?? 0).toDouble())
            .fold(0.0, (a, b) => a + b);
      } catch (e) {
        developer.log('Dashboard: hours fetch failed: $e', name: 'WorkerDashboard');
      }

      if (!mounted) return;
      setState(() {
        _faceEnrolled = faceEnrolled;
        _lastCheckIn = lastCheckIn;
        _totalCheckIns = totalCheckIns;
        _weeklyHours = weeklyHours;
        _monthlyHours = monthlyHours;
        _loading = false;
      });
    } catch (e, stack) {
      developer.log('Dashboard load failed: $e',
          name: 'WorkerDashboard', error: e, stackTrace: stack);
      if (!mounted) return;
      setState(() {
        _error = 'Failed to load dashboard. Please try again.';
        _loading = false;
      });
    }
  }

  String _pad(int n) => n.toString().padLeft(2, '0');

  @override
  Widget build(BuildContext context) {
    // Wait for WorkerContext to be ready before rendering content or
    // triggering _loadData — prevents false "Failed to load" on first open.
    final ctx = context.watch<WorkerContext>();
    if (!ctx.isLoaded) {
      return Scaffold(
        appBar: stafivoAppBar(context, 'My Dashboard', implyLeading: false),
        body: const SafeArea(child: Center(child: CircularProgressIndicator())),
      );
    }

    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      body: SafeArea(
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : _error != null
                ? _buildError()
                : _buildContent(ctx),
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
            Text(
              _error!,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Color(0xFF1E293B),
                fontSize: 15,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 24),
            SizedBox(
              height: 48,
              child: FilledButton.icon(
                onPressed: _loadData,
                icon: const Icon(Icons.refresh_rounded),
                label: const Text('Try Again'),
                style: FilledButton.styleFrom(
                  backgroundColor: StafivoColors.primary,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildContent(WorkerContext ctx) {
    return RefreshIndicator(
      onRefresh: _loadData,
      color: StafivoColors.primary,
      child: CustomScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          // ── Hero profile banner ──────────────────────────────────────────
          SliverToBoxAdapter(child: _buildHeroBanner(ctx)),

          // ── Content padding ──────────────────────────────────────────────
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 32),
            sliver: SliverList(
              delegate: SliverChildListDelegate([
                const SizedBox(height: 20),

                // ── Hours stats ─────────────────────────────────────────────
                _buildSectionLabel('Hours Overview'),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: _HoursCard(
                        label: 'This Week',
                        value: _weeklyHours.toStringAsFixed(1),
                        icon: Icons.calendar_today_rounded,
                        gradientColors: const [Color(0xFF0F3D91), Color(0xFF1E63FF)],
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: _HoursCard(
                        label: 'This Month',
                        value: _monthlyHours.toStringAsFixed(1),
                        icon: Icons.date_range_rounded,
                        gradientColors: const [Color(0xFF6B21A8), Color(0xFFA855F7)],
                      ),
                    ),
                  ],
                ),

                const SizedBox(height: 20),

                // ── Status stats ────────────────────────────────────────────
                _buildSectionLabel('Status'),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: _StatusCard(
                        icon: Icons.fingerprint_rounded,
                        label: 'Face ID',
                        status: _faceEnrolled ? 'Enrolled' : 'Not Enrolled',
                        statusColor: _faceEnrolled
                            ? const Color(0xFF22C55E)
                            : const Color(0xFFEF4444),
                        bgColor: _faceEnrolled
                            ? const Color(0xFFEFFFF5)
                            : const Color(0xFFFFEDED),
                        iconColor: _faceEnrolled
                            ? const Color(0xFF22C55E)
                            : const Color(0xFFEF4444),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: _StatusCard(
                        icon: Icons.login_rounded,
                        label: 'Total Check-ins',
                        status: _totalCheckIns.toString(),
                        statusColor: StafivoColors.primary,
                        bgColor: const Color(0xFFEEF4FF),
                        iconColor: StafivoColors.primary,
                      ),
                    ),
                  ],
                ),

                const SizedBox(height: 20),

                // ── Pay rates ───────────────────────────────────────────────
                if (ctx.baseSalaryPerHour != null || ctx.otRatePerHour != null) ...[
                  _buildSectionLabel('Pay Rates'),
                  const SizedBox(height: 10),
                  _buildRatesCard(ctx),
                  const SizedBox(height: 20),
                ],

                // ── Last check-in ───────────────────────────────────────────
                _buildSectionLabel('Last Activity'),
                const SizedBox(height: 10),
                _buildLastCheckInCard(),

                const SizedBox(height: 24),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.swipe_down_rounded,
                        size: 14, color: StafivoColors.textMuted),
                    const SizedBox(width: 6),
                    Text(
                      'Pull down to refresh',
                      style: TextStyle(
                        fontSize: 12,
                        color: StafivoColors.textMuted,
                      ),
                    ),
                  ],
                ),
              ]),
            ),
          ),
        ],
      ),
    );
  }

  // ── Hero banner with gradient ───────────────────────────────────────────────
  Widget _buildHeroBanner(WorkerContext ctx) {
    return Container(
      width: double.infinity,
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          colors: [Color(0xFF0F3D91), Color(0xFF1E63FF)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      child: Stack(
        children: [
          // Decorative circle top-right
          Positioned(
            top: -30,
            right: -30,
            child: Container(
              width: 130,
              height: 130,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: Colors.white.withValues(alpha: 0.06),
              ),
            ),
          ),
          Positioned(
            bottom: -20,
            left: 40,
            child: Container(
              width: 80,
              height: 80,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: Colors.white.withValues(alpha: 0.05),
              ),
            ),
          ),
          // Content
          Padding(
            padding: const EdgeInsets.fromLTRB(24, 20, 24, 28),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Back button + title row
                Row(
                  children: [
                    GestureDetector(
                      onTap: () => workerShellKey.currentState?.switchToTab(0),
                      child: Container(
                        width: 36,
                        height: 36,
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: 0.15),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: const Icon(Icons.arrow_back_ios_new_rounded,
                            color: Colors.white, size: 16),
                      ),
                    ),
                    const SizedBox(width: 12),
                    const Text(
                      'My Dashboard',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 18,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 0.2,
                      ),
                    ),
                    const Spacer(),
                    GestureDetector(
                      onTap: _loadData,
                      child: Container(
                        width: 36,
                        height: 36,
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: 0.15),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: const Icon(Icons.refresh_rounded,
                            color: Colors.white, size: 18),
                      ),
                    ),
                  ],
                ),

                const SizedBox(height: 24),

                // Avatar + worker info
                Row(
                  children: [
                    Container(
                      width: 64,
                      height: 64,
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.2),
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(
                          color: Colors.white.withValues(alpha: 0.4),
                          width: 2,
                        ),
                      ),
                      child: const Icon(Icons.person_rounded,
                          color: Colors.white, size: 34),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            ctx.workerName ?? '—',
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 20,
                              fontWeight: FontWeight.w800,
                              letterSpacing: 0.1,
                            ),
                          ),
                          if (ctx.outletName != null) ...[
                            const SizedBox(height: 6),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 10, vertical: 4),
                              decoration: BoxDecoration(
                                color: Colors.white.withValues(alpha: 0.15),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  const Icon(Icons.store_rounded,
                                      color: Colors.white70, size: 12),
                                  const SizedBox(width: 5),
                                  Flexible(
                                    child: Text(
                                      ctx.outletName!,
                                      style: const TextStyle(
                                        color: Colors.white,
                                        fontSize: 12,
                                        fontWeight: FontWeight.w500,
                                      ),
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ── Section label ─────────────────────────────────────────────────────────
  Widget _buildSectionLabel(String title) {
    return Text(
      title,
      style: const TextStyle(
        fontSize: 13,
        fontWeight: FontWeight.w700,
        color: StafivoColors.textSecondary,
        letterSpacing: 0.6,
      ),
    );
  }

  // ── Rates card ────────────────────────────────────────────────────────────
  Widget _buildRatesCard(WorkerContext ctx) {
    return Container(
      padding: const EdgeInsets.all(20),
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
      child: Row(
        children: [
          Expanded(
            child: _RateItem(
              label: 'Base Rate',
              value: ctx.baseSalaryPerHour != null
                  ? '₹${ctx.baseSalaryPerHour!.toStringAsFixed(2)}/hr'
                  : 'Not set',
              icon: Icons.attach_money_rounded,
              color: const Color(0xFF0F3D91),
            ),
          ),
          Container(
            width: 1,
            height: 48,
            color: const Color(0xFFE2E8F0),
          ),
          Expanded(
            child: _RateItem(
              label: 'OT Rate',
              value: ctx.otRatePerHour != null
                  ? '₹${ctx.otRatePerHour!.toStringAsFixed(2)}/hr'
                  : 'Not set',
              icon: Icons.more_time_rounded,
              color: const Color(0xFF7C3AED),
            ),
          ),
        ],
      ),
    );
  }

  // ── Last check-in card ────────────────────────────────────────────────────
  Widget _buildLastCheckInCard() {
    return Container(
      padding: const EdgeInsets.all(20),
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
      child: Row(
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [Color(0xFF0F3D91), Color(0xFF1E63FF)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              borderRadius: BorderRadius.circular(14),
            ),
            child: const Icon(Icons.access_time_filled_rounded,
                color: Colors.white, size: 24),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'LAST CHECK-IN',
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                    color: StafivoColors.textSecondary,
                    letterSpacing: 1.0,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  _lastCheckIn ?? 'No check-ins yet',
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: _lastCheckIn != null
                        ? const Color(0xFF0F172A)
                        : StafivoColors.textMuted,
                  ),
                ),
              ],
            ),
          ),
          if (_lastCheckIn != null)
            Container(
              padding:
                  const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
              decoration: BoxDecoration(
                color: const Color(0xFFEFFFF5),
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Text(
                '✓ Done',
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  color: Color(0xFF22C55E),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

// ── Reusable widgets ──────────────────────────────────────────────────────────

class _HoursCard extends StatelessWidget {
  const _HoursCard({
    required this.label,
    required this.value,
    required this.icon,
    required this.gradientColors,
  });
  final String label;
  final String value;
  final IconData icon;
  final List<Color> gradientColors;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: gradientColors,
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(20),
        boxShadow: [
          BoxShadow(
            color: gradientColors.last.withValues(alpha: 0.28),
            blurRadius: 14,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.18),
              borderRadius: BorderRadius.circular(11),
            ),
            child: Icon(icon, color: Colors.white, size: 20),
          ),
          const SizedBox(height: 14),
          Text(
            '$value hrs',
            style: const TextStyle(
              color: Colors.white,
              fontSize: 22,
              fontWeight: FontWeight.w800,
              letterSpacing: -0.5,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            label,
            style: TextStyle(
              color: Colors.white.withValues(alpha: 0.75),
              fontSize: 12,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }
}

class _StatusCard extends StatelessWidget {
  const _StatusCard({
    required this.icon,
    required this.label,
    required this.status,
    required this.statusColor,
    required this.bgColor,
    required this.iconColor,
  });
  final IconData icon;
  final String label;
  final String status;
  final Color statusColor;
  final Color bgColor;
  final Color iconColor;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
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
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              color: bgColor,
              borderRadius: BorderRadius.circular(13),
            ),
            child: Icon(icon, color: iconColor, size: 22),
          ),
          const SizedBox(height: 14),
          Text(
            status,
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w800,
              color: statusColor,
              letterSpacing: -0.3,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            label,
            style: const TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w500,
              color: StafivoColors.textSecondary,
            ),
          ),
        ],
      ),
    );
  }
}

class _RateItem extends StatelessWidget {
  const _RateItem({
    required this.label,
    required this.value,
    required this.icon,
    required this.color,
  });
  final String label;
  final String value;
  final IconData icon;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12),
      child: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.10),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, color: color, size: 18),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: const TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w600,
                    color: StafivoColors.textSecondary,
                    letterSpacing: 0.3,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  value,
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w800,
                    color: color,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
