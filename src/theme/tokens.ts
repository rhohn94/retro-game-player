// Aura theming — the canonical brand-knob values, named themes, and persistence
// key for Retro Game Player. The OKLCH values mirror
// docs/design/ux/design-language.md §3 exactly (3-knob brand model + dark
// surface tokens); this module is the single TS source of truth so no screen
// re-invents a colour or a magic string. The CSS custom properties themselves
// are declared per-theme in theme/aura-theme.css.

/** localStorage key the anti-FOUC head script + AuraProvider both read/write. */
export const THEME_STORAGE_KEY = "rgp.theme";

/** W269 rename: legacy pre-rename storage key, read once as a migration
 * fallback so an upgrading user's chosen theme survives (see
 * `resolveTheme`/`AuraProvider`). Never written to again after this release. */
export const LEGACY_THEME_STORAGE_KEY = "harmony.theme";

/** W269 rename: maps legacy `theme-harmony-*` class values (as persisted
 * under `LEGACY_THEME_STORAGE_KEY`) to their renamed `theme-rgp-*` equivalent. */
const LEGACY_CLASS_NAME_MIGRATIONS: Readonly<Record<string, string>> = {
  "theme-harmony-noir": "theme-rgp-noir",
  "theme-harmony-dusk": "theme-rgp-dusk",
};

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
export const THEME_RGP_NOIR: NamedTheme = {
  className: "theme-rgp-noir",
  label: "RGP Noir (dark)",
  colorScheme: "dark",
};

/** Lighter companion theme (reserved/optional per design-language.md §3.3). */
export const THEME_RGP_DUSK: NamedTheme = {
  className: "theme-rgp-dusk",
  label: "RGP Dusk (light)",
  colorScheme: "light",
};

/** Every theme the Appearance select offers. Dark is first = the default. */
export const NAMED_THEMES: readonly NamedTheme[] = [
  THEME_RGP_NOIR,
  THEME_RGP_DUSK,
];

/** The default theme applied when nothing is persisted (matches the head script). */
export const DEFAULT_THEME: NamedTheme = THEME_RGP_NOIR;

/** The set of valid theme class names, for validating persisted/loaded values. */
const THEME_CLASS_NAMES: ReadonlySet<string> = new Set(
  NAMED_THEMES.map((t) => t.className),
);

/**
 * Resolve a persisted class name to a NamedTheme, falling back to the
 * default. W269 rename: also accepts the legacy pre-rename `theme-harmony-*`
 * class values (mapped forward via `LEGACY_CLASS_NAME_MIGRATIONS`) so a value
 * read from the legacy storage key still resolves correctly.
 */
export function resolveTheme(className: string | null | undefined): NamedTheme {
  const migrated = className ? LEGACY_CLASS_NAME_MIGRATIONS[className] : undefined;
  const resolved = migrated ?? className;
  if (resolved && THEME_CLASS_NAMES.has(resolved)) {
    return NAMED_THEMES.find((t) => t.className === resolved) ?? DEFAULT_THEME;
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
