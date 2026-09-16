import 'dart:developer' as developer;
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../services/worker_context.dart';
import '../theme/stafivo_colors.dart';

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

  bool _initialized = false; // race-condition guard

  @override
  void initState() {
    super.initState();
    // _loadInitial() is triggered from didChangeDependencies once WorkerContext is ready.
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
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(
            left: 24,
            right: 24,
            top: 24,
            bottom: MediaQuery.of(ctx).viewInsets.bottom + 28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Handle bar
            Center(
              child: Container(
                width: 36,
                height: 4,
                decoration: BoxDecoration(
                  color: const Color(0xFFE2E8F0),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            const SizedBox(height: 20),
            Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: const Color(0xFFFFEDED),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(Icons.gavel_rounded,
                      color: Color(0xFFEF4444), size: 20),
                ),
                const SizedBox(width: 12),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Appeal this fine',
                        style: TextStyle(
                            fontSize: 16, fontWeight: FontWeight.w700)),
                    Text(
                      'Adjustment on ${adj['effective_date'] ?? ''}',
                      style: const TextStyle(
                          fontSize: 12, color: StafivoColors.textSecondary),
                    ),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 20),
            TextField(
              controller: controller,
              maxLines: 4,
              decoration: InputDecoration(
                hintText: 'Explain why this fine should be removed…',
                hintStyle: const TextStyle(color: StafivoColors.textMuted),
                filled: true,
                fillColor: const Color(0xFFF8FAFC),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: const BorderSide(color: Color(0xFFE2E8F0)),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: const BorderSide(color: Color(0xFFE2E8F0)),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: const BorderSide(
                      color: StafivoColors.primary, width: 1.5),
                ),
                contentPadding: const EdgeInsets.all(14),
              ),
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              height: 50,
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
                      borderRadius: BorderRadius.circular(14)),
                ),
                child: const Text('Submit Appeal',
                    style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
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

  Widget _buildContent(WorkerContext ctx) {
    return RefreshIndicator(
      onRefresh: _loadInitial,
      color: StafivoColors.primary,
      child: CustomScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          // ── Gradient header ───────────────────────────────────────────
          SliverToBoxAdapter(child: _buildHeader(ctx)),

          SliverPadding(
            padding: const EdgeInsets.fromLTRB(16, 20, 16, 32),
            sliver: SliverList(
              delegate: SliverChildListDelegate([

                // ── Salary History ──────────────────────────────────────
                _buildSectionLabel('Salary History'),
                const SizedBox(height: 10),

                if (_payroll.isEmpty)
                  _EmptyCard(message: 'No salary records yet.',
                      icon: Icons.payments_rounded)
                else ...[
                  ..._payroll.map((rec) => _PayrollCard(rec: rec)),
                  _buildFooter(
                    hasMore: _hasMorePayroll,
                    loading: _loadingMorePayroll,
                    onLoad: _loadMorePayroll,
                  ),
                ],

                const SizedBox(height: 28),

                // ── Adjustments ─────────────────────────────────────────
                Row(
                  children: [
                    _buildSectionLabel('Adjustments'),
                    const SizedBox(width: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: const Color(0xFFEEF4FF),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: const Text('OT · Fines · Incentives',
                          style: TextStyle(
                              fontSize: 10,
                              fontWeight: FontWeight.w600,
                              color: StafivoColors.primary)),
                    ),
                  ],
                ),
                const SizedBox(height: 10),

                if (_adjustments.isEmpty)
                  _EmptyCard(message: 'No adjustments yet.',
                      icon: Icons.tune_rounded)
                else ...[
                  ..._adjustments.map((adj) => _AdjustmentCard(
                        adj: adj,
                        onAppeal: () => _openAppealSheet(adj),
                      )),
                  _buildFooter(
                    hasMore: _hasMoreAdj,
                    loading: _loadingMoreAdj,
                    onLoad: _loadMoreAdj,
                  ),
                ],
              ]),
            ),
          ),
        ],
      ),
    );
  }

  // ── Gradient header + rates ────────────────────────────────────────────────
  Widget _buildHeader(WorkerContext ctx) {
    final base = ctx.baseSalaryPerHour;
    final ot = ctx.otRatePerHour;

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
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 28),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Salary & Adjustments',
              style: TextStyle(
                color: Colors.white,
                fontSize: 20,
                fontWeight: FontWeight.w800,
                letterSpacing: 0.2,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              'Payroll records and pay adjustments',
              style: TextStyle(
                color: Colors.white.withValues(alpha: 0.7),
                fontSize: 13,
              ),
            ),
            const SizedBox(height: 20),

            // Rates row
            Row(
              children: [
                Expanded(
                  child: _RateTile(
                    icon: Icons.attach_money_rounded,
                    label: 'Base Rate',
                    value: base != null
                        ? '₹${base.toStringAsFixed(2)}/hr'
                        : 'Not set',
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _RateTile(
                    icon: Icons.more_time_rounded,
                    label: 'OT Rate',
                    value: ot != null
                        ? '₹${ot.toStringAsFixed(2)}/hr'
                        : 'Not set',
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSectionLabel(String label) {
    return Text(
      label,
      style: const TextStyle(
        fontSize: 13,
        fontWeight: FontWeight.w700,
        color: StafivoColors.textSecondary,
        letterSpacing: 0.5,
      ),
    );
  }

  Widget _buildFooter({
    required bool hasMore,
    required bool loading,
    required VoidCallback onLoad,
  }) {
    if (loading) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 12),
        child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
      );
    }
    if (!hasMore) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.check_circle_outline_rounded,
                size: 13, color: StafivoColors.textMuted),
            const SizedBox(width: 5),
            const Text('All records loaded',
                style:
                    TextStyle(fontSize: 12, color: StafivoColors.textMuted)),
          ],
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Center(
        child: OutlinedButton.icon(
          onPressed: onLoad,
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

// ── Rate tile ─────────────────────────────────────────────────────────────────

class _RateTile extends StatelessWidget {
  const _RateTile(
      {required this.icon, required this.label, required this.value});
  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        children: [
          Icon(icon, color: Colors.white70, size: 18),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label,
                    style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.7),
                        fontSize: 10,
                        fontWeight: FontWeight.w500)),
                const SizedBox(height: 2),
                Text(value,
                    style: const TextStyle(
                        color: Colors.white,
                        fontSize: 13,
                        fontWeight: FontWeight.w800)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ── Empty card ────────────────────────────────────────────────────────────────

class _EmptyCard extends StatelessWidget {
  const _EmptyCard({required this.message, required this.icon});
  final String message;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 28, horizontal: 20),
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, size: 20, color: StafivoColors.textMuted),
          const SizedBox(width: 10),
          Text(message,
              style: const TextStyle(
                  color: StafivoColors.textMuted, fontSize: 13)),
        ],
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
    final total = (rec['calculated_total'] as num?) ?? 0;

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
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
              // Navy left stripe
              Container(
                  width: 4,
                  decoration: const BoxDecoration(
                    gradient: LinearGradient(
                      colors: [Color(0xFF0F3D91), Color(0xFF1E63FF)],
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                    ),
                  )),

              Expanded(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Month + total
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Row(
                            children: [
                              Container(
                                width: 34,
                                height: 34,
                                decoration: BoxDecoration(
                                  color: const Color(0xFFEEF4FF),
                                  borderRadius: BorderRadius.circular(10),
                                ),
                                child: const Icon(Icons.calendar_month_rounded,
                                    color: Color(0xFF0F3D91), size: 17),
                              ),
                              const SizedBox(width: 10),
                              Text(
                                rec['payroll_month']?.toString() ?? '—',
                                style: const TextStyle(
                                  fontSize: 15,
                                  fontWeight: FontWeight.w700,
                                  color: Color(0xFF0F172A),
                                ),
                              ),
                            ],
                          ),
                          Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 12, vertical: 6),
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
                              '₹${total.toStringAsFixed(2)}',
                              style: const TextStyle(
                                fontSize: 14,
                                fontWeight: FontWeight.w800,
                                color: Colors.white,
                              ),
                            ),
                          ),
                        ],
                      ),

                      const SizedBox(height: 14),
                      Container(height: 1, color: const Color(0xFFF1F5F9)),
                      const SizedBox(height: 12),

                      // Breakdown grid
                      Row(
                        children: [
                          Expanded(
                            child: _BreakdownItem(
                              label: 'Base',
                              value: _cur(rec['base_salary']),
                              color: const Color(0xFF0EA5E9),
                              bg: const Color(0xFFE0F7FF),
                            ),
                          ),
                          Expanded(
                            child: _BreakdownItem(
                              label: 'Overtime',
                              value: _cur(rec['overtime']),
                              color: const Color(0xFF22C55E),
                              bg: const Color(0xFFEFFFF5),
                            ),
                          ),
                          Expanded(
                            child: _BreakdownItem(
                              label: 'Incentives',
                              value: _cur(rec['incentives']),
                              color: const Color(0xFF7C3AED),
                              bg: const Color(0xFFF3E8FF),
                            ),
                          ),
                          Expanded(
                            child: _BreakdownItem(
                              label: 'Fines',
                              value: _cur(rec['fines']),
                              color: const Color(0xFFEF4444),
                              bg: const Color(0xFFFFEDED),
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
}

class _BreakdownItem extends StatelessWidget {
  const _BreakdownItem({
    required this.label,
    required this.value,
    required this.color,
    required this.bg,
  });
  final String label;
  final String value;
  final Color color;
  final Color bg;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
          decoration: BoxDecoration(
              color: bg, borderRadius: BorderRadius.circular(6)),
          child: Text(label,
              style: TextStyle(
                  fontSize: 9, fontWeight: FontWeight.w700, color: color)),
        ),
        const SizedBox(height: 4),
        Text(value,
            style: const TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w700,
                color: Color(0xFF0F172A))),
      ],
    );
  }
}

