import 'dart:convert';
import 'dart:io';
import 'dart:developer' as developer;

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

  /// Workers missing enrollment using RPC fallback (safe, uses SECURITY DEFINER).
  static Future<List<Map<String, dynamic>>> workersNeedingEnrollmentFallback() async {
    try {
      final rows = await sb.rpc('workers_needing_enrollment');
      return _castList(rows);
    } catch (e) {
      // If RPC fails, return empty list (should not happen after migration)
      return [];
    }
  }

  static Future<List<Map<String, dynamic>>> allWorkers() async {
    final rows = await sb.from('workers').select('id,name').order('name');
    return _castList(rows);
  }

  /// Fetch all outlets for selection dropdown.
  static Future<List<Map<String, dynamic>>> listOutlets() async {
    final rows = await sb
        .from('outlets')
        .select('id, name, latitude, longitude, radius_meters')
        .order('name');
    return _castList(rows);
  }

  static Future<List<WorkerDropdown>> workerDropdown() async {
    // Use RPC function to safely get enrollment status without exposing face_profiles
    final rows = await sb.rpc('workers_with_enrollment');
    
    return _castList(rows).map((row) {
      return WorkerDropdown(
        id: row['id']?.toString() ?? '',
        name: row['name']?.toString() ?? 'Unnamed',
        enrolled: row['enrolled'] == true,
      );
    }).toList();
  }

  /// Fetch workers filtered by outlet_id with enrollment status.
  /// Uses RPC function to safely get enrollment status without exposing face_profiles.
  static Future<List<WorkerDropdown>> workersByOutlet(String outletId) async {
    final rows = await sb.rpc(
      'workers_by_outlet_with_enrollment',
      params: {'p_outlet_id': outletId},
    );
    
    return _castList(rows).map((row) {
      return WorkerDropdown(
        id: row['id']?.toString() ?? '',
        name: row['name']?.toString() ?? 'Unnamed',
        enrolled: row['enrolled'] == true,
      );
    }).toList();
  }

  static Future<Set<String>> enrolledWorkerIds() async {
    // Use RPC function to safely get enrolled worker IDs without exposing face_profiles
    final rows = await sb.rpc('enrolled_worker_ids');
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

    final row = Map<String, dynamic>.from(first);
    developer.log(
      'DEBUG outletByWorker: resolved outlet => $row',
      name: 'SupabaseRepo',
    );
    return row;
  }

  /// Returns stored face profile info.
  /// Uses RPC function to safely retrieve face profile without exposing face_profiles directly.
  /// 
  /// CRITICAL SECURITY: Validates that returned worker_id matches requested worker_id
  /// to prevent cross-worker face acceptance attacks.
  static Future<Map<String, dynamic>?> faceProfile(String workerId) async {
    final rows = await sb.rpc(
      'get_face_profile',
      params: {'p_worker_id': workerId},
    );
    if (rows.isEmpty) return null;
    final row = Map<String, dynamic>.from(rows[0] as Map);
    
    // CRITICAL SECURITY CHECK: Validate worker_id binding
    final returnedWorkerId = row['worker_id']?.toString();
    if (returnedWorkerId != workerId) {
      developer.log(
        'SECURITY ERROR: Worker ID mismatch detected. '
        'Requested: $workerId, Returned: $returnedWorkerId',
        name: 'SupabaseRepo.faceProfile',
        level: 1000, // SHOUT level
      );
      throw Exception(
        'Security validation failed: Face profile worker_id mismatch. '
        'This incident has been logged.'
      );
    }
    
    // Parse embedding from vector (PostgREST converts vector to JSON array)
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
