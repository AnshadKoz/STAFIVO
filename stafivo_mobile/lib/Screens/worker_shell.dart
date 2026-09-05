import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../screens/checkin_screen.dart';
import '../screens/worker_dashboard_screen.dart';
import '../screens/attendance_history_screen.dart';
import '../screens/salary_screen.dart';
import '../screens/documents_screen.dart';
import '../services/worker_context.dart';
import '../theme/stafivo_colors.dart';

/// WorkerShell — bottom-navigation shell for the worker module.
///
/// Triggers WorkerContext.load() once on mount so all child screens
/// can consume cached profile data without individual fetches.
/// Zero business logic — pure routing only.
class WorkerShell extends StatefulWidget {
  const WorkerShell({super.key});

  @override
  State<WorkerShell> createState() => _WorkerShellState();
}

class _WorkerShellState extends State<WorkerShell> {
  int _currentIndex = 0;

  static const List<Widget> _tabs = [
    CheckInScreen(),
    WorkerDashboardScreen(),
    AttendanceHistoryScreen(),
    SalaryScreen(),
    DocumentsScreen(),
  ];

  @override
  void initState() {
    super.initState();
    // Trigger load after first frame so BuildContext is ready.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) context.read<WorkerContext>().load();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(
        index: _currentIndex,
        children: _tabs,
      ),
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _currentIndex,
        onTap: (i) => setState(() => _currentIndex = i),
        type: BottomNavigationBarType.fixed,
        selectedItemColor: StafivoColors.primary,
        unselectedItemColor: StafivoColors.textMuted,
        backgroundColor: Colors.white,
        elevation: 8,
        selectedLabelStyle:
            const TextStyle(fontSize: 11, fontWeight: FontWeight.w700),
        unselectedLabelStyle:
            const TextStyle(fontSize: 11, fontWeight: FontWeight.w500),
        items: const [
          BottomNavigationBarItem(
              icon: Icon(Icons.fingerprint_rounded), label: 'Check-In'),
          BottomNavigationBarItem(
              icon: Icon(Icons.dashboard_rounded), label: 'Dashboard'),
          BottomNavigationBarItem(
              icon: Icon(Icons.history_rounded), label: 'Attendance'),
          BottomNavigationBarItem(
              icon: Icon(Icons.payments_rounded), label: 'Salary'),
          BottomNavigationBarItem(
              icon: Icon(Icons.folder_rounded), label: 'Documents'),
        ],
      ),
    );
  }
}
