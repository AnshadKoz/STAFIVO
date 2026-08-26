import 'dart:convert';
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

  /// Returns true if the currently logged-in worker already has a face profile.
  ///
  /// Correct flow:
  ///   auth.user.id → workers.auth_id → workers.id → RPC get_face_profile(uuid) → bool
  ///
  /// The RPC `get_face_profile` is declared as RETURNS boolean — PostgREST
  /// wraps a scalar-returning function in a single-element list, so the
  /// raw response is `[true]` or `[false]`.  We extract element [0] and
  /// coerce it to bool.  If anything is unexpected we fall back to false
  /// (fail-open: send to enrollment rather than silently skipping it).
  static Future<bool> isCurrentWorkerEnrolled() async {
    try {
      final authUser = sb.auth.currentUser;
      if (authUser == null) return false;

      // Resolve auth_id → workers.id.
      // CRITICAL: face_profiles.worker_id is a FK to workers.id, NOT app_users.id.
      // .maybeSingle() returns null when no row matches; avoids manual isEmpty check.
      final worker = await sb
          .from('workers')
          .select('id')
          .eq('auth_id', authUser.id)
          .maybeSingle();

      if (worker == null) return false;

      final workerId = worker['id']?.toString();
      if (workerId == null || workerId.isEmpty) return false;

      // get_face_profile(p_worker_id uuid) RETURNS boolean.
      // PostgREST wraps a scalar function result in a list: [true] or [false].
      // We must NOT check `rows is List && rows.isNotEmpty` — that would be
      // true even when the function returns false.  Extract the actual value.
      final dynamic result = await sb.rpc(
        'get_face_profile',
        params: {'p_worker_id': workerId},
      );

      // PostgREST scalar wrapping: result is either a raw bool or a List<dynamic>
      // containing one bool element.  Handle both forms defensively.
      if (result is bool) return result;
      if (result is List && result.isNotEmpty) {
        final first = result.first;
        if (first is bool) return first;
      }

      developer.log(
        'isCurrentWorkerEnrolled: unexpected RPC result type=${result.runtimeType} value=$result',
        name: 'SupabaseRepo',
      );
      return false;
    } catch (e) {
      developer.log(
        'isCurrentWorkerEnrolled check failed: $e',
        name: 'SupabaseRepo',
      );
      // Fail-open: send to enrollment screen so the worker can enroll.
      return false;
    }
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
    } catch (e) {
      throw AttendanceNetworkError(e.toString());
    }
  }

  // ── Hard delete ──────────────────────────────────────────────────────────────

  /// Permanently deletes the currently logged-in worker's account.
  ///
  /// Delete order (all handled atomically inside the RPC):
  ///   1. face_profiles row
  ///   2. workers row  (cascades any FK-linked tables)
  ///   3. auth.users record
  ///
  /// The RPC returns the storage `image_url` so we can remove the file from
  /// Supabase Storage here in the client (storage admin cannot be called from
  /// inside a SECURITY DEFINER function without the service-role key).
  ///
  /// After a successful delete the user is signed out.
  ///
  /// Throws [WorkerDeleteException] on any identifiable failure so callers
  /// can surface a human-readable message.
  static Future<void> deleteCurrentWorkerAccount() async {
    final authUser = sb.auth.currentUser;
    if (authUser == null) {
      throw WorkerDeleteException('Not logged in. Please sign in and try again.');
    }

    // ── Step 1: Resolve workers.id from auth_id ──────────────────────────────
    final worker = await sb
        .from('workers')
        .select('id')
        .eq('auth_id', authUser.id)
        .maybeSingle();

    if (worker == null) {
      throw WorkerDeleteException('No worker account found for this user.');
    }
    final workerId = worker['id']?.toString();
    if (workerId == null || workerId.isEmpty) {
      throw WorkerDeleteException('Worker record is incomplete. Contact support.');
    }

    // ── Step 2: Call RPC — deletes face_profiles + workers + auth user ────────
    // The function returns the storage image_url (may be null).
    String? imageUrl;
    try {
      final dynamic rpcResult = await sb.rpc(
        'delete_worker_account',
        params: {'p_worker_id': workerId},
      );
      // PostgREST wraps scalar returns in a list.
      if (rpcResult is List && rpcResult.isNotEmpty) {
        imageUrl = rpcResult.first?.toString();
      } else if (rpcResult is String && rpcResult.isNotEmpty) {
        imageUrl = rpcResult;
      }
    } on PostgrestException catch (e) {
      developer.log(
        'deleteCurrentWorkerAccount RPC failed: ${e.message}',
        name: 'SupabaseRepo',
        error: e,
      );
      final hint = e.hint ?? '';
      if (hint.contains('worker_not_found')) {
        throw WorkerDeleteException('Worker not found. It may have already been deleted.');
      }
      if (hint.contains('unauthorized')) {
        throw WorkerDeleteException('Permission denied. You can only delete your own account.');
      }
      throw WorkerDeleteException('Delete failed: ${e.message}');
    } catch (e) {
      developer.log(
        'deleteCurrentWorkerAccount unexpected error: $e',
        name: 'SupabaseRepo',
      );
      throw WorkerDeleteException('Unexpected error during delete: $e');
    }

    // ── Step 3: Delete storage file (best-effort) ─────────────────────────────
    // The RPC returns the raw image_url as stored, e.g. "/faces/workers/<id>/enroll-best.jpg"
    // or "workers/<id>/enroll-best.jpg".  We strip a leading "/" or the bucket
    // prefix "/faces/" to get the bucket-relative object path.
    if (imageUrl != null && imageUrl.isNotEmpty) {
      try {
        // Normalise: strip leading "/" and optional "faces/" bucket prefix.
        var storagePath = imageUrl.replaceFirst(RegExp(r'^/'), '');
        if (storagePath.startsWith('faces/')) {
          storagePath = storagePath.substring('faces/'.length);
        }
        await sb.storage.from('faces').remove([storagePath]);
        developer.log(
          'Deleted storage file: $storagePath',
          name: 'SupabaseRepo',
        );
      } catch (e) {
        // Storage deletion is non-fatal: DB records are already gone.
        // Log for manual cleanup; do not abort the overall flow.
        developer.log(
          'WARNING: Storage file deletion failed (non-fatal): $e\n'
          'Path attempted: $imageUrl',
          name: 'SupabaseRepo',
        );
      }
    }

    // ── Step 4: Sign out ──────────────────────────────────────────────────────
    // The auth user no longer exists in the DB; signing out clears local tokens.
    try {
      await sb.auth.signOut();
    } catch (_) {
      // Ignore sign-out errors — the account is already deleted.
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

class WorkerDeleteException implements Exception {
  WorkerDeleteException(this.message);
  final String message;
  @override
  String toString() => 'WorkerDeleteException($message)';
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
