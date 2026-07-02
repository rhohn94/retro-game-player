/* ==========================================================================
   Aura — aura-theme-select: declarative named-theme switcher.

   A light-DOM custom element that turns the active named theme into a single
   self-contained control — ZERO consumer script, the sibling of
   <aura-theme-toggle> (which owns the dark/light MODE axis the same way). On
   connect it:
     1. registers the shipped named themes (Aura.theme.registerTheme),
     2. renders one <aura-option> per registered theme inside an inner
        <aura-select> (built idempotently so HTMX swaps are safe),
     3. seeds the control + scope from the persisted value
        (localStorage["aura-demo-theme-name"], matching the demo persistence
        key the anti-FOUC pre-paint script reads),
     4. applies the chosen theme on the scope (default: :root / document.documentElement)
        and persists it on every aura:change.

   Attributes (all optional):
     scope      CSS selector for the theme apply target. Defaults to :root so the
                attribute lands on <html>, matching the anti-FOUC script and covering
                portaled menus. Use scope="#stage" to drive a scoped preview instead.
     no-persist Do not read/write localStorage — for a scoped preview that must
                not clobber the page-wide persisted choice.

   Emits the inner <aura-select>'s `aura:change` (it bubbles), so a consumer can
   still observe theme changes without re-implementing the wiring.

   A theme is ONLY a named token set (see js/theme.js / theming-and-configuration
   -design.md §7), so the look itself needs no JS — this element only populates +
   wires the switcher UI and the persistence the demos previously duplicated as a
   ~46-line inline IIFE across ~18 pages (#407).

   Load order: core.js → theme.js → element-base.js → menu.js → select.js →
   aura-theme-select.js
   See docs/design/theming-and-configuration-design.md and page-templates-design.md.
   ========================================================================== */
(function () {
  "use strict";
  /* SSR guard (#416): no-op outside the browser so SSR/RSC frameworks can
     evaluate this module (and the dist bundle) in Node without crashing. */
  if (typeof window === "undefined" || typeof document === "undefined") return;
  var Aura = window.Aura;
  if (!Aura || !Aura.BaseElement) return;

  /* The named themes Aura ships (css/themes/*.css). Registering them is
     idempotent (Aura.theme.registerTheme overwrites by key), so multiple
     <aura-theme-select>s on a page — or a page that also registers them — are
     safe. "default" restores the base look (no theme-name attribute). */
  var SHIPPED_THEMES = [
    { name: "default",       label: "Aura (default)"  },
    { name: "modern-flat",   label: "Modern Flat"     },
    { name: "warm-dusk",     label: "Warm Dusk"       },
    { name: "flat-primary",  label: "Flat Primary"    },
    { name: "extra-depth",   label: "Extra Depth"     },
    { name: "retro-pc",      label: "Retro PC"        },
    { name: "aqua-aero",     label: "Aqua Aero"       },
    { name: "frutiger-aero", label: "Frutiger Aero"   }
  ];

  /* localStorage key the demos persist the named theme under. MUST match the
     key the anti-FOUC pre-paint script reads (site/templates/base.html →
     NAME_KEY) so a reload restores the same theme without a flash. */
  var PERSIST_KEY = "aura-demo-theme-name";

  /* Resolve the apply scope from the `scope` selector attribute, falling back
     to :root (document.documentElement). The default is the document root so
     that the named-theme attribute lands on the same element the anti-FOUC
     script writes (#207/#290) and portaled menus / wallpaper tokens outside
     <aura-app> are themed correctly. Pass scope="#stage" to drive a scoped
     preview region instead of the whole page. */
  function resolveScope(sel) {
    if (sel) {
      var el = document.querySelector(sel);
      if (el) return el;
    }
    return document.documentElement;
  }

  /* Read the persisted theme name, or null when persistence is off / unset /
     unreadable. Defends against a throwing localStorage (private mode). */
  function readPersisted(optOut) {
    if (optOut) return null;
    try { return window.localStorage.getItem(PERSIST_KEY); }
    catch (e) { return null; }
  }

  /* Write the persisted theme name (no-op when opted out / on storage error). */
  function writePersisted(optOut, value) {
    if (optOut) return;
    try { window.localStorage.setItem(PERSIST_KEY, value); }
    catch (e) { /* private mode / quota — persistence is best-effort */ }
  }

  /* Summary: declarative named-theme switcher; registers the shipped themes,
     builds an inner <aura-select> of them, seeds from the persisted value, and
     applies + persists the chosen theme on the scope — all with no consumer
     script. */
  Aura.define("aura-theme-select", class extends Aura.BaseElement {
    static get observedAttributes() { return ["disabled"]; }

    /* Register the named themes (idempotent) and build the inner <aura-select>
       once, reusing an existing one on an HTMX reconnect. The options are the
       full registry so a page that registered extra themes still shows them. */
    _build() {
      SHIPPED_THEMES.forEach(function (t) {
        Aura.theme.registerTheme(t.name, { label: t.label });
      });

      var sel = this.querySelector(":scope > aura-select");
      if (!sel) {
        sel = document.createElement("aura-select");
        sel.setAttribute("aria-label", this.getAttribute("label") || "Named theme");
        this.appendChild(sel);
      }
      this.__sel = sel;

      /* Seed the active theme from persistence. The anti-FOUC pre-paint script
         already set data-aura-theme-name on <html>, so Aura.theme.getTheme()
         resolves to the saved value; the explicit localStorage read is the
         authority when this element drives a non-root scope. */
      var optOut = this.hasAttribute("no-persist");
      var saved = readPersisted(optOut) || Aura.theme.getTheme();
      if (!saved) saved = "default";
      this.__scope = resolveScope(this.getAttribute("scope"));

      /* Render one option per registered theme, marking the saved one selected. */
      sel.textContent = "";
      Aura.theme.listThemes().forEach(function (t) {
        var o = document.createElement("aura-option");
        o.setAttribute("value", t.name);
        if (t.name === saved) o.setAttribute("selected", "");
        o.textContent = t.label;
        sel.appendChild(o);
      });
      sel.rebuild();
      sel.value = saved;

      /* Apply the saved theme to the scope now that it exists (skip the base
         look — "default" means the attribute is simply absent). */
      if (saved && saved !== "default") Aura.theme.setTheme(saved, this.__scope);
    }

    /* Wire the change → apply + persist path once (the inner select's aura:change
       bubbles to this host). */
    _bind() {
      var self = this;
      this.addEventListener("aura:change", function (e) {
        if (e.target !== self.__sel) return;
        var value = self.__sel.value;
        Aura.theme.setTheme(value, self.__scope);
        writePersisted(self.hasAttribute("no-persist"), value);
      });
    }

    /* Forward the host's disabled state onto the inner select. */
    _sync() {
      var sel = this.__sel;
      if (!sel) return;
      if (this.hasAttribute("disabled")) sel.setAttribute("disabled", "");
      else sel.removeAttribute("disabled");
    }
  });
})();
