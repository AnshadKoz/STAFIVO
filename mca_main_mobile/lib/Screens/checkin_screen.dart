import 'dart:io';

import 'dart:async';
import 'dart:developer' as developer;

import 'package:camera/camera.dart';
import 'package:geolocator/geolocator.dart';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../face/face_cropper.dart';
import '../face/face_embedder.dart';
import '../face/mathx.dart';
import '../services/geo.dart';
import '../navigation/route_observer.dart';
import '../services/offline_queue.dart';
import '../services/supabase_repo.dart';
import '../widgets/face_frame_overlay.dart';
import '../widgets/workforge_app_bar.dart';
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
  static const String _outletPrefKey = 'selected_outlet_id';

  CameraController? _camera;
  final FaceCropper _cropper = FaceCropper();
  final MobileFaceNetEmbedder _embedder = MobileFaceNetEmbedder();
  bool _ready = false;
  bool _busy = false;
  String? _pipelineError;
  bool _cameraInitializing = false;
  String? _cameraError;
  String? _bootstrapError;

  // Outlet selection state
  String? _selectedOutletId;
  List<Map<String, dynamic>> _outlets = [];
  bool _workerDropdownEnabled = false;

  String? _selectedWorkerId;
  List<Map<String, dynamic>> _workers = [];
  String _status = 'Ready';
  double? _lastFaceScore;
  bool _faceCheckPassed = false;
  bool _locationCheckPassed = false;
  String? _lastActionSummary;
  String? _locationStatusMessage;

  @override
  void initState() {
    super.initState();
    _initAll();
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
      // Load outlets first
      List<Map<String, dynamic>> outlets = [];
      try {
        outlets = await SupabaseRepo.listOutlets();
        debugPrint('DEBUG loaded ${outlets.length} outlets');
        if (outlets.isEmpty) {
          debugPrint('WARNING: No outlets found - check RLS policies for outlets table');
        }
      } catch (e) {
        // Log technical details for debugging
        developer.log(
          'ERROR loading outlets: $e',
          name: 'CheckInScreen._initAll',
          error: e,
        );
        
        // Show user-friendly message for offline errors
        if (!mounted) return;
        setState(() {
          _bootstrapError = _sanitizeBootstrapError(e);
          _ready = true;
        });
        return;
      }
      
      // Load saved outlet selection
      String? savedOutletId;
      try {
        final prefs = await SharedPreferences.getInstance();
        savedOutletId = prefs.getString(_outletPrefKey);
        debugPrint('DEBUG loaded saved outlet: $savedOutletId');
      } catch (e) {
        debugPrint('DEBUG failed to load saved outlet: $e');
      }

      // Load workers based on outlet selection
      List<Map<String, dynamic>> workers = [];
      bool workerDropdownEnabled = false;
      
      if (savedOutletId != null && outlets.any((o) => o['id'] == savedOutletId)) {
        // Auto-load workers from saved outlet
        workers = await RepoList.workers(outletId: savedOutletId);
        workerDropdownEnabled = true;
        debugPrint('DEBUG auto-loaded ${workers.length} workers from saved outlet');
      }

      String? pipelineError;
      try {
        await _embedder.load();
      } catch (e) {
        pipelineError = e.toString();
      }

      await _initializeCamera();
      if (!mounted) return;
      setState(() {
        _outlets = outlets;
        _selectedOutletId = savedOutletId;
        _workers = workers;
        _workerDropdownEnabled = workerDropdownEnabled;
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

  Future<void> _refreshWorkers({bool preserveSelection = false}) async {
    if (_selectedOutletId == null) return;

    try {
      final rows = await RepoList.workers(outletId: _selectedOutletId);
      if (!mounted) return;

      setState(() {
        _workers = rows;

        if (preserveSelection && _selectedWorkerId != null) {
          final exists = rows.any(
            (w) => w['id'].toString() == _selectedWorkerId,
          );
          if (!exists) {
            _selectedWorkerId = null;
          }
        }
        // ❗ otherwise DO NOT TOUCH _selectedWorkerId
      });
    } catch (e) {
      debugPrint('Error refreshing workers: $e');
    }
  }

  Future<void> _handleOutletChange(String? outletId) async {
    debugPrint('DEBUG _handleOutletChange called with outletId: $outletId');
    
    if (outletId == null) {
      debugPrint('DEBUG outlet selection cleared');
      setState(() {
        _selectedOutletId = null;
        _workers = [];
        _selectedWorkerId = null;
        _workerDropdownEnabled = false;
        _faceCheckPassed = false;
        _locationCheckPassed = false;
        _lastActionSummary = null;
      });
      return;
    }

    setState(() {
      _selectedOutletId = outletId;
      _selectedWorkerId = null;
      _faceCheckPassed = false;
      _locationCheckPassed = false;
      _lastActionSummary = null;
      _status = 'Loading workers...';
    });

    // Save outlet selection
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_outletPrefKey, outletId);
      debugPrint('DEBUG saved outlet selection: $outletId');
    } catch (e) {
      debugPrint('DEBUG failed to save outlet: $e');
    }

    // Fetch workers for selected outlet
    try {
      debugPrint('DEBUG fetching workers for outlet: $outletId');
      final workers = await RepoList.workers(outletId: outletId);
      debugPrint('DEBUG fetched ${workers.length} workers: $workers');
      
      if (!mounted) return;
      setState(() {
        _workers = workers;
        _workerDropdownEnabled = true;
        _status = 'Ready';
      });
      debugPrint('DEBUG worker dropdown enabled with ${workers.length} workers');
    } catch (e) {
      debugPrint('ERROR loading workers: $e');
      if (!mounted) return;
      setState(() {
        _workers = [];
        _workerDropdownEnabled = false;
        _status = 'Failed to load workers';
      });
    }
  }

  Map<String, dynamic>? _findWorker(String? workerId) {
    if (workerId == null) return null;
    for (final worker in _workers) {
      if (worker['id'].toString() == workerId) {
        return worker;
      }
    }
    return null;
  }

  Future<void> _handleWorkerChange(String? workerId) async {
    if (workerId == null) {
      setState(() => _selectedWorkerId = null);
      return;
    }

    setState(() {
      _selectedWorkerId = workerId;
      _faceCheckPassed = false;
      _locationCheckPassed = false;
      _lastActionSummary = null;
      _status = 'Ready';
    });

    final worker = _findWorker(workerId);
    final enrolled = worker?['enrolled'] == true;
    if (!enrolled) {
      await _disposeCameraController();
      if (!mounted) return;
      final result = await Navigator.of(context).pushNamed('/enroll', arguments: workerId);
      if (!mounted) return;
      final completed = result == true || result == 'enrollment_completed';
      if (completed) {
        await _refreshWorkers(preserveSelection: true);
      }
      await _restartCameraPreview();
    }
  }

  @override
  void dispose() {
    railRouteObserver.unsubscribe(this);
    _disposeCameraController(updateState: false);
    _cropper.close();
    _embedder.close();
    super.dispose();
  }

  @override
  void didPushNext() {
    _disposeCameraController();
  }

  @override
  void didPopNext() {
    _restartCameraPreview();
    if (mounted && _selectedOutletId != null) {
      _refreshWorkers(); // ❗ no preserve
    }
  }


  Future<void> _doAction(String action) async {
    if (_selectedWorkerId == null) {
      _toast('Pick a worker first');
      return;
    }
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
    final outlet = await SupabaseRepo.outletByWorker(_selectedWorkerId!);
    debugPrint('DEBUG outlet for worker $_selectedWorkerId => $outlet');
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
    final last = await SupabaseRepo.lastAction(_selectedWorkerId!);
    if (last == action) {
      _toast('Already $action. Do the opposite action first.');
      return false;
    }

    final outletId = outlet['id'] as String;
    final nowUtc = DateTime.now().toUtc();
    final payload = {
      'worker_id': _selectedWorkerId!,
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
    final worker = _findWorker(_selectedWorkerId);
    final workerName = (worker?['name'] as String?) ?? 'Worker';
    final actionLabel = action == 'IN' ? 'checked in' : 'checked out';
    final timeText = TimeOfDay.fromDateTime(DateTime.now()).format(context);
    setState(() {
      _lastActionSummary = '$workerName $actionLabel at $timeText';
    });
  }

  Future<bool> _verifyFace() async {
    final shot = await _camera!.takePicture();
    final bytes = await File(shot.path).readAsBytes();
    final tensor = await _cropper.cropAndPreprocess(
      bytes,
      imagePath: shot.path,
    );
    if (tensor == null) {
      _toast('Need exactly one face. Hold steady and retry.');
      return false;
    }

    final profile = await SupabaseRepo.faceProfile(_selectedWorkerId!);
    if (profile == null) {
      _toast('No face profile for this worker. Enroll first.');
      return false;
    }
    
    // CRITICAL SECURITY CHECK: Validate worker_id binding
    // This prevents cross-worker face acceptance attacks
    final profileWorkerId = profile['worker_id']?.toString();
    if (profileWorkerId != _selectedWorkerId) {
      developer.log(
        'SECURITY ERROR: Worker ID mismatch in face verification. '
        'Selected: $_selectedWorkerId, Profile: $profileWorkerId',
        name: 'CheckInScreen._verifyFace',
        level: 1000, // SHOUT level
      );
      _toast('Security validation failed. Please try again or contact support.');
      return false;
    }
    
    final rawEmbedding = profile['embedding'];
    if (rawEmbedding is! List || rawEmbedding.isEmpty) {
      _toast('Face profile missing embedding data. Please re-enroll this worker.');
      return false;
    }

    final storedEmbedding = rawEmbedding.map((e) => (e as num).toDouble()).toList();
    final probe = _embedder.embed(tensor);
    if (storedEmbedding.length != probe.length) {
      _toast('Face profile is outdated. Please re-enroll this worker.');
      return false;
    }
    
    // Compute cosine distance and confidence
    final distance = cosineDistance(probe, storedEmbedding);
    final confidence = 1 - distance;
    _lastFaceScore = confidence;
    
    // CRITICAL: Dual-gate verification - BOTH checks must pass
    // This prevents low-quality matches (60-70%) from proceeding
    // even if they pass the distance threshold.
    //
    // Gate 1: Distance check (similarity threshold)
    if (distance > _faceThreshold) {
      _toast('Face mismatch. Please try again.');
      return false;
    }
    
    // Gate 2: Confidence check (quality threshold)
    // Rejects faces detected in poor lighting, bad angles, or partial occlusion
    if (confidence < _faceMinConfidence) {
      _toast('Face detected, but confidence is too low. Please hold the phone straight and try again.');
      return false;
    }

    // Both gates passed - proceed to location check
    return true;
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

  Widget _buildOutletDropdown(ColorScheme scheme) {
    return DropdownButtonFormField<String>(
      value: _selectedOutletId,
      style: Theme.of(context).textTheme.bodyLarge,
      decoration: InputDecoration(
        labelText: 'Select outlet',
        hintText: 'Choose your outlet',
        helperText: 'Workers will be filtered by outlet',
        prefixIcon: Icon(Icons.location_on, color: scheme.primary),
        filled: true,
        fillColor: Colors.white,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(24),
          borderSide: BorderSide(color: scheme.outline),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(24),
          borderSide: BorderSide(color: scheme.outline),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(24),
          borderSide: BorderSide(color: const Color(0xFF4CAF50), width: 2),
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
      ),
      items: _outlets
          .map(
            (outlet) => DropdownMenuItem<String>(
              value: outlet['id'] as String,
              child: Row(
                children: [
                  Icon(Icons.location_on, size: 20, color: scheme.primary),
                  const SizedBox(width: 12),
                  Flexible(
                    child: Text(
                      outlet['name'] as String? ?? 'Unnamed Outlet',
                      style: const TextStyle(fontWeight: FontWeight.w600),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
            ),
          )
          .toList(),
      onChanged: _handleOutletChange,
      isExpanded: true,
    );
  }

  Widget _buildDropdown(ColorScheme scheme) {
    // Requirements:
    // 1. DropdownButtonFormField.value must bind directly to _selectedWorkerId
    // 2. Do NOT compute or override selected value in build()
    
    // Check for zero workers case
    final hasNoWorkers = _selectedOutletId != null && 
                        _workerDropdownEnabled && 
                        _workers.isEmpty;
    
    String helperText;
    if (!_workerDropdownEnabled) {
      helperText = 'Select an outlet first to load workers';
    } else if (hasNoWorkers) {
      helperText = 'No workers found for this outlet';
    } else {
      helperText = 'Unenrolled workers will open face enrollment';
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        DropdownButtonFormField<String>(
          // FIXED: Direct binding to state variable
          value: _selectedWorkerId,
          style: Theme.of(context).textTheme.bodyLarge,
          decoration: InputDecoration(
            labelText: 'Select worker',
            hintText: 'Search worker',
            helperText: helperText,
            helperMaxLines: 2,
            prefixIcon: Icon(Icons.person, color: scheme.primary),
            filled: true,
            fillColor: Colors.white,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(24),
              borderSide: BorderSide(color: scheme.outline),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(24),
              borderSide: BorderSide(color: scheme.outline),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(24),
              borderSide: BorderSide(color: const Color(0xFF4CAF50), width: 2),
            ),
            contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
          ),
          items: _workers
              .map(
                (w) => DropdownMenuItem<String>(
                  // FIXED: Ensure ID is string to match _selectedWorkerId type
                  value: w['id'].toString(),
                  child: Row(
                    children: [
                      Icon(Icons.person, size: 20, color: scheme.primary),
                      const SizedBox(width: 12),
                      Flexible(
                        child: Text(
                          w['name'] as String? ?? 'Unnamed',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                      if (w['enrolled'] != true) ...[
                        const SizedBox(width: 8),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                          decoration: BoxDecoration(
                            color: scheme.error.withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Text(
                            'Unenrolled',
                            style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.w700,
                              color: scheme.error,
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              )
              .toList(),
          onChanged: (_workerDropdownEnabled && !hasNoWorkers)
              ? (value) {
                  // Focus cleanup
                  FocusScope.of(context).unfocus();
                  _handleWorkerChange(value);
                }
              : null,
          isExpanded: true,
        ),
        if (hasNoWorkers) ...[
          const SizedBox(height: 8),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Text(
              'Please contact your manager to add workers.',
              style: TextStyle(
                fontSize: 12,
                color: scheme.error,
                fontStyle: FontStyle.italic,
              ),
            ),
          ),
        ],
      ],
    );
  }

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
                'Unable to load workers',
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 12),
              Text(
                'Check your connection and Supabase permissions, then tap Retry.',
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
      appBar: workForgeAppBar(context, 'Check-in / Check-out', implyLeading: false),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Dropdown selection card
              Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: scheme.surfaceContainerHighest.withValues(alpha: 0.3),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _buildOutletDropdown(scheme),
                    const SizedBox(height: 16),
                    _buildDropdown(scheme),
                  ],
                ),
              ),
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
