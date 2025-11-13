import 'dart:io';

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';

import '../face/face_cropper.dart';
import '../face/face_embedder.dart';
import '../face/mathx.dart';
import '../services/geo.dart';
import '../services/offline_queue.dart';
import '../services/supabase_repo.dart';

class CheckInScreen extends StatefulWidget {
  const CheckInScreen({super.key});

  @override
  State<CheckInScreen> createState() => _CheckInScreenState();
}

class _CheckInScreenState extends State<CheckInScreen> {
  static const double _faceThreshold = 0.40;

  CameraController? _camera;
  final FaceCropper _cropper = FaceCropper();
  final MobileFaceNetEmbedder _embedder = MobileFaceNetEmbedder();
  bool _ready = false;
  bool _busy = false;
  String? _pipelineError;

  String? _selectedWorkerId;
  List<Map<String, dynamic>> _workers = [];
  String _status = 'Ready';
  double? _lastFaceScore;

  @override
  void initState() {
    super.initState();
    _initAll();
  }

  Future<void> _initAll() async {
    final rows = await RepoList.workers();
    String? pipelineError;
    try {
      await _embedder.load();
    } catch (e) {
      pipelineError = e.toString();
    }

    final cameras = await availableCameras();
    final camera = cameras.firstWhere(
      (c) => c.lensDirection == CameraLensDirection.front,
      orElse: () => cameras.first,
    );
    final controller = CameraController(camera, ResolutionPreset.medium, enableAudio: false);
    await controller.initialize();

    if (!mounted) return;
    setState(() {
      _workers = rows;
      _camera = controller;
      _pipelineError = pipelineError;
      _ready = true;
    });
  }

  @override
  void dispose() {
    _camera?.dispose();
    _cropper.close();
    _embedder.close();
    super.dispose();
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
      _status = 'Checking face…';
    });

    try {
      final faceOk = await _verifyFace();
      if (!faceOk) return;

      setState(() => _status = 'Checking location…');
      final outlet = await SupabaseRepo.outletByWorker(_selectedWorkerId!);
      if (outlet == null) {
        _toast('Outlet not found');
        return;
      }

      final pos = await GeoService.currentPosition();
      final dist = GeoService.distanceMeters(
        pos.latitude,
        pos.longitude,
        (outlet['latitude'] as num).toDouble(),
        (outlet['longitude'] as num).toDouble(),
      );
      final radius = (outlet['radius_meters'] as num).toDouble();
      if (dist > radius) {
        _toast(
          'Outside outlet geofence (${dist.toStringAsFixed(1)} m > ${radius.toStringAsFixed(0)} m)',
        );
        return;
      }

      setState(() => _status = 'Validating last state…');
      final last = await SupabaseRepo.lastAction(_selectedWorkerId!);
      if (last == action) {
        _toast('Already $action. Do the opposite action first.');
        return;
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

      setState(() => _status = 'Saving…');
      try {
        await SupabaseRepo.insertAttendanceRaw(payload);
        _success('$action recorded');
      } on AttendanceNetworkError catch (e) {
        await OfflineQueue.addPending(payload: payload, reason: 'network:${e.message}');
        _success('$action queued (offline)');
      } on AttendanceServerDenied catch (e) {
        _toast('Server denied: ${e.message}');
      } on AttendanceAuthError catch (e) {
        _toast('Auth error: ${e.message}');
      } catch (e) {
        await OfflineQueue.addPending(payload: payload, reason: 'unknown:$e');
        _success('$action queued (offline)');
      }
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
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
    final distance = cosineDistance(probe, storedEmbedding);
    _lastFaceScore = 1 - distance;
    if (distance > _faceThreshold) {
      _toast('Face mismatch. Please try again.');
      return false;
    }

    return true;
  }

  void _toast(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
    setState(() => _status = msg);
  }

  void _success(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
    setState(() => _status = msg);
  }

  @override
  Widget build(BuildContext context) {
    if (!_ready) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Check-in / Check-out')),
      body: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          children: [
            DropdownButtonFormField<String>(
              value: _selectedWorkerId,
              decoration: const InputDecoration(labelText: 'Worker'),
              items: _workers
                  .map(
                    (w) => DropdownMenuItem<String>(
                      value: w['id'] as String,
                      child: Text(w['name'] as String),
                    ),
                  )
                  .toList(),
              onChanged: (v) => setState(() => _selectedWorkerId = v),
            ),
            const SizedBox(height: 12),
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
            AspectRatio(
              aspectRatio: _camera!.value.aspectRatio,
              child: CameraPreview(_camera!),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: FilledButton(
                    onPressed: _busy ? null : () => _doAction('IN'),
                    child: const Text('Check-in'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: OutlinedButton(
                    onPressed: _busy ? null : () => _doAction('OUT'),
                    child: const Text('Check-out'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(_status, style: const TextStyle(color: Colors.grey)),
            if (_lastFaceScore != null)
              Text('Face confidence: ${(_lastFaceScore! * 100).toStringAsFixed(1)}%'),
          ],
        ),
      ),
    );
  }
}

class RepoList {
  static Future<List<Map<String, dynamic>>> workers() async {
    final dynamic response = await sb.from('workers').select('id,name').order('name');
    if (response is! List) return [];
    return List<Map<String, dynamic>>.from(response);
  }
}
