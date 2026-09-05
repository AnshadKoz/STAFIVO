import 'dart:developer' as developer;
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../services/worker_context.dart';
import '../theme/stafivo_colors.dart';
import '../widgets/async_state_widget.dart';
import '../widgets/stafivo_app_bar.dart';

/// Salary Screen — paginated payroll records + adjustments with fine appeals.
/// Uses WorkerContext to avoid re-fetching worker profile.
class SalaryScreen extends StatefulWidget {
  const SalaryScreen({super.key});

  @override
  State<SalaryScreen> createState() => _SalaryScreenState();
}

class _SalaryScreenState extends State<SalaryScreen> {
  final _client = Supabase.instance.client;

  static const _payrollPageSize = 12;
  static const _adjPageSize = 20;

  bool _loading = true;
  String? _error;

  // Payroll pagination
  List<Map<String, dynamic>> _payroll = [];
  bool _loadingMorePayroll = false;
  bool _hasMorePayroll = true;
  int _payrollOffset = 0;

  // Adjustments pagination
  List<Map<String, dynamic>> _adjustments = [];
  bool _loadingMoreAdj = false;
  bool _hasMoreAdj = true;
  int _adjOffset = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadInitial());
  }

  Future<String?> _resolveWorkerId() async {
    final ctx = context.read<WorkerContext>();
    if (ctx.isLoaded && ctx.workerId != null) return ctx.workerId;
    await ctx.load();
    return ctx.workerId;
  }

  Future<void> _loadInitial() async {
    setState(() {
      _loading = true;
      _error = null;
      _payroll = [];
      _payrollOffset = 0;
      _hasMorePayroll = true;
      _adjustments = [];
      _adjOffset = 0;
      _hasMoreAdj = true;
    });
    try {
      final workerId = await _resolveWorkerId();
      if (workerId == null) throw Exception('Worker profile not found');

      final payrollRows = await _client
          .from('payroll_records')
          .select(
              'id, payroll_month, base_salary, overtime, incentives, fines, calculated_total')
          .eq('worker_id', workerId)
          .order('payroll_month', ascending: false)
          .range(0, _payrollPageSize - 1);

      final adjRows = await _client
          .from('worker_adjustments')
          .select(
              'id, effective_date, kind, hours, amount, note, fine_appeals(id, status)')
          .eq('worker_id', workerId)
          .order('effective_date', ascending: false)
          .range(0, _adjPageSize - 1);

      if (!mounted) return;
      final p = List<Map<String, dynamic>>.from(payrollRows as List);
      final a = List<Map<String, dynamic>>.from(adjRows as List);
      setState(() {
        _payroll = p;
        _payrollOffset = p.length;
        _hasMorePayroll = p.length == _payrollPageSize;
        _adjustments = a;
        _adjOffset = a.length;
        _hasMoreAdj = a.length == _adjPageSize;
        _loading = false;
      });
    } catch (e, st) {
      developer.log('SalaryScreen._loadInitial: $e',
          name: 'SalaryScreen', error: e, stackTrace: st);
      if (!mounted) return;
      setState(() {
        _error = 'Failed to load salary data. Pull to retry.';
        _loading = false;
      });
    }
  }

  Future<void> _loadMorePayroll() async {
    if (!_hasMorePayroll || _loadingMorePayroll) return;
    final workerId = context.read<WorkerContext>().workerId;
    if (workerId == null) return;
    setState(() => _loadingMorePayroll = true);
    try {
      final rows = await _client
          .from('payroll_records')
          .select(
              'id, payroll_month, base_salary, overtime, incentives, fines, calculated_total')
          .eq('worker_id', workerId)
          .order('payroll_month', ascending: false)
          .range(_payrollOffset, _payrollOffset + _payrollPageSize - 1);
      final data = List<Map<String, dynamic>>.from(rows as List);
      if (!mounted) return;
      setState(() {
        _payroll.addAll(data);
        _payrollOffset += data.length;
        _hasMorePayroll = data.length == _payrollPageSize;
        _loadingMorePayroll = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _loadingMorePayroll = false);
    }
  }

  Future<void> _loadMoreAdj() async {
    if (!_hasMoreAdj || _loadingMoreAdj) return;
    final workerId = context.read<WorkerContext>().workerId;
    if (workerId == null) return;
    setState(() => _loadingMoreAdj = true);
    try {
      final rows = await _client
          .from('worker_adjustments')
          .select(
              'id, effective_date, kind, hours, amount, note, fine_appeals(id, status)')
          .eq('worker_id', workerId)
          .order('effective_date', ascending: false)
          .range(_adjOffset, _adjOffset + _adjPageSize - 1);
      final data = List<Map<String, dynamic>>.from(rows as List);
      if (!mounted) return;
      setState(() {
        _adjustments.addAll(data);
        _adjOffset += data.length;
        _hasMoreAdj = data.length == _adjPageSize;
        _loadingMoreAdj = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _loadingMoreAdj = false);
    }
  }

  // ── Fine appeal ─────────────────────────────────────────────────────────────

  Future<void> _submitAppeal(String adjustmentId, String reason) async {
    final ctx = context.read<WorkerContext>();
    final workerId = ctx.workerId;
    final outletId = ctx.outletId;
    if (workerId == null || outletId == null) {
      _showSnack('Your profile is not linked to an outlet yet.', isError: true);
      return;
    }
    try {
      // Duplicate guard
      final existing = await _client
          .from('fine_appeals')
          .select('id')
          .eq('adjustment_id', adjustmentId)
          .maybeSingle();
      if (existing != null) {
        _showSnack('An appeal is already pending or processed for this fine.',
            isError: true);
        return;
      }
      // Resolve manager
      final managerRow = await _client
          .from('managers')
          .select('id, app_user_id, is_active')
          .eq('outlet_id', outletId)
          .eq('is_active', true)
          .limit(1)
          .maybeSingle();
      if (managerRow == null) {
        _showSnack('No manager assigned to your outlet yet.', isError: true);
        return;
      }
      final managerAppUserId = managerRow['app_user_id']?.toString();
      if (managerAppUserId == null) {
        _showSnack('No manager account linked to your outlet yet.',
            isError: true);
        return;
      }
      // Insert appeal
      final appealRes = await _client
          .from('fine_appeals')
          .insert({
            'worker_id': workerId,
            'manager_id': managerAppUserId,
            'adjustment_id': adjustmentId,
            'reason': reason,
            'status': 'pending',
          })
          .select('id')
          .single();
      // Notify manager (non-fatal)
      try {
        await _client.from('notifications').insert({
          'user_id': managerAppUserId,
          'type': 'fine_appeal_created',
          'title': 'New fine appeal',
          'body': 'A worker submitted a fine appeal.',
          'data': {
            'appeal_id': appealRes['id'],
            'adjustment_id': adjustmentId
          },
          'is_read': false,
        });
      } catch (notifyErr) {
        developer.log('Appeal notification failed (non-fatal): $notifyErr',
            name: 'SalaryScreen');
      }
      _showSnack('Appeal submitted successfully.');
      await _loadInitial(); // refresh status badges
    } catch (e) {
      developer.log('Appeal submit failed: $e', name: 'SalaryScreen');
      _showSnack('Could not submit appeal. Please try again.', isError: true);
    }
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

  void _openAppealSheet(Map<String, dynamic> adj) {
    final controller = TextEditingController();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(
            left: 24,
            right: 24,
            top: 24,
            bottom: MediaQuery.of(ctx).viewInsets.bottom + 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Appeal this fine',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            Text('Adjustment on ${adj['effective_date'] ?? ''}',
                style: const TextStyle(
                    fontSize: 13, color: StafivoColors.textSecondary)),
            const SizedBox(height: 16),
            TextField(
              controller: controller,
              maxLines: 4,
              decoration: InputDecoration(
                hintText: 'Explain why this fine should be removed',
                border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12)),
                contentPadding: const EdgeInsets.all(14),
              ),
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: () async {
                  final reason = controller.text.trim();
                  if (reason.isEmpty) {
                    ScaffoldMessenger.of(ctx).showSnackBar(
                        const SnackBar(content: Text('Reason is required')));
                    return;
                  }
                  Navigator.pop(ctx);
                  await _submitAppeal(adj['id']?.toString() ?? '', reason);
                },
                style: FilledButton.styleFrom(
                  backgroundColor: StafivoColors.primary,
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12)),
                  padding: const EdgeInsets.symmetric(vertical: 14),
                ),
                child: const Text('Submit Appeal',
                    style: TextStyle(fontWeight: FontWeight.w700)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ── Build ───────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: stafivoAppBar(context, 'Salary & Adjustments', implyLeading: false),
      backgroundColor: StafivoColors.background,
      body: SafeArea(
        child: AsyncStateWidget(
          loading: _loading,
          error: _error,
          onRetry: _loadInitial,
          child: RefreshIndicator(
            onRefresh: _loadInitial,
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                // ── Rates banner (from shared context — zero extra fetch) ─────
                _RatesBanner(),

                const SizedBox(height: 20),

                // ── Payroll ──────────────────────────────────────────────────
                const _SectionHeader(title: 'Salary History'),
                const SizedBox(height: 8),
                if (_payroll.isEmpty)
                  const _EmptyCard(message: 'No salary records yet.')
                else ...[
                  ..._payroll.map((rec) => _PayrollCard(rec: rec)),
                  _PaginationFooter(
                    hasMore: _hasMorePayroll,
                    loading: _loadingMorePayroll,
                    onLoadMore: _loadMorePayroll,
                  ),
                ],

                const SizedBox(height: 24),

                // ── Adjustments ──────────────────────────────────────────────
                const _SectionHeader(title: 'Recent Adjustments'),
                const SizedBox(height: 4),
                const Text('OT, fines, incentives, deductions.',
                    style: TextStyle(
                        fontSize: 12, color: StafivoColors.textSecondary)),
                const SizedBox(height: 8),
                if (_adjustments.isEmpty)
                  const _EmptyCard(message: 'No adjustments yet.')
                else ...[
                  ..._adjustments.map((adj) => _AdjustmentCard(
                        adj: adj,
                        onAppeal: () => _openAppealSheet(adj),
                      )),
                  _PaginationFooter(
                    hasMore: _hasMoreAdj,
                    loading: _loadingMoreAdj,
                    onLoadMore: _loadMoreAdj,
                  ),
                ],
                const SizedBox(height: 24),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// ── Rates banner — reads from WorkerContext, zero extra fetch ─────────────────

class _RatesBanner extends StatelessWidget {
  const _RatesBanner();

  String _rate(double? v) => v != null ? '₹${v.toStringAsFixed(2)}/hr' : 'Not set';

  @override
  Widget build(BuildContext context) {
    final ctx = context.watch<WorkerContext>();
    if (!ctx.isLoaded) return const SizedBox.shrink();
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: StafivoColors.primary.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: StafivoColors.primary.withValues(alpha: 0.15)),
      ),
      child: Row(
        children: [
          Expanded(
            child: _RateChip(
                label: 'Base Rate', value: _rate(ctx.baseSalaryPerHour)),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: _RateChip(label: 'OT Rate', value: _rate(ctx.otRatePerHour)),
          ),
        ],
      ),
    );
  }
}

class _RateChip extends StatelessWidget {
  const _RateChip({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label,
            style: const TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: StafivoColors.textSecondary)),
        const SizedBox(height: 2),
        Text(value,
            style: const TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w800,
                color: StafivoColors.primary)),
      ],
    );
  }
}

