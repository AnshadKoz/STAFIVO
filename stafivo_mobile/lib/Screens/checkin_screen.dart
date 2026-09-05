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
import '../theme/stafivo_colors.dart';

class CheckInScreen extends StatefulWidget {
  const CheckInScreen({super.key});

  @override
  State<CheckInScreen> createState() => _CheckInScreenState();
}

class _CheckInScreenState extends State<CheckInScreen> with RouteAware, WidgetsBindingObserver {
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
  String? _pendingAction; // remembers in/out action for lifecycle retry
  bool _isLocationDialogOpen = false; // tracks whether the location dialog is visible
  bool _deletingAccount = false; // guards against double-tap on delete

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
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
    WidgetsBinding.instance.removeObserver(this);
    railRouteObserver.unsubscribe(this);
    _disposeCameraController(updateState: false);
    _cropper.close();
    _embedder.close();
    _pendingTimer?.cancel();
    super.dispose();
  }

  // ── Lifecycle: auto-retry location when returning from system settings ───
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      // ignore: avoid_print
      print('[location] app resumed');

      // Close the location dialog if it is still on screen
      if (_isLocationDialogOpen && mounted && Navigator.canPop(context)) {
        // ignore: avoid_print
        print('[location] closing dialog after resume');
        Navigator.of(context, rootNavigator: true).pop();
        _isLocationDialogOpen = false;
      }

      _retryLocationIfEnabled();
    }
  }

  Future<void> _retryLocationIfEnabled() async {
    // Only retry if there is a pending action AND the screen is still active
    if (_pendingAction == null || !mounted) return;

    final serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!mounted) return;

    if (serviceEnabled) {
      // ignore: avoid_print
      print('[location] service enabled after resume → retrying');
      _continueLocationCheck(_pendingAction!);
    } else {
      // ignore: avoid_print
      print('[location] still disabled after resume');
    }
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
      _pendingAction = action; // store for lifecycle-based retry
      final success = await _continueLocationCheck(action);
      if (!success) return;
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  // ── Location-disabled dialog ─────────────────────────────────────────────
  void _showLocationDisabledDialog(BuildContext ctx, String action) {
    _isLocationDialogOpen = true;
    showDialog(
      context: ctx,
      barrierDismissible: false,
      builder: (_) => AlertDialog(
        title: const Text('Location Required'),
        content: const Text(
          'Please turn on location services to continue check-in.',
        ),
        actions: [
          TextButton(
            onPressed: () async {
              Navigator.pop(ctx);

              await Geolocator.openLocationSettings();

              // ⏳ Give the OS a moment to propagate the location toggle
              await Future.delayed(const Duration(seconds: 2));

              if (mounted) {
                // ignore: avoid_print
                print('[location] returned from settings → retrying');
                _continueLocationCheck(action);
              }
            },
            child: const Text('Turn On'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
        ],
      ),
    ).then((_) {
      // Clear flag whenever dialog closes (any reason: Turn On, Cancel, back)
      _isLocationDialogOpen = false;
    });
  }

  Future<bool> _continueLocationCheck(String action) async {
    // ── Guard: show dialog immediately if location services are OFF ──────
    final serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) {
      // ignore: avoid_print
      print('[location] service disabled → showing popup');
      if (mounted) {
        _showLocationDisabledDialog(context, action);
        setState(() {
          _locationStatusMessage = 'Location is turned off';
        });
      }
      return false;
    }

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

  // ── Unified Executive Worker Header ─────────────────────────────────────────
  Widget _buildWorkerHeader(ColorScheme scheme) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: StafivoColors.border),
        boxShadow: [
          BoxShadow(
            color: StafivoColors.primary.withValues(alpha: 0.05),
            blurRadius: 16,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Row(
        children: [
          // Avatar with gradient border
          Container(
            padding: const EdgeInsets.all(2.5),
            decoration: const BoxDecoration(
              shape: BoxShape.circle,
              gradient: LinearGradient(
                colors: [StafivoColors.primary, StafivoColors.secondary],
              ),
            ),
            child: const CircleAvatar(
              radius: 20,
              backgroundColor: Color(0xFFEFF6FF),
              child: Icon(Icons.person_rounded, color: StafivoColors.primary, size: 24),
            ),
          ),
          const SizedBox(width: 14),
          // Name & Outlet & Status
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        _workerName ?? 'Worker',
                        style: const TextStyle(
                          fontWeight: FontWeight.w800,
                          fontSize: 15,
                          color: StafivoColors.textPrimary,
                          letterSpacing: -0.2,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    const SizedBox(width: 6),
                    Container(
                      width: 7,
                      height: 7,
                      decoration: const BoxDecoration(
                        color: StafivoColors.success,
                        shape: BoxShape.circle,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 3),
                Row(
                  children: [
                    const Icon(Icons.location_on_rounded,
                        size: 13, color: StafivoColors.secondary),
                    const SizedBox(width: 3),
                    Expanded(
                      child: Text(
                        _outletName ?? 'Assigned Outlet',
                        style: const TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w500,
                          color: StafivoColors.textSecondary,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          // Dashboard button chip
          Material(
            color: Colors.transparent,
            child: InkWell(
              onTap: () => Navigator.of(context).pushNamed('/worker-dashboard'),
              borderRadius: BorderRadius.circular(12),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 7),
                decoration: BoxDecoration(
                  color: const Color(0xFFEFF6FF),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                    color: StafivoColors.secondary.withValues(alpha: 0.2),
                  ),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: const [
                    Icon(Icons.dashboard_rounded,
                        size: 14, color: StafivoColors.secondary),
                    SizedBox(width: 5),
                    Text(
                      'Dashboard',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        color: StafivoColors.secondary,
                      ),
                    ),
                    SizedBox(width: 2),
                    Icon(Icons.chevron_right_rounded,
                        size: 15, color: StafivoColors.secondary),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCameraPreview(double height) {
    final controller = _camera;
    if (controller != null && controller.value.isInitialized) {
      final previewSize = controller.value.previewSize;
      final width = previewSize?.height ?? height * 0.75;
      final innerHeight = previewSize?.width ?? height;

      final overlayColor = _faceCheckPassed
          ? const Color(0xFF22C55E)
          : (_busy
              ? StafivoColors.secondary
              : Colors.white.withValues(alpha: 0.85));

      return Container(
        height: height,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(26),
          border: Border.all(
            color: _faceCheckPassed
                ? const Color(0xFF22C55E).withValues(alpha: 0.5)
                : StafivoColors.border,
            width: 1.5,
          ),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.08),
              blurRadius: 20,
              offset: const Offset(0, 8),
            ),
          ],
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(24.5),
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
              FaceFrameOverlay(color: overlayColor),
              // Top-left live telemetry pill
              Positioned(
                left: 16,
                top: 16,
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(
                    color: Colors.black.withValues(alpha: 0.65),
                    borderRadius: BorderRadius.circular(20),
                    border:
                        Border.all(color: Colors.white.withValues(alpha: 0.15)),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        width: 7,
                        height: 7,
                        decoration: BoxDecoration(
                          color: _faceCheckPassed
                              ? const Color(0xFF22C55E)
                              : (_busy
                                  ? StafivoColors.secondary
                                  : const Color(0xFF4ADE80)),
                          shape: BoxShape.circle,
                          boxShadow: [
                            BoxShadow(
                              color: (_faceCheckPassed
                                      ? const Color(0xFF22C55E)
                                      : const Color(0xFF4ADE80))
                                  .withValues(alpha: 0.6),
                              blurRadius: 6,
                              spreadRadius: 1,
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 7),
                      Text(
                        _faceCheckPassed
                            ? 'Face Verified'
                            : (_busy ? 'Verifying Face...' : 'Biometric Active'),
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          letterSpacing: 0.2,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              // Top-right offline badge (if any)
              if (_pendingCount > 0)
                Positioned(
                  right: 16,
                  top: 16,
                  child: Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                    decoration: BoxDecoration(
                      color: const Color(0xFFD97706).withValues(alpha: 0.88),
                      borderRadius: BorderRadius.circular(20),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.2),
                          blurRadius: 8,
                        ),
                      ],
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.cloud_off_rounded,
                            color: Colors.white, size: 13),
                        const SizedBox(width: 5),
                        Text(
                          '$_pendingCount queued',
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                          ),
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
      message = Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.videocam_off_rounded,
                color: Colors.amber.shade300, size: 36),
            const SizedBox(height: 10),
            const Text(
              'Camera Preview Unavailable',
              style: TextStyle(
                fontWeight: FontWeight.w700,
                color: Colors.white,
                fontSize: 15,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              _cameraError!,
              textAlign: TextAlign.center,
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                  color: Colors.white.withValues(alpha: 0.7), fontSize: 12),
            ),
            const SizedBox(height: 14),
            ElevatedButton.icon(
              onPressed: _cameraInitializing ? null : _initializeCamera,
              icon: const Icon(Icons.refresh_rounded, size: 16),
              label: const Text('Restart Camera'),
              style: ElevatedButton.styleFrom(
                backgroundColor: StafivoColors.secondary,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12)),
              ),
            ),
          ],
        ),
      );
    } else if (_cameraInitializing) {
      message = const CircularProgressIndicator(color: StafivoColors.secondary);
    } else {
      message = Column(
        mainAxisSize: MainAxisSize.min,
        children: const [
          CircularProgressIndicator(color: StafivoColors.secondary),
          SizedBox(height: 14),
          Text(
            'Initializing Biometric Camera...',
            style: TextStyle(color: Colors.white70, fontSize: 13),
          ),
        ],
      );
    }

    return Container(
      height: height,
      decoration: BoxDecoration(
        color: const Color(0xFF0F172A),
        borderRadius: BorderRadius.circular(26),
        border: Border.all(color: StafivoColors.border),
      ),
      child: Center(child: message),
    );
  }

  Widget _buildActionButtons(ColorScheme scheme) {
    return Row(
      children: [
        // ── Check In ─────────────────────────
        Expanded(
          child: Container(
            height: 52,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(16),
              gradient: const LinearGradient(
                colors: [StafivoColors.primary, StafivoColors.secondary],
              ),
              boxShadow: [
                BoxShadow(
                  color: StafivoColors.secondary.withValues(alpha: 0.28),
                  blurRadius: 14,
                  offset: const Offset(0, 5),
                ),
              ],
            ),
            child: ElevatedButton(
              onPressed: _busy ? null : () => _doAction('IN'),
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.transparent,
                shadowColor: Colors.transparent,
                foregroundColor: Colors.white,
                disabledBackgroundColor: Colors.transparent,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: const [
                  Icon(Icons.login_rounded, size: 20),
                  SizedBox(width: 8),
                  Text(
                    'Check In',
                    style: TextStyle(
                      fontWeight: FontWeight.w800,
                      fontSize: 15,
                      letterSpacing: 0.2,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
        const SizedBox(width: 14),
        // ── Check Out ─────────────────────────
        Expanded(
          child: Container(
            height: 52,
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: const Color(0xFFCBD5E1), width: 1.2),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.04),
                  blurRadius: 10,
                  offset: const Offset(0, 3),
                ),
              ],
            ),
            child: ElevatedButton(
              onPressed: _busy ? null : () => _doAction('OUT'),
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.white,
                shadowColor: Colors.transparent,
                foregroundColor: StafivoColors.textPrimary,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: const [
                  Icon(Icons.logout_rounded,
                      size: 20, color: Color(0xFFDC2626)),
                  SizedBox(width: 8),
                  Text(
                    'Check Out',
                    style: TextStyle(
                      fontWeight: FontWeight.w800,
                      fontSize: 15,
                      color: StafivoColors.textPrimary,
                      letterSpacing: 0.2,
                    ),
                  ),
                ],
              ),
            ),
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

  // ── Dual Biometric Telemetry HUD ──────────────────────────────────────────
  Widget _buildTelemetryHUD() {
    return Row(
      children: [
        // Face ID Status Card
        Expanded(
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            decoration: BoxDecoration(
              color: _faceCheckPassed ? const Color(0xFFF0FDF4) : Colors.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                color: _faceCheckPassed
                    ? const Color(0xFF86EFAC)
                    : StafivoColors.border,
              ),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.02),
                  blurRadius: 10,
                  offset: const Offset(0, 2),
                ),
              ],
            ),
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(7),
                  decoration: BoxDecoration(
                    color: _faceCheckPassed
                        ? const Color(0xFFDCFCE7)
                        : const Color(0xFFEFF6FF),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(
                    _faceCheckPassed
                        ? Icons.check_circle_rounded
                        : Icons.face_rounded,
                    color: _faceCheckPassed
                        ? StafivoColors.success
                        : StafivoColors.secondary,
                    size: 18,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Face ID',
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: StafivoColors.textSecondary,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        _faceCheckPassed
                            ? (_lastFaceScore != null
                                ? '${(_lastFaceScore! * 100).toStringAsFixed(0)}% Match'
                                : 'Verified')
                            : (_busy ? 'Scanning...' : 'Ready'),
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w800,
                          color: _faceCheckPassed
                              ? const Color(0xFF15803D)
                              : StafivoColors.textPrimary,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(width: 10),
        // Geofence Location Card
        Expanded(
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            decoration: BoxDecoration(
              color:
                  _locationCheckPassed ? const Color(0xFFF0FDF4) : Colors.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                color: _locationCheckPassed
                    ? const Color(0xFF86EFAC)
                    : StafivoColors.border,
              ),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.02),
                  blurRadius: 10,
                  offset: const Offset(0, 2),
                ),
              ],
            ),
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(7),
                  decoration: BoxDecoration(
                    color: _locationCheckPassed
                        ? const Color(0xFFDCFCE7)
                        : const Color(0xFFEFF6FF),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(
                    _locationCheckPassed
                        ? Icons.check_circle_rounded
                        : Icons.location_on_rounded,
                    color: _locationCheckPassed
                        ? StafivoColors.success
                        : StafivoColors.secondary,
                    size: 18,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Location',
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: StafivoColors.textSecondary,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        _locationCheckPassed
                            ? (_locationStatusMessage ?? 'Verified (In Radius)')
                            : (_busy ? 'Checking...' : (_locationStatusMessage ?? 'In Radius')),
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w800,
                          color: _locationCheckPassed
                              ? const Color(0xFF15803D)
                              : StafivoColors.textPrimary,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildStatusCard() {
    final summary = _lastActionSummary ?? _status;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 13),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: StafivoColors.border),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.02),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(7),
            decoration: BoxDecoration(
              color: const Color(0xFFF1F5F9),
              borderRadius: BorderRadius.circular(10),
            ),
            child: const Icon(Icons.history_rounded,
                color: StafivoColors.secondary, size: 18),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  summary,
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: 13,
                    color: StafivoColors.textPrimary,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                Text(
                  _status,
                  style: const TextStyle(
                    fontSize: 11,
                    color: StafivoColors.textSecondary,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          if (_busy)
            const SizedBox(
              width: 16,
              height: 16,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: StafivoColors.secondary,
              ),
            ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (!_ready) {
      return const Scaffold(
        backgroundColor: StafivoColors.background,
        body: Center(child: CircularProgressIndicator(color: StafivoColors.primary)),
      );
    }

    if (_bootstrapError != null) {
      return _buildBootstrapError(context);
    }

    final scheme = Theme.of(context).colorScheme;
    final size = MediaQuery.of(context).size;
    final previewHeight = size.height * 0.38;

    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: stafivoAppBar(
        context,
        'STAFIVO Punch',
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
          else ...[
            PopupMenuButton<String>(
              icon: const Icon(Icons.more_vert_rounded,
                  color: StafivoColors.primary),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(16),
              ),
              onSelected: (val) {
                if (val == 'dashboard') {
                  Navigator.of(context).pushNamed('/worker-dashboard');
                } else if (val == 'logout') {
                  _handleLogout();
                } else if (val == 'delete') {
                  _handleDeleteAccount();
                }
              },
              itemBuilder: (ctx) => [
                const PopupMenuItem(
                  value: 'dashboard',
                  child: Row(
                    children: [
                      Icon(Icons.dashboard_outlined,
                          size: 18, color: StafivoColors.primary),
                      SizedBox(width: 10),
                      Text('My Dashboard'),
                    ],
                  ),
                ),
                const PopupMenuItem(
                  value: 'logout',
                  child: Row(
                    children: [
                      Icon(Icons.logout_rounded,
                          size: 18, color: StafivoColors.textSecondary),
                      SizedBox(width: 10),
                      Text('Log out'),
                    ],
                  ),
                ),
                const PopupMenuDivider(),
                PopupMenuItem(
                  value: 'delete',
                  child: Row(
                    children: [
                      Icon(Icons.delete_forever_rounded,
                          size: 18, color: Colors.red.shade600),
                      const SizedBox(width: 10),
                      Text(
                        'Delete Account',
                        style: TextStyle(
                          color: Colors.red.shade700,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(width: 6),
          ],
        ],
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // ── Executive Worker Header ────────────────────────
              _buildWorkerHeader(scheme),
              const SizedBox(height: 14),

              if (_pipelineError != null) ...[
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: scheme.error.withValues(alpha: 0.08),
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: Text(
                    'Embedding disabled: $_pipelineError',
                    style: TextStyle(
                      color: scheme.error,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                const SizedBox(height: 14),
              ],

              // ── Biometric Camera Preview ───────────────────────
              _buildCameraPreview(previewHeight),
              const SizedBox(height: 14),

              // ── Dual Telemetry HUD ─────────────────────────────
              _buildTelemetryHUD(),
              const SizedBox(height: 16),

              // ── Action Buttons ─────────────────────────────────
              _buildActionButtons(scheme),
              const SizedBox(height: 14),

              // ── Real-time Status Strip ─────────────────────────
              _buildStatusCard(),
              const SizedBox(height: 12),
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
