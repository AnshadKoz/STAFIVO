import 'dart:math' as math;

double cosineDistance(List<double> a, List<double> b) {
  assert(a.length == b.length, 'Vector dimensions must match');
  var dot = 0.0;
  var normA = 0.0;
  var normB = 0.0;
  for (var i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  final denom = (math.sqrt(normA) * math.sqrt(normB)) + 1e-9;
  return 1 - (dot / denom);
}

List<double> meanVectors(List<List<double>> vectors) {
  assert(vectors.isNotEmpty, 'At least one vector required');
  final length = vectors.first.length;
  if (vectors.any((v) => v.length != length)) {
    throw ArgumentError('All vectors must have the same length.');
  }
  final out = List<double>.filled(length, 0);
  for (final vec in vectors) {
    for (var i = 0; i < length; i++) {
      out[i] += vec[i];
    }
  }
  for (var i = 0; i < length; i++) {
    out[i] /= vectors.length;
  }
  return _normalize(out);
}

List<double> _normalize(List<double> vector) {
  var sum = 0.0;
  for (final v in vector) {
    sum += v * v;
  }
  final norm = sum <= 0 ? 1.0 : math.sqrt(sum);
  for (var i = 0; i < vector.length; i++) {
    vector[i] /= norm;
  }
  return vector;
}
