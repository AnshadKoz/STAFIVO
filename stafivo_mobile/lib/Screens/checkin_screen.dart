import 'dart:async';
import 'dart:developer' as developer;

import 'package:camera/camera.dart';
import 'package:geolocator/geolocator.dart';
import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../face/face_cropper.dart';
import '../face/face_embedder.dart';
import '../face/mathx.dart';
import '../services/geo.dart';
import '../navigation/route_observer.dart';
import '../services/offline_queue.dart';
import '../services/supabase_repo.dart';
import '../widgets/face_frame_overlay.dart';
import '../widgets/stafivo_app_bar.dart';
import '../widgets/alert_dialog_helper.dart';

class CheckInScreen extends StatefulWidget {
  const CheckInScreen({super.key});

  @override
  State<CheckInScreen> createState() => _CheckInScreenState();
}

class _CheckInScreenState extends State<CheckInScreen> with RouteAware {
  // Face verification thresholds
  // SECURITY: Verification is intentionally stricter than enrollment
  // - Enrollment: Permissive (allows enrollment in varied conditions)
  // - Verification: Strict (prevents false acceptance in production)
  static const double _faceThreshold = 0.40; // Cosine distance threshold
  static const double _faceMinConfidence = 0.80; // 80% minimum confidence required

  CameraController? _camera;
  int _pendingCount = 0;
  Timer? _pendingTimer;
  final FaceCropper _cropper = FaceCropper();
  final MobileFaceNetEmbedder _embedder = MobileFaceNetEmbedder();
  bool _ready = false;
  bool _busy = false;
  String? _pipelineError;
  bool _cameraInitializing = false;
  String? _cameraError;
  String? _bootstrapError;

  // --- ADDED: Auto-resolved worker from login session ---
  String? _workerId;
  String? _workerName;
  String? _outletName;
  // --- END ADDED ---


  String _status = 'Ready';
  double? _lastFaceScore;
  bool _faceCheckPassed = false;
  bool _locationCheckPassed = false;
  String? _lastActionSummary;
  String? _locationStatusMessage;
  bool _deletingAccount = false; // guards against double-tap on delete

  @override
  void initState() {
    super.initState();
    _initAll();
    _pendingTimer = Timer.periodic(const Duration(seconds: 5), (_) => _checkPendingQueue());
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final route = ModalRoute.of(context);
    if (route is PageRoute && route.isCurrent) {
      railRouteObserver.unsubscribe(this);
      railRouteObserver.subscribe(this, route);
    }
  }

  Future<void> _checkPendingQueue() async {
    final list = await OfflineQueue.pending();
    if (mounted && _pendingCount != list.length) {
      setState(() {
        _pendingCount = list.length;
      });
    }
  }

