/* ==========================================================================
   Aura — aura-theme-toggle: dark / light / auto mode cycling button.

   A light-DOM custom element that cycles the active theme mode on click in
   the order dark → light → auto → dark, calling Aura.theme.setMode() each
   time. Renders as a single <aura-button> child that carries a mode-matched
   icon (moon / sun / layers) and an aria-label. The inner button is rebuilt
   idempotently so HTMX swaps are safe; the MutationObserver that watches the
   document root for external mode changes (e.g. persistence restore) keeps
   the icon/label in sync without polling.

   Sizing, colour, and spacing ride the existing aura-button / token system;
   no new CSS layer is required.

   Load order: core.js → theme.js → aura-button.js → aura-theme-toggle.js
   See docs/design/page-templates-design.md and theming-and-configuration-design.md.
   ========================================================================== */
(function () {
  "use strict";
  /* SSR guard (#416): no-op outside the browser so SSR/RSC frameworks can
     evaluate this module (and the dist bundle) in Node without crashing. */
  if (typeof window === "undefined" || typeof document === "undefined") return;
  var Aura = window.Aura;
  if (!Aura || !Aura.BaseElement) return;

  /* Mode cycling order and metadata. */
  var MODES = ["dark", "light", "auto"];
  var MODE_META = {
    dark:  { icon: "moon",   label: "Switch to light mode"  },
    light: { icon: "sun",    label: "Switch to auto mode"   },
    auto:  { icon: "layers", label: "Switch to dark mode"   }
  };

  /* localStorage key the toggle persists under — matches the anti-FOUC
     bootstrap snippet documented in templates/README.md. */
  var PERSIST_KEY = "aura-theme";
  /* Enable theme persistence at most once per page. Placing a theme toggle is
     the author's explicit opt-in to remembering the choice (theme.js keeps
     persistence off by default); a `no-persist` attribute opts back out. */
  var persistArmed = false;
  function armPersistence(optOut) {
    if (persistArmed || optOut) return;
    persistArmed = true;
    if (Aura.theme && Aura.theme.persist) Aura.theme.persist(true, { key: PERSIST_KEY });
  }

  /* Read the currently active mode from the document root, defaulting to
     "dark" when the attribute is absent or holds an unrecognised value. */
  function currentMode() {
    var m = document.documentElement.getAttribute("data-aura-theme");
    return (m && MODE_META[m]) ? m : "dark";
  }

  /* Summary: mode-cycling button; builds an inner aura-button, wires click +
     keyboard cycling, and keeps the icon/label in sync with the active mode via
     a MutationObserver on the document root. */
  Aura.define("aura-theme-toggle", class extends Aura.BaseElement {
    /* Observe `disabled` so a runtime toggle re-runs _sync() and re-forwards
       the disabled state onto the inner button — otherwise the host stops
       cycling while the button still looks enabled (#559). Every other Aura
       control declares observedAttributes; this brings theme-toggle in line. */
    static get observedAttributes() { return ["disabled"]; }

    /* Arm the document-root observer PER-CONNECT (#439): it is torn down on every
       disconnect, so it cannot live in the once-per-lifetime _bind() (which now
       runs a single time so the host click listener isn't stacked on remount).
       The base runs _build / once-only _bind / _sync first. */
    connectedCallback() {
      Aura.BaseElement.prototype.connectedCallback.call(this);
      if (!this.__rootObs) {
        var self = this;
        /* Observe data-aura-theme on the document root so external mode changes
           (Aura.theme.persist() restoring a saved preference on load, or another
           piece of UI calling setMode()) keep the icon/label in sync. */
        var obs = new MutationObserver(function () { self._sync(); });
        obs.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["data-aura-theme"]
        });
        this.__rootObs = obs;
      }
    }

    disconnectedCallback() {
      /* Drop the root observer when removed from the document so we don't leak
         a reference to a disconnected element. Re-armed by connectedCallback on
         the next connect. The base reset (__init = false) follows so a re-insert
         rebuilds cleanly; __bound survives so the host click listener (bound once
         in _bind) is not duplicated (#439). */
      if (this.__rootObs) { this.__rootObs.disconnect(); this.__rootObs = null; }
      Aura.BaseElement.prototype.disconnectedCallback.call(this);
    }

    /* Build the inner <aura-button> once (arming theme persistence on the first
       build — placing a toggle is the author's opt-in to remembering the mode).
       Reuses an existing button when server-rendered or HTMX-reconnected. */
    _build() {
      armPersistence(this.hasAttribute("no-persist"));
      var btn = this.querySelector(":scope > aura-button");
      if (!btn) {
        btn = document.createElement("aura-button");
        this.appendChild(btn);
      }
      this.__btn = btn;
    }

    /* Wire activation on the host element. Cycling is driven by a single click
       listener; keyboard activation (Enter / Space) is NOT handled here — it is
       owned by the inner <aura-button>, which fires a synthetic click on
       Enter/Space that bubbles up to this host's click path. The host therefore
       stopPropagation()s to keep that bubbled click from escaping and so the
       cycle runs exactly once per activation (#640). */
    _bind() {
      var self = this;
      this.addEventListener("click", function (e) {
        /* Reached both by a real pointer click on the host and by the synthetic
           click the inner aura-button dispatches for Enter/Space; either way the
           host cycles once, then halts the bubble to avoid a double-cycle. */
        self._cycle();
        e.stopPropagation();
      });
      /* The document-root data-aura-theme observer is armed per-connect in
         connectedCallback (#439), not here — it is torn down on every disconnect
         and so must re-arm on every reconnect, unlike this once-bound click. */
    }

    /* Reflect the current mode into the inner button's icon and aria-label. */
    _sync() {
      var mode = currentMode();
      var meta = MODE_META[mode];
      var btn  = this.__btn;
      if (!btn) return;

      /* icon — use the `icon` attribute so aura-button renders it via the
         built-in icon registry (moon, sun, layers are all registered in core). */
      btn.setAttribute("icon", meta.icon);

      /* Accessible label on the button so screen readers announce the action
         ("Switch to light mode" etc.) rather than the raw icon name. */
      btn.setAttribute("aria-label", meta.label);

      /* Forward any disabled state from the host onto the inner button. */
      if (this.hasAttribute("disabled")) btn.setAttribute("disabled", "");
      else btn.removeAttribute("disabled");
    }

    /* Advance to the next mode in the cycle and apply it. */
    _cycle() {
      if (this.hasAttribute("disabled")) return;
      var mode = currentMode();
      var next = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
      Aura.theme.setMode(next);
      /* _sync() is triggered automatically by the MutationObserver on root. */
    }
  });
})();
