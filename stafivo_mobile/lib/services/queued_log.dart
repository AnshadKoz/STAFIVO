import 'dart:convert';

class QueuedLog {
  QueuedLog({
    required this.id,
    required this.payload,
    required this.reason,
    required this.retryCount,
    this.lastError,
  });

  final int id;
  final Map<String, dynamic> payload;
  final String reason;
  final int retryCount;
  final String? lastError;

  factory QueuedLog.fromRow(Map<String, dynamic> row) {
    final payloadRaw = row['payload'] as String;
    return QueuedLog(
      id: row['id'] as int,
      payload: Map<String, dynamic>.from(jsonDecode(payloadRaw) as Map),
      reason: row['reason'] as String,
      retryCount: row['retry_count'] as int,
      lastError: row['last_error'] as String?,
    );
  }
}
