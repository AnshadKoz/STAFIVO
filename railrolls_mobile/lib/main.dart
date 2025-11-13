import 'package:flutter/material.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'screens/login_screen.dart';
import 'screens/enroll_screen.dart';
import 'screens/checkin_screen.dart';
import 'screens/splash_screen.dart';
import 'services/sync_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await dotenv.load(fileName: ".env");

  await Supabase.initialize(
    url: dotenv.env['SUPABASE_URL']!,
    anonKey: dotenv.env['SUPABASE_ANON_KEY']!,
  );

  await SyncService.start();

  runApp(const RailRollsApp());
}

class RailRollsApp extends StatelessWidget {
  const RailRollsApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Rail Rolls',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF16A34A)),
        useMaterial3: true,
      ),
      home: const SplashScreen(),
      routes: {
        '/login': (_) => const LoginScreen(),
        '/check': (_) => const CheckInScreen(),
      },
      onGenerateRoute: (settings) {
        if (settings.name == '/enroll') {
          final workerId = settings.arguments as String?;
          return MaterialPageRoute(
            builder: (_) => EnrollScreen(workerId: workerId),
          );
        }
        return null;
      },
    );
  }
}
