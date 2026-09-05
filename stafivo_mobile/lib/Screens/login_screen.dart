import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../services/supabase_repo.dart';
import '../theme/stafivo_colors.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _loading = false;
  bool _checkingProfile = false;
  bool _showPassword = false;

  Future<void> _signIn() async {
    if (_loading || _checkingProfile) return;
    setState(() => _loading = true);

    try {
      final res = await Supabase.instance.client.auth.signInWithPassword(
        email: _email.text.trim(),
        password: _password.text,
      );

      if (!mounted) return;
      setState(() => _loading = false);

      final user = res.session?.user;
      if (user == null) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Login failed. No session returned.')),
        );
        return;
      }

      await _routePostLogin();
    } on AuthException catch (e) {
      if (!mounted) return;
      setState(() => _loading = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.message)),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() => _loading = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Login error: $e')),
      );
    }
  }

  Future<void> _routePostLogin() async {
    setState(() => _checkingProfile = true);
    try {
      // Check whether THIS logged-in worker already has a face profile.
      // The old global check (workersNeedingEnrollment) returned ALL unenrolled
      // workers on the device — so if any OTHER worker was unenrolled the app
      // kept redirecting the already-enrolled worker back to enrollment.
      final enrolled = await SupabaseRepo.isCurrentWorkerEnrolled();

      if (!mounted) return;
      if (enrolled) {
        Navigator.pushReplacementNamed(context, '/check');
      } else {
        Navigator.pushReplacementNamed(context, '/enroll');
      }
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Post-login routing failed: $e')),
      );
    } finally {
      if (mounted) {
        setState(() => _checkingProfile = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final busy = _loading || _checkingProfile;

    return Scaffold(
      body: LayoutBuilder(
        builder: (context, constraints) {
          final isNarrow = constraints.maxWidth < 480;

          return Stack(
            fit: StackFit.expand,
            children: [
              // ── Plain white background ───────────────────────────
              IgnorePointer(
                child: SizedBox.expand(
                  child: Container(color: Colors.white),
                ),
              ),

              // ── Scrollable content ───────────────────────────────
              SafeArea(
                child: SingleChildScrollView(
                  physics: const ClampingScrollPhysics(),
                  padding: EdgeInsets.symmetric(
                    horizontal: isNarrow ? 20 : 24,
                    vertical: 24,
                  ),
                  child: ConstrainedBox(
                    constraints: BoxConstraints(
                      minHeight: (constraints.maxHeight - 48).clamp(0, double.infinity),
                    ),
                    child: Center(
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 360),
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const SizedBox(height: 20), // shifts contents downward
                            // ── Logo + brand ─────────────────────
                            ClipRRect(
                              borderRadius: BorderRadius.circular(24),
                              child: Image.asset(
                                'assets/stafivo_logo.png',
                                width: isNarrow ? 116 : 132,
                                height: isNarrow ? 116 : 132,
                                fit: BoxFit.contain,
                              ),
                            ),
                            SizedBox(height: isNarrow ? 12 : 16),
                            RichText(
                              text: TextSpan(
                                children: [
                                  TextSpan(
                                    text: 'STAFIVO',
                                    style: TextStyle(
                                      fontSize: isNarrow ? 20 : 22,
                                      fontWeight: FontWeight.w900,
                                      color: StafivoColors.primary,
                                      letterSpacing: -0.5,
                                    ),
                                  ),
                                  TextSpan(
                                    text: ' App',
                                    style: TextStyle(
                                      fontSize: isNarrow ? 20 : 22,
                                      fontWeight: FontWeight.w900,
                                      color: StafivoColors.secondary,
                                      letterSpacing: -0.5,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(height: 4),
                            const Text(
                              'Sign in with your email to continue.',
                              style: TextStyle(
                                fontSize: 13,
                                color: StafivoColors.textSecondary,
                              ),
                            ),
                            SizedBox(height: isNarrow ? 18 : 22),

                            // ── Blue card ─────────────────────────
                            Container(
                              width: double.infinity,
                              decoration: BoxDecoration(
                                color: StafivoColors.primary,
                                borderRadius: BorderRadius.circular(18),
                                border: Border.all(
                                  color: Colors.white.withOpacity(0.15),
                                ),
                                boxShadow: [
                                  BoxShadow(
                                    color: StafivoColors.primary.withOpacity(0.35),
                                    blurRadius: 28,
                                    offset: const Offset(0, 10),
                                  ),
                                ],
                              ),
                              padding: EdgeInsets.symmetric(
                                horizontal: isNarrow ? 18 : 22,
                                vertical: isNarrow ? 18 : 22,
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.stretch,
                                children: [
                                  // Email field
                                  _buildLabel('Email address'),
                                  const SizedBox(height: 6),
                                  _buildInput(
                                    controller: _email,
                                    hint: 'name@company.com',
                                    icon: Icons.mail_outline_rounded,
                                    keyboardType: TextInputType.emailAddress,
                                    textInputAction: TextInputAction.next,
                                  ),
                                  const SizedBox(height: 14),

                                  // Password field
                                  _buildLabel('Password'),
                                  const SizedBox(height: 6),
                                  _buildInput(
                                    controller: _password,
                                    hint: '••••••••',
                                    icon: Icons.lock_outline_rounded,
                                    obscureText: !_showPassword,
                                    textInputAction: TextInputAction.done,
                                    onSubmitted: (_) => _signIn(),
                                    suffixIcon: IconButton(
                                      icon: Icon(
                                        _showPassword
                                            ? Icons.visibility_off_outlined
                                            : Icons.visibility_outlined,
                                        size: 20,
                                        color: Colors.white60,
                                      ),
                                      onPressed: () => setState(
                                        () => _showPassword = !_showPassword,
                                      ),
                                    ),
                                  ),
                                  const SizedBox(height: 18),

                                  // Sign-in button — white with blue text
                                  SizedBox(
                                    height: 46,
                                    child: ElevatedButton(
                                      onPressed: busy ? null : _signIn,
                                      style: ElevatedButton.styleFrom(
                                        backgroundColor: Colors.white,
                                        foregroundColor: StafivoColors.primary,
                                        disabledBackgroundColor:
                                            Colors.white.withOpacity(0.5),
                                        elevation: 0,
                                        shape: RoundedRectangleBorder(
                                          borderRadius: BorderRadius.circular(12),
                                        ),
                                      ),
                                      child: busy
                                          ? Row(
                                              mainAxisAlignment:
                                                  MainAxisAlignment.center,
                                              children: [
                                                const SizedBox(
                                                  width: 18,
                                                  height: 18,
                                                  child: CircularProgressIndicator(
                                                    color: StafivoColors.primary,
                                                    strokeWidth: 2.5,
                                                  ),
                                                ),
                                                const SizedBox(width: 10),
                                                Text(
                                                  _checkingProfile
                                                      ? 'Checking profile...'
                                                      : 'Authenticating…',
                                                  style: const TextStyle(
                                                    fontWeight: FontWeight.w600,
                                                    fontSize: 14,
                                                    color: StafivoColors.primary,
                                                  ),
                                                ),
                                              ],
                                            )
                                          : const Text(
                                              'Sign in',
                                              style: TextStyle(
                                                fontWeight: FontWeight.w700,
                                                fontSize: 14,
                                                color: StafivoColors.primary,
                                              ),
                                            ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            SizedBox(height: isNarrow ? 40 : 54),

                          // Footer
                          RichText(
                            text: const TextSpan(
                              style: TextStyle(
                                fontSize: 11,
                                color: StafivoColors.textMuted,
                              ),
                              children: [
                                TextSpan(text: 'Powered by '),
                                TextSpan(
                                  text: 'Pent 26',
                                  style: TextStyle(
                                    fontWeight: FontWeight.w700,
                                    color: StafivoColors.primary,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
        );
      },
    ),
  );
  }

  Widget _buildLabel(String text) {
    return Text(
      text,
      style: const TextStyle(
        fontSize: 13,
        fontWeight: FontWeight.w600,
        color: Colors.white,
      ),
    );
  }

  Widget _buildInput({
    required TextEditingController controller,
    required String hint,
    required IconData icon,
    TextInputType keyboardType = TextInputType.text,
    TextInputAction textInputAction = TextInputAction.next,
    bool obscureText = false,
    ValueChanged<String>? onSubmitted,
    Widget? suffixIcon,
  }) {
    return TextField(
      controller: controller,
      keyboardType: keyboardType,
      textInputAction: textInputAction,
      obscureText: obscureText,
      onSubmitted: onSubmitted,
      style: const TextStyle(
        fontSize: 14,
        color: Colors.white,
      ),
      decoration: InputDecoration(
        hintText: hint,
        hintStyle: const TextStyle(color: Colors.white38, fontSize: 14),
        prefixIcon: Icon(icon, size: 18, color: Colors.white54),
        suffixIcon: suffixIcon,
        filled: true,
        fillColor: Colors.white.withOpacity(0.12),
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: Colors.white.withOpacity(0.25)),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: Colors.white.withOpacity(0.25)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: Colors.white, width: 1.8),
        ),
      ),
    );
  }

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }
}
