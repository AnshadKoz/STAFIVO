import 'dart:async';
import 'package:flutter/material.dart';

class WelcomeScreen extends StatefulWidget {
  const WelcomeScreen({super.key});

  @override
  State<WelcomeScreen> createState() => _WelcomeScreenState();
}

class _WelcomeScreenState extends State<WelcomeScreen>
    with SingleTickerProviderStateMixin {
  Timer? _timer;
  late AnimationController _controller;
  late Animation<double> _fade;

  @override
  void initState() {
    super.initState();

    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 700),
    );

    _fade = CurvedAnimation(
      parent: _controller,
      curve: Curves.easeIn,
    );

    _controller.forward();
    _timer = Timer(const Duration(seconds: 2), _goToCheckIn);
  }

  @override
  void dispose() {
    _timer?.cancel();
    _controller.dispose();
    super.dispose();
  }

  void _goToCheckIn() {
    if (!mounted) return;
    Navigator.of(context).pushReplacementNamed('/check');
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      body: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            colors: [
              Colors.white,
              scheme.primary.withValues(alpha: 0.04),
            ],
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
          ),
        ),
        child: SafeArea(
          child: FadeTransition(
            opacity: _fade,
            child: Column(
              children: [
                const Spacer(flex: 2),
                Image.asset(
                  'assets/stafivo_logo.png',
                  height: 120,
                ),
                const SizedBox(height: 32),
                Text(
                  'Welcome Back',
                  style: Theme.of(context)
                      .textTheme
                      .headlineMedium
                      ?.copyWith(
                        fontWeight: FontWeight.w700,
                        color: scheme.primary,
                      ),
                ),
                const SizedBox(height: 14),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 32),
                  child: Text(
                    'Checking workers and outlets,\ngetting everything ready for you.',
                    textAlign: TextAlign.center,
                    style: Theme.of(context)
                        .textTheme
                        .bodyLarge
                        ?.copyWith(
                          color:
                              scheme.onSurface.withValues(alpha: 0.65),
                          height: 1.4,
                        ),
                  ),
                ),
                const Spacer(),
                Padding(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 48),
                  child: LinearProgressIndicator(
                    minHeight: 4,
                    borderRadius: BorderRadius.circular(8),
                    color: scheme.primary,
                    backgroundColor:
                        scheme.primary.withValues(alpha: 0.12),
                  ),
                ),
                const SizedBox(height: 40),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