  Future<void> _initAll() async {
    if (mounted) {
      setState(() {
        _ready = false;
        _bootstrapError = null;
      });
    } else {
      _ready = false;
      _bootstrapError = null;
    }

    try {
      // --- ADDED: Resolve logged-in worker from app_users via auth_id ---
      final authUser = Supabase.instance.client.auth.currentUser;
      if (authUser == null) {
        if (!mounted) return;
        setState(() {
          _bootstrapError = 'Not logged in. Please log in and try again.';
          _ready = true;
        });
        return;
      }

      // Resolve workers.id via auth_id — face_profiles.worker_id is a FK to
      // workers.id, NOT app_users.id. Using app_users.id here would cause
      // faceProfile() to always return null (wrong table FK target).
      final List<dynamic> workerRows = await Supabase.instance.client
          .from('workers')
          .select('id, name')
          .eq('auth_id', authUser.id)
          .limit(1);

      if (workerRows.isEmpty) {
        if (!mounted) return;
        setState(() {
          _bootstrapError =
              'No worker profile found for this account.\nPlease contact your manager.';
          _ready = true;
        });
        return;
      }

      final workerRow = Map<String, dynamic>.from(workerRows.first as Map);
      final resolvedWorkerId = workerRow['id']?.toString();
      final resolvedWorkerName = workerRow['name']?.toString();

      if (resolvedWorkerId == null) {
        if (!mounted) return;
        setState(() {
          _bootstrapError = 'Worker record is incomplete. Please contact support.';
          _ready = true;
        });
        return;
      }

      // Fetch outlet_id from app_users for geofence check
      String? resolvedOutletId;
      try {
        final List<dynamic> appUserRows = await Supabase.instance.client
            .from('app_users')
            .select('outlet_id')
            .eq('auth_id', authUser.id)
            .limit(1);
        if (appUserRows.isNotEmpty) {
          resolvedOutletId =
              (appUserRows.first as Map)['outlet_id']?.toString();
        }
      } catch (e) {
        developer.log(
          'Could not fetch outlet_id from app_users: $e',
          name: 'CheckInScreen._initAll',
        );
      }

      // Fetch outlet name if outlet_id is present
      String? resolvedOutletName;
      if (resolvedOutletId != null) {
        try {
          final List<dynamic> outletRows = await Supabase.instance.client
              .from('outlets')
              .select('name')
              .eq('id', resolvedOutletId)
              .limit(1);
          if (outletRows.isNotEmpty) {
            resolvedOutletName =
                (outletRows.first as Map)['name']?.toString();
          }
        } catch (e) {
          developer.log(
            'Could not fetch outlet name: $e',
            name: 'CheckInScreen._initAll',
          );
        }
      }
      // --- END ADDED ---

      String? pipelineError;
      try {
        await _embedder.load();
      } catch (e) {
        pipelineError = e.toString();
      }

      await _initializeCamera();
      if (!mounted) return;
      setState(() {
        // --- ADDED: Store resolved worker ---
        _workerId = resolvedWorkerId;
        _workerName = resolvedWorkerName;
        _outletName = resolvedOutletName;
        // --- END ADDED ---

        _pipelineError = pipelineError;
        _bootstrapError = null;
        _ready = true;
      });
    } catch (e) {
      // Log technical details for debugging
      developer.log(
        'Check-in bootstrap failed: $e',
        name: 'CheckInScreen._initAll',
        error: e,
      );

      if (!mounted) return;
      setState(() {
        _bootstrapError = _sanitizeBootstrapError(e);
        _ready = true;
      });
    }
  }

  /// Sanitizes bootstrap errors to show user-friendly messages
  /// instead of exposing technical details like SocketException or Supabase URLs.
  String _sanitizeBootstrapError(Object error) {
    final errorString = error.toString().toLowerCase();

    // Detect offline/network errors
    if (errorString.contains('socketexception') ||
        errorString.contains('clientexception') ||
        errorString.contains('failed host lookup') ||
        errorString.contains('no address associated') ||
        errorString.contains('network unreachable') ||
        errorString.contains('connection refused') ||
        errorString.contains('connection timeout')) {
      return 'No internet connection.\nPlease turn on mobile data or Wi-Fi and tap Retry.';
    }

    // For other errors, show generic message without exposing internals
    return 'Unable to connect.\nPlease check your connection and tap Retry.';
  }

  Future<CameraController> _createCameraController() async {
    final cameras = await availableCameras();
    if (cameras.isEmpty) {
      throw CameraException('no_camera', 'No camera available on this device');
    }
    final camera = cameras.firstWhere(
      (c) => c.lensDirection == CameraLensDirection.front,
      orElse: () => cameras.first,
    );
    // Use a higher-res preview when possible; still fall back if device rejects it.
    final presets = <ResolutionPreset>[
      ResolutionPreset.high,
      ResolutionPreset.medium,
      ResolutionPreset.low,
    ];
    CameraException? lastError;
    for (final preset in presets) {
      final controller = CameraController(
        camera,
        preset,
        enableAudio: false,
        imageFormatGroup: ImageFormatGroup.yuv420,
      );
      try {
        await controller.initialize();
        return controller;
      } on CameraException catch (e) {
        lastError = e;
        await controller.dispose();
      }
    }
    throw lastError ?? CameraException('init_failed', 'Unable to initialize camera');
  }

  Future<void> _disposeCameraController({bool updateState = true}) async {
    final controller = _camera;
    if (updateState && mounted) {
      setState(() => _camera = null);
    } else {
      _camera = null;
    }
    if (controller != null) {
      try {
        await controller.dispose();
      } catch (e) {
        developer.log(
          'Error disposing camera controller',
          name: 'CheckInScreen',
          error: e,
        );
      }
    }
  }

