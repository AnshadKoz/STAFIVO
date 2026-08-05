import sys

with open('stafivo_mobile/lib/Screens/checkin_screen.dart', 'r') as f:
    content = f.read()

# 1. State vars
content = content.replace('CameraController? _camera;', 'CameraController? _camera;\n  int _pendingCount = 0;\n  Timer? _pendingTimer;')

# 2. initState
init_state_target = '''  void initState() {
    super.initState();
    _initAll();
  }'''
init_state_replace = '''  void initState() {
    super.initState();
    _initAll();
    _pendingTimer = Timer.periodic(const Duration(seconds: 5), (_) => _checkPendingQueue());
  }'''
content = content.replace(init_state_target, init_state_replace)

# 3. dispose
content = content.replace('super.dispose();', '_pendingTimer?.cancel();\n    super.dispose();')

# 4. _checkPendingQueue
pending_func = '''  Future<void> _checkPendingQueue() async {
    final list = await OfflineQueue.pending();
    if (mounted && _pendingCount != list.length) {
      setState(() {
        _pendingCount = list.length;
      });
    }
  }

  Future<void> _initAll'''
content = content.replace('  Future<void> _initAll', pending_func)

# 5. UI injection
ui_target = '''        appBar: stafivoAppBar(context, 'Check-in / Check-out', implyLeading: false),
        body: SafeArea(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Column('''
ui_replace = '''        appBar: stafivoAppBar(context, 'Check-in / Check-out', implyLeading: false),
        body: SafeArea(
          child: Column(
            children: [
              if (_pendingCount > 0)
                Container(
                  width: double.infinity,
                  color: Colors.orange.shade100,
                  padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 16),
                  child: Text(
                    '\ Attendance records waiting to sync',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Colors.orange.shade900, fontWeight: FontWeight.w600, fontSize: 13),
                  ),
                ),
              Expanded(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.all(16),
                  child: Column('''
content = content.replace(ui_target, ui_replace)

# 6. UI closing brackets
ui_close_target = '''          ),
        ),
      );
    }

  Widget _buildBootstrapError'''
ui_close_replace = '''          ),
                ),
              ),
            ],
          ),
        ),
      );
    }

  Widget _buildBootstrapError'''
content = content.replace(ui_close_target, ui_close_replace)

with open('stafivo_mobile/lib/Screens/checkin_screen.dart', 'w') as f:
    f.write(content)
print('Done injecting offline banner')
