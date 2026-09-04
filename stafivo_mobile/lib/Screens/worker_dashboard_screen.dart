import 'dart:developer' as developer;

import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../widgets/stafivo_app_bar.dart';

/// Read-only personal dashboard for the logged-in worker.
///
/// Queries ONLY existing tables — no schema changes, no new RPCs.
/// Tables used (SELECT only):
///   workers          → name, id
///   face_profiles    → exists check for enrollment status
///   attendance_logs  → last check-in timestamp + total count
class WorkerDashboardScreen extends StatefulWidget {
  const WorkerDashboardScreen({super.key});

  @override
  State<WorkerDashboardScreen> createState() => _WorkerDashboardScreenState();
}

class _WorkerDashboardScreenState extends State<WorkerDashboardScreen> {
  final _client = Supabase.instance.client;

  bool _loading = true;
  String? _error;

  String? _workerName;
  String? _workerId;
  bool _faceEnrolled = false;
  String? _lastCheckIn;
  int _totalCheckIns = 0;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final authUser = _client.auth.currentUser;
      if (authUser == null) {
        setState(() {
          _error = 'Not logged in.';
          _loading = false;
        });
        return;
      }

      // ── 1. Resolve worker from auth_id ────────────────────────────────────
      final workerRow = await _client
          .from('workers')
          .select('id, name')
          .eq('auth_id', authUser.id)
          .maybeSingle();

      if (workerRow == null) {
        setState(() {
          _error = 'Worker profile not found.';
          _loading = false;
        });
        return;
      }

      final workerId = workerRow['id']?.toString() ?? '';
      final workerName = workerRow['name']?.toString() ?? 'Worker';

      // ── 2. Face enrollment status ─────────────────────────────────────────
      bool faceEnrolled = false;
      try {
        final profileRow = await _client
            .from('face_profiles')
            .select('worker_id')
            .eq('worker_id', workerId)
            .maybeSingle();
        faceEnrolled = profileRow != null;
      } catch (e) {
        developer.log('Dashboard: face_profiles check failed: $e',
            name: 'WorkerDashboard');
      }

      // ── 3. Attendance: last check-in + total count ────────────────────────
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
        developer.log('Dashboard: attendance fetch failed: $e',
            name: 'WorkerDashboard');
      }

      if (!mounted) return;
      setState(() {
        _workerId = workerId;
        _workerName = workerName;
        _faceEnrolled = faceEnrolled;
        _lastCheckIn = lastCheckIn;
        _totalCheckIns = totalCheckIns;
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
      appBar: stafivoAppBar(context, 'My Dashboard'),
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
            Text(
              _error!,
              textAlign: TextAlign.center,
              style: TextStyle(
                  color: scheme.error, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: _loadData,
              icon: const Icon(Icons.refresh),
              label: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildContent(ColorScheme scheme) {
    return RefreshIndicator(
      onRefresh: _loadData,
      child: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          // ── Worker identity card ──────────────────────────────────────────
          _SectionCard(
            child: Row(
              children: [
                CircleAvatar(
                  radius: 30,
                  backgroundColor: scheme.primary.withValues(alpha: 0.12),
                  child:
                      Icon(Icons.person_rounded, color: scheme.primary, size: 34),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _workerName ?? '',
                        style: Theme.of(context)
                            .textTheme
                            .titleLarge
                            ?.copyWith(fontWeight: FontWeight.w700),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'ID: ${_shortId(_workerId)}',
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: scheme.onSurface.withValues(alpha: 0.55),
                            ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(height: 16),

          // ── Stats row ─────────────────────────────────────────────────────
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

          const SizedBox(height: 16),

          // ── Last check-in ─────────────────────────────────────────────────
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
                      Text(
                        'Last Check-in',
                        style: Theme.of(context).textTheme.labelMedium?.copyWith(
                              color: scheme.onSurface.withValues(alpha: 0.55),
                              fontWeight: FontWeight.w600,
                            ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        _lastCheckIn ?? 'No check-ins yet',
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                              fontWeight: FontWeight.w700,
                              color: _lastCheckIn != null
                                  ? scheme.onSurface
                                  : scheme.onSurface.withValues(alpha: 0.4),
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

  String _shortId(String? id) {
    if (id == null || id.length < 8) return id ?? '—';
    return '…${id.substring(id.length - 8)}';
  }
}

// ── Small reusable widgets ────────────────────────────────────────────────────

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
          Text(
            value,
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w800,
                  color: valueColor ?? scheme.onSurface,
                ),
          ),
          const SizedBox(height: 2),
          Text(
            label,
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: scheme.onSurface.withValues(alpha: 0.5),
                ),
          ),
        ],
      ),
    );
  }
}
