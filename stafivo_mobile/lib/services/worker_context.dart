import 'dart:developer' as developer;
import 'package:flutter/foundation.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// Centralized worker profile state — loaded once after login, reused across
/// Dashboard, Attendance, Salary and Documents screens.
///
/// Safety: checkin_screen.dart intentionally resolves its own workerId for
/// security isolation and is NOT affected by this class.
class WorkerContext extends ChangeNotifier {
  static const _tag = 'WorkerContext';
  final _client = Supabase.instance.client;

  bool _loading = false;
  bool _loaded = false;
  String? _error;

  String? workerId;
  String? workerName;
  String? outletId;
  String? outletName;
  double? baseSalaryPerHour;
  double? otRatePerHour;

  bool get isLoading => _loading;
  bool get isLoaded => _loaded;
  String? get error => _error;

  // ── Load (idempotent) ────────────────────────────────────────────────────────
  Future<void> load({bool force = false}) async {
    if (_loaded && !force) return;
    if (_loading) return;

    _loading = true;
    _error = null;
    notifyListeners();

    try {
      final authUser = _client.auth.currentUser;
      if (authUser == null) throw Exception('Not authenticated');

      final row = await _client
          .from('workers')
          .select(
              'id, name, outlet_id, base_salary_per_hour, ot_rate_per_hour, outlets(name)')
          .eq('auth_id', authUser.id)
          .single();

      workerId = row['id']?.toString();
      workerName = row['name']?.toString() ?? 'Worker';
      outletId = row['outlet_id']?.toString();
      baseSalaryPerHour = (row['base_salary_per_hour'] as num?)?.toDouble();
      otRatePerHour = (row['ot_rate_per_hour'] as num?)?.toDouble();
      final outlets = row['outlets'];
      if (outlets is Map) outletName = outlets['name']?.toString();
      _loaded = true;
    } catch (e, st) {
      developer.log('WorkerContext.load failed: $e',
          name: _tag, error: e, stackTrace: st);
      _error = 'Failed to load worker profile.';
    }

    _loading = false;
    notifyListeners();
  }

  /// Call on logout / account switch to clear cached state.
  void reset() {
    _loaded = false;
    _error = null;
    workerId = null;
    workerName = null;
    outletId = null;
    outletName = null;
    baseSalaryPerHour = null;
    otRatePerHour = null;
    notifyListeners();
  }
}
