/* ==========================================================================
   Aura — shared custom-element base class.

   AuraElement consolidates the lifecycle boilerplate that every form-associated
   control (checkbox, radio, range, switch) repeated verbatim: the one-time
   __init build/bind guard, the disconnect reset that lets HTMX re-inserts
   re-initialise cleanly, and the connected/attribute "is this live yet?" guards.

   Subclasses override the protected hooks rather than the platform callbacks:
     _build()  build internal DOM once (idempotent; reuse on reconnect)
     _bind()   attach listeners once
     _sync()   reflect host attributes → internal state (runs on every connect)
     _onAttr(name, oldVal, newVal)  respond to an observed attribute change
                                    (defaults to a full _sync())

   Set this.__reflecting = true around self-driven setAttribute calls to suppress
   the re-entrant attributeChangedCallback they would otherwise trigger.

   Collaborators (loaded immediately after this module):
     js/glow-host.js  — proximity-glow host wiring (_wireGlowTarget, _invalidateGlow)
     js/attr-mirror.js — ARIA forwarding + accessible-name resolution
                         (_forwardAria, _ensureAccessibleName, _enclosingLabelText)

   Load order: core.js → element-base.js → glow-host.js → attr-mirror.js → (controls)
   See docs/design/element-base-design.md and control-widgets-design.md.
   ========================================================================== */
(function () {
  "use strict";
  /* SSR guard (#416): no-op outside the browser so SSR/RSC frameworks can
     evaluate this module (and the dist bundle) in Node without crashing. */
  if (typeof window === "undefined" || typeof document === "undefined") return;
  var Aura = window.Aura;
  if (!Aura || !("customElements" in window)) return;

  /* Summary: HTMLElement subclass providing the shared Aura control lifecycle.
     Glow-host wiring lives in glow-host.js; attribute/ARIA mirroring lives in
     attr-mirror.js. Both patch onto this prototype immediately after load. */
  Aura.BaseElement = class extends HTMLElement {
    connectedCallback() {
      if (!this.__init) {
        this.__init = true;
        this._build();
        /* Bind listeners ONCE per built-DOM lifetime (#439). disconnectedCallback
           resets __init so a re-inserted node re-runs _build() (idempotent — it
           reuses the existing internal DOM), but _bind() must NOT re-run when the
           build was REUSED: its listeners are still attached to the surviving
           nodes (internal sub-parts, or the host element itself), so re-binding
           stacks a duplicate set on every React StrictMode double-mount / HTMX
           re-insert / DOM move. _buildIsFresh() tells the two cases apart: it is
           true only when _build() created brand-new internal DOM (a server-render
           miss, or an HTMX swap that WIPED the subtree) — in which case the old
           listeners died with the old nodes and a clean re-bind is required (the
           reason the __init reset exists). Call it UNCONDITIONALLY (not behind a
           short-circuit) so it always stamps the built DOM on the very first
           connect — otherwise the first reconnect would mistake an unmarked reuse
           for a fresh build and double-bind. */
        var freshBuild = this._buildIsFresh();
        if (!this.__bound || freshBuild) {
          this.__bound = true;
          this._bind();
        }
      }
      this._sync();
    }

    disconnectedCallback() {
      this.__init = false; // allow a clean re-init (re-build + re-sync) on re-insert (HTMX swap)
      // __bound deliberately SURVIVES the disconnect: listeners bound to nodes
      // that persist across it (the host element, or reused internal DOM) are
      // still live, so a reconnect must not re-add them (#439).
    }

    /* Did the most recent _build() create FRESH internal DOM (vs reuse an
       existing build)? Stamps the element's first managed child with a private
       marker the first time it is built; a later _build() that REUSED that child
       finds the marker (→ reuse, returns false), while a build that wiped +
       recreated the subtree (HTMX swap) yields a new first child without it
       (→ fresh, returns true). Subclasses whose _build() targets a non-first-child
       root, or that bind exclusively to the host, may override for a more precise
       signal — but the generic first-child probe covers every shipped control
       (#439). A host with no internal DOM reports fresh on the first connect, then
       reuse — correct, since such host-bound listeners persist across remount. */
    _buildIsFresh() {
      var root = this.firstElementChild;
      if (root && root.__auraBuilt) return false; // reused an existing build
      if (root) root.__auraBuilt = true;
      return true; // first build, or the subtree was wiped + rebuilt
    }

    attributeChangedCallback(name, oldVal, newVal) {
      if (!this.isConnected || !this.__init || this.__reflecting) return;
      this._onAttr(name, oldVal, newVal);
    }

    /* ---- Protected hooks (override in subclasses) ----------------------- */
    /* Build internal DOM once. Must be idempotent: reuse an existing build
       when the element was server-rendered or reconnected with children. */
    _build() {}
    /* Attach event listeners once (called immediately after _build). */
    _bind() {}
    /* Reflect host attributes onto internal state. Runs on every connect and,
       by default, on every observed attribute change. */
    _sync() {}
    /* React to one observed attribute change. Defaults to a full re-sync;
       override when an attribute needs a narrower update. */
    _onAttr() { this._sync(); }
  };
})();
