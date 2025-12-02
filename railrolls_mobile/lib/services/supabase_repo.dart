import 'dart:convert';
import 'dart:io';
import 'dart:developer' as developer;

import 'package:flutter/foundation.dart';
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

  static Future<List<WorkerDropdown>> workerDropdown() async {
    final res = await sb.rpc('worker_dropdown_data');
    debugPrint('DEBUG worker_dropdown_data: $res');
    if (res is! List) return [];
    return res.map<Map<String, dynamic>>((row) {
      final map = Map<String, dynamic>.from(row as Map);
      return {
        'id': map['id']?.toString() ?? '',
        'name': map['name']?.toString() ?? 'Unnamed',
        'enrolled': map['enrolled'] as bool? ?? false,
      };
    }).map((row) => WorkerDropdown.fromRow(row)).toList();
  }

  static Future<Set<String>> enrolledWorkerIds() async {
    final rows = await sb.from('face_profiles').select('worker_id');
    final list = _castList(rows);
    final ids = <String>{};
    for (final row in list) {
      final id = row['worker_id'];
      if (id != null) {
        ids.add(id.toString());
      }
    }
    return ids;
  }

  /// Returns {id, name, latitude, longitude, radius_meters}
  static Future<Map<String, dynamic>?> outletByWorker(String workerId) async {
    final res = await sb.rpc(
      'worker_outlet',
      params: {'worker_uuid': workerId},
    );

    if (res is! List || res.isEmpty) {
      developer.log(
        'DEBUG outletByWorker: no rows for worker $workerId',
        name: 'SupabaseRepo',
      );
      return null;
    }

    final first = res.first;
    if (first is! Map) {
      developer.log(
        'DEBUG outletByWorker: unexpected row type: $first',
        name: 'SupabaseRepo',
      );
      return null;
    }

    final row = Map<String, dynamic>.from(first as Map);
    developer.log(
      'DEBUG outletByWorker: resolved outlet => $row',
      name: 'SupabaseRepo',
    );
    return row;
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

class WorkerDropdown {
  WorkerDropdown({
    required this.id,
    required this.name,
    required this.enrolled,
  });

  final String id;
  final String name;
  final bool enrolled;

  factory WorkerDropdown.fromRow(Map<String, dynamic> row) {
    return WorkerDropdown(
      id: row['id']?.toString() ?? '',
      name: row['name']?.toString() ?? 'Unnamed',
      enrolled: row['enrolled'] == true,
    );
  }
}
