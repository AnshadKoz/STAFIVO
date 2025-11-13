import 'dart:convert';
import 'dart:io';

import 'package:supabase_flutter/supabase_flutter.dart';

final sb = Supabase.instance.client;

class SupabaseRepo {
  static List<Map<String, dynamic>> _castList(dynamic rows) {
    if (rows is! List) return [];
    return rows.map<Map<String, dynamic>>((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  /// Workers missing enrollment via optional RPC (preferred).
  static Future<List<Map<String, dynamic>>> workersNeedingEnrollment() async {
    try {
      final rows = await sb.rpc('workers_needing_enrollment').select();
      return _castList(rows);
    } on PostgrestException catch (e) {
      // Function not defined or inaccessible → fallback to left join.
      if (e.code == 'PGRST202' ||
          e.message.toLowerCase().contains('could not find the function')) {
        return workersNeedingEnrollmentFallback();
      }
      rethrow;
    }
  }

  /// Workers missing enrollment using a left join fallback.
  static Future<List<Map<String, dynamic>>> workersNeedingEnrollmentFallback() async {
    final rows = await sb
        .from('workers')
        .select('id,name,face_profiles!left(worker_id)')
        .order('name');
    final pending = <Map<String, dynamic>>[];
    for (final row in _castList(rows)) {
      final faceProfiles = row['face_profiles'];
      final hasProfile = (faceProfiles is Map && faceProfiles.isNotEmpty) ||
          (faceProfiles is List && faceProfiles.isNotEmpty);
      if (!hasProfile) {
        pending.add({
          'id': row['id'],
          'name': row['name'],
        });
      }
    }
    return pending;
  }

  static Future<List<Map<String, dynamic>>> allWorkers() async {
    final rows = await sb.from('workers').select('id,name').order('name');
    return _castList(rows);
  }

  /// Returns {id, name, latitude, longitude, radius_meters}
  static Future<Map<String, dynamic>?> outletByWorker(String workerId) async {
    final rows = await sb
        .from('workers')
        .select('outlet_id, outlet:outlet_id (id, name, latitude, longitude, radius_meters)')
        .eq('id', workerId)
        .limit(1);
    if (rows.isEmpty) return null;
    return rows[0]['outlet'] as Map<String, dynamic>?;
  }

  /// Returns stored face profile info.
  static Future<Map<String, dynamic>?> faceProfile(String workerId) async {
    final rows = await sb
        .from('face_profiles')
        .select('worker_id, embedding, image_url, embed_model, version')
        .eq('worker_id', workerId)
        .limit(1);
    if (rows.isEmpty) return null;
    final row = Map<String, dynamic>.from(rows[0] as Map);
    row['embedding'] = _parseEmbedding(row['embedding']);
    return row;
  }

  /// Last action for the worker (to prevent double IN / OUT).
  static Future<String?> lastAction(String workerId) async {
    final rows = await sb
        .from('attendance_logs')
        .select('action')
        .eq('worker_id', workerId)
        .order('timestamp_utc', ascending: false)
        .limit(1);
    if (rows.isEmpty) return null;
    return rows[0]['action'] as String?;
  }

  static Future<void> insertAttendance({
    required String workerId,
    required String outletId,
    required String action,
    DateTime? tsUtc,
    Map<String, dynamic>? extra,
  }) async {
    final payload = {
      'worker_id': workerId,
      'outlet_id': outletId,
      'action': action,
      'timestamp_utc': (tsUtc ?? DateTime.now().toUtc()).toIso8601String(),
      'source': 'device',
      ...?extra,
    };
    await _insertRaw(payload);
  }

  static Future<void> insertAttendanceRaw(Map<String, dynamic> payload) async {
    final data = {
      ...payload,
      'timestamp_utc': (payload['timestamp_utc'] ??
              DateTime.now().toUtc().toIso8601String())
          .toString(),
      'source': payload['source'] ?? 'device',
    };
    await _insertRaw(data);
  }

  static Future<void> _insertRaw(Map<String, dynamic> payload) async {
    try {
      await sb.from('attendance_logs').insert(payload);
    } on PostgrestException catch (e) {
      throw AttendanceServerDenied(e.message);
    } on AuthException catch (e) {
      throw AttendanceAuthError(e.message);
    } on SocketException catch (e) {
      throw AttendanceNetworkError(e.message);
    } catch (e) {
      throw AttendanceNetworkError(e.toString());
    }
  }
}

List<double>? _parseEmbedding(dynamic raw) {
  if (raw == null) return null;
  if (raw is List) {
    final result = <double>[];
    for (final value in raw) {
      if (value is num) {
        result.add(value.toDouble());
      } else if (value is String) {
        final parsed = double.tryParse(value);
        if (parsed == null) return null;
        result.add(parsed);
      } else {
        return null;
      }
    }
    return result;
  }
  if (raw is String) {
    try {
      final decoded = jsonDecode(raw);
      return _parseEmbedding(decoded);
    } catch (_) {
      return null;
    }
  }
  return null;
}

class AttendanceNetworkError implements Exception {
  AttendanceNetworkError(this.message);
  final String message;
  @override
  String toString() => 'AttendanceNetworkError($message)';
}

class AttendanceServerDenied implements Exception {
  AttendanceServerDenied(this.message);
  final String message;
  @override
  String toString() => 'AttendanceServerDenied($message)';
}

class AttendanceAuthError implements Exception {
  AttendanceAuthError(this.message);
  final String message;
  @override
  String toString() => 'AttendanceAuthError($message)';
}
