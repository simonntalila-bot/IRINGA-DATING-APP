export const colors = {
  primary: '#E11D48',
  primaryDark: '#9F1239',
  accent: '#F59E0B',
  background: '#FFFFFF',
  backgroundAlt: '#F8FAFC',
  card: '#FFFFFF',
  text: '#0F172A',
  textMuted: '#64748B',
  border: '#E2E8F0',
  success: '#16A34A',
  danger: '#DC2626',
  overlay: 'rgba(15, 23, 42, 0.55)',
};

export const darkColors = {
  primary: '#FB7185',
  primaryDark: '#E11D48',
  accent: '#FBBF24',
  background: '#0B1120',
  backgroundAlt: '#111827',
  card: '#1F2937',
  text: '#F1F5F9',
  textMuted: '#94A3B8',
  border: '#334155',
  success: '#4ADE80',
  danger: '#F87171',
  overlay: 'rgba(0, 0, 0, 0.6)',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const radius = {
  sm: 8,
  md: 14,
  lg: 24,
  pill: 999,
};

export const typography = {
  title: { fontSize: 28, fontWeight: '700' as const, color: colors.text },
  heading: { fontSize: 20, fontWeight: '700' as const, color: colors.text },
  body: { fontSize: 16, fontWeight: '400' as const, color: colors.text },
  caption: { fontSize: 13, fontWeight: '400' as const, color: colors.textMuted },
};

export type ThemeColors = typeof colors;
