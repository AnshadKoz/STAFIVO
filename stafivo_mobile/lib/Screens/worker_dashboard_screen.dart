import 'dart:developer' as developer;
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../services/worker_context.dart';
import '../theme/stafivo_colors.dart';
import '../widgets/stafivo_app_bar.dart';

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

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadData());
  }

  Future<void> _loadData() async {
    setState(() { _loading = true; _error = null; });
    try {
      // Ensure WorkerContext is loaded (no-op if already cached)
      final ctx = context.read<WorkerContext>();
      await ctx.load();
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
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: stafivoAppBar(context, 'My Dashboard', implyLeading: false),
      body: SafeArea(
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : _error != null
                ? _buildError(scheme)
                : _buildContent(scheme),
      ),
    );
  }

  Widget _buildError(ColorScheme scheme) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.error_outline_rounded, size: 48, color: scheme.error),
            const SizedBox(height: 16),
            Text(_error!,
                textAlign: TextAlign.center,
                style: TextStyle(
                    color: scheme.error, fontWeight: FontWeight.w600)),
            const SizedBox(height: 24),
            FilledButton.icon(
                onPressed: _loadData,
                icon: const Icon(Icons.refresh),
                label: const Text('Retry')),
          ],
        ),
      ),
    );
  }

  Widget _buildContent(ColorScheme scheme) {
    // Reads profile from shared context — zero extra fetch
    final ctx = context.watch<WorkerContext>();

    return RefreshIndicator(
      onRefresh: _loadData,
      child: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          // ── Identity card ──────────────────────────────────────────────────
          _SectionCard(
            child: Row(
              children: [
                CircleAvatar(
                  radius: 30,
                  backgroundColor: scheme.primary.withValues(alpha: 0.12),
                  child: Icon(Icons.person_rounded,
                      color: scheme.primary, size: 34),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        ctx.workerName ?? '—',
                        style: Theme.of(context)
                            .textTheme
                            .titleLarge
                            ?.copyWith(fontWeight: FontWeight.w700),
                      ),
                      if (ctx.outletName != null) ...[
                        const SizedBox(height: 3),
                        Row(
                          children: [
                            const Icon(Icons.store_rounded,
                                size: 13, color: StafivoColors.textMuted),
                            const SizedBox(width: 4),
                            Text(ctx.outletName!,
                                style: Theme.of(context)
                                    .textTheme
                                    .bodySmall
                                    ?.copyWith(
                                        color: StafivoColors.textSecondary)),
                          ],
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(height: 14),

          // ── Hours stats ────────────────────────────────────────────────────
          Row(
            children: [
              Expanded(
                child: _StatCard(
                  icon: Icons.calendar_today_rounded,
                  label: 'This Week',
                  value: '${_weeklyHours.toStringAsFixed(1)} hrs',
                  scheme: scheme,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _StatCard(
                  icon: Icons.date_range_rounded,
                  label: 'This Month',
                  value: '${_monthlyHours.toStringAsFixed(1)} hrs',
                  scheme: scheme,
                ),
              ),
            ],
          ),

          const SizedBox(height: 12),

          // ── Face + Check-in stats ──────────────────────────────────────────
          Row(
            children: [
              Expanded(
                child: _StatCard(
                  icon: Icons.fingerprint_rounded,
                  label: 'Face',
                  value: _faceEnrolled ? 'Enrolled' : 'Not enrolled',
                  valueColor: _faceEnrolled
                      ? Colors.green.shade600
                      : scheme.error,
                  scheme: scheme,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _StatCard(
                  icon: Icons.login_rounded,
                  label: 'Total Check-ins',
                  value: _totalCheckIns.toString(),
                  scheme: scheme,
                ),
              ),
            ],
          ),

          const SizedBox(height: 12),

          // ── Rates (from WorkerContext, zero fetch) ─────────────────────────
          if (ctx.baseSalaryPerHour != null || ctx.otRatePerHour != null)
            _SectionCard(
              child: Row(
                children: [
                  Expanded(
                    child: _RateRow(
                      label: 'Base Rate',
                      value: ctx.baseSalaryPerHour != null
                          ? '₹${ctx.baseSalaryPerHour!.toStringAsFixed(2)}/hr'
                          : 'Not set',
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _RateRow(
                      label: 'OT Rate',
                      value: ctx.otRatePerHour != null
                          ? '₹${ctx.otRatePerHour!.toStringAsFixed(2)}/hr'
                          : 'Not set',
                    ),
                  ),
                ],
              ),
            ),

          const SizedBox(height: 12),

          // ── Last check-in ──────────────────────────────────────────────────
          _SectionCard(
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: scheme.primary.withValues(alpha: 0.10),
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: Icon(Icons.access_time_rounded,
                      color: scheme.primary, size: 22),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Last Check-in',
                          style:
                              Theme.of(context).textTheme.labelMedium?.copyWith(
                                    color: scheme.onSurface
                                        .withValues(alpha: 0.55),
                                    fontWeight: FontWeight.w600,
                                  )),
                      const SizedBox(height: 4),
                      Text(
                        _lastCheckIn ?? 'No check-ins yet',
                        style:
                            Theme.of(context).textTheme.bodyMedium?.copyWith(
                                  fontWeight: FontWeight.w700,
                                  color: _lastCheckIn != null
                                      ? scheme.onSurface
                                      : scheme.onSurface
                                          .withValues(alpha: 0.4),
                                ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(height: 8),
          Text(
            'Pull down to refresh',
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: scheme.onSurface.withValues(alpha: 0.35),
                ),
          ),
        ],
      ),
    );
  }
}

// ── Reusable widgets ──────────────────────────────────────────────────────────

class _SectionCard extends StatelessWidget {
  const _SectionCard({required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest.withValues(alpha: 0.35),
        borderRadius: BorderRadius.circular(22),
      ),
      child: child,
    );
  }
}

class _StatCard extends StatelessWidget {
  const _StatCard({
    required this.icon,
    required this.label,
    required this.value,
    required this.scheme,
    this.valueColor,
  });
  final IconData icon;
  final String label;
  final String value;
  final ColorScheme scheme;
  final Color? valueColor;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest.withValues(alpha: 0.35),
        borderRadius: BorderRadius.circular(22),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: scheme.primary, size: 24),
          const SizedBox(height: 12),
          Text(value,
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w800,
                    color: valueColor ?? scheme.onSurface,
                  )),
          const SizedBox(height: 2),
          Text(label,
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: scheme.onSurface.withValues(alpha: 0.5),
                  )),
        ],
      ),
    );
  }
}

class _RateRow extends StatelessWidget {
  const _RateRow({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label,
              style: const TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  color: StafivoColors.textSecondary)),
          const SizedBox(height: 3),
          Text(value,
              style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w800,
                  color: StafivoColors.primary)),
        ],
      );
}
