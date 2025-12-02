import 'dart:developer' as developer;
import 'dart:io';
import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../enroll/enroll_logic.dart';
import '../services/supabase_repo.dart';
import '../widgets/face_frame_overlay.dart';
import '../widgets/railrolls_app_bar.dart';

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
  String? _selectedWorkerId;
  String? _savedUrl;
  double? _enrollSuccessRatio;
  String? _pipelineError;
  bool _allowReturnToCheck = false;
  bool _cameraInitializing = false;
  String? _cameraError;

  List<Map<String, dynamic>> _workers = [];

  bool get _isSelfEnrollment => widget.workerId != null;

  @override
  void initState() {
    super.initState();
    _enrollController = EnrollController();
    _selectedWorkerId = widget.workerId;
    _initAll();
  }

  Future<void> _initAll() async {
    setState(() {
      _ready = false;
      _cameraError = null;
    });
    await _initEmbedder();
    await _loadWorkers();
    await _initializeCamera();
    if (!mounted) return;
    setState(() => _ready = true);
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
      } catch (_) {}
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

  Future<void> _loadWorkers() async {
    if (_isSelfEnrollment) return;
    try {
      var list = await SupabaseRepo.workersNeedingEnrollment();
      if (list.isEmpty) {
        list = await SupabaseRepo.workersNeedingEnrollmentFallback();
      }
      if (!mounted) return;
      setState(() {
        _workers = list;
        _selectedWorkerId = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _workers = [];
        _selectedWorkerId = null;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to load workers: $e')),
      );
    }
  }

  Future<void> _captureAndUpload() async {
    final camera = _camera;
    if (camera == null || !camera.value.isInitialized) return;
    if (_selectedWorkerId == null) {
      _toast('Select a worker first');
      return;
    }
    if (_pipelineError != null) {
      _toast(_pipelineError!);
      return;
    }

    setState(() {
      _saving = true;
      _enrollSuccessRatio = null;
    });

    try {
      const captureCount = 3;
      final frames = <CapturedFrame>[];

      for (var i = 0; i < captureCount; i++) {
        final shot = await camera.takePicture();
        final bytes = await File(shot.path).readAsBytes();
        frames.add(CapturedFrame(bytes: bytes, path: shot.path));
        if (i < captureCount - 1) {
          await Future.delayed(const Duration(milliseconds: 350));
        }
      }

      final result = await _enrollController.enrollWorker(_selectedWorkerId!, frames);
      if (result == null) {
        _toast('Need at least two clean frames. Try again.');
        return;
      }

      final bestIndex = result.bestFrameIndex ?? 0;
      final bestBytes = frames[bestIndex].bytes;
      final storagePath = 'workers/${_selectedWorkerId!}/enroll-best.jpg';

      await Supabase.instance.client.storage.from('faces').uploadBinary(
        storagePath,
        bestBytes,
        fileOptions: const FileOptions(upsert: true, contentType: 'image/jpeg'),
      );

      final publicUrl = Supabase.instance.client.storage.from('faces').getPublicUrl(storagePath);

      await _enrollController.saveProfile(
        _selectedWorkerId!,
        result,
        imageUrl: '/faces/$storagePath',
      );

      final ratio = result.successfulFrames / captureCount;
      if (!mounted) return;
      setState(() {
        _savedUrl = _isSelfEnrollment ? null : publicUrl;
        _enrollSuccessRatio = ratio;
      });

      await _showSuccessDialog();
      if (!mounted) return;
      if (_isSelfEnrollment) {
        setState(() => _allowReturnToCheck = true);
      } else {
        await _loadWorkers();
        if (!mounted) return;
        if (_workers.isEmpty) {
          await _replaceWithCheckScreen();
        } else {
          setState(() {
            _selectedWorkerId = null;
            _savedUrl = null;
            _enrollSuccessRatio = null;
          });
          _toast('Select the next worker to continue enrollment.');
        }
      }
    } on PostgrestException catch (e, stack) {
      // Surface Supabase errors to help diagnose RLS / schema issues.
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

  Future<void> _returnToCheck({bool completed = false}) async {
    await _disposeCameraController();
    if (!mounted) return;
    Navigator.of(context).pop(completed ? 'enrollment_completed' : null);
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
      canPop: true,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) {
          await _disposeCameraController(updateState: false);
        }
      },
      child: Scaffold(
        appBar: railRollsAppBar(context, 'Face Enrollment'),
        body: !_ready
            ? const Center(child: CircularProgressIndicator())
            : SafeArea(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
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
                      if (_isSelfEnrollment)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: Text(
                            'Registering face for your account.',
                            style: TextStyle(
                              fontWeight: FontWeight.w600,
                              color: scheme.primary,
                            ),
                          ),
                        )
                      else
                        DropdownButtonFormField<String>(
                          decoration: const InputDecoration(labelText: 'Select worker'),
                          value: _selectedWorkerId,
                          items: _workers
                              .map(
                                (w) => DropdownMenuItem<String>(
                                  value: w['id'].toString(),
                                  child: Text(w['name']?.toString() ?? 'Unnamed'),
                                ),
                              )
                              .toList(),
                          onChanged: (v) => setState(() => _selectedWorkerId = v),
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
                          onPressed: (_saving || (!_isSelfEnrollment && _selectedWorkerId == null)) ? null : _captureAndUpload,
                          icon: const Icon(Icons.face_retouching_natural),
                          label: Text(_saving ? 'Saving...' : 'Capture & Save'),
                        ),
                      ),
                      if (_savedUrl != null) ...[
                        const SizedBox(height: 16),
                        const Text('Saved preview:'),
                        Text(_savedUrl!, style: TextStyle(color: scheme.primary)),
                      ],
                      if (_enrollSuccessRatio != null) ...[
                        const SizedBox(height: 8),
                        Text('Frames accepted: ${(_enrollSuccessRatio! * 100).toStringAsFixed(0)}%'),
                      ],
                      if (_allowReturnToCheck) ...[
                        const SizedBox(height: 24),
                        OutlinedButton.icon(
                          onPressed: () => _returnToCheck(completed: true),
                          style: OutlinedButton.styleFrom(
                            padding: const EdgeInsets.symmetric(vertical: 16),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
                          ),
                          icon: const Icon(Icons.arrow_back),
                          label: const Text('Back to Check-in screen'),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
      ),
    );
  }
}
