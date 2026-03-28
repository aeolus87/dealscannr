export const theme = {
  bg: "#07080a",
  bgElevated: "#0f1114",
  stroke: "rgba(255,255,255,0.08)",
  text: "#f4f4f5",
  muted: "#a1a1aa",
  accent: "#38bdf8",
  accentSoft: "rgba(56, 189, 248, 0.15)",
  warn: "#fbbf24",
  safeWidthPct: 0.88,
  fontSans:
    'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontMono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
} as const;

export type Theme = typeof theme;