// ── Shared UI pieces ──────────────────────────────────────────────────────────

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title});
  final String title;

  @override
  Widget build(BuildContext context) => Text(title,
      style: const TextStyle(
          fontSize: 16,
          fontWeight: FontWeight.w700,
          color: StafivoColors.textPrimary));
}

class _EmptyCard extends StatelessWidget {
  const _EmptyCard({required this.message});
  final String message;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: StafivoColors.border),
        ),
        child: Text(message,
            style: const TextStyle(
                color: StafivoColors.textMuted, fontSize: 13)),
      );
}

class _PaginationFooter extends StatelessWidget {
  const _PaginationFooter({
    required this.hasMore,
    required this.loading,
    required this.onLoadMore,
  });
  final bool hasMore;
  final bool loading;
  final VoidCallback onLoadMore;

  @override
  Widget build(BuildContext context) {
    if (!hasMore) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 8),
        child: Center(
            child: Text('All records loaded',
                style:
                    TextStyle(fontSize: 12, color: StafivoColors.textMuted))),
      );
    }
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Center(
        child: loading
            ? const SizedBox(
                height: 24,
                width: 24,
                child: CircularProgressIndicator(strokeWidth: 2))
            : OutlinedButton.icon(
                onPressed: onLoadMore,
                icon: const Icon(Icons.expand_more_rounded, size: 18),
                label: const Text('Load More'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: StafivoColors.primary,
                  side: const BorderSide(color: StafivoColors.primary),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12)),
                ),
              ),
      ),
    );
  }
}

