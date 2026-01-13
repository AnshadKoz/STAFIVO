import 'dart:math' as math;
import 'dart:typed_data';

import 'package:flutter/services.dart' show rootBundle;
import 'package:tflite_flutter/tflite_flutter.dart';

/// MobileFaceNet currently outputs 192-D float embeddings, so we read the
/// tensor metadata at runtime instead of hard-coding a dimension. Keep the
/// Supabase `face_profiles.embedding` column aligned (e.g. vector(192)).
class MobileFaceNetEmbedder {
  MobileFaceNetEmbedder({
    this.assetPath = _defaultAsset,
    this.threads = 2,
  });

  static const _defaultAsset = 'assets/models/mobilefacenet.tflite';
  static const _inputSize = 112;

  final String assetPath;
  final int threads;

  Interpreter? _interpreter;
  int? _embeddingDim;

  String get modelName => 'mobilefacenet-${_embeddingDim ?? 0}d';

  Future<void> load() async {
    if (_interpreter != null) return;

    try {
      await rootBundle.load(assetPath);
    } catch (_) {
      throw StateError(
        'Missing MobileFaceNet asset at "$assetPath". '
        'Download a 112x112 MobileFaceNet .tflite and place it there.',
      );
    }

    final options = InterpreterOptions()..threads = threads;
    try {
      _interpreter = await Interpreter.fromAsset(assetPath, options: options);
      final outTensor = _interpreter!.getOutputTensors().first;
      _embeddingDim = outTensor.shape.reduce((a, b) => a * b);
    } catch (e) {
      throw StateError(
        'Failed to initialize MobileFaceNet interpreter. '
        'Ensure the asset is a valid TFLite model. ($e)',
      );
    }
  }

  /// Accepts a flattened Float32 tensor (112x112x3).
  List<double> embed(Float32List input) {
    final interpreter = _interpreter;
    final dim = _embeddingDim;
    if (interpreter == null || dim == null) {
      throw StateError('MobileFaceNetEmbedder.load() must be called before embed().');
    }
    if (input.length != _inputSize * _inputSize * 3) {
      throw ArgumentError.value(input.length, 'input.length', 'Expected 112x112x3 tensor.');
    }

    final reshaped = _reshapeInput(input);
    final output = List.generate(1, (_) => List<double>.filled(dim, 0));
    interpreter.run(reshaped, output);

    final embedding = List<double>.from(output.first);
    return _normalize(embedding);
  }

  Future<void> close() async {
    _interpreter?.close();
    _interpreter = null;
    _embeddingDim = null;
  }

  List<List<List<List<double>>>> _reshapeInput(Float32List flat) {
    final tensor = List.generate(
      1,
      (_) => List.generate(
        _inputSize,
        (_) => List.generate(
          _inputSize,
          (_) => List<double>.filled(3, 0.0),
        ),
      ),
    );

    var offset = 0;
    for (var y = 0; y < _inputSize; y++) {
      for (var x = 0; x < _inputSize; x++) {
        tensor[0][y][x][0] = flat[offset++];
        tensor[0][y][x][1] = flat[offset++];
        tensor[0][y][x][2] = flat[offset++];
      }
    }
    return tensor;
  }

  List<double> _normalize(List<double> vector) {
    var norm = 0.0;
    for (final v in vector) {
      norm += v * v;
    }
    norm = norm <= 0 ? 1.0 : math.sqrt(norm);
    for (var i = 0; i < vector.length; i++) {
      vector[i] = vector[i] / norm;
    }
    return vector;
  }
}
