/* ==========================================================================
   Aura — aura-breadcrumb: declarative breadcrumb trail (v3.6).

   The CSS-first declarative form of the `.aura-breadcrumb` recipe
   (css/components.css). Instead of hand-assembling the
   `<nav class="aura-breadcrumb"><ol><li><a>…` structure, the author writes the
   trail as flat children — links plus a final current crumb:

     <aura-breadcrumb label="Breadcrumb">
       <a href="/">Aura</a>
       <a href="/components">Components</a>
       <span aria-current="page">Navigation</span>
     </aura-breadcrumb>

   The element reuses the EXISTING `.aura-breadcrumb` styles: it adds the host
   class, sets role/aria-label for the nav landmark, and wraps each authored
   crumb in the `<ol><li>` recipe structure (the CSS `li + li::before` paints the
   separators, hidden from AT). The legacy `<nav class="aura-breadcrumb"><ol>…`
   markup keeps working unchanged (#5 declarative-markup).

   Lifecycle comes from Aura.BaseElement (js/element-base.js): _build wraps the
   authored crumbs once (idempotent on an HTMX reconnect — a prior <ol> is reused).

   Load order: core.js → element-base.js → aura-breadcrumb.js (self-registers).
   See docs/design/declarative-markup-design.md.
   ========================================================================== */
(function () {
  "use strict";
  /* SSR guard (#416): no-op outside the browser so SSR/RSC frameworks can
     evaluate this module (and the dist bundle) in Node without crashing. */
  if (typeof window === "undefined" || typeof document === "undefined") return;
  var Aura = window.Aura;
  if (!Aura || !Aura.BaseElement) return;

  /* Summary: declarative breadcrumb; reuses the .aura-breadcrumb recipe, wrapping
     flat authored crumbs into the ol/li trail and naming the nav landmark. */
  Aura.define("aura-breadcrumb", class extends Aura.BaseElement {
    static get observedAttributes() { return ["label"]; }

    /* Mark the host as the nav landmark and wrap loose crumbs into the <ol><li>
       recipe structure. A server-rendered / reconnected <ol> is reused. Runs the
       sweep on EVERY build (not just the create path), so a crumb appended as a
       direct child after the first build — an HTMX-added link — is also folded
       into the <ol> as a trailing <li> rather than left bare and unstyled (#506). */
    _build() {
      this.classList.add("aura-breadcrumb");
      if (!this.hasAttribute("role")) this.setAttribute("role", "navigation");
      this._wrapLooseCrumbs();
    }

    /* Move every direct-child crumb that isn't already the <ol> (loose siblings,
       freshly appended links) into a trailing <li>; links and the final current
       crumb keep their own markup. Reuses a server-rendered / reconnected <ol>.
       Factored out so both _build and the live-append MutationObserver fold new
       crumbs into the <ol> through the same path (#506/#647). Idempotent — a
       crumb already inside the <ol> is never a direct child, so it's skipped. */
    _wrapLooseCrumbs() {
      var ol = this.querySelector(":scope > ol");
      if (!ol) ol = document.createElement("ol");
      var crumbs = Array.prototype.slice.call(this.children);
      crumbs.forEach(function (crumb) {
        if (crumb === ol) return;
        var li = document.createElement("li");
        li.appendChild(crumb);
        ol.appendChild(li);
      });
      if (ol.parentNode !== this) this.appendChild(ol);
    }

    /* Observe live child additions (#647): #506 only folded loose crumbs on a
       full reconnect (connectedCallback → _build), so a crumb appendChild-ed to
       an ALREADY-connected breadcrumb — the natural "add a level" API for an
       HTMX/SPA flow — stayed bare outside the <ol>. A childList observer scoped
       to the host re-runs the wrap whenever a non-<ol> direct child appears. The
       observer's own moves (crumb → <li>, <li> → <ol>) add nodes only INSIDE the
       <ol>, never as direct host children, so they don't re-trigger the wrap. */
    _bind() {
      var self = this;
      this.__crumbObserver = new MutationObserver(function (records) {
        for (var i = 0; i < records.length; i++) {
          var added = records[i].addedNodes;
          for (var j = 0; j < added.length; j++) {
            var node = added[j];
            // A new ELEMENT child that isn't the <ol> means a loose crumb.
            if (node.nodeType === 1 && node.parentNode === self &&
                node.tagName.toLowerCase() !== "ol") {
              self._wrapLooseCrumbs();
              return;
            }
          }
        }
      });
      this.__crumbObserver.observe(this, { childList: true });
    }

    /* Disconnect the observer on teardown so a removed breadcrumb leaves no live
       observer over a detached node. _bind() here attaches ONLY this observer
       (and removes it here), so clear __bound (the #439 bind-once flag) alongside
       the base __init reset — a reconnect must re-run _bind() to arm a fresh
       observer (#647). */
    disconnectedCallback() {
      if (this.__crumbObserver) { this.__crumbObserver.disconnect(); this.__crumbObserver = null; }
      this.__bound = false; // observer fully removed above — reconnect re-binds
      Aura.BaseElement.prototype.disconnectedCallback.call(this);
    }

    /* Reflect the accessible name onto the nav landmark on every connect. */
    _sync() {
      this.setAttribute("aria-label", this.getAttribute("label") || "Breadcrumb");
    }
  });
})();
