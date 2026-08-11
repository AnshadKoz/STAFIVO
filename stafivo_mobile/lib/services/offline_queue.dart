import 'offline_queue_io.dart' if (dart.library.html) 'offline_queue_web.dart';
import 'queued_log.dart';

/// Platform-specific offline queue wrapper.
///
/// Web uses an in-memory queue and avoids `path_provider`/`sqflite`.
class OfflineQueue {
  static final OfflineQueueImpl _impl = OfflineQueueImpl();

  static Future<void> init() => _impl.init();

  static Future<void> addPending({
    required Map<String, dynamic> payload,
    required String reason,
  }) async {
    return _impl.addPending(payload: payload, reason: reason);
  }

  static Future<List<QueuedLog>> pending({bool networkOnly = false}) {
    return _impl.pending(networkOnly: networkOnly);
  }

  static Future<void> deleteIds(List<int> ids) {
    return _impl.deleteIds(ids);
  }

  static Future<void> markFailed({
    required int id,
    required String lastError,
  }) {
    return _impl.markFailed(id: id, lastError: lastError);
  }

  static Future<void> markReason({
    required int id,
    required String reason,
    String? lastError,
  }) {
    return _impl.markReason(id: id, reason: reason, lastError: lastError);
  }
}

