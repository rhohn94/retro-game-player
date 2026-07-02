/// <reference path="./jsx.d.ts" />
/* ==========================================================================
   Aura — React hooks — TypeScript definitions

   (#662) The triple-slash reference above auto-wires the raw-`aura-*`-tag JSX
   augmentation for a HOOKS-ONLY consumer. The documented raw-tag pattern uses
   the hooks (useAuraEvent + a raw `<aura-editor ref>`), importing from
   `@aura-design/core/bindings/react/hooks` ALONE — never the wrapper module.
   A `/// <reference>` directive is file-local and is NOT propagated through the
   type-only `import` of aura-react.js below, so without this line a hooks-only
   consumer's raw tags fail TS2339. Triple-slash directives must precede all
   other content, so this is the very first line of the file.
   ========================================================================== */
import { RefObject } from "react";
/* Explicit `.js` extension (#515): under moduleResolution node16/nodenext a
   relative ESM import MUST carry the extension or tsc errors TS2307. */
import { AuraEventMap, AuraMenuSelectDetail } from "./aura-react.js";
/** Re-exported so hooks-only consumers (`@aura-design/core/bindings/react/hooks`) can use the typed event map. */
export type { AuraEventMap };
/** Re-exported so hooks-only consumers can type `aura:menu-select` callbacks without importing from `aura-react.js`. */
export type { AuraMenuSelectDetail };
/** All valid Aura event name strings — `keyof AuraEventMap`. */
export type AuraEventName = keyof AuraEventMap;
import { auraTokens } from "../../dist/aura-tokens.js";
import type { AuraToastOptions } from "../../dist/aura.js";
/** Re-exported convenience type so hooks-only consumers can annotate toast inputs without a separate import from `dist/aura.js`. */
export type { AuraToastOptions };

/**
 * Reads and controls the active Aura MODE (`data-aura-theme` on `<html>`:
 * dark / light / auto). Orthogonal to {@link useAuraThemeName} (#570).
 *
 * Persists to `localStorage` under `"aura-theme"` in the SAME `{ theme, mode }`
 * JSON shape the vanilla `Aura.theme.persist()` uses (#579) — writing only the
 * `mode` field — so the two layers interoperate, and syncs across browser tabs.
 *
 * @example
 * ```tsx
 * const [theme, setTheme] = useAuraTheme("dark");
 * <button onClick={() => setTheme("light")}>Switch to light</button>
 * ```
 */
export function useAuraTheme(
  defaultTheme?: string
): [theme: string, setTheme: (theme: string) => void];

/**
 * Reads and controls the active NAMED theme (`data-aura-theme-name` on
 * `<html>`) — the axis the vanilla `Aura.theme.setTheme()` flips and the one
 * that carries the colour tokens (#570). Orthogonal to {@link useAuraTheme}
 * (the dark/light mode axis). `"default"` when no named theme is set.
 *
 * Persists to the same `{ theme, mode }` JSON key (#579), writing only the
 * `theme` field, and syncs across tabs.
 *
 * @example
 * ```tsx
 * const [name, setName] = useAuraThemeName();
 * return (
 *   <>
 *     <button onClick={() => setName("warm-dusk")}>Warm dusk</button>
 *     {/* Pass "default" to remove the named theme and restore the base look: *\/}
 *     <button onClick={() => setName("default")}>Reset</button>
 *     <p>Active theme: {name}</p>
 *   </>
 * );
 * ```
 */
export function useAuraThemeName(
  defaultName?: string
): [themeName: string, setThemeName: (name: string) => void];

