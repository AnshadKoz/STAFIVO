import 'package:flutter/material.dart';
import '../theme/stafivo_colors.dart';

/// Standard loading / empty / error / content widget used across all worker
/// dashboard screens. Eliminates duplicate boilerplate.
class AsyncStateWidget extends StatelessWidget {
  const AsyncStateWidget({
    super.key,
    required this.loading,
    required this.error,
    required this.onRetry,
    required this.child,
    this.empty = false,
    this.emptyMessage = 'No records found.',
    this.emptyIcon = Icons.inbox_rounded,
  });

  final bool loading;
  final String? error;
  final VoidCallback onRetry;
  final Widget child;
  final bool empty;
  final String emptyMessage;
  final IconData emptyIcon;

  @override
  Widget build(BuildContext context) {
    if (loading) return const Center(child: CircularProgressIndicator());
    if (error != null) return _ErrorView(message: error!, onRetry: onRetry);
    if (empty) return _EmptyView(message: emptyMessage, icon: emptyIcon);
    return child;
  }
}

class _ErrorView extends StatelessWidget {
  const _ErrorView({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline_rounded,
                size: 48, color: StafivoColors.error),
            const SizedBox(height: 16),
            Text(message,
                textAlign: TextAlign.center,
                style: const TextStyle(
                    color: StafivoColors.error, fontWeight: FontWeight.w600)),
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }
}

class _EmptyView extends StatelessWidget {
  const _EmptyView({required this.message, required this.icon});
  final String message;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 48, color: StafivoColors.textMuted),
          const SizedBox(height: 16),
          Text(message,
              style:
                  const TextStyle(color: StafivoColors.textSecondary, fontSize: 14)),
        ],
      ),
    );
  }
}
