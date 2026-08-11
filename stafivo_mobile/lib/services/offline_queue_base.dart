import 'queued_log.dart';

abstract class OfflineQueueImplBase {
  Future<void> init();

  Future<void> addPending({
    required Map<String, dynamic> payload,
    required String reason,
  });

  Future<List<QueuedLog>> pending({bool networkOnly = false});

  Future<void> deleteIds(List<int> ids);

  Future<void> markFailed({
    required int id,
    required String lastError,
  });

  Future<void> markReason({
    required int id,
    required String reason,
    String? lastError,
  });
}