/**
 * Returns the static Aura token map (memoized), with the precise generated
 * literal type so keys narrow and autocomplete (#469) — e.g. `tokens.bg2`
 * type-checks and an unknown key like `tokens.nope` is a compile error.
 *
 * KEY NAMESPACE — note the distinction from {@link useAuraCSSToken}:
 *   - `useAuraTokens()` keys are **camelCase, unprefixed** build-time names
 *     (`accent`, `avatarLg`, `bg2`). They are NOT the CSS custom-property
 *     names: `useAuraTokens()["--aura-primary"]` is `undefined`.
 *   - {@link useAuraCSSToken} takes the **`--aura-*` CSS custom-property**
 *     name (`"--aura-primary"`) and reads the live computed value.
 *
 * For most cases, importing `auraTokens` directly from the token file is
 * equivalent and cheaper.
 *
 * @example
 * ```tsx
 * const tokens = useAuraTokens();
 * // tokens.bg2, tokens.accent — autocomplete + type-checked
 * <div style={{ background: `var(${tokens.bg2})` }}>…</div>
 * ```
 */
export function useAuraTokens(): typeof auraTokens;

/**
 * Reads a single Aura CSS custom property from the document root at runtime.
 * Re-reads automatically when the active theme changes.
 * Returns `""` (empty string) during SSR and before the first mount effect.
 *
 * @param property  The full CSS custom-property name, e.g. `"--aura-primary"`.
 *
 * @example
 * ```tsx
 * const primary = useAuraCSSToken("--aura-primary");
 * return <div style={{ borderLeft: `4px solid ${primary || "var(--aura-primary)"}` }}>…</div>;
 * ```
 */
export function useAuraCSSToken(property: string): string;

/**
 * Returns `true` when the user has enabled `prefers-reduced-motion: reduce`.
 * Reactive — updates on system preference change. Returns `false` during SSR.
 *
 * @example
 * ```tsx
 * const reducedMotion = useAuraMotion();
 * // Skip animation when the user prefers reduced motion:
 * <div style={{ transition: reducedMotion ? "none" : "transform 0.3s" }}>…</div>
 * ```
 */
export function useAuraMotion(): boolean;

/**
 * Reactive `window.matchMedia` wrapper. Returns `false` during SSR.
 *
 * @param query  Any CSS media query, e.g. `"(max-width: 640px)"`.
 *
 * @example
 * ```tsx
 * const isMobile = useAuraMediaQuery("(max-width: 640px)");
 * return isMobile ? <MobileNav /> : <DesktopNav />;
 * ```
 */
export function useAuraMediaQuery(query: string): boolean;

/**
 * Attaches a typed Aura custom-event listener to a ref'd element.
 *
 * @example
 * ```tsx
 * const editorRef = useRef<HTMLElement>(null);
 * useAuraEvent(editorRef, "aura:change", (e) => setHtml(e.detail.html));
 * ```
 */
export function useAuraEvent<K extends keyof AuraEventMap>(
  ref: RefObject<HTMLElement | null>,
  eventName: K,
  handler: (event: AuraEventMap[K]) => void
): void;
export function useAuraEvent(
  ref: RefObject<HTMLElement | null>,
  eventName: string,
  handler: (event: CustomEvent) => void
): void;

/**
 * Convenience dark/light toggle on the MODE axis (`data-aura-theme`, #574).
 *
 * `isDark` is true for `dark`, false for `light`, and for `auto` is resolved
 * against the OS `prefers-color-scheme` (reactive) — so a dark OS reports
 * `isDark === true` even when the mode reads `auto`. Returns `false` during SSR.
 * `setDark` writes the explicit `dark`/`light` mode; `toggle` flips the effective state.
 *
 * @example
 * ```tsx
 * const { isDark, toggle } = useAuraDarkMode();
 * <button onClick={toggle}>{isDark ? "☀️ Light" : "🌙 Dark"}</button>
 * ```
 */
export function useAuraDarkMode(): {
  isDark: boolean;
  toggle: () => void;
  setDark: (dark: boolean) => void;
};

/**
 * Stable callback wrapping `Aura.toast()` for use in React event handlers.
 * SSR-safe — `showToast` no-ops on the server and returns `undefined`.
 *
 * @example
 * ```tsx
 * const { showToast } = useAuraToast();
 * return (
 *   <button onClick={() => showToast({ message: "Saved!", variant: "success", duration: 3000 })}>
 *     Save
 *   </button>
 * );
 * ```
 */
