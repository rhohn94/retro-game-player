/* ==========================================================================
   Aura — aura-avatar: declarative avatar element (v3.6).

   The CSS-first declarative form of the `.aura-avatar` recipe (css/components.css).
   Instead of hand-assembling `<span class="aura-avatar" data-status><img …></span>`
   the author writes:

     <aura-avatar src="…" alt="…" initials="AB" size="lg" status="online"></aura-avatar>

   The element reuses the EXISTING `.aura-avatar` styles by reflecting onto the
   host: it adds the `.aura-avatar` class (+ size modifier), mirrors `status` →
   `data-status`, and renders either an <img> (when `src` resolves) or the
   `initials` text fallback. The legacy `<span class="aura-avatar">` markup keeps
   working unchanged — this element is additive (#5 declarative-markup).

   Lifecycle comes from Aura.BaseElement (js/element-base.js): _build runs once,
   _sync reflects the attributes on every connect, _onAttr re-syncs the narrow set.

   Load order: core.js → element-base.js → aura-avatar.js (self-registers).
   See docs/design/declarative-markup-design.md.
   ========================================================================== */
(function () {
  "use strict";
  /* SSR guard (#416): no-op outside the browser so SSR/RSC frameworks can
     evaluate this module (and the dist bundle) in Node without crashing. */
  if (typeof window === "undefined" || typeof document === "undefined") return;
  var Aura = window.Aura;
  if (!Aura || !Aura.BaseElement) return;

  /* Map the friendly `size` token to the recipe's BEM size modifier. */
  var SIZE_CLASS = { sm: "aura-avatar--sm", lg: "aura-avatar--lg" };

  /* Summary: declarative avatar; reuses the .aura-avatar recipe, rendering an
     image or initials fallback and a presence-status ring from attributes. */
  Aura.define("aura-avatar", class extends Aura.BaseElement {
    static get observedAttributes() {
      return ["src", "alt", "initials", "size", "status"];
    }

    /* Mark the host with the base recipe class once. */
    _build() { this.classList.add("aura-avatar"); }

    /* Reflect every attribute onto the host class / data-status and (re)render
       the image-or-initials content. Idempotent on each connect. */
    _sync() {
      /* Size modifier (only one at a time). */
      this.classList.remove("aura-avatar--sm", "aura-avatar--lg");
      var size = this.getAttribute("size");
      if (size && SIZE_CLASS[size]) this.classList.add(SIZE_CLASS[size]);

      /* Presence ring rides the existing data-status hook. */
      var status = this.getAttribute("status");
      if (status) this.setAttribute("data-status", status);
      else this.removeAttribute("data-status");

      this._renderContent(status);
    }

    /* A narrow attribute change just re-syncs. */
    _onAttr() { this._sync(); }

    /* Render an <img> when a src is set, else the initials text fallback. The
       presence status is surfaced as a visually-hidden text node so assistive
       tech reads it (the ::after dot is decorative). */
    _renderContent(status) {
      var src = this.getAttribute("src");
      var img = this.querySelector(":scope > img");
      var initialsEl = this.querySelector(":scope > .aura-avatar__initials");

      if (src) {
        if (initialsEl) initialsEl.remove();
        if (!img) { img = document.createElement("img"); this.insertBefore(img, this.firstChild); }
        if (img.getAttribute("src") !== src) img.setAttribute("src", src);
        img.setAttribute("alt", this.getAttribute("alt") || this.getAttribute("initials") || "");
      } else {
        if (img) img.remove();
        var initials = this.getAttribute("initials") || "";
        if (!initialsEl) {
          initialsEl = document.createElement("span");
          initialsEl.className = "aura-avatar__initials";
          initialsEl.setAttribute("aria-hidden", "true");
          this.insertBefore(initialsEl, this.firstChild);
        }
        if (initialsEl.textContent !== initials) initialsEl.textContent = initials;
      }

      /* Status announced for AT (the coloured dot alone is decorative). */
      var sr = this.querySelector(":scope > .aura-avatar__status-sr");
      if (status) {
        if (!sr) {
          sr = document.createElement("span");
          sr.className = "aura-avatar__status-sr aura-sr-only";
          this.appendChild(sr);
        }
        sr.textContent = status;
      } else if (sr) {
        sr.remove();
      }
    }
  });
})();
