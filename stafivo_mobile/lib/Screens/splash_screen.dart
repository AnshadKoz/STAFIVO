import 'dart:async';
import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../services/supabase_repo.dart';
import '../theme/stafivo_colors.dart';

class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen>
    with SingleTickerProviderStateMixin {
  Timer? _timer;
  late AnimationController _controller;
  late Animation<double> _scale;
  late Animation<double> _opacity;

  @override
  void initState() {
    super.initState();

    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1400),
    )..repeat(reverse: true);

    _scale = Tween<double>(begin: 0.92, end: 1.05).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeInOut),
    );

    _opacity = Tween<double>(begin: 0.75, end: 1.0).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeInOut),
    );

    // Navigate after delay
    _timer = Timer(const Duration(seconds: 3), _bootstrap);
  }

  @override
  void dispose() {
    _timer?.cancel();
    _controller.dispose();
    super.dispose();
  }

  // Called once the splash delay has elapsed.
  Future<void> _bootstrap() async {
    if (!mounted) return;
    final session = Supabase.instance.client.auth.currentSession;
    if (session == null) {
      // No active session — send to login.
      Navigator.of(context).pushReplacementNamed('/login');
      return;
    }

    // Session exists: check enrollment status BEFORE routing.
    // This mirrors the post-login check in LoginScreen._routePostLogin() and
    // prevents a returning user from landing on EnrollScreen when already enrolled.
    try {
      final enrolled = await SupabaseRepo.isCurrentWorkerEnrolled();
      if (!mounted) return;
      if (enrolled) {
        Navigator.of(context).pushReplacementNamed('/check');
      } else {
        Navigator.of(context).pushReplacementNamed('/enroll');
      }
    } catch (e) {
      if (!mounted) return;
      // On any unexpected error fall back to login so the user can retry.
      Navigator.of(context).pushReplacementNamed('/login');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // Animated logo
              AnimatedBuilder(
                animation: _controller,
                builder: (context, child) {
                  return Opacity(
                    opacity: _opacity.value,
                    child: Transform.scale(
                      scale: _scale.value,
                      child: child,
                    ),
                  );
                },
                child: Container(
                  width: 150,
                  height: 150,
                  decoration: BoxDecoration(
                    color: StafivoColors.primary.withValues(alpha: 0.06),
                    shape: BoxShape.circle,
                  ),
                  padding: const EdgeInsets.all(26),
                  child: Image.asset(
                    'assets/stafivo_logo.png',
                    fit: BoxFit.contain,
                  ),
                ),
              ),
              const SizedBox(height: 28),
              // Brand name
              const Text(
                'STAFIVO',
                style: TextStyle(
                  fontSize: 28,
                  fontWeight: FontWeight.w700,
                  color: StafivoColors.primary,
                  letterSpacing: 4,
                ),
              ),
              const SizedBox(height: 8),
              // Tagline
              const Text(
                'Smart Workforce. Seamless Operations.',
                style: TextStyle(
                  fontSize: 13,
                  color: StafivoColors.textSecondary,
                  letterSpacing: 0.3,
                ),
              ),
              const SizedBox(height: 6),
              // Developer credit
              const Text(
                'Powered by Pent 26',
                style: TextStyle(
                  fontSize: 11,
                  color: StafivoColors.textMuted,
                  fontWeight: FontWeight.w500,
                  letterSpacing: 0.2,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
