import 'dart:io';
import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../enroll/enroll_logic.dart';
import '../services/supabase_repo.dart';

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
    await Future.wait([
      _initCamera(),
      _initEmbedder(),
      _loadWorkers(),
    ]);
  }

  Future<void> _initEmbedder() async {
    try {
      await _enrollController.init();
    } catch (e) {
      if (!mounted) return;
      setState(() => _pipelineError = e.toString());
    }
  }

  Future<void> _initCamera() async {
    final cams = await availableCameras();
    final cam = cams.firstWhere(
      (c) => c.lensDirection == CameraLensDirection.front,
      orElse: () => cams.first,
    );
    final controller = CameraController(cam, ResolutionPreset.medium, enableAudio: false);
    await controller.initialize();
    if (!mounted) return;
    setState(() {
      _camera = controller;
      _ready = true;
    });
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

      await Supabase.instance.client
          .from('face_profiles')
          .update({'image_url': '/faces/$storagePath'}).eq('worker_id', _selectedWorkerId!);

      final ratio = result.successfulFrames / captureCount;
      if (!mounted) return;
      setState(() {
        _savedUrl = _isSelfEnrollment ? null : publicUrl;
        _enrollSuccessRatio = ratio;
      });

      await _showSuccessDialog();
      if (!mounted) return;
      if (_isSelfEnrollment) {
        Navigator.of(context).pushReplacementNamed('/check');
      } else {
        await _loadWorkers();
        if (!mounted) return;
        if (_workers.isEmpty) {
          Navigator.of(context).pushReplacementNamed('/check');
        } else {
          setState(() {
            _selectedWorkerId = null;
            _savedUrl = null;
            _enrollSuccessRatio = null;
          });
          _toast('Select the next worker to continue enrollment.');
        }
      }
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
    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('All set!'),
        content: const Text('Face registered successfully!'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Continue'),
          ),
        ],
      ),
    );
  }

  @override
  void dispose() {
    _camera?.dispose();
    _enrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Face Enrollment')),
      body: !_ready
          ? const Center(child: CircularProgressIndicator())
          : Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                children: [
                  if (_pipelineError != null)
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(12),
                      margin: const EdgeInsets.only(bottom: 12),
                      decoration: BoxDecoration(
                        color: Colors.red.shade50,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        'Embedding disabled: $_pipelineError',
                        style: TextStyle(color: Colors.red.shade700),
                      ),
                    ),
                  if (_isSelfEnrollment)
                    Container(
                      width: double.infinity,
                      margin: const EdgeInsets.only(bottom: 12),
                      child: Text(
                        'Registering face for your account.',
                        style: TextStyle(
                          fontWeight: FontWeight.w600,
                          color: Theme.of(context).colorScheme.primary,
                        ),
                      ),
                    )
                  else
                    Row(
                      children: [
                        Expanded(
                          child: DropdownButtonFormField<String>(
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
                        ),
                      ],
                    ),
                  const SizedBox(height: 12),
                  if (_camera != null)
                    AspectRatio(
                      aspectRatio: _camera!.value.aspectRatio,
                      child: CameraPreview(_camera!),
                    ),
                  const SizedBox(height: 12),
                  FilledButton.icon(
                    onPressed: (_saving || (!_isSelfEnrollment && _selectedWorkerId == null)) ? null : _captureAndUpload,
                    icon: const Icon(Icons.face_retouching_natural),
                    label: Text(_saving ? 'Saving…' : 'Capture & Save'),
                  ),
                  if (_savedUrl != null) ...[
                    const SizedBox(height: 12),
                    const Text('Saved preview:'),
                    Text(_savedUrl!, style: const TextStyle(color: Colors.green)),
                  ],
                  if (_enrollSuccessRatio != null) ...[
                    const SizedBox(height: 8),
                    Text('Frames accepted: ${(_enrollSuccessRatio! * 100).toStringAsFixed(0)}%'),
                  ],
                ],
              ),
            ),
    );
  }
}
