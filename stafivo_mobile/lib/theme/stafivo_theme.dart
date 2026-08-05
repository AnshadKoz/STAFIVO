// STAFIVO App Theme
// Brand by Pent 26
// Single source of truth for all Material 3 theme settings.

import 'package:flutter/material.dart';
import 'stafivo_colors.dart';

/// Returns the STAFIVO [ThemeData] used throughout the app.
ThemeData stafivoTheme() {
  final colorScheme = ColorScheme.fromSeed(
    seedColor: StafivoColors.primary,
    brightness: Brightness.light,
  ).copyWith(
    primary: StafivoColors.primary,
    onPrimary: Colors.white,
    secondary: StafivoColors.secondary,
    onSecondary: Colors.white,
    tertiary: StafivoColors.teal,
    surface: StafivoColors.surface,
    onSurface: StafivoColors.textPrimary,
    error: StafivoColors.error,
    onError: Colors.white,
  );

  return ThemeData(
    colorScheme: colorScheme,
    scaffoldBackgroundColor: StafivoColors.surface,
    useMaterial3: true,

    // --- AppBar ---
    appBarTheme: const AppBarTheme(
      backgroundColor: Colors.white,
      foregroundColor: StafivoColors.primary,
      surfaceTintColor: Colors.white,
      elevation: 0,
      centerTitle: true,
      titleTextStyle: TextStyle(
        fontWeight: FontWeight.w700,
        fontSize: 20,
        color: StafivoColors.primary,
        letterSpacing: 0.2,
      ),
      iconTheme: IconThemeData(color: StafivoColors.primary),
    ),

    // --- Filled Button ---
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: StafivoColors.primary,
        foregroundColor: Colors.white,
        padding: const EdgeInsets.symmetric(vertical: 18, horizontal: 24),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
        ),
        textStyle: const TextStyle(
          fontSize: 16,
          fontWeight: FontWeight.w600,
          letterSpacing: 0.3,
        ),
      ),
    ),

    // --- Outlined Button ---
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: StafivoColors.primary,
        side: const BorderSide(color: StafivoColors.primary, width: 1.5),
        padding: const EdgeInsets.symmetric(vertical: 18, horizontal: 24),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
        ),
        textStyle: const TextStyle(
          fontSize: 16,
          fontWeight: FontWeight.w600,
        ),
      ),
    ),

    // --- Text Button ---
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: StafivoColors.primary,
        textStyle: const TextStyle(
          fontWeight: FontWeight.w600,
          fontSize: 14,
        ),
      ),
    ),

    // --- Input Decoration ---
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: StafivoColors.surface,
      labelStyle: const TextStyle(color: StafivoColors.textSecondary),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: StafivoColors.border),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: StafivoColors.border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: StafivoColors.primary, width: 2),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: StafivoColors.error),
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
    ),

    // --- Card ---
    cardTheme: CardThemeData(
      color: StafivoColors.surface,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: StafivoColors.border),
      ),
      margin: EdgeInsets.zero,
    ),

    // --- SnackBar ---
    snackBarTheme: SnackBarThemeData(
      backgroundColor: StafivoColors.primary,
      contentTextStyle: const TextStyle(color: Colors.white, fontSize: 14),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      behavior: SnackBarBehavior.floating,
    ),

    // --- Progress Indicator ---
    progressIndicatorTheme: const ProgressIndicatorThemeData(
      color: StafivoColors.primary,
      linearTrackColor: StafivoColors.surfaceHover,
    ),
  );
}
