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
  /// Uses RPC function to enforce duplicate face detection at database level.
  /// 
  /// IMPORTANT: This uses RPC instead of direct insert to enforce duplicate face prevention.
  /// DO NOT use supabase.from('face_profiles').insert() - it will fail after SQL migration.
  Future<void> saveProfile(
    String workerId,
    EnrollResult result, {
    String? imageUrl,
  }) async {
    // Use RPC function for safe enrollment with duplicate detection
    final params = <String, dynamic>{
      'p_worker_id': workerId,
      'p_embedding': result.embedding, // Supabase converts List<double> to vector automatically
      'p_face_hash': result.faceHash,
      'p_embed_model': _embedder.modelName,
      'p_version': 3,
    };
    
    // Only include image_url if provided (SQL function has DEFAULT NULL)
    if (imageUrl != null) {
      params['p_image_url'] = imageUrl;
    }
    
    await _client.rpc('enroll_face_profile', params: params);
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
