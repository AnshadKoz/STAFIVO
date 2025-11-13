import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' show Rect, Size;

import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';
import 'package:image/image.dart' as img;

/// Detects, crops, and normalizes faces into 112x112 RGB tensors.
class FaceCropper {
  FaceCropper({FaceDetector? detector})
      : _detector = detector ??
            FaceDetector(
              options: FaceDetectorOptions(
                performanceMode: FaceDetectorMode.accurate,
                enableContours: false,
                enableLandmarks: false,
                minFaceSize: 0.2,
              ),
            );

  static const int targetSize = 112;

  final FaceDetector _detector;

  /// Returns a Float32 tensor (1 x 112 x 112 x 3) normalized to [-1, 1].
  /// Returns null if zero or multiple faces detected.
  Future<Float32List?> cropAndPreprocess(
    Uint8List inputBytes, {
    String? imagePath,
  }) async {
    final decoded = img.decodeImage(inputBytes);
    if (decoded == null) return null;

    List<Face> faces;
    if (imagePath != null) {
      faces = await _detector.processImage(InputImage.fromFilePath(imagePath));
    } else {
      final metadata = InputImageMetadata(
        size: Size(decoded.width.toDouble(), decoded.height.toDouble()),
        rotation: InputImageRotation.rotation0deg,
        format: InputImageFormat.bgra8888,
        bytesPerRow: decoded.width * 4,
      );
      final bgraBytes = _toBgra(decoded);
      faces = await _detector.processImage(
        InputImage.fromBytes(bytes: bgraBytes, metadata: metadata),
      );
    }

    if (faces.length != 1) {
      return null;
    }

    final cropBox = _expandBox(faces.first.boundingBox, decoded.width, decoded.height);
    final cropped = img.copyCrop(
      decoded,
      x: cropBox.left,
      y: cropBox.top,
      width: cropBox.width,
      height: cropBox.height,
    );
    final resized = img.copyResize(
      cropped,
      width: targetSize,
      height: targetSize,
      interpolation: img.Interpolation.linear,
    );

    final tensor = Float32List(targetSize * targetSize * 3);
    var offset = 0;
    for (var y = 0; y < targetSize; y++) {
      for (var x = 0; x < targetSize; x++) {
        final pixel = resized.getPixel(x, y);
        tensor[offset++] = (pixel.r / 255.0) * 2 - 1;
        tensor[offset++] = (pixel.g / 255.0) * 2 - 1;
        tensor[offset++] = (pixel.b / 255.0) * 2 - 1;
      }
    }

    return tensor;
  }

  Future<void> close() => _detector.close();

  Uint8List _toBgra(img.Image src) {
    final bytes = Uint8List(src.width * src.height * 4);
    var offset = 0;
    for (var y = 0; y < src.height; y++) {
      for (var x = 0; x < src.width; x++) {
        final pixel = src.getPixel(x, y);
        bytes[offset++] = pixel.b.toInt();
        bytes[offset++] = pixel.g.toInt();
        bytes[offset++] = pixel.r.toInt();
        bytes[offset++] = 255;
      }
    }
    return bytes;
  }

  _CropBox _expandBox(Rect rect, int width, int height) {
    final size = math.max(rect.width, rect.height) * 1.4;
    final half = size / 2;
    final cx = rect.center.dx;
    final cy = rect.center.dy;
    final left = (cx - half).clamp(0, math.max(0, width - 1)).toDouble();
    final top = (cy - half).clamp(0, math.max(0, height - 1)).toDouble();
    final right = (cx + half).clamp(left + 1, width.toDouble());
    final bottom = (cy + half).clamp(top + 1, height.toDouble());
    final cropWidth = math.max(1, (right - left).round());
    final cropHeight = math.max(1, (bottom - top).round());
    return _CropBox(
      left: left.round(),
      top: top.round(),
      width: cropWidth,
      height: cropHeight,
    );
  }
}

class _CropBox {
  _CropBox({
    required this.left,
    required this.top,
    required this.width,
    required this.height,
  });

  final int left;
  final int top;
  final int width;
  final int height;
}