// ── Payroll Card ──────────────────────────────────────────────────────────────

class _PayrollCard extends StatelessWidget {
  const _PayrollCard({required this.rec});
  final Map<String, dynamic> rec;

  String _cur(dynamic v) =>
      '₹${((v as num?) ?? 0).toStringAsFixed(2)}';

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
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
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(rec['payroll_month']?.toString() ?? '—',
                  style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      color: StafivoColors.textPrimary)),
              Text(_cur(rec['calculated_total']),
                  style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w800,
                      color: StafivoColors.primary)),
            ],
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 12,
            runSpacing: 6,
            children: [
              _CurrencyLabel(label: 'Base', value: _cur(rec['base_salary']), color: StafivoColors.info),
              _CurrencyLabel(label: 'OT', value: _cur(rec['overtime']), color: StafivoColors.success),
              _CurrencyLabel(label: 'Incentives', value: _cur(rec['incentives']), color: StafivoColors.teal),
              _CurrencyLabel(label: 'Fines', value: _cur(rec['fines']), color: StafivoColors.error),
            ],
          ),
        ],
      ),
    );
  }
}

class _CurrencyLabel extends StatelessWidget {
  const _CurrencyLabel(
      {required this.label, required this.value, required this.color});
  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label,
              style: TextStyle(
                  fontSize: 10, fontWeight: FontWeight.w600, color: color)),
          Text(value,
              style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: StafivoColors.textPrimary)),
        ],
      );
}

