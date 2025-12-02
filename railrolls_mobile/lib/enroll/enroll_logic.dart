import 'dart:typed_data';

import 'package:supabase_flutter/supabase_flutter.dart';

import '../face/face_cropper.dart';
import '../face/face_embedder.dart';
import '../face/mathx.dart';

class CapturedFrame {
  CapturedFrame({
    required this.bytes,
    required this.path,
  });

  final Uint8List bytes;
  final String path;
}

class EnrollResult {
  EnrollResult({
    required this.embedding,
    required this.successfulFrames,
    this.bestFrameIndex,
    required this.faceHash,
  });

  final List<double> embedding;
  final int successfulFrames;
  final int? bestFrameIndex;
  final String faceHash;
}

class EnrollController {
  EnrollController({
    FaceCropper? cropper,
    MobileFaceNetEmbedder? embedder,
    SupabaseClient? client,
  })  : _cropper = cropper ?? FaceCropper(),
        _embedder = embedder ?? MobileFaceNetEmbedder(),
        _client = client ?? Supabase.instance.client;

  final FaceCropper _cropper;
  final MobileFaceNetEmbedder _embedder;
  final SupabaseClient _client;

  Future<void> init() async => _embedder.load();

  Future<EnrollResult?> enrollWorker(
    String workerId,
    List<CapturedFrame> frames,
  ) async {
    if (frames.isEmpty) {
      throw ArgumentError('At least one frame is required');
    }

    final vectors = <List<double>>[];
    int? firstSuccessIndex;

    for (var i = 0; i < frames.length; i++) {
      final tensor = await _cropper.cropAndPreprocess(
        frames[i].bytes,
        imagePath: frames[i].path,
      );
      if (tensor == null) continue;

      final embedding = _embedder.embed(tensor);
      vectors.add(embedding);
      firstSuccessIndex ??= i;
    }

    if (vectors.length < 2) {
      return null;
    }

    final averaged = meanVectors(vectors);
    final faceHash = _embeddingHash(averaged);

    return EnrollResult(
      embedding: averaged,
      successfulFrames: vectors.length,
      bestFrameIndex: firstSuccessIndex,
      faceHash: faceHash,
    );
  }

  /// Persists the profile after `enrollWorker` generates an embedding.
  Future<void> saveProfile(
    String workerId,
    EnrollResult result, {
    String? imageUrl,
  }) async {
    await _client.from('face_profiles').upsert({
      'worker_id': workerId,
      'embedding': result.embedding,
      'face_hash': result.faceHash,
      'embed_model': _embedder.modelName,
      'version': 3,
      if (imageUrl != null) 'image_url': imageUrl,
    }, onConflict: 'worker_id');
  }

  Future<void> dispose() async {
    await _cropper.close();
    await _embedder.close();
  }
}

String _embeddingHash(List<double> emb) {
  var sum = 0.0;
  for (final v in emb) {
    sum += v * 1000.0;
  }
  final intVal = sum.round() & 0x7fffffff;
  return intVal.toRadixString(16);
}
