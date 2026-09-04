import 'dart:math';
import 'package:geolocator/geolocator.dart';

class GeoService {
  static Future<Position> currentPosition() async {
    // ignore: avoid_print
    print('[location] checking service...');
    final serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) {
      // ignore: avoid_print
      print('[location] service disabled');
      throw Exception('Location services disabled');
    }

    // ignore: avoid_print
    print('[location] checking permission...');
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
      // ignore: avoid_print
      print('[location] requested permission: $permission');
      if (permission == LocationPermission.denied) {
        // ignore: avoid_print
        print('[location] permission denied');
        throw Exception('Location permission denied');
      }
    }

    if (permission == LocationPermission.deniedForever) {
      // ignore: avoid_print
      print('[location] permission denied forever');
      throw Exception('Location permission permanently denied');
    }

    // ── Stage 1: Last known position (instant, no GPS warm-up needed) ──────
    // ignore: avoid_print
    print('[location] fetching last known position...');
    try {
      final last = await Geolocator.getLastKnownPosition();
      if (last != null) {
        // ignore: avoid_print
        print('[location] using last known position lat=${last.latitude} lng=${last.longitude}');
        return last;
      }
    } catch (e) {
      // ignore: avoid_print
      print('[location] last known position failed: $e — continuing to live fetch');
    }

    // ── Stage 2: Live position, medium accuracy, hard 10-second timeout ────
    // High accuracy on OEM devices (OPPO/Realme/Xiaomi) frequently hangs
    // because battery optimisers kill the GPS provider before it responds.
    // Medium accuracy uses network/cell triangulation which is far more
    // reliable on these devices.
    // ignore: avoid_print
    print('[location] fetching current position (medium accuracy, 10s timeout)...');
    try {
      final pos = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.medium,
          timeLimit: Duration(seconds: 10),
        ),
      );
      // ignore: avoid_print
      print('[location] SUCCESS lat=${pos.latitude} lng=${pos.longitude} accuracy=${pos.accuracy}m');
      return pos;
    } catch (e) {
      // ignore: avoid_print
      print('[location] medium accuracy failed: $e — retrying with low accuracy');
    }

    // ── Stage 3: Final retry with low accuracy (fastest possible fix) ───────
    // ignore: avoid_print
    print('[location] fetching current position (low accuracy, 8s timeout)...');
    final pos = await Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.low,
        timeLimit: Duration(seconds: 8),
      ),
    );
    // ignore: avoid_print
    print('[location] SUCCESS (low) lat=${pos.latitude} lng=${pos.longitude}');
    return pos;
  }

  /// Haversine distance in meters.
  static double distanceMeters(
    double lat1,
    double lon1,
    double lat2,
    double lon2,
  ) {
    const radius = 6371000.0;
    final dLat = _deg2rad(lat2 - lat1);
    final dLon = _deg2rad(lon2 - lon1);
    final a = sin(dLat / 2) * sin(dLat / 2) +
        cos(_deg2rad(lat1)) * cos(_deg2rad(lat2)) * sin(dLon / 2) * sin(dLon / 2);
    final c = 2 * atan2(sqrt(a), sqrt(1 - a));
    return radius * c;
  }

  static double _deg2rad(double value) => value * pi / 180.0;
}
