/**
 * STAFIVO Brand Constants
 * Use these for chart fill colors, inline styles, and any non-CSS contexts.
 * All UI colors should come from theme.css CSS variables where possible.
 */

export const BRAND = {
  primary:        '#0F3D91',
  primaryHover:   '#0a2d6e',
  secondary:      '#1E63FF',
  accent:         '#4DA3FF',
  teal:           '#0E9C8F',
  success:        '#22C55E',
  warning:        '#F59E0B',
  error:          '#EF4444',
  info:           '#2563EB',
  textPrimary:    '#0F172A',
  textSecondary:  '#64748B',
  border:         '#E2E8F0',
  surface:        '#FFFFFF',
  background:     '#F8FAFC',
} as const

/** Chart color palette — for Recharts bar/line fills */
export const CHART_COLORS = {
  primary:   BRAND.primary,
  secondary: BRAND.secondary,
  accent:    BRAND.accent,
  teal:      BRAND.teal,
  success:   BRAND.success,
  warning:   BRAND.warning,
  error:     BRAND.error,
} as const

export type BrandKey = keyof typeof BRAND