// ── Adjustment Card ───────────────────────────────────────────────────────────

class _AdjustmentCard extends StatelessWidget {
  const _AdjustmentCard({required this.adj, required this.onAppeal});
  final Map<String, dynamic> adj;
  final VoidCallback onAppeal;

  Color _kindColor(String kind) => switch (kind) {
        'ot' => StafivoColors.success,
        'fine' => StafivoColors.error,
        'incentive' => StafivoColors.info,
        'deduction' => StafivoColors.warning,
        _ => StafivoColors.textMuted,
      };

  @override
  Widget build(BuildContext context) {
    final kind = adj['kind']?.toString() ?? '';
    final color = _kindColor(kind);
    final isOt = kind == 'ot';
    final isFine = kind == 'fine';

    // Resolve appeal status from join (list or map form)
    String? appealStatus;
    final rawAppeal = adj['fine_appeals'];
    if (rawAppeal is List && rawAppeal.isNotEmpty) {
      appealStatus = (rawAppeal.first as Map)['status']?.toString();
    } else if (rawAppeal is Map) {
      appealStatus = rawAppeal['status']?.toString();
    }

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: StafivoColors.border),
      ),
      child: Row(
        children: [
          Container(
            padding:
                const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(kind.toUpperCase(),
                style: TextStyle(
                    fontSize: 11, fontWeight: FontWeight.w800, color: color)),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(adj['effective_date']?.toString() ?? '—',
                    style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: StafivoColors.textPrimary)),
                const SizedBox(height: 2),
                Text(adj['note']?.toString() ?? '—',
                    style: const TextStyle(
                        fontSize: 12, color: StafivoColors.textSecondary),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                isOt
                    ? '${((adj['hours'] as num?) ?? 0).toStringAsFixed(1)} hrs'
                    : '₹${((adj['amount'] as num?) ?? 0).toStringAsFixed(2)}',
                style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: StafivoColors.textPrimary),
              ),
              if (isFine) ...[
                const SizedBox(height: 6),
                _appealBadge(appealStatus, onAppeal),
              ],
            ],
          ),
        ],
      ),
    );
  }

  Widget _appealBadge(String? status, VoidCallback onAppeal) {
    return switch (status) {
      'approved' => _StatusChip('Resolved', StafivoColors.info),
      'pending' => _StatusChip('Pending', StafivoColors.warning),
      'rejected' => _StatusChip('Rejected', StafivoColors.error),
      _ => GestureDetector(
          onTap: onAppeal,
          child: Container(
            padding:
                const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              border: Border.all(color: StafivoColors.primary),
              borderRadius: BorderRadius.circular(8),
            ),
            child: const Text('Appeal',
                style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    color: StafivoColors.primary)),
          ),
        ),
    };
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip(this.label, this.color);
  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Text(label,
            style: TextStyle(
                fontSize: 10, fontWeight: FontWeight.w700, color: color)),
      );
}
