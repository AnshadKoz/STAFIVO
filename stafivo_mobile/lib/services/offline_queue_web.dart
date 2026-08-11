import 'dart:async';
import 'dart:convert';

import 'offline_queue_base.dart';
import 'queued_log.dart';

class OfflineQueueImpl extends OfflineQueueImplBase {
  final List<QueuedLog> _queue = [];
  int _nextId = 1;

  @override
  Future<void> init() async {
    // No persistent offline queue available on web.
    _queue.clear();
  }

  @override
  Future<void> addPending({
    required Map<String, dynamic> payload,
    required String reason,
  }) async {
    final data = jsonEncode(payload);
    _queue.add(QueuedLog(
      id: _nextId++,
      payload: Map<String, dynamic>.from(jsonDecode(data) as Map),
      reason: reason,
      retryCount: 0,
    ));
  }

  @override
  Future<List<QueuedLog>> pending({bool networkOnly = false}) async {
    if (!networkOnly) return List.unmodifiable(_queue);
    return List.unmodifiable(_queue.where((log) => log.reason.startsWith('network')).toList());
  }

  @override
  Future<void> deleteIds(List<int> ids) async {
    _queue.removeWhere((log) => ids.contains(log.id));
  }

  @override
  Future<void> markFailed({
    required int id,
    required String lastError,
  }) async {
    final index = _queue.indexWhere((log) => log.id == id);
    if (index >= 0) {
      final existing = _queue[index];
      _queue[index] = QueuedLog(
        id: existing.id,
        payload: existing.payload,
        reason: existing.reason,
        retryCount: existing.retryCount + 1,
        lastError: lastError,
      );
    }
  }

  @override
  Future<void> markReason({
    required int id,
    required String reason,
    String? lastError,
  }) async {
    final index = _queue.indexWhere((log) => log.id == id);
    if (index >= 0) {
      final existing = _queue[index];
      _queue[index] = QueuedLog(
        id: existing.id,
        payload: existing.payload,
        reason: reason,
        retryCount: existing.retryCount,
        lastError: lastError ?? existing.lastError,
      );
    }
  }

}
