import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../services/supabase_repo.dart';

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
      List<Map<String, dynamic>> needing;
      try {
        needing = await SupabaseRepo.workersNeedingEnrollment();
        if (needing.isEmpty) {
          needing = await SupabaseRepo.workersNeedingEnrollmentFallback();
        }
      } catch (_) {
        needing = await SupabaseRepo.workersNeedingEnrollmentFallback();
      }

      if (!mounted) return;
      if (needing.isNotEmpty) {
        Navigator.pushReplacementNamed(context, '/enroll');
      } else {
        Navigator.pushReplacementNamed(context, '/check');
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
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Card(
            elevation: 2,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  // STAFIVO Logo
                  Image.asset(
                    'assets/stafivo_logo.png',
                    width: 120,
                    height: 120,
                    fit: BoxFit.contain,
                  ),
                  const SizedBox(height: 16),
                  Text(
                    'STAFIVO',
                    style: TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w700,
                      color: Theme.of(context).colorScheme.primary,
                    ),
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    controller: _email,
                    keyboardType: TextInputType.emailAddress,
                    textInputAction: TextInputAction.next,
                    decoration: const InputDecoration(labelText: 'Email'),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: _password,
                    obscureText: true,
                    textInputAction: TextInputAction.done,
                    onSubmitted: (_) => _signIn(),
                    decoration: const InputDecoration(labelText: 'Password'),
                  ),
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: busy ? null : _signIn,
                    child: Text(
                      _loading ? 'Signing in...' : (_checkingProfile ? 'Checking workers...' : 'Sign in'),
                    ),
                  ),
                ],
              ),
            ),
          ),
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
