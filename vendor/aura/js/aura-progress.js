/* ==========================================================================
   Aura — aura-progress: declarative progress bar element (v3.84).

   The CSS-first declarative form of the `.aura-progress` recipe (css/components.css).
   Instead of hand-assembling the `<div class="aura-progress" role="progressbar"
   aria-valuenow="…" style="--aura-progress-value:…%"><div class="aura-progress__fill">
   </div></div>` structure, the author writes:

     <aura-progress value="60" max="100" aria-label="Upload"></aura-progress>
     <aura-progress indeterminate aria-label="Loading"></aura-progress>
     <aura-progress value="100" variant="success" aria-label="Done"></aura-progress>

   The element reuses the EXISTING `.aura-progress` styles by adding the host
   class, setting ARIA attributes, injecting a `.aura-progress__fill` child, and
   mirroring value/max as a CSS custom property. The legacy
   `<div class="aura-progress">` markup keeps working unchanged (#405 declarative-markup).

   Lifecycle comes from Aura.BaseElement (js/element-base.js): _build runs once,
   _sync reflects attributes on every connect, _onAttr re-syncs on attribute change.

   Load order: core.js → element-base.js → aura-progress.js (self-registers).
   See docs/design/declarative-markup-design.md.
   ========================================================================== */
(function () {
  "use strict";
  /* SSR guard (#416): no-op outside the browser so SSR/RSC frameworks can
     evaluate this module (and the dist bundle) in Node without crashing. */
  if (typeof window === "undefined" || typeof document === "undefined") return;
  var Aura = window.Aura;
  if (!Aura || !Aura.BaseElement) return;

  /* Summary: declarative progress bar; reuses the .aura-progress recipe, wiring
     ARIA attributes and the --aura-progress-value CSS custom property from the
     observed value/max/indeterminate/variant attributes. */
  Aura.define("aura-progress", class extends Aura.BaseElement {
    static get observedAttributes() {
      return ["value", "max", "indeterminate", "variant"];
    }

    /* Mark the host with the base recipe class and inject the fill span once. */
    _build() {
      this.classList.add("aura-progress");
      if (!this.hasAttribute("role")) this.setAttribute("role", "progressbar");
      var fill = this.querySelector(":scope > .aura-progress__fill");
      if (!fill) {
        fill = document.createElement("span");
        fill.className = "aura-progress__fill";
        this.appendChild(fill);
      }
      this.__fill = fill;
    }

    /* Reflect value/max/indeterminate/variant onto ARIA attributes, the CSS
       custom property, and the variant data-attribute. Idempotent per connect. */
    _sync() {
      /* Ensure the fill span exists (idempotent on reconnect). */
      if (!this.__fill) {
        var fill = this.querySelector(":scope > .aura-progress__fill");
        if (!fill) {
          fill = document.createElement("span");
          fill.className = "aura-progress__fill";
          this.appendChild(fill);
        }
        this.__fill = fill;
      }

      var max = parseFloat(this.getAttribute("max")) || 100;
      var value = parseFloat(this.getAttribute("value")) || 0;
      var indeterminate = this.hasAttribute("indeterminate");
      var variant = this.getAttribute("variant");

      /* ARIA: min is always 0 for a progress bar. */
      this.setAttribute("aria-valuemin", "0");
      this.setAttribute("aria-valuemax", String(max));

      if (indeterminate) {
        this.removeAttribute("aria-valuenow");
        this.classList.add("aura-progress--indeterminate");
        /* The CSS uses 40% fill width driven by the animation, not the property. */
        this.style.removeProperty("--aura-progress-value");
      } else {
        this.classList.remove("aura-progress--indeterminate");
        this.setAttribute("aria-valuenow", String(value));
        /* Clamp 0..1 and express as a ratio; the CSS fill uses
           `inline-size: var(--aura-progress-value)` which the CSS file sets
           as 0%; we override with the computed fraction × 100%. */
        var ratio = Math.min(1, Math.max(0, value / max));
        this.style.setProperty("--aura-progress-value", (ratio * 100).toFixed(4) + "%");
      }

      /* Variant: one of '', 'success', 'warning', 'danger'. */
      if (variant) this.setAttribute("data-variant", variant);
      else this.removeAttribute("data-variant");
    }

    /* A narrow attribute change re-syncs the element. */
    _onAttr() { this._sync(); }
  });
})();