export function useAuraToast(): { showToast: (input: string | AuraToastOptions) => Element | undefined };

/**
 * Reactive read/write for the Aura primary accent colour (`--aura-primary`).
 *
 * `color` is the live computed value (empty string during SSR/before mount).
 * `setColor(hex)` delegates to `Aura.theme.setPrimary(hex)` — sets `--aura-primary`
 * as an inline style on `<html>`, superseding any token-layer value.
 *
 * @example
 * ```tsx
 * const [primary, setPrimary] = useAuraAccentColor();
 * return (
 *   <input type="color" value={primary || "#6366f1"} onChange={e => setPrimary(e.target.value)} />
 * );
 * ```
 */
export function useAuraAccentColor(): [color: string, setColor: (hex: string) => void];

/**
 * Reactive read/write for the Aura secondary accent colour (`--aura-secondary`).
 *
 * `color` is the live computed value (empty string during SSR/before mount).
 * `setColor(hex)` delegates to `Aura.theme.setSecondary(hex)` — sets `--aura-secondary`
 * as an inline style on `<html>`, superseding any token-layer value.
 *
 * @example
 * ```tsx
 * const [secondary, setSecondary] = useAuraSecondaryColor();
 * return (
 *   <input type="color" value={secondary || "#22d3ee"} onChange={e => setSecondary(e.target.value)} />
 * );
 * ```
 */
export function useAuraSecondaryColor(): [color: string, setColor: (hex: string) => void];

/**
 * Suggests a harmonious secondary colour derived from a primary accent.
 * Wraps `Aura.theme.suggestPalette()` (OKLCH 180° complement), memoised on `primary`.
 * Returns `null` during SSR or when the Aura colour module is unavailable.
 *
 * @example
 * ```tsx
 * const palette = useAuraSuggestPalette("#6366f1");
 * // palette?.secondary → "#ec4899"
 * ```
 */
export function useAuraSuggestPalette(
  primary: string
): { secondary: string } | null;

/**
 * Imperatively controls an `<AuraDialog>` element and tracks its open/closed state.
 *
 * Wraps `Aura.dialog.open()` / `.close()` and syncs `isOpen` from the
 * `aura:dialog-open` / `aura:dialog-close` events — ESC-close, scrim-close,
 * and close-button dismissals are all reflected automatically.
 * `isOpen` is seeded from the element's `open` attribute on mount.
 * Pass an `opener` element to `open()` so focus returns to the trigger on close.
 *
 * @example
 * ```tsx
 * const dialogRef = useRef<HTMLElement>(null);
 * const { isOpen, open, close } = useAuraDialog(dialogRef);
 * <AuraButton onClick={open}>Open</AuraButton>
 * <AuraDialog ref={dialogRef}>
 *   <AuraButton onClick={close}>Close</AuraButton>
 * </AuraDialog>
 * ```
 */
export function useAuraDialog(
  ref: RefObject<HTMLElement | null>
): { isOpen: boolean; open: (opener?: Element | null) => void; close: () => void };

/**
 * Tracks the active tab index in an `<aura-tabs>` container and allows
 * programmatic tab selection.
 *
 * Listens for `aura:tab-change` events (which bubble from `<aura-tab>` elements)
 * so `activeIndex` stays in sync with all user- and code-driven tab changes.
 * On mount reads the initial `<aura-tab[selected]>` attribute; returns -1 until
 * the element mounts.
 *
 * @example
 * ```tsx
 * const tabsRef = useRef<HTMLElement>(null);
 * const { activeIndex, activeTab, selectTab } = useAuraTabs(tabsRef);
 * return (
 *   <>
 *     <AuraTabs ref={tabsRef}>…</AuraTabs>
 *     <button onClick={() => selectTab(1)}>Jump to tab 2</button>
 *     <p>Active: {activeIndex} — {activeTab?.textContent?.trim() ?? "none"}</p>
 *   </>
 * );
 * ```
 */
