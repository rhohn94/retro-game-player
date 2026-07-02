/* ==========================================================================
   Aura — aura-pagination: declarative pagination nav element (v3.84).

   The CSS-first declarative form of the `.aura-pagination` recipe (css/components.css).
   Instead of hand-assembling the `<nav class="aura-pagination" aria-label="Pagination">
   <a class="aura-pagination__item" aria-current="page">` structure, the author writes
   the page links as direct children:

     <aura-pagination current="2" label="Pagination">
       <a class="aura-pagination__item" href="/page/1">1</a>
       <a class="aura-pagination__item" href="/page/2">2</a>
       <a class="aura-pagination__item" href="/page/3">3</a>
     </aura-pagination>

   The element reuses the EXISTING `.aura-pagination` styles: it adds the host class,
   sets role="navigation" and aria-label on the host, and manages the aria-current="page"
   attribute on the active `<a>` child from the `current` attribute. The legacy
   `<nav class="aura-pagination">` markup keeps working unchanged (#405 declarative-markup).

   Lifecycle comes from Aura.BaseElement (js/element-base.js): _build runs once,
   _sync reflects attributes on every connect, _onAttr re-syncs on change.

   Load order: core.js → element-base.js → aura-pagination.js (self-registers).
   See docs/design/declarative-markup-design.md.
   ========================================================================== */
(function () {
  "use strict";
  /* SSR guard (#416): no-op outside the browser so SSR/RSC frameworks can
     evaluate this module (and the dist bundle) in Node without crashing. */
  if (typeof window === "undefined" || typeof document === "undefined") return;
  var Aura = window.Aura;
  if (!Aura || !Aura.BaseElement) return;

  /* Summary: declarative pagination nav; reuses the .aura-pagination recipe,
     naming the nav landmark and managing aria-current="page" on the active link
     from the `current` attribute (href match or 1-based page number). */
  Aura.define("aura-pagination", class extends Aura.BaseElement {
    static get observedAttributes() {
      return ["current", "label"];
    }

    /* Mark the host as the navigation landmark. */
    _build() {
      this.classList.add("aura-pagination");
      if (!this.hasAttribute("role")) this.setAttribute("role", "navigation");
    }

    /* Reflect label → aria-label and current → aria-current="page" on the
       matching child link. Idempotent per connect. */
    _sync() {
      /* aria-label: use the authored label attribute, or default to "Pagination". */
      if (!this.getAttribute("aria-label")) {
        this.setAttribute("aria-label", this.getAttribute("label") || "Pagination");
      }
      this._markCurrentPage();
    }

    /* A narrow attribute change re-syncs. */
    _onAttr(name) {
      if (name === "label") {
        this.setAttribute("aria-label", this.getAttribute("label") || "Pagination");
      } else {
        this._markCurrentPage();
      }
    }

    /* Walk the direct <a> children and apply aria-current="page" to the one
       matching `current`. Match strategy: if `current` looks like a URL
       (contains "/" or "#") match against the child's href; otherwise treat it
       as a 1-based page index and match the Nth <a>. */
    _markCurrentPage() {
      var current = this.getAttribute("current");
      var links = Array.prototype.slice.call(
        this.querySelectorAll(":scope > .aura-pagination__item, :scope > a")
      );

      links.forEach(function (a, i) {
        var match = false;
        if (current !== null && current !== "") {
          /* Try href match first (URL or fragment). */
          if (current.indexOf("/") !== -1 || current.indexOf("#") !== -1) {
            match = a.getAttribute("href") === current;
          } else {
            /* 1-based page number match. */
            var n = parseInt(current, 10);
            if (!isNaN(n)) match = (i + 1) === n;
          }
        }
        if (match) a.setAttribute("aria-current", "page");
        else a.removeAttribute("aria-current");
      });
    }
  });
})();
