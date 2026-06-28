// AuraProvider — the app-entry seam that (1) loads the Aura CSS barrel, the Aura
// runtime (so `customElements.define` runs before <App/> mounts — design-
// language.md §7.4), and Harmony's theme CSS; and (2) owns the live theme:
// applying the theme class to <html>, persisting it to localStorage under the
// same key the anti-FOUC head script reads, and exposing a setter via context.
// See docs/design/ux/design-language.md §2.3, §3, §4.

// Order matters: the @layer barrel first, then Harmony's override layer
// (declared after Aura's — design-language.md §7.5). The Aura RUNTIME is NOT
// imported here: importing it as an ES module defers its execution past parse,
// which fires Aura's internal `ready()` callback before `Aura.icons` is defined
// and crashes the app (see the auraRuntimeClassicScript plugin in vite.config).
// It is injected as a classic render-blocking <head> script instead, so custom
// elements are registered before React mounts.
import "@aura/css/aura.css";
import "./aura-theme.css";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_THEME,
  NAMED_THEMES,
  resolveTheme,
  THEME_STORAGE_KEY,
  type NamedTheme,
} from "./tokens";

/** The theming surface exposed to consumers (e.g. the Settings appearance UI). */
export interface AuraThemeContextValue {
  theme: NamedTheme;
  themes: readonly NamedTheme[];
  setTheme: (className: string) => void;
}

const AuraThemeContext = createContext<AuraThemeContextValue | null>(null);

/** Read the persisted theme (or the dark default) without throwing on bad storage. */
function readPersistedTheme(): NamedTheme {
  try {
    return resolveTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

/** Swap the active theme class on <html> and set the matching color-scheme. */
function applyThemeClass(next: NamedTheme): void {
  const root = document.documentElement;
  for (const t of NAMED_THEMES) root.classList.remove(t.className);
  root.classList.add(next.className);
  root.style.colorScheme = next.colorScheme;
}

/**
 * Wraps the app: loads Aura assets once and keeps <html> + localStorage in sync
 * with the selected theme so the next cold start reads the correct value (the
 * head script in index.html then applies it before first paint — no FOUC).
 */
export function AuraProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<NamedTheme>(readPersistedTheme);

  // Reconcile the DOM + storage whenever the selected theme changes.
  useEffect(() => {
    applyThemeClass(theme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme.className);
    } catch {
      // Storage unavailable (private mode): the class is still applied; the
      // head script will fall back to the dark default next start.
    }
  }, [theme]);

  const setTheme = useCallback((className: string) => {
    setThemeState(resolveTheme(className));
  }, []);

  const value = useMemo<AuraThemeContextValue>(
    () => ({ theme, themes: NAMED_THEMES, setTheme }),
    [theme, setTheme],
  );

  return (
    <AuraThemeContext.Provider value={value}>
      {children}
    </AuraThemeContext.Provider>
  );
}

/** Access the live theme + setter. Throws if used outside <AuraProvider>. */
export function useAuraTheme(): AuraThemeContextValue {
  const ctx = useContext(AuraThemeContext);
  if (!ctx) {
    throw new Error("useAuraTheme must be used within <AuraProvider>");
  }
  return ctx;
}