export function useAuraTabs(
  ref: RefObject<HTMLElement | null>
): {
  activeIndex: number;
  /** The currently-selected `<aura-tab>` element, or `null` before mount. Use to read the tab's label or attributes. */
  activeTab: Element | null;
  /** The `aria-controls` value of the active tab — the ID of the corresponding `<aura-tabpanel>`. `null` before mount or when the tab has no panel wired yet. */
  activePanelId: string | null;
  selectTab: (index: number) => void;
};

/**
 * Tracks the open/closed state of an `<aura-menu>` element via a
 * `MutationObserver` on its `class` attribute, and exposes wrappers around
 * `Aura.menu.openAtAnchor()` and `Aura.menu.closeAll()`.
 *
 * `selection` holds the last `aura:menu-select` event payload —
 * `{ value, label, checked, action }` — or `null` before the first selection.
 *
 * For the full imperative API (`open`, `openAtAnchor`, `closeAll`, `openCount`),
 * access `Aura.menu` directly (typed as `AuraMenuAPI` in `dist/aura.d.ts`).
 *
 * Every dismiss path (ESC, scrim click, focus-out) is reflected automatically
 * because the observer watches the engine's `aura-menu--open` class sentinel.
 *
 * @example
 * ```tsx
 * const menuRef = useRef<HTMLElement>(null);
 * const triggerRef = useRef<HTMLButtonElement>(null);
 * const { isOpen, openAtAnchor, selection } = useAuraMenu(menuRef);
 * return (
 *   <>
 *     <button ref={triggerRef} onClick={() => openAtAnchor(triggerRef.current!)}>Options</button>
 *     {selection && <p>Last action: {selection.label} ({selection.value})</p>}
 *     <aura-menu ref={menuRef}>
 *       <aura-menu-item value="cut">Cut</aura-menu-item>
 *       <aura-menu-item value="copy">Copy</aura-menu-item>
 *     </aura-menu>
 *   </>
 * );
 * ```
 */
export function useAuraMenu(
  ref: RefObject<HTMLElement | null>
): {
  isOpen: boolean;
  openAtAnchor: (anchorEl: HTMLElement) => void;
  closeAll: () => void;
  selection: { value: string; label: string; checked: boolean; action: string | null } | null;
};

/**
 * Tracks the live panel size ratios of an `<aura-split>` element by
 * subscribing to its `aura:change` events.
 *
 * `ratios` is an array of fr values (positive numbers, one per panel,
 * summing to 100). Seeded from the element's live `ratios` getter on mount;
 * `[]` only before the element has connected and established its grid.
 *
 * @example
 * ```tsx
 * const splitRef = useRef<HTMLElement>(null);
 * const { ratios } = useAuraSplit(splitRef);
 * <AuraSplit ref={splitRef} style={{ height: "200px" }}>
 *   <div>Left — {ratios[0]?.toFixed(0) ?? "…"} fr</div>
 *   <div>Right — {ratios[1]?.toFixed(0) ?? "…"} fr</div>
 * </AuraSplit>
 * ```
 */
export function useAuraSplit(
  ref: RefObject<HTMLElement | null>
): { ratios: number[] };

/**
 * Reads the selected value from an `<aura-datepicker>` element via
 * `aura:change` events. Works for both single-date and range mode.
 *
 * - Single: `value` = ISO date string, `date` = `Date` object, `label` = display string.
 * - Range: `value` = `"start/end"`, `start` and `end` = individual ISO strings.
 *
 * On mount, seeds `value`, `date`, `start`, and `end` from the `value` attribute (no label — derived only on change); `null` only during SSR.
 *
 * @example
 * ```tsx
 * const dpRef = useRef<HTMLElement>(null);
 * const { value, label } = useAuraDatePicker(dpRef);
 * <AuraDatepicker ref={dpRef} />
 * <p>Selected: {label ?? "(none)"}</p>
 * ```
 */