  Future<void> _initializeCamera() async {
    if (_cameraInitializing) return;
    _cameraInitializing = true;
    if (mounted) {
      setState(() {
        _cameraError = null;
      });
    }
    await _disposeCameraController();
    try {
      final controller = await _createCameraController();
      if (!mounted) {
        await controller.dispose();
        return;
      }
      setState(() {
        _camera = controller;
        _cameraError = null;
      });
    } on CameraException catch (e) {
      if (mounted) {
        setState(() => _cameraError = e.description ?? e.code);
      }
    } catch (e) {
      if (mounted) {
        setState(() => _cameraError = e.toString());
      }
    } finally {
      _cameraInitializing = false;
    }
  }

  Future<void> _restartCameraPreview() async {
    await _initializeCamera();
  }

  @override
  void dispose() {
    railRouteObserver.unsubscribe(this);
    _disposeCameraController(updateState: false);
    _cropper.close();
    _embedder.close();
    _pendingTimer?.cancel();
    super.dispose();
  }

  @override
  void didPushNext() {
    _disposeCameraController();
  }

  @override
  void didPopNext() {
    _restartCameraPreview();
  }

  Future<void> _doAction(String action) async {
    // --- CHANGED: Guard uses _workerId instead of _selectedWorkerId ---
    if (_workerId == null) {
      _toast('Worker profile not found. Please log out and log in again.');
      return;
    }
    // --- END CHANGED ---
    if (_camera == null || !_camera!.value.isInitialized) {
      _toast('Camera not ready yet');
      return;
    }
    if (_pipelineError != null) {
      _toast(_pipelineError!);
      return;
    }
    if (_busy) return;

    setState(() {
      _busy = true;
      _status = 'Checking face...';
      _faceCheckPassed = false;
      _locationCheckPassed = false;
      _lastActionSummary = null;
      _locationStatusMessage = null;
    });

    try {
      final faceOk = await _verifyFace();
      if (!faceOk) return;

      setState(() {
        _faceCheckPassed = true;
        _status = 'Checking location...';
      });
      final success = await _continueLocationCheck(action);
      if (!success) return;
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  Future<bool> _continueLocationCheck(String action) async {
    // --- CHANGED: Uses _workerId instead of _selectedWorkerId ---
    final outlet = await SupabaseRepo.outletByWorker(_workerId!);
    developer.log('DEBUG outlet for worker $_workerId => $outlet', name: 'CheckInScreen');
    // --- END CHANGED ---
    if (outlet == null) {
      _toast('Outlet not found');
      return false;
    }

    Position? pos;
    try {
      pos = await GeoService.currentPosition();
    } catch (e) {
      if (mounted) {
        setState(() {
          _locationStatusMessage = 'Location unavailable. Turn it on and tap Check again.';
        });
      }
      return false;
    }

    final dist = GeoService.distanceMeters(
      pos.latitude,
      pos.longitude,
      (outlet['latitude'] as num).toDouble(),
      (outlet['longitude'] as num).toDouble(),
    );
    final radius = (outlet['radius_meters'] as num).toDouble();
    if (dist > radius) {
      final msg =
          'Outside outlet geofence (${dist.toStringAsFixed(1)} m > ${radius.toStringAsFixed(0)} m)';
      if (mounted) {
        setState(() {
          _locationCheckPassed = false;
          _locationStatusMessage = msg;
          _status = 'Outside outlet geofence';
        });
      }
      _toast(msg);
      return false;
    }

    setState(() {
      _locationCheckPassed = true;
      _status = 'Validating last state...';
      _locationStatusMessage = null;
    });
    // --- CHANGED: Uses _workerId instead of _selectedWorkerId ---
    final last = await SupabaseRepo.lastAction(_workerId!);
    // --- END CHANGED ---
    if (last == action) {
      _toast('Already $action. Do the opposite action first.');
      return false;
    }

    final outletId = outlet['id'] as String;
    final nowUtc = DateTime.now().toUtc();
    final payload = {
      // --- CHANGED: Uses _workerId instead of _selectedWorkerId ---
      'worker_id': _workerId!,
      // --- END CHANGED ---
      'outlet_id': outletId,
      'action': action,
      'timestamp_utc': nowUtc.toIso8601String(),
      'gps_lat': pos.latitude,
      'gps_lng': pos.longitude,
      'gps_accuracy_m': pos.accuracy,
      'face_score': _lastFaceScore,
    };

    setState(() => _status = 'Saving...');
    try {
      await SupabaseRepo.insertAttendanceRaw(payload);
      _success('$action recorded');
      _setCompletionSummary(action);
      return true;
    } on AttendanceNetworkError catch (e) {
      await OfflineQueue.addPending(payload: payload, reason: 'network:${e.message}');
      _success('$action queued (offline)');
      _setCompletionSummary(action);
      return true;
    } on AttendanceServerDenied catch (e) {
      _toast('Server denied: ${e.message}');
    } on AttendanceAuthError catch (e) {
      _toast('Auth error: ${e.message}');
    } catch (e) {
      await OfflineQueue.addPending(payload: payload, reason: 'unknown:$e');
      _success('$action queued (offline)');
      _setCompletionSummary(action);
      return true;
    }
    return false;
  }

  void _setCompletionSummary(String action) {
    // --- CHANGED: Uses _workerName directly, no more _findWorker lookup ---
    final workerName = _workerName ?? 'Worker';
    // --- END CHANGED ---
    final actionLabel = action == 'IN' ? 'checked in' : 'checked out';
    final timeText = TimeOfDay.fromDateTime(DateTime.now()).format(context);
    setState(() {
      _lastActionSummary = '$workerName $actionLabel at $timeText';
    });
  }

  Future<bool> _verifyFace() async {
    print('[1] verifyFace start');
    print('[2] workerId: $_workerId');

    try {
      final shot = await _camera!.takePicture();
      final bytes = await shot.readAsBytes();

      print('[4] generating embedding (face crop + ML detect)');
      final tensor = await _cropper
          .cropAndPreprocess(bytes, imagePath: shot.path)
          .timeout(
            const Duration(seconds: 10),
            onTimeout: () {
              print('[ERROR] cropAndPreprocess timed out after 10s');
              return null;
            },
          );

      if (tensor == null) {
        print('[9] FAILURE — no face or crop timed out');
        _toast('Need exactly one face. Hold steady and retry.');
        return false;
      }
      print('[5] embedding generated');

      // --- CHANGED: Uses _workerId instead of _selectedWorkerId ---
      print('[3] fetching face profile for workerId=$_workerId');
      final profile = await SupabaseRepo.faceProfile(_workerId!)
          .timeout(
            const Duration(seconds: 8),
            onTimeout: () {
              print('[ERROR] faceProfile() timed out after 8s');
              return null;
            },
          );
      // --- END CHANGED ---
      print('[3] profile fetched: ${profile == null ? "null" : "found"}');

      if (profile == null) {
        print('[9] FAILURE — no face profile for worker $_workerId');
        _toast('No face profile for this worker. Enroll first.');
        return false;
      }

      // CRITICAL SECURITY CHECK: Validate worker_id binding
      // This prevents cross-worker face acceptance attacks
      final profileWorkerId = profile['worker_id']?.toString();
      // --- CHANGED: Uses _workerId instead of _selectedWorkerId ---
      if (profileWorkerId != _workerId) {
      // --- END CHANGED ---
        developer.log(
          'SECURITY ERROR: Worker ID mismatch in face verification. '
          'Selected: $_workerId, Profile: $profileWorkerId',
          name: 'CheckInScreen._verifyFace',
          level: 1000, // SHOUT level
        );
        print('[ERROR] worker_id mismatch — selected=$_workerId profile=$profileWorkerId');
        _toast('Security validation failed. Please try again or contact support.');
        return false;
      }

      final rawEmbedding = profile['embedding'];
      if (rawEmbedding is! List || rawEmbedding.isEmpty) {
        print('[9] FAILURE — embedding missing in profile');
        _toast('Face profile missing embedding data. Please re-enroll this worker.');
        return false;
      }

      final storedEmbedding = rawEmbedding.map((e) => (e as num).toDouble()).toList();
      print('[6] comparing faces (probe.len=${storedEmbedding.length})');
      final probe = _embedder.embed(tensor);
      if (storedEmbedding.length != probe.length) {
        print('[9] FAILURE — embedding length mismatch stored=${storedEmbedding.length} probe=${probe.length}');
        _toast('Face profile is outdated. Please re-enroll this worker.');
        return false;
      }

      // Compute cosine distance and confidence
      final distance = cosineDistance(probe, storedEmbedding);
      final confidence = 1 - distance;
      _lastFaceScore = confidence;
      print('[7] match result: distance=$distance confidence=$confidence');

      // CRITICAL: Dual-gate verification - BOTH checks must pass
      // This prevents low-quality matches (60-70%) from proceeding
      // even if they pass the distance threshold.
      //
      // Gate 1: Distance check (similarity threshold)
      if (distance > _faceThreshold) {
        print('[9] FAILURE — distance $distance > threshold $_faceThreshold');
        _toast('Face mismatch. Please try again.');
        return false;
      }

      // Gate 2: Confidence check (quality threshold)
      // Rejects faces detected in poor lighting, bad angles, or partial occlusion
      if (confidence < _faceMinConfidence) {
        print('[9] FAILURE — confidence $confidence < minimum $_faceMinConfidence');
        _toast('Face detected, but confidence is too low. Please hold the phone straight and try again.');
        return false;
      }

      // Both gates passed - proceed to location check
      print('[8] SUCCESS — face verified for worker $_workerId');
      return true;
    } catch (e, stack) {
      print('[ERROR] _verifyFace exception: $e');
      developer.log(
        '_verifyFace failed: $e',
        name: 'CheckInScreen._verifyFace',
        error: e,
        stackTrace: stack,
      );
      _toast('Face check failed: $e');
      return false;
    }
  }

  void _toast(String msg) {
    if (!mounted) return;
    showAlertDialog(
      context,
      message: msg,
      type: AlertType.warning,
      autoDismissSeconds: 3,
    );
    setState(() => _status = msg);
  }

  void _success(String msg) {
    if (!mounted) return;
    showAlertDialog(
      context,
      message: msg,
      type: AlertType.success,
      autoDismissSeconds: 3,
    );
    setState(() => _status = msg);
  }

  // --- ADDED: Logout handler ---
  Future<void> _handleLogout() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Log out?'),
        content: const Text('You will be returned to the login screen.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Log out'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await Supabase.instance.client.auth.signOut();
    if (!mounted) return;
    Navigator.of(context).pushNamedAndRemoveUntil('/login', (route) => false);
  }
  // --- END ADDED ---

  // ── Delete account ────────────────────────────────────────────────────────
  /// Shows a confirmation dialog and, on confirmation, permanently deletes
  /// the worker's account, face profile, storage file, then navigates to /login.
  Future<void> _handleDeleteAccount() async {
    if (_deletingAccount) return; // guard against double-tap

    // ── Confirmation dialog ───────────────────────────────────────────────────
    final confirmed = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
        backgroundColor: Colors.white,
        contentPadding: const EdgeInsets.fromLTRB(24, 28, 24, 8),
        actionsPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        title: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: Colors.red.shade50,
                shape: BoxShape.circle,
              ),
              child: Icon(Icons.delete_forever_rounded,
                  color: Colors.red.shade700, size: 26),
            ),
            const SizedBox(width: 12),
            const Expanded(
              child: Text(
                'Delete Account',
                style: TextStyle(
                  fontWeight: FontWeight.w700,
                  fontSize: 18,
                ),
              ),
            ),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Are you sure you want to permanently delete your account?',
              style: TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
            ),
            const SizedBox(height: 10),
            Text(
              'This will remove your face profile, attendance history access, '
              'and all associated data. This action cannot be undone.',
              style: TextStyle(
                fontSize: 13,
                color: Colors.grey.shade700,
                height: 1.5,
              ),
            ),
          ],
        ),
        actions: [
          SizedBox(
            width: double.infinity,
            child: OutlinedButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14)),
              ),
              child: const Text('Cancel'),
            ),
          ),
          const SizedBox(height: 8),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: () => Navigator.of(ctx).pop(true),
              style: FilledButton.styleFrom(
                backgroundColor: Colors.red.shade700,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14)),
              ),
              child: const Text(
                'Delete Permanently',
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
            ),
          ),
        ],
      ),
    );

    if (confirmed != true) return;
    if (!mounted) return;

    setState(() => _deletingAccount = true);

    // ── Execute delete ─────────────────────────────────────────────────────────
    try {
      await SupabaseRepo.deleteCurrentWorkerAccount();
      // Account deleted + signed out inside the repo call.
      if (!mounted) return;
      Navigator.of(context).pushNamedAndRemoveUntil('/login', (_) => false);
    } on WorkerDeleteException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(e.message),
          backgroundColor: Colors.red.shade700,
          behavior: SnackBarBehavior.floating,
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Delete failed: $e'),
          backgroundColor: Colors.red.shade700,
          behavior: SnackBarBehavior.floating,
        ),
      );
    } finally {
      if (mounted) setState(() => _deletingAccount = false);
    }
  }
  // ── End delete account ────────────────────────────────────────────────────

  // --- ADDED: Worker info card replaces outlet+worker dropdowns ---
  Widget _buildWorkerInfoCard(ColorScheme scheme) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest.withValues(alpha: 0.3),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        children: [
          CircleAvatar(
            radius: 24,
            backgroundColor: scheme.primary.withValues(alpha: 0.12),
            child: Icon(Icons.person, color: scheme.primary, size: 28),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _workerName ?? 'Worker',
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w700,
                        color: scheme.onSurface,
                      ),
                ),
                if (_outletName != null) ...[
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      Icon(Icons.location_on, size: 14, color: scheme.primary),
                      const SizedBox(width: 4),
                      Text(
                        _outletName!,
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: scheme.onSurface.withValues(alpha: 0.65),
                            ),
                      ),
                    ],
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
  // --- END ADDED ---

  Widget _buildCameraPreview(double height) {
    final controller = _camera;
    final scheme = Theme.of(context).colorScheme;
    if (controller != null && controller.value.isInitialized) {
      final previewSize = controller.value.previewSize;
      final width = previewSize?.height ?? height * 0.75;
      final innerHeight = previewSize?.width ?? height;

      return SizedBox(
        height: height,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(32),
          child: Stack(
            fit: StackFit.expand,
            children: [
              Container(
                color: Colors.black,
                child: FittedBox(
                  fit: BoxFit.cover,
                  child: SizedBox(
                    width: width,
                    height: innerHeight,
                    child: CameraPreview(controller),
                  ),
                ),
              ),
              const FaceFrameOverlay(color: Colors.white),
              Positioned(
                left: 20,
                top: 20,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(
                    color: Colors.black.withValues(alpha: 0.55),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.camera_front, color: Colors.white, size: 16),
                      const SizedBox(width: 6),
                      Text(
                        'Live preview',
                        style: Theme.of(context)
                            .textTheme
                            .labelSmall
                            ?.copyWith(color: Colors.white, fontWeight: FontWeight.w600),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      );
    }

    Widget message;
    if (_cameraError != null) {
      message = Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.warning_amber_rounded, color: scheme.error),
          const SizedBox(height: 8),
          Text(
            'Camera unavailable',
            style: TextStyle(fontWeight: FontWeight.w600, color: scheme.error),
          ),
          const SizedBox(height: 4),
          Text(
            _cameraError!,
            textAlign: TextAlign.center,
            maxLines: 4,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(color: scheme.onSurface.withValues(alpha: 0.7)),
          ),
          const SizedBox(height: 12),
          FilledButton.icon(
            onPressed: _cameraInitializing ? null : _initializeCamera,
            icon: const Icon(Icons.refresh),
            label: const Text('Retry camera'),
          ),
        ],
      );
    } else if (_cameraInitializing) {
      message = const CircularProgressIndicator();
    } else {
      message = Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const CircularProgressIndicator(),
          const SizedBox(height: 12),
          Text(
            'Starting camera...',
            style: TextStyle(color: scheme.onSurface.withValues(alpha: 0.7)),
          ),
        ],
      );
    }

    return SizedBox(
      height: height,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(32),
        child: Container(
          color: Colors.black.withValues(alpha: 0.85),
          child: Center(child: message),
        ),
      ),
    );
  }

  Widget _buildActionButtons(ColorScheme scheme) {
    return Row(
      children: [
        Expanded(
          child: FilledButton(
            onPressed: _busy ? null : () => _doAction('IN'),
            style: FilledButton.styleFrom(
              backgroundColor: scheme.primary,
              foregroundColor: Colors.white,
            ),
            child: const Text('Check In'),
          ),
        ),
        const SizedBox(width: 16),
        Expanded(
          child: FilledButton.tonal(
            onPressed: _busy ? null : () => _doAction('OUT'),
            style: FilledButton.styleFrom(
              backgroundColor: scheme.primary.withValues(alpha: 0.12),
              foregroundColor: scheme.primary,
            ),
            child: const Text('Check Out'),
          ),
        ),
      ],
    );
  }

  Widget _statusRow({
    required String label,
    required bool complete,
    String? subtitle,
  }) {
    final scheme = Theme.of(context).colorScheme;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(
          complete ? Icons.check_circle_rounded : Icons.radio_button_unchecked,
          color: complete ? scheme.primary : scheme.onSurface.withValues(alpha: 0.3),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: TextStyle(
                  fontWeight: FontWeight.w600,
                  color: complete ? scheme.primary : scheme.onSurface.withValues(alpha: 0.7),
                ),
              ),
              if (subtitle != null)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(
                    subtitle,
                    style: TextStyle(
                      color: scheme.onSurface.withValues(alpha: 0.6),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildBootstrapError(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final message = _bootstrapError ?? 'Unknown error';
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.error_outline, size: 56, color: scheme.error),
              const SizedBox(height: 16),
              Text(
                'Unable to load worker profile',
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 12),
              Text(
                'Check your connection and try again.',
                textAlign: TextAlign.center,
                style: TextStyle(color: scheme.onSurface.withValues(alpha: 0.7)),
              ),
              const SizedBox(height: 16),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: scheme.surfaceContainerHighest.withValues(alpha: 0.6),
                  borderRadius: BorderRadius.circular(18),
                ),
                child: Text(
                  message,
                  textAlign: TextAlign.center,
                  style: TextStyle(color: scheme.onSurface.withValues(alpha: 0.85)),
                ),
              ),
              const SizedBox(height: 24),
              FilledButton(
                onPressed: _initAll,
                child: const Text('Retry'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildStatusCard() {
    final scheme = Theme.of(context).colorScheme;
    final summary = _lastActionSummary ?? _status;
    final cardColor = scheme.surfaceContainerHighest.withValues(alpha: 0.4);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: cardColor,
        borderRadius: BorderRadius.circular(28),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _statusRow(
            label: 'Face check complete',
            complete: _faceCheckPassed,
            subtitle: _faceCheckPassed && _lastFaceScore != null
                ? 'Confidence ${(_lastFaceScore! * 100).toStringAsFixed(1)}%'
                : null,
          ),
          const SizedBox(height: 16),
          _statusRow(
            label: 'Location verified',
            complete: _locationCheckPassed,
            subtitle: _locationStatusMessage,
          ),
          const SizedBox(height: 16),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(Icons.access_time, color: scheme.primary),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      summary,
                      style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      _status,
                      style: TextStyle(color: scheme.onSurface.withValues(alpha: 0.7)),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (!_ready) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }

    if (_bootstrapError != null) {
      return _buildBootstrapError(context);
    }

    final scheme = Theme.of(context).colorScheme;
    final size = MediaQuery.of(context).size;
    final previewHeight = size.height * 0.38;

    return Scaffold(
      appBar: workForgeAppBar(
        context,
        'Check-in / Check-out',
        implyLeading: false,
        actions: [
          if (_deletingAccount)
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 16),
              child: SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            )
          else ...([
            IconButton(
              icon: const Icon(Icons.delete_forever_rounded),
              tooltip: 'Delete account',
              color: Colors.red.shade400,
              onPressed: _handleDeleteAccount,
            ),
            IconButton(
              icon: const Icon(Icons.logout),
              tooltip: 'Log out',
              onPressed: _handleLogout,
            ),
          ]),
        ],
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // --- CHANGED: Worker info card replaces outlet+worker dropdown card ---
              _buildWorkerInfoCard(scheme),
              // --- END CHANGED ---
              const SizedBox(height: 16),
              if (_pipelineError != null)
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: scheme.error.withValues(alpha: 0.08),
                    borderRadius: BorderRadius.circular(18),
                  ),
                  child: Text(
                    'Embedding disabled: $_pipelineError',
                    style: TextStyle(
                      color: scheme.error,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              if (_pipelineError != null) const SizedBox(height: 16),
              _buildCameraPreview(previewHeight),
              const SizedBox(height: 20),
              _buildActionButtons(scheme),
              const SizedBox(height: 20),
              _buildStatusCard(),
            ],
          ),
        ),
      ),
    );
  }
}

class RepoList {
  static Future<List<Map<String, dynamic>>> workers({String? outletId}) async {
    final rows = outletId != null
        ? await SupabaseRepo.workersByOutlet(outletId)
        : await SupabaseRepo.workerDropdown();
    return rows.map<Map<String, dynamic>>((worker) {
      return {
        'id': worker.id,
        'name': worker.name,
        'enrolled': worker.enrolled,
      };
    }).toList();
  }
}
