// Conditional export for mobile/native and web builds.
//
// `tflite_flutter` is only imported by the mobile/native implementation.
export 'face_embedder_io.dart' if (dart.library.html) 'face_embedder_web.dart';
