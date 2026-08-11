import 'dart:typed_data';

/// Web implementation for embedding generation.
///
/// This stub preserves the app structure for web builds while preventing
/// `tflite_flutter` from being compiled on Chrome. The face recognition flow
/// remains disabled on web because the native TFLite interpreter is unavailable.
class MobileFaceNetEmbedder {
  MobileFaceNetEmbedder({
    this.assetPath = _defaultAsset,
    this.threads = 2,
  });

  static const _defaultAsset = 'assets/models/mobilefacenet.tflite';

  final String assetPath;
  final int threads;

  String get modelName => 'mobilefacenet-web';

  Future<void> load() async {
    throw UnsupportedError(
      'Face embeddings are not available on web. ' 
      'This feature requires the native TFLite interpreter.',
    );
  }

  List<double> embed(Float32List input) {
    throw UnsupportedError(
      'Face embeddings are not available on web. ' 
      'This feature requires the native TFLite interpreter.',
    );
  }

  Future<void> close() async {
    return;
  }
}
