import 'dart:developer' as developer;
import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../enroll/enroll_logic.dart';
import '../widgets/face_frame_overlay.dart';
import '../widgets/stafivo_app_bar.dart';
import '../widgets/alert_dialog_helper.dart';

class EnrollScreen extends StatefulWidget {
  const EnrollScreen({super.key, this.workerId});

  final String? workerId;

  @override
  State<EnrollScreen> createState() => _EnrollScreenState();
}

class _EnrollScreenState extends State<EnrollScreen> {
  CameraController? _camera;
  late final EnrollController _enrollController;

  bool _ready = false;
  bool _saving = false;
  String? _workerId;          // resolved from logged-in auth user
  String? _bootstrapError;    // shown if auth/worker lookup fails
  String? _pipelineError;
  bool _cameraInitializing = false;
  String? _cameraError;

  @override
  void initState() {
    super.initState();
    _enrollController = EnrollController();
    _initAll();
  }

  Future<void> _initAll() async {
    setState(() {
      _ready = false;
      _cameraError = null;
      _bootstrapError = null;
    });
    await _resolveWorker();
    await _initEmbedder();
    await _initializeCamera();
    if (!mounted) return;
    setState(() => _ready = true);
  }

  /// Resolves the logged-in auth user → workers.id → _workerId.
  ///
  /// face_profiles.worker_id is a FK to workers.id (NOT app_users.id).
  /// The workers table has its own auth_id column, so we can query it directly.
  ///
  /// Correct path: auth.currentUser.id → workers WHERE auth_id = auth_id → workers.id
  ///
  /// Uses .single() so Supabase throws a PostgrestException if the result is
  /// not exactly one row — this catches both missing workers (PGRST116) and
  /// data inconsistencies where multiple workers share the same auth_id.
  Future<void> _resolveWorker() async {
    try {
      final authUser = Supabase.instance.client.auth.currentUser;
      if (authUser == null) {
        if (mounted) setState(() => _bootstrapError = 'Not logged in. Please sign in again.');
        return;
      }

      // .single() enforces exactly one row — throws PostgrestException otherwise.
      // This prevents silently using the wrong worker when data is inconsistent.
      final workerRow = await Supabase.instance.client
          .from('workers')
          .select('id')
          .eq('auth_id', authUser.id)
          .single();

      final workerId = workerRow['id']?.toString();
      if (workerId == null || workerId.isEmpty) {
        if (mounted) {
          setState(() => _bootstrapError = 'Worker record is incomplete. Contact support.');
        }
        return;
      }

      developer.log('Resolved worker_id: $workerId', name: 'EnrollScreen');
      if (mounted) setState(() => _workerId = workerId);
    } on PostgrestException catch (e) {
      developer.log(
        '_resolveWorker: PostgrestException code=${e.code} msg=${e.message}',
        name: 'EnrollScreen',
      );
      if (e.code == 'PGRST116') {
        // "JSON object requested, multiple (or no) rows returned"
        // Covers: worker not found OR duplicate auth_id in workers table.
        if (mounted) {
          setState(() => _bootstrapError = 'Worker not found. Please contact admin.');
        }
      } else {
        // Unexpected DB error (RLS denial, schema issue, etc.) — surface the message
        // so it is debuggable without hiding it under the same user-facing label.
        if (mounted) {
          setState(() => _bootstrapError = 'Database error: ${e.message}');
        }
      }
    } catch (e) {
      developer.log('_resolveWorker unexpected error: $e', name: 'EnrollScreen');
      if (mounted) setState(() => _bootstrapError = 'Could not load worker profile: $e');
    }
  }