// ── Adjustment Card ───────────────────────────────────────────────────────────

class _AdjustmentCard extends StatelessWidget {
  const _AdjustmentCard({required this.adj, required this.onAppeal});
  final Map<String, dynamic> adj;
  final VoidCallback onAppeal;

  static const _kindMeta = {
    'ot': (
      label: 'Overtime',
      icon: Icons.more_time_rounded,
      color: Color(0xFF22C55E),
      bg: Color(0xFFEFFFF5),
      accent: Color(0xFF22C55E),
    ),
    'fine': (
      label: 'Fine',
      icon: Icons.gavel_rounded,
      color: Color(0xFFEF4444),
      bg: Color(0xFFFFEDED),
      accent: Color(0xFFEF4444),
    ),
    'incentive': (
      label: 'Incentive',
      icon: Icons.star_rounded,
      color: Color(0xFF7C3AED),
      bg: Color(0xFFF3E8FF),
      accent: Color(0xFF7C3AED),
    ),
    'deduction': (
      label: 'Deduction',
      icon: Icons.remove_circle_outline_rounded,
      color: Color(0xFFF59E0B),
      bg: Color(0xFFFFFBEB),
      accent: Color(0xFFF59E0B),
    ),
  };

  @override
  Widget build(BuildContext context) {
    final kind = adj['kind']?.toString() ?? '';
    final meta = _kindMeta[kind];
    final color = meta?.color ?? const Color(0xFF64748B);
    final bg = meta?.bg ?? const Color(0xFFF1F5F9);
    final icon = meta?.icon ?? Icons.tune_rounded;
    final label = meta?.label ?? kind.toUpperCase();
    final isOt = kind == 'ot';
    final isFine = kind == 'fine';

    // Resolve appeal status from join
    String? appealStatus;
    final rawAppeal = adj['fine_appeals'];
    if (rawAppeal is List && rawAppeal.isNotEmpty) {
      appealStatus = (rawAppeal.first as Map)['status']?.toString();
    } else if (rawAppeal is Map) {
      appealStatus = rawAppeal['status']?.toString();
    }

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
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
              // Kind-colored left stripe
              Container(width: 4, color: color),

              Expanded(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(14, 14, 14, 14),
                  child: Row(
                    children: [
                      // Icon badge
                      Container(
                        width: 44,
                        height: 44,
                        decoration: BoxDecoration(
                          color: bg,
                          borderRadius: BorderRadius.circular(13),
                        ),
                        child: Icon(icon, color: color, size: 22),
                      ),
                      const SizedBox(width: 12),

                      // Info
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Row(
                              children: [
                                Container(
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 8, vertical: 3),
                                  decoration: BoxDecoration(
                                    color: bg,
                                    borderRadius: BorderRadius.circular(6),
                                  ),
                                  child: Text(label,
                                      style: TextStyle(
                                          fontSize: 10,
                                          fontWeight: FontWeight.w700,
                                          color: color)),
                                ),
                                const SizedBox(width: 6),
                                Text(
                                  adj['effective_date']?.toString() ?? '—',
                                  style: const TextStyle(
                                      fontSize: 11,
                                      color: StafivoColors.textSecondary),
                                ),
                              ],
                            ),
                            const SizedBox(height: 5),
                            Text(
                              adj['note']?.toString() ?? '—',
                              style: const TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w600,
                                  color: Color(0xFF0F172A)),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 8),

                      // Value + appeal
                      Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Text(
                            isOt
                                ? '${((adj['hours'] as num?) ?? 0).toStringAsFixed(1)} hrs'
                                : '₹${((adj['amount'] as num?) ?? 0).toStringAsFixed(2)}',
                            style: TextStyle(
                                fontSize: 14,
                                fontWeight: FontWeight.w800,
                                color: color),
                          ),
                          if (isFine) ...[
                            const SizedBox(height: 6),
                            _appealWidget(appealStatus, onAppeal),
                          ],
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

  Widget _appealWidget(String? status, VoidCallback onAppeal) {
    return switch (status) {
      'approved' => _StatusChip('✓ Resolved', const Color(0xFF0EA5E9),
          const Color(0xFFE0F7FF)),
      'pending' => _StatusChip('⏳ Pending', const Color(0xFFF59E0B),
          const Color(0xFFFFFBEB)),
      'rejected' => _StatusChip('✕ Rejected', const Color(0xFFEF4444),
          const Color(0xFFFFEDED)),
      _ => GestureDetector(
          onTap: onAppeal,
          child: Container(
            padding:
                const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [Color(0xFF0F3D91), Color(0xFF1E63FF)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              borderRadius: BorderRadius.circular(8),
            ),
            child: const Text('Appeal',
                style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    color: Colors.white)),
          ),
        ),
    };
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip(this.label, this.color, this.bg);
  final String label;
  final Color color;
  final Color bg;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color: bg,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Text(label,
            style: TextStyle(
                fontSize: 10, fontWeight: FontWeight.w700, color: color)),
      );
}
