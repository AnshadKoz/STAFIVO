import 'package:flutter/material.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'navigation/route_observer.dart';
import 'screens/enroll_screen.dart';
import 'screens/checkin_screen.dart';
import 'screens/splash_screen.dart';
import 'screens/login_screen.dart';
import 'screens/welcome_screen.dart';
import 'screens/worker_dashboard_screen.dart';
import 'services/sync_service.dart';
import 'theme/stafivo_theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await dotenv.load(fileName: ".env");

  await Supabase.initialize(
    url: dotenv.env['SUPABASE_URL']!,
    anonKey: dotenv.env['SUPABASE_ANON_KEY']!,
  );

  await SyncService.start();

  runApp(const StafivoApp());
}

/// Root application widget for STAFIVO.
/// Built by Pent 26.
class StafivoApp extends StatelessWidget {
  const StafivoApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'STAFIVO',
      debugShowCheckedModeBanner: false,
      theme: stafivoTheme(),
      home: const SplashScreen(),
      routes: {
        '/login': (_) => const LoginScreen(),
        '/welcome': (_) => const WelcomeScreen(),
        '/check': (_) => const CheckInScreen(),
        '/worker-dashboard': (_) => const WorkerDashboardScreen(),
      },
      navigatorObservers: [railRouteObserver],
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
