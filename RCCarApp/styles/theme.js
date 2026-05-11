// Global design tokens used by all screens.
// Change colors here to restyle the entire app.

export const colors = {
  background:  '#0d1117',   // page background (dark)
  surface:     '#161b22',   // card / panel background
  surfaceAlt:  '#21262d',   // input backgrounds, secondary surfaces
  primary:     '#58a6ff',   // blue accent
  primaryDark: '#1f6feb',   // darker blue for buttons
  danger:      '#f85149',   // red — emergency stop, errors
  warning:     '#d29922',   // yellow — fail-safe, warnings
  success:     '#3fb950',   // green — connected, OK state
  text:        '#e6edf3',   // primary text
  textMuted:   '#8b949e',   // secondary / label text
  border:      '#30363d',   // card borders, dividers
  white:       '#ffffff',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

// Reusable card style applied to every info panel.
export const card = {
  backgroundColor: colors.surface,
  borderRadius:    12,
  padding:         spacing.md,
  marginBottom:    spacing.md,
  borderWidth:     1,
  borderColor:     colors.border,
};
