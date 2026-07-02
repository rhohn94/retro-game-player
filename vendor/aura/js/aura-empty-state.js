/* ==========================================================================
   Aura — aura-empty-state: declarative empty/placeholder panel (v3.6).

   The CSS-first declarative form of the `.aura-empty-state` recipe (css/states.css).
   Instead of hand-assembling the `.aura-empty-state__icon / __title / __description
   / __actions` div-soup, the author writes:

     <aura-empty-state icon="inbox" title="No images yet">
       <p>Upload photos and they'll appear here.</p>
       <aura-button slot="actions" variant="primary">Upload</aura-button>
     </aura-empty-state>

   The element reuses the EXISTING `.aura-empty-state*` styles by adding the host
   class and PREPENDING a decorative icon + title from attributes; the author's
   own children become the description/body, and any element marked
   data-actions (or [slot="actions"]) is grouped into the actions row. The legacy
   `<div class="aura-empty-state">…` markup keeps working unchanged (#5).

   Lifecycle comes from Aura.BaseElement (js/element-base.js): _build wraps the
   authored body once; _sync keeps the icon/title in step on every connect.

   Load order: core.js → element-base.js → aura-empty-state.js (self-registers).
   See docs/design/declarative-markup-design.md.
   ========================================================================== */
(function () {
  "use strict";
  /* SSR guard (#416): no-op outside the browser so SSR/RSC frameworks can
     evaluate this module (and the dist bundle) in Node without crashing. */
  if (typeof window === "undefined" || typeof document === "undefined") return;
  var Aura = window.Aura;
  if (!Aura || !Aura.BaseElement) return;

  /* Summary: declarative empty-state panel; reuses the .aura-empty-state recipe,
     prepending an icon + title from attributes and grouping any actions row. */
  Aura.define("aura-empty-state", class extends Aura.BaseElement {
    static get observedAttributes() { return ["icon", "title"]; }

    /* One-time: mark the host, gather authored actions into the actions row,
       and wrap loose body text in the description recipe slot. */
    _build() {
      this.classList.add("aura-empty-state");

      /* Collect any author-marked action controls into one actions row. */
      var actions = Array.prototype.slice.call(
        this.querySelectorAll(":scope > [slot='actions'], :scope > [data-actions]")
      );
      if (actions.length) {
        var row = document.createElement("div");
        row.className = "aura-empty-state__actions";
        actions.forEach(function (a) {
          a.removeAttribute("slot");
          row.appendChild(a);
        });
        this.appendChild(row);
      }
    }

    /* Reflect the icon + title attributes into prepended recipe nodes. */
    _sync() {
      this._syncIcon();
      this._syncTitle();
    }

    /* A narrow attribute change just re-syncs the relevant node. */
    _onAttr(name) {
      if (name === "icon") this._syncIcon();
      else this._syncTitle();
    }

    /* Build/update the decorative icon node (aria-hidden — never the sole
       carrier of meaning). Removed when the attribute is cleared. */
    _syncIcon() {
      var name = this.getAttribute("icon");
      var slot = this.querySelector(":scope > .aura-empty-state__icon");
      if (name) {
        if (!slot) {
          slot = document.createElement("span");
          slot.className = "aura-empty-state__icon";
          slot.setAttribute("aria-hidden", "true");
          this.insertBefore(slot, this.firstChild);
        }
        slot.textContent = "";
        var svg = Aura.icon(name);
        if (svg) slot.appendChild(svg);
      } else if (slot) {
        slot.remove();
      }
    }

    /* Build/update the title heading. Sits after the icon, before the body. */
    _syncTitle() {
      var text = this.getAttribute("title");
      var title = this.querySelector(":scope > .aura-empty-state__title");
      if (text) {
        if (!title) {
          title = document.createElement("p");
          title.className = "aura-empty-state__title";
          var icon = this.querySelector(":scope > .aura-empty-state__icon");
          this.insertBefore(title, icon ? icon.nextSibling : this.firstChild);
        }
        if (title.textContent !== text) title.textContent = text;
      } else if (title) {
        title.remove();
      }
    }
  });
})();
