// Aura theming — the canonical brand-knob values, named themes, and persistence
// key for Harmony. The OKLCH values mirror docs/design/ux/design-language.md §3
// exactly (3-knob brand model + dark surface tokens); this module is the single
// TS source of truth so no screen re-invents a colour or a magic string. The CSS
// custom properties themselves are declared per-theme in theme/aura-theme.css.

/** localStorage key the anti-FOUC head script + AuraProvider both read/write. */
export const THEME_STORAGE_KEY = "harmony.theme";

/** A selectable named theme: its display label and the class set on <html>. */
export interface NamedTheme {
  /** Class applied to documentElement (also the persisted value). */
  className: string;
  /** Human label shown in the Settings → Appearance select. */
  label: string;
  /** CSS color-scheme hint applied alongside the class. */
  colorScheme: "dark" | "light";
}

/** Dark cinematic default — design-language.md §3.1/§3.2. */
export const THEME_HARMONY_NOIR: NamedTheme = {
  className: "theme-harmony-noir",
  label: "Harmony Noir (dark)",
  colorScheme: "dark",
};

/** Lighter companion theme (reserved/optional per design-language.md §3.3). */
export const THEME_HARMONY_DUSK: NamedTheme = {
  className: "theme-harmony-dusk",
  label: "Harmony Dusk (light)",
  colorScheme: "light",
};

/** Every theme the Appearance select offers. Dark is first = the default. */
export const NAMED_THEMES: readonly NamedTheme[] = [
  THEME_HARMONY_NOIR,
  THEME_HARMONY_DUSK,
];

/** The default theme applied when nothing is persisted (matches the head script). */
export const DEFAULT_THEME: NamedTheme = THEME_HARMONY_NOIR;

/** The set of valid theme class names, for validating persisted/loaded values. */
const THEME_CLASS_NAMES: ReadonlySet<string> = new Set(
  NAMED_THEMES.map((t) => t.className),
);

/** Resolve a persisted class name to a NamedTheme, falling back to the default. */
export function resolveTheme(className: string | null | undefined): NamedTheme {
  if (className && THEME_CLASS_NAMES.has(className)) {
    return NAMED_THEMES.find((t) => t.className === className) ?? DEFAULT_THEME;
  }
  return DEFAULT_THEME;
}

/**
 * The three OKLCH brand knobs — everything else (hover, borders, focus rings,
 * on-surface text) derives from these. Mirrors design-language.md §3.1.
 * Exported for tests / programmatic consumers; the live values come from CSS.
 */
export const BRAND_KNOBS = {
  primary: "oklch(0.78 0.15 215)",
  secondary: "oklch(0.80 0.13 65)",
  onPrimary: "oklch(0.18 0.01 230)",
} as const;