  Future<void> _initEmbedder() async {
    try {
      await _enrollController.init();
    } catch (e) {
      if (!mounted) return;
      setState(() => _pipelineError = e.toString());
    }
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
          name: 'EnrollScreen',
          error: e,
        );
      }
    }
  }

  Future<CameraController> _createCameraController() async {
    final cameras = await availableCameras();
    if (cameras.isEmpty) {
      throw CameraException('no_camera', 'No camera available on this device');
    }
    final cam = cameras.firstWhere(
      (c) => c.lensDirection == CameraLensDirection.front,
      orElse: () => cameras.first,
    );
    // Prefer a sharper preview (high) but keep graceful fallbacks for devices
    // that cannot deliver that size; capture resolution stays high.
    final presets = <ResolutionPreset>[
      ResolutionPreset.high,
      ResolutionPreset.medium,
      ResolutionPreset.low,
    ];
    CameraException? lastError;
    for (final preset in presets) {
      final controller = CameraController(
        cam,
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


  Future<void> _captureAndUpload() async {
    final camera = _camera;
    if (camera == null || !camera.value.isInitialized) return;
    if (_workerId == null) {
      _toast('Worker profile not loaded. Please restart.');
      return;
    }
    if (_pipelineError != null) {
      _toast(_pipelineError!);
      return;
    }

    setState(() => _saving = true);

    try {
      const captureCount = 3;
      final frames = <CapturedFrame>[];

      for (var i = 0; i < captureCount; i++) {
        final shot = await camera.takePicture();
        final bytes = await shot.readAsBytes();
        frames.add(CapturedFrame(bytes: bytes, path: shot.path));
        if (i < captureCount - 1) {
          await Future.delayed(const Duration(milliseconds: 350));
        }
      }

      final result = await _enrollController.enrollWorker(_workerId!, frames);
      if (result == null) {
        _toast('Need at least two clean frames. Try again.');
        return;
      }

      // Debug: log embedding and faceHash before upload/save so values are
      // visible in the console if the DB raises a constraint error.
      developer.log(
        'enrollWorker result — '
        'embedding.length=${result.embedding.length} '
        'faceHash="${result.faceHash}" '
        'successfulFrames=${result.successfulFrames}',
        name: 'EnrollScreen',
      );

      final bestIndex = result.bestFrameIndex ?? 0;
      final bestBytes = frames[bestIndex].bytes;
      final storagePath = 'workers/$_workerId/enroll-best.jpg';

      await Supabase.instance.client.storage.from('faces').uploadBinary(
        storagePath,
        bestBytes,
        fileOptions: const FileOptions(upsert: true, contentType: 'image/jpeg'),
      );

      // Pre-save validation: confirm workers.id exists before inserting face_profiles.
      // Guards against FK violation (code 23503) if _workerId was resolved incorrectly.
      final workerCheck = await Supabase.instance.client
          .from('workers')
          .select('id')
          .eq('id', _workerId!)
          .limit(1);
      if (workerCheck.isEmpty) {
        developer.log(
          'Pre-save validation failed: worker_id=$_workerId not in workers table',
          name: 'EnrollScreen',
        );
        _toast('Worker not found. Please contact admin.');
        return;
      }

      await _enrollController.saveProfile(
        _workerId!,
        result,
        imageUrl: '/faces/$storagePath',
      );

      await _showSuccessDialog();
      if (!mounted) return;
      // Enrollment complete — go directly to the check-in screen.
      await _replaceWithCheckScreen();
    } on PostgrestException catch (e, stack) {
      // Check for duplicate face error (error code 23514)
      final isDuplicateFace = e.code == '23514' || 
                              (e.message.toLowerCase().contains('face already enrolled') ||
                               e.message.toLowerCase().contains('already enrolled for another worker'));
      
      if (isDuplicateFace) {
        // Show specific alert for duplicate face
        if (mounted) {
          showAlertDialog(
            context,
            message: 'This face is already registered.\nPlease contact your manager.',
            type: AlertType.error,
            autoDismissSeconds: 0, // Don't auto-dismiss, user must acknowledge
          );
        }
        developer.log(
          'Duplicate face detected during enrollment',
          name: 'EnrollScreen',
          error: e,
          stackTrace: stack,
        );
        return;
      }
      
      // Surface other Supabase errors to help diagnose RLS / schema issues.
      developer.log(
        'Supabase enrollment failed: ${e.message}',
        name: 'EnrollScreen',
        error: e,
        stackTrace: stack,
      );
      final hintStr = e.hint?.toString();
      final detailsStr = e.details?.toString();
      final details = [
        if (e.code != null) 'code ${e.code}',
        if (hintStr != null && hintStr.isNotEmpty) 'hint: $hintStr',
        if (detailsStr != null && detailsStr.isNotEmpty) 'details: $detailsStr',
      ].where((s) => s.isNotEmpty).join(' • ');
      final message = details.isEmpty ? e.message : '${e.message} ($details)';
      _toast('Enrollment failed: $message');
    } catch (e, stack) {
      developer.log(
        'Enrollment pipeline failed',
        name: 'EnrollScreen',
        error: e,
        stackTrace: stack,
      );
      _toast('Enrollment failed: $e');
    } finally {
      if (mounted) {
        setState(() => _saving = false);
      }
    }
  }

  void _toast(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _showSuccessDialog() async {
    if (!mounted) return;
    final scheme = Theme.of(context).colorScheme;
    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
        backgroundColor: Colors.white,
        contentPadding: const EdgeInsets.fromLTRB(24, 24, 24, 12),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                CircleAvatar(
                  radius: 22,
                  backgroundColor: scheme.primary.withValues(alpha: 0.1),
                  child: Icon(Icons.check_rounded, color: scheme.primary, size: 28),
                ),
                const SizedBox(width: 12),
                Text(
                  'All set!',
                  style: TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: 20,
                    color: scheme.primary,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            const Text(
              'Face registered successfully!',
              style: TextStyle(fontSize: 16),
            ),
          ],
        ),
        actionsPadding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
        actions: [
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('Continue'),
            ),
          ),
        ],
      ),
    );
  }

  @override
  void dispose() {
    _disposeCameraController(updateState: false);
    _enrollController.dispose();
    super.dispose();
  }

  Future<void> _returnToCheck() async {
    await _disposeCameraController();
    if (!mounted) return;
    // Login used pushReplacementNamed('/enroll'), so there is no previous
    // route to pop back to — doing so produces a black screen.
    // Instead, always replace with the login screen to reset the stack.
    Navigator.of(context).pushReplacementNamed('/login');
  }

  Future<void> _replaceWithCheckScreen() async {
    await _disposeCameraController(updateState: false);
    if (!mounted) return;
    Navigator.of(context).pushReplacementNamed('/check');
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
                    children: const [
                      Icon(Icons.camera_alt_rounded, color: Colors.white, size: 16),
                      SizedBox(width: 6),
                      Text(
                        'Live preview',
                        style: TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w600,
                          fontSize: 12,
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

    Widget child;
    if (_cameraError != null) {
      child = Column(
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
            onPressed: _cameraInitializing ? null : _initAll,
            icon: const Icon(Icons.refresh),
            label: const Text('Retry'),
          ),
        ],
      );
    } else if (_cameraInitializing) {
      child = const CircularProgressIndicator();
    } else {
      child = Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const CircularProgressIndicator(),
          const SizedBox(height: 12),
          Text(
            'Starting camera...',
            style: TextStyle(color: scheme.onSurface.withValues(alpha: 0.6)),
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
          child: Center(child: child),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final previewHeight = MediaQuery.of(context).size.height * 0.38;
    return PopScope(
      // Prevent the system/gesture back from raw-popping to a blank navigator.
      // We handle back ourselves via _returnToCheck() which disposes the camera
      // and replaces the route with the login screen.
      canPop: false,
      onPopInvokedWithResult: (didPop, _) async {
        if (!didPop) {
          await _returnToCheck();
        }
      },
      child: Scaffold(
        appBar: stafivoAppBar(
          context,
          'Face Enrollment',
          leading: IconButton(
            tooltip: 'Back',
            icon: const Icon(Icons.arrow_back_ios_new_rounded),
            onPressed: () => _returnToCheck(),
          ),
        ),
        body: !_ready
            ? const Center(child: CircularProgressIndicator())
            : SafeArea(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      // Bootstrap error (auth/worker lookup failure)
                      if (_bootstrapError != null)
                        Container(
                          padding: const EdgeInsets.all(16),
                          margin: const EdgeInsets.only(bottom: 16),
                          decoration: BoxDecoration(
                            color: scheme.error.withValues(alpha: 0.08),
                            borderRadius: BorderRadius.circular(18),
                          ),
                          child: Text(
                            _bootstrapError!,
                            style: TextStyle(
                              color: scheme.error,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      if (_pipelineError != null)
                        Container(
                          padding: const EdgeInsets.all(16),
                          margin: const EdgeInsets.only(bottom: 16),
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
                      const SizedBox(height: 16),
                      _buildCameraPreview(previewHeight),
                      const SizedBox(height: 24),
                      SizedBox(
                        width: double.infinity,
                        child: FilledButton.icon(
                          style: FilledButton.styleFrom(
                            padding: const EdgeInsets.symmetric(vertical: 18),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                          ),
                          onPressed: (_saving || _workerId == null) ? null : _captureAndUpload,
                          icon: const Icon(Icons.face_retouching_natural),
                          label: Text(_saving ? 'Saving...' : 'Capture & Save'),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
      ),
    );
  }
}
