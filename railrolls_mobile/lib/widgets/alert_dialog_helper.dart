import 'dart:async';
import 'package:flutter/material.dart';

enum AlertType { success, warning, error, info }

/// Shows a modal alert dialog with auto-dismiss functionality.
/// 
/// Displays an icon, message, and OK button based on the alert type.
/// Automatically dismisses after [autoDismissSeconds] if specified.
void showAlertDialog(
  BuildContext context, {
  required String message,
  required AlertType type,
  int autoDismissSeconds = 3,
}) {
  if (!context.mounted) return;

  final colorScheme = Theme.of(context).colorScheme;
  final (icon, color) = _getAlertStyle(type, colorScheme);

  showDialog(
    context: context,
    barrierDismissible: true,
    builder: (BuildContext dialogContext) {
      // Auto-dismiss timer
      if (autoDismissSeconds > 0) {
        Timer(Duration(seconds: autoDismissSeconds), () {
          if (dialogContext.mounted) {
            Navigator.of(dialogContext).pop();
          }
        });
      }

      return AlertDialog(
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
        ),
        icon: Icon(
          icon,
          color: color,
          size: 48,
        ),
        content: Text(
          message,
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 16),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: Text(
              'OK',
              style: TextStyle(
                color: color,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      );
    },
  );
}

(IconData, Color) _getAlertStyle(AlertType type, ColorScheme colorScheme) {
  switch (type) {
    case AlertType.success:
      return (Icons.check_circle, const Color(0xFF4CAF50)); // Green
    case AlertType.warning:
      return (Icons.warning_amber_rounded, const Color(0xFFFFA726)); // Orange
    case AlertType.error:
      return (Icons.error, colorScheme.error);
    case AlertType.info:
      return (Icons.info, colorScheme.primary);
  }
}