export function useAuraDatePicker(
  ref: RefObject<HTMLElement | null>
): {
  value: string | null;
  date: Date | null;
  label: string | null;
  start: string | null;
  end: string | null;
};

/**
 * Reads the selected time value from an `<aura-timepicker>` element via
 * `aura:change` events.
 *
 * `value` is seeded from the element `value` attribute on mount (e.g. `"14:30"`); `null` only during SSR.
 *
 * @example
 * ```tsx
 * const tpRef = useRef<HTMLElement>(null);
 * const { value } = useAuraTimePicker(tpRef);
 * <AuraTimepicker ref={tpRef} />
 * <p>Selected: {value ?? "(none)"}</p>
 * ```
 */
export function useAuraTimePicker(
  ref: RefObject<HTMLElement | null>
): { value: string | null };

/**
 * Reads the selected colour from an `<aura-color-picker>` element via
 * `aura:change` events.
 *
 * Returns the full colour payload: `value` (hex string), `rgb` (`{ r, g, b }`,
 * each 0–255), `hsl` (`{ h, s, l }`, h: 0–360, s/l: 0–100), `oklch`
 * (`{ l, c, h }`, l: 0–1, c: 0–0.4, h: 0–360), and `alpha` (0–1 float).
 * On mount, seeds the full color model from the `value` attribute via `Aura.color`; all fields `null` only during SSR or when no value is set.
 *
 * @example
 * ```tsx
 * const cpRef = useRef<HTMLElement>(null);
 * const { value, rgb, oklch } = useAuraColorPicker(cpRef);
 * <AuraColorPicker ref={cpRef} />
 * <p>Hex: {value ?? "(none)"}</p>
 * {rgb && <p>RGB: {rgb.r}, {rgb.g}, {rgb.b}</p>}
 * {oklch && <p>OKLCH: {oklch.l.toFixed(3)} {oklch.c.toFixed(3)} {oklch.h.toFixed(1)}°</p>}
 * ```
 */
export function useAuraColorPicker(
  ref: RefObject<HTMLElement | null>
): {
  value: string | null;
  rgb: { r: number; g: number; b: number } | null;
  hsl: { h: number; s: number; l: number } | null;
  /** OKLCH triple — `l` 0–1, `c` 0–0.4, `h` 0–360. Always present (derived from RGB when not set directly). */
  oklch: { l: number; c: number; h: number } | null;
  alpha: number | null;
};

/**
 * Subscribes to form-wide `aura:form-change` and `aura:dirty` events on an
 * `<aura-form>` element.
 * - `managed` is seeded from `aura-field[depends-on]` count on mount; `null` only during SSR.
 * - `dirty` is seeded from `data-aura-dirty` attribute on mount; `null` only during SSR.
 * - `clearDirty()` removes `data-aura-dirty`, calls `Aura.formGuard.clear()`, and resets `dirty` to `false`.
 *
 * @example
 * ```tsx
 * const formRef = useRef<HTMLElement>(null);
 * const { managed, dirty, clearDirty } = useAuraForm(formRef);
 * <AuraForm ref={formRef}>…</AuraForm>
 * {dirty && <button onClick={clearDirty}>Dismiss unsaved-changes warning</button>}
 * ```
 */
export function useAuraForm(
  ref: RefObject<HTMLElement | null>
): { managed: number | null; dirty: boolean; clearDirty: () => void };

/**
 * Subscribes to `aura:change` on an `<aura-editor>` element.
 * Seeded from `getHTML()`/`getText()` on mount; updates on every user edit.
 * Programmatic `setHTML()` calls are silent and do NOT update this state.
 *
 * @example
 * ```tsx
 * const editorRef = useRef<HTMLElement>(null);
 * const { html, text } = useAuraEditor(editorRef);
 * <AuraEditor ref={editorRef} name="body" />
 * <p>Characters: {text ? text.length : 0}</p>
 * ```
 */
export function useAuraEditor(
  ref: RefObject<HTMLElement | null>
): { html: string | null; text: string | null };

