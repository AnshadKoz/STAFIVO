import 'dart:async';
import 'package:connectivity_plus/connectivity_plus.dart';

import 'offline_queue.dart';
import 'supabase_repo.dart';

class SyncService {
  static StreamSubscription<List<ConnectivityResult>>? _subscription;
  static Timer? _timer;
  static bool _syncing = false;

  static Future<void> start() async {
    await OfflineQueue.init();
    await _subscription?.cancel();
    _subscription = Connectivity().onConnectivityChanged.listen((statuses) {
      if (_isOnline(statuses)) {
        _syncNow();
      }
    });

    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 20), (_) => _syncNow());
    await _syncNow();
  }

  static bool _isOnline(List<ConnectivityResult> statuses) {
    return statuses.any(
      (status) =>
          status == ConnectivityResult.mobile ||
          status == ConnectivityResult.wifi,
    );
  }

  static Future<void> _syncNow() async {
    if (_syncing) return;
    _syncing = true;
    try {
      final queue = await OfflineQueue.pending(networkOnly: true);
      if (queue.isEmpty) return;

      final idsToDelete = <int>[];
      for (final log in queue) {
        try {
          await SupabaseRepo.insertAttendanceRaw(log.payload);
          idsToDelete.add(log.id);
        } on AttendanceNetworkError catch (e) {
          await OfflineQueue.markFailed(id: log.id, lastError: e.message);
          break;
        } on AttendanceServerDenied catch (e) {
          await OfflineQueue.markReason(
            id: log.id,
            reason: 'server:${e.message}',
            lastError: e.message,
          );
        } on AttendanceAuthError catch (e) {
          await OfflineQueue.markReason(
            id: log.id,
            reason: 'auth:${e.message}',
            lastError: e.message,
          );
        } catch (e) {
          await OfflineQueue.markFailed(id: log.id, lastError: e.toString());
          break;
        }
      }

      if (idsToDelete.isNotEmpty) {
        await OfflineQueue.deleteIds(idsToDelete);
      }
    } finally {
      _syncing = false;
    }
  }
}
