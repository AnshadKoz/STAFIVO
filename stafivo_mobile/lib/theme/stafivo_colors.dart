// STAFIVO Color Palette
// Brand by Pent 26
// Use these constants everywhere in the Flutter app instead of hardcoded hex values.

import 'package:flutter/material.dart';

/// Central color constants for the STAFIVO brand.
class StafivoColors {
  StafivoColors._(); // prevent instantiation

  // --- Primary Palette ---
  static const Color primary = Color(0xFF0F3D91);
  static const Color primaryHover = Color(0xFF0A2D6E);
  static const Color secondary = Color(0xFF1E63FF);
  static const Color accent = Color(0xFF4DA3FF);
  static const Color teal = Color(0xFF0E9C8F);

  // --- Surface & Background ---
  static const Color background = Color(0xFFF8FAFC);
  static const Color surface = Color(0xFFFFFFFF);
  static const Color surfaceHover = Color(0xFFEAF2FF);

  // --- Text ---
  static const Color textPrimary = Color(0xFF0F172A);
  static const Color textSecondary = Color(0xFF64748B);
  static const Color textMuted = Color(0xFF94A3B8);

  // --- Border ---
  static const Color border = Color(0xFFE2E8F0);
  static const Color borderFocus = Color(0xFF1E63FF);

  // --- Semantic ---
  static const Color success = Color(0xFF22C55E);
  static const Color successBg = Color(0xFFF0FDF4);
  static const Color warning = Color(0xFFF59E0B);
  static const Color warningBg = Color(0xFFFFFBEB);
  static const Color error = Color(0xFFEF4444);
  static const Color errorBg = Color(0xFFFEF2F2);
  static const Color info = Color(0xFF2563EB);
  static const Color infoBg = Color(0xFFEFF6FF);
}