/**
 * Subscribes to `aura:change` on an `<aura-switch>` element.
 * Reads the initial `checked` attribute on mount; `null` only during SSR (before the element mounts).
 * `toggle()` calls the element's own `toggle()` method — fires `aura:change` so hook state updates automatically.
 *
 * @example
 * ```tsx
 * const ref = useRef<HTMLElement>(null);
 * const { checked, toggle } = useAuraSwitch(ref);
 * return (
 *   <>
 *     <AuraSwitch ref={ref} checked name="darkMode" />
 *     <button onClick={toggle}>{checked ? "Disable" : "Enable"} notifications</button>
 *     <p>Notifications: {checked !== null ? String(checked) : "mounting…"}</p>
 *   </>
 * );
 * ```
 */
export function useAuraSwitch(
  ref: RefObject<HTMLElement | null>
): { checked: boolean | null; toggle: () => void };

/**
 * Subscribes to `aura:change` on an `<aura-checkbox>` element.
 * Seeds initial state from element attributes on mount; values are `null` only during SSR.
 *
 * @example
 * ```tsx
 * const ref = useRef<HTMLElement>(null);
 * const { checked, value } = useAuraCheckbox(ref);
 * return (
 *   <>
 *     <AuraCheckbox ref={ref} name="agree" value="yes" />
 *     <p>Agreed: {checked !== null ? String(checked) : "mounting…"}</p>
 *   </>
 * );
 * ```
 */
export function useAuraCheckbox(
  ref: RefObject<HTMLElement | null>
): { checked: boolean | null; indeterminate: boolean | null; value: string | null };

/**
 * Subscribes to `aura:change` on an `<aura-select>` element.
 * Seeds initial `value`, `multiple`, and `label` (from `aura-option[selected]` text) on mount; `null` only during SSR.
 *
 * @example
 * ```tsx
 * const ref = useRef<HTMLElement>(null);
 * const { value, label } = useAuraSelect(ref);
 * return (
 *   <>
 *     <AuraSelect ref={ref} value="apple" name="fruit">…</AuraSelect>
 *     <p>Selected: {label ?? value ?? "mounting…"}</p>
 *   </>
 * );
 * ```
 */
export function useAuraSelect(
  ref: RefObject<HTMLElement | null>
): { value: string | string[] | null; label: string | null; multiple: boolean };

/**
 * Subscribes to `aura:change` on an `<aura-stepper>` element.
 * Seeds initial value from the `value` attribute, or falls back to `min` (default 0) on mount; `null` only during SSR.
 *
 * @example
 * ```tsx
 * const ref = useRef<HTMLElement>(null);
 * const { value } = useAuraStepper(ref);
 * return (
 *   <>
 *     <AuraStepper ref={ref} value="3" min="1" max="10" name="qty" />
 *     <p>Quantity: {value ?? "mounting…"}</p>
 *   </>
 * );
 * ```
 */
export function useAuraStepper(
  ref: RefObject<HTMLElement | null>
): { value: number | null };

/**
 * Subscribes to `aura:change` on an `<aura-range>` element.
 * Seeds initial value on mount: single mode → `value` attr or `min` (default 0); dual mode → `[lo, hi]` from `value` attr or `[min, max]` fallback. `null` only during SSR.
 * Returns a `number` in single mode or `number[]` in dual/range mode.
 *
 * @example
 * ```tsx
 * const ref = useRef<HTMLElement>(null);
 * const { value } = useAuraRange(ref);
 * const display = Array.isArray(value) ? `${value[0]}–${value[1]}` : String(value ?? "…");
 * return (
 *   <>
 *     <AuraRange ref={ref} value="40" name="volume" />
 *     <p>Volume: {display}</p>
 *   </>
 * );
 * ```
 */
export function useAuraRange(
  ref: RefObject<HTMLElement | null>
): { value: number | number[] | null };

