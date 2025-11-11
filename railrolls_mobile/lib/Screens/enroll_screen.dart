import 'dart:io';
import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';
import 'package:path_provider/path_provider.dart';
import 'package:path/path.dart' as p;
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:uuid/uuid.dart';

class EnrollScreen extends StatefulWidget {
  const EnrollScreen({super.key});
  @override
  State<EnrollScreen> createState() => _EnrollScreenState();
}

class _EnrollScreenState extends State<EnrollScreen> {
  CameraController? _controller;
  late final FaceDetector _detector;
  bool _ready = false;
  String? _savedUrl;
  String? _selectedWorkerId;

  @override
  void initState() {
    super.initState();
    _detector = FaceDetector(options: FaceDetectorOptions(
      enableContours: false, enableClassification: false, minFaceSize: 0.2));
    _initCamera();
    _loadWorkers();
  }

  Future<void> _initCamera() async {
    final cams = await availableCameras();
    final cam = cams.firstWhere((c) => c.lensDirection == CameraLensDirection.front, orElse: () => cams.first);
    _controller = CameraController(cam, ResolutionPreset.medium, enableAudio: false);
    await _controller!.initialize();
    if (mounted) setState(() => _ready = true);
  }

  Future<void> _loadWorkers() async {
    // pull workers list so the operator picks a worker to enroll
    // (RLS ensures manager only sees their outlet’s workers)
    final resp = await Supabase.instance.client
      .from('workers')
      .select('id,name').order('name');
    // store in state
    setState(() {
      // very lightweight local store: list of {id, name}
      _workers = List<Map<String, dynamic>>.from(resp);
    });
  }

  List<Map<String, dynamic>> _workers = [];

  Future<void> _captureAndUpload() async {
    if (_controller == null || !_controller!.value.isInitialized) return;
    if (_selectedWorkerId == null) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Select a worker first')));
      return;
    }

    // 1) capture photo
    final file = await _controller!.takePicture();
    final imgPath = file.path;

    // 2) run face detection on still image
    final input = InputImage.fromFilePath(imgPath);
    final faces = await _detector.processImage(input);
    if (faces.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('No face detected. Try again.')));
      return;
    }

    // 3) persist to temp path (so we can upload)
    final dir = await getTemporaryDirectory();
    final fname = 'enroll-${const Uuid().v4()}.jpg';
    final localPath = p.join(dir.path, fname);
    await File(imgPath).copy(localPath);

    // 4) upload to Storage at faces/workers/<worker_id>/enroll-best.jpg
    final storagePath = 'workers/${_selectedWorkerId!}/enroll-best.jpg';
    final bytes = await File(localPath).readAsBytes();
    await Supabase.instance.client.storage.from('faces').uploadBinary(
      storagePath, bytes, fileOptions: const FileOptions(upsert: true, contentType: 'image/jpeg'));

    final publicUrl = Supabase.instance.client.storage.from('faces').getPublicUrl(storagePath); // can keep non-public; using signed URLs later

    // 5) write face_profiles row (placeholder hash for now)
    final faceHash = _placeholderHash(bytes); // simple hash now; replace with embeddings later

    await Supabase.instance.client.from('face_profiles').upsert({
      'worker_id': _selectedWorkerId,
      'face_hash': faceHash,
      'image_url': '/faces/$storagePath',
      'version': 1,
    }, onConflict: 'worker_id');

    setState(() => _savedUrl = publicUrl);
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Enrollment saved')));
    }
  }

  String _placeholderHash(List<int> bytes) {
    // super simple checksum to start; replace with proper embedding hash later
    int sum = 0;
    for (final b in bytes) sum = (sum + b) & 0xFFFFFFFF;
    return sum.toRadixString(16);
  }

  @override
  void dispose() {
    _controller?.dispose();
    _detector.close();
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
                  Row(children: [
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        decoration: const InputDecoration(labelText: 'Select worker'),
                        value: _selectedWorkerId,
                        items: _workers
                            .map((w) => DropdownMenuItem<String>(
                                  value: w['id'].toString(),
                                  child: Text(w['name']?.toString() ?? 'Unnamed'),
                                ))
                            .toList(),
                        onChanged: (v) => setState(() => _selectedWorkerId = v),
                      ),
                    ),
                  ]),
                  const SizedBox(height: 12),
                  AspectRatio(
                    aspectRatio: _controller!.value.aspectRatio,
                    child: CameraPreview(_controller!),
                  ),
                  const SizedBox(height: 12),
                  FilledButton.icon(
                    onPressed: _captureAndUpload,
                    icon: const Icon(Icons.face_retouching_natural),
                    label: const Text('Capture & Save'),
                  ),
                  if (_savedUrl != null) ...[
                    const SizedBox(height: 12),
                    Text('Saved preview:'),
                    Text(_savedUrl!, style: const TextStyle(color: Colors.green)),
                  ]
                ],
              ),
            ),
    );
  }
}
