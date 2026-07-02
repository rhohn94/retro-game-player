/* ==========================================================================
   Aura — aura-button: declarative button surface.

   Styles a contained <button>/<a> (or itself as role=button when none is
   present), adds proximity glow + pointer sheen, renders an optional leading
   icon from the icon registry, and reflects the disabled state to ARIA + tab
   order. Light-DOM + CSS-first; JS only adds behavior/ARIA via Aura.BaseElement
   hooks: _build wires the activatable surface + glow/sheen once, _sync renders
   the icon and reflects disabled on every connect, _onAttr re-runs that pair.
   See docs/design/declarative-markup-design.md.

   Load order: core.js → element-base.js → aura-button.js (self-registers).
   ========================================================================== */
(function () {
  "use strict";
  /* SSR guard (#416): no-op outside the browser so SSR/RSC frameworks can
     evaluate this module (and the dist bundle) in Node without crashing. */
  if (typeof window === "undefined" || typeof document === "undefined") return;
  var Aura = window.Aura;
  if (!Aura || !Aura.BaseElement) return;

  /* Summary: button element; ensures a focusable activatable surface, wires the
     glow/sheen affordances, renders the icon attribute, and reflects disabled. */
  Aura.define("aura-button", class extends Aura.BaseElement {
    static get observedAttributes() { return ["icon", "disabled"]; }

    /* One-time: make a contained-less host an activatable role=button surface
       (focusable + Enter/Space), and wire the glow + sheen affordances. */
    _build() {
      if (!this.querySelector("button, a[href]")) {
        if (!this.hasAttribute("role")) this.setAttribute("role", "button");
        if (!this.hasAttribute("tabindex") && !this.hasAttribute("disabled")) this.tabIndex = 0;
        this.addEventListener("keydown", function (e) {
          if ((e.key === "Enter" || e.key === " ") && !this.hasAttribute("disabled")) {
            e.preventDefault(); this.click();
          }
        });
      }
      this.classList.add("aura-glow", "aura-sheen");
    }

    _sync() { this._renderIcon(); this._reflectDisabled(); }
    _onAttr() { this._renderIcon(); this._reflectDisabled(); }

    /* Insert (or remove) the leading icon SVG to match the `icon` attribute. */
    _renderIcon() {
      var name = this.getAttribute("icon");
      var existing = this.querySelector(":scope > .aura-icon[data-aura-auto]");
      if (name && !existing) {
        var svg = Aura.icon(name); svg.setAttribute("data-aura-auto", "");
        this.insertBefore(svg, this.firstChild);
      } else if (!name && existing) { existing.remove(); }
    }

    /* Reflect disabled state onto aria-disabled and the tab order. An authored
       `tabindex` attribute is honored (so a roving-tabindex container such as the
       aura-editor toolbar can hold a button at tabindex=-1) — the host only
       owns its own tab order when no tabindex is authored (#547). */
    _reflectDisabled() {
      var disabled = this.hasAttribute("disabled");
      if (disabled) { this.setAttribute("aria-disabled", "true"); this.tabIndex = -1; }
      else {
        this.removeAttribute("aria-disabled");
        if (this.getAttribute("role") === "button" && !this.hasAttribute("tabindex")) this.tabIndex = 0;
      }
      this._reflectInnerDisabled(disabled);
    }

    /* Propagate disabled to a contained native control (#644). pointer-events:
       none on the host blocks the mouse but NOT keyboard focus/activation, so a
       visually-disabled aura-button wrapping a real <button>/<a href> stays
       Tab-and-Enter operable unless we disable the inner control itself. A native
       <button> takes the `disabled` property; an <a href> cannot be `disabled`,
       so it gets aria-disabled + tabindex=-1 and its activation is suppressed.
       The role=button (contained-less) path has no inner control and is
       unaffected — its keydown handler already early-returns on disabled. */
    _reflectInnerDisabled(disabled) {
      var inner = this.querySelector(":scope > button, :scope > a[href]");
      if (!inner) return;
      var tag = inner.tagName.toLowerCase();
      if (tag === "button") {
        inner.disabled = disabled;
        return;
      }
      // <a href>: there is no disabled property, so emulate it.
      if (disabled) {
        if (!inner.hasAttribute("data-aura-disabled")) {
          // Remember the author's prior tab order so re-enable can restore it.
          inner.setAttribute("data-aura-prev-tabindex",
            inner.hasAttribute("tabindex") ? inner.getAttribute("tabindex") : "");
          inner.setAttribute("data-aura-disabled", "");
        }
        inner.setAttribute("aria-disabled", "true");
        inner.setAttribute("tabindex", "-1");
        if (!inner.__auraSuppressActivation) {
          inner.__auraSuppressActivation = function (e) { e.preventDefault(); };
          inner.addEventListener("click", inner.__auraSuppressActivation);
        }
      } else if (inner.hasAttribute("data-aura-disabled")) {
        inner.removeAttribute("aria-disabled");
        var prev = inner.getAttribute("data-aura-prev-tabindex");
        if (prev) inner.setAttribute("tabindex", prev);
        else inner.removeAttribute("tabindex");
        if (inner.__auraSuppressActivation) {
          inner.removeEventListener("click", inner.__auraSuppressActivation);
          inner.__auraSuppressActivation = null;
        }
        inner.removeAttribute("data-aura-prev-tabindex");
        inner.removeAttribute("data-aura-disabled");
      }
    }
  });
})();