/**
 * Subscribes to `aura:copy` on an element (or parent container).
 * Returns the last-copied text string; `null` before the first copy action.
 * `copy(str)` is a stable helper that calls `Aura.copy.copyText()`.
 *
 * @example
 * ```tsx
 * const codeRef = useRef<HTMLElement>(null);
 * const { text, copy } = useAuraCopy(codeRef);
 * return (
 *   <>
 *     <AuraCode ref={codeRef} copyable>console.log("hello")</AuraCode>
 *     {text && <p>Copied: {text}</p>}
 *     <button onClick={() => copy("custom text")}>Copy custom</button>
 *   </>
 * );
 * ```
 */
export function useAuraCopy(
  ref: RefObject<HTMLElement | null>
): { text: string | null; copy: (str: string) => Promise<boolean> };

/**
 * Subscribes to `aura:footer-revealed` on an `<aura-footer>` element.
 * Seeds `revealed: true` from the `data-aura-revealed` attribute on mount; `null` only before mount or while hidden.
 *
 * @example
 * ```tsx
 * const footerRef = useRef<HTMLElement>(null);
 * const { revealed } = useAuraFooter(footerRef);
 * return (
 *   <>
 *     <AuraFooter ref={footerRef}>…</AuraFooter>
 *     {revealed && <p>Footer is visible — show back-to-top button</p>}
 *   </>
 * );
 * ```
 */
export function useAuraFooter(
  ref: RefObject<HTMLElement | null>
): { revealed: boolean | null };

/**
 * Subscribes to `aura:nav-panel-open` on an `<aura-nav-header>` element.
 * Returns `{ trigger: HTMLElement|null }` — the element that triggered the last
 * nav panel open, or `null` before the first open event.
 *
 * @example
 * ```tsx
 * const navRef = useRef<HTMLElement>(null);
 * const { trigger } = useAuraNavPanel(navRef);
 * return (
 *   <>
 *     <AuraNavHeader ref={navRef}>…</AuraNavHeader>
 *     {trigger && <p>Nav opened by: {trigger.textContent}</p>}
 *   </>
 * );
 * ```
 */
export function useAuraNavPanel(
  ref: RefObject<HTMLElement | null>
): { trigger: HTMLElement | null };

/**
 * Subscribes to `aura:change` on an `<aura-tag-input>` element.
 * Seeds initial tags from the `value` attribute on mount; `null` only during SSR.
 * `addTag(value)` and `removeTag(index)` delegate to the element's built-in
 * de-duplicate-aware methods — no React state mutation needed.
 *
 * @example
 * ```tsx
 * const ref = useRef<HTMLElement>(null);
 * const { tags, addTag, removeTag } = useAuraTagInput(ref);
 * return (
 *   <>
 *     <AuraTagInput ref={ref} value="react,css" name="skills" />
 *     <button onClick={() => addTag("typescript")}>Add TS</button>
 *     <p>Tags: {tags ? tags.join(", ") : "mounting…"}</p>
 *   </>
 * );
 * ```
 */
export function useAuraTagInput(
  ref: RefObject<HTMLElement | null>
): {
  tags: string[] | null;
  /** Add a tag (deduped, trimmed; no-op on empty or duplicate). */
  addTag: (value: string) => void;
  /** Remove the tag at `index`. No-op if out of bounds. */
  removeTag: (index: number) => void;
};

/**
 * Subscribes to `aura:change` on an `<aura-radio>` element.
 * Seeds initial `checked` and `value` from element attributes on mount; `null` only during SSR.
 *
 * @example
 * ```tsx
 * const ref = useRef<HTMLElement>(null);
 * const { checked, value } = useAuraRadio(ref);
 * return (
 *   <>
 *     <AuraRadio ref={ref} name="plan" value="pro" checked />
 *     <p>{checked !== null ? `${value} selected` : "mounting…"}</p>
 *   </>
 * );
 * ```
 */
export function useAuraRadio(
  ref: RefObject<HTMLElement | null>
): { checked: boolean | null; value: string | null };
