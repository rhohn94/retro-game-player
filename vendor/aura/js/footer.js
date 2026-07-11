/* ==========================================================================
   Aura — reveal-on-scroll-end site footer (<aura-footer>) behaviour.

   A light-DOM custom element that self-registers via Aura.define and adds the
   .aura-footer root class. CSS-first: all appearance, the off-screen resting
   translate, and the slide animation live in css/footer.css; this module
   supplies ONLY the reveal trigger — it reads no layout dimensions on the hot
   path, so there is no forced reflow.

   Space-economy realization (docs/design/space-economy-design.md,
   docs/design/footer-design.md §Philosophy): a footer in
   data-aura-footer="reveal" mode IS the stash-default equivalent for the bottom
   chrome — always stashed off-screen (#828), revealing only at scroll-end. This
   mirrors the nav-header's stash-default mode (data-nav-behavior="stash-default")
   but for the page end instead of the top. See also css/footer.css. A footer in
   data-aura-footer="reveal" mode is summoned chrome. It rests fully off the
   bottom edge (holding no viewport space) and reveals only when the user reaches
   the end of the content. The trigger is an IntersectionObserver watching an
   end-of-content SENTINEL the element injects just before itself: when the
   sentinel comes within --aura-footer-reveal-offset of the scroll region's
   bottom edge, data-aura-revealed is set and CSS slides the footer in; scrolling
   back up clears it and the footer slides away, returning its space to content.

   Static footer (no data-aura-footer="reveal"): this module skips all reveal logic
   for static footers — they participate in the normal document flow as persistent
   chrome (#775 by design). Static mode is for footers that MUST always be visible
   (e.g. a config page with persistent navigation links). This is intentional, not
   a bug — see docs/design/space-economy-design.md §static-footer-mode.

     - Scroll-owner aware: the app-shell makes an inner <aura-region> the scroll
       owner (html/body are locked — see css/layout.css), so the observer is
       ROOTED on that region (mirrors how js/nav-header.js resolves its scroll
       source) rather than the implicit viewport, which would never intersect.
       Aura.scrollRootFor now walks ancestors first to find the CLOSEST aura-region
       (#820), prefers non-sidebar direct-shell-children in multi-region layouts
       (#746), and skips hidden/non-rendered regions (#749). Standalone pages with
       no shell fall back to root:null (layout viewport).
     - reveal-offset is read from the --aura-footer-reveal-offset token via a
       probe element so that var() chains resolve to real px values (#744), and
       fed to the observer rootMargin as a NEGATIVE bottom value so the footer
       eases in just BEFORE the true bottom; no magic numbers in JS.
     - Reduced motion is handled entirely in CSS (the transition is nulled); the
       attribute flip is identical, so the reveal is instant.
     - HTMX-safe: listens for htmx:afterSwap / htmx:historyRestore to detect
       when the scroll root or its contents are replaced and re-enhance (#743
       #813 #823). A MutationObserver re-roots the IO when aura-shell/aura-region
       is inserted after connectedCallback (#742).
     - Container-query breakpoints do not fire window resize, so a ResizeObserver
       on documentElement supplements the window resize listener for re-resolution
       (#767). The window listener is kept as a fallback.

   Standalone reveal footers are marked .aura-footer--standalone during _enhance()
   (css no longer keys position:fixed off this class specifically — v3.550 made
   position:fixed unconditional for every reveal footer, see below — but the class
   is kept for back-compat consumer targeting and the #770 no-layout-space intent
   still holds either way).

   Button/panel decoupling (v3.550, #1047, docs/design/fmb-design.md §Hard
   requirement — the button-stability invariant): pre-v3.550, the HOST element's
   own box animated between a compact circle and the full-width bar — button and
   open-state were the same element transforming. _enhance() now creates a single
   `.aura-footer__panel` wrapper (idempotent, `this._panel` guard), appended to
   document.body (NOT nested inside the host — the host's `.aura-glow` class sets
   `translate` unconditionally, which makes it a containing block for
   position:fixed descendants, so a nested panel would resolve against the 48px
   circle instead of the viewport; mirrors js/nav-header.js's ensureUserFmb()
   sibling-proxy precedent), and moves every non-mark child into it. css/footer.css
   keeps the HOST a fixed-size, fixed-position circle in every state and renders
   the panel as an independent floating surface anchored to the circle's own
   corner. A childList MutationObserver re-homes any child an author (or HTMX
   swap) adds directly to the host afterward, so authoring
   `<aura-footer>...</aura-footer>` normally still works with no author-visible
   change; a second MutationObserver + real pointer/focus listeners
   (armPanelStateMirror) reflect the host's Opened/Pinned/Revealed state onto the
   panel's own `data-footer-panel-open` attribute, since the panel is no longer a
   CSS-combinator-reachable descendant. See docs/design/footer-design.md
   §Floating Menu Button.

   Performance (#739 #758 #777 #780 #783 #759 #815): the resize path is throttled
   with a 100ms trailing debounce so rapid window-resize sequences only fire one
   IO re-root after the user stops; a ResizeObserver on documentElement replaces
   the unbounded window resize listener (more precise — fires only on actual size
   change — and catches container-query breakpoints that do not fire window resize,
   #767); the window listener is kept only as a cross-origin / unsupported fallback.
   When an aura-dialog[open][aria-modal] is present the IO is paused
   (disconnected) and the resize handler is suppressed — the modal obscures the
   footer, so animation and compositing work is wasted (#815). The IO re-arms on
   the matching dialog-close event (or 'aura:dialog-close').

   Mobile convergence (v3.552, #1051, docs/design/fmb-design.md §Mobile):
   below --aura-bp-mobile the circle joins the shared merged column's reveal
   control instead of always rendering standalone — css/footer.css gates the
   circle's visibility on <aura-fmb-column>'s [data-fmb-column-revealed]
   state (js/fmb-column.js already registers the footer as a column member
   since v3.549 ITEM-2; no registration change was needed here). The one JS
   change this required: syncOneFmb()'s proximity check now skips entirely
   while the circle is not visible (getComputedStyle().visibility ===
   'hidden'), since getBoundingClientRect() keeps returning real geometry for
   a hidden box and the circle's fixed corner coincides with where the
   reveal control itself sits — see docs/design/footer-design.md §Mobile
   convergence.

   Load order: core.js → element-base.js → … → footer.js (self-registers).
   See docs/design/space-economy-design.md.
   ========================================================================== */
(function () {
  "use strict";
  /* SSR guard (#416): no-op outside the browser so SSR/RSC frameworks can
     evaluate this module (and the dist bundle) in Node without crashing. */
  if (typeof window === "undefined" || typeof document === "undefined") return;
  var Aura = window.Aura;
  if (!Aura || !("customElements" in window)) return;

  var BEHAVIOR_ATTR = "data-aura-footer";
  /* data-aura-revealed carries the "aura-" namespace prefix (#747) to prevent
     accidental collision with consumer code or other Aura attributes. */
  var REVEALED_ATTR = "data-aura-revealed";
  /* Attribute that marks the footer as being keyboard-focused (for focus-within
     reveal, #766 #804). */
  var FOCUSED_ATTR = "data-aura-footer-focused";
  /* Attribute set by JS proximity detection to temporarily expand the FMB circle
     before the cursor physically touches the element edge (mirrors the nav-header
     fmb-expand-px mechanism). Cleared when the cursor leaves proximity or when
     data-aura-revealed is permanently set by the IntersectionObserver. */
  var EXPANDED_ATTR = "data-footer-expanded";
  /* Attribute toggled by click-to-pin: keeps the FMB expanded until clicked again. */
  var PINNED_ATTR = "data-fmb-pinned";
  /* Unified FMB stash-state mirror (v3.541, #1019): positive-polarity inverse of
     data-aura-revealed, reflected on every reveal-mode footer so all three FMB
     hosts expose one stash spelling (matches nav-header's data-stashed polarity).
     Purely additive — CSS and internal logic keep reading data-aura-revealed. */
  var STASHED_MIRROR_ATTR = "data-aura-stashed";
  /* Button/panel decoupling (v3.550, #1047): the class name of the floating
     panel wrapper _enhance() creates to hold every non-mark child. Mirrors
     css/footer.css's `.aura-footer__panel` selector — keep the two in sync. */
  var PANEL_CLASS = "aura-footer__panel";

  /* ---- FMB proximity detection (module-level, shared across all instances) */
  var fmbPointerX = -1;
  var fmbPointerY = -1;
  var fmbRafPending = false;
  /* Active footer instances that need proximity sync (added in _enhance,
     removed in _teardown). */
  var fmbInstances = [];

  /* Read --aura-footer-fmb-size in px via a probe element (same technique as
     revealOffsetPx — resolves var() chains the browser can't otherwise serialize).
     Returns the numeric pixel value, defaulting to 48 (3rem at 16px base). */
  function fmbSizePx(el) {
    var probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;width:var(--aura-footer-fmb-size,3rem)';
    el.appendChild(probe);
    var px = parseFloat(getComputedStyle(probe).width) || 48;
    el.removeChild(probe);
    return px;
  }


  /* Read --aura-footer-fmb-expand-px (unitless scalar → numeric via width probe). */
  function fmbExpandPx(el) {
    var v = parseFloat(getComputedStyle(el).getPropertyValue('--aura-footer-fmb-expand-px')) || 14;
    return v >= 0 ? v : 14;
  }

  /* Guard: is there an open panel (e.g. the theme-select dropdown) inside the
     footer? Mirrors nav-header's hasOpenMenu — prevents the FMB from collapsing
     while the user has a panel open. Searches the whole subtree, so it still
     finds a descendant dropdown regardless of whether it lives directly under
     the host or (post button/panel decoupling) inside .aura-footer__panel. */
  function hasOpenPanel(el) {
    /* v3.550: real content (any descendant dropdown trigger, e.g. the demo's
       theme-select) now lives in the body-level `.aura-footer__panel`, not
       inside the host itself (see ensureFooterPanel()'s containing-block
       doc comment) — check both locations. */
    if (el.querySelector('button[aria-expanded="true"]')) return true;
    return !!(el._panel && el._panel.querySelector('button[aria-expanded="true"]'));
  }

  /* Host attributes that (in addition to :hover/:focus-within, tracked via
     real listeners below) determine whether the panel should be open.
     data-aura-footer-layout is mirrored too, unconditionally, so the split
     layout API still reaches the panel's own layout rule. */
  var PANEL_OPEN_ATTRS = [REVEALED_ATTR, EXPANDED_ATTR, PINNED_ATTR];
  var PANEL_LAYOUT_ATTR = 'data-aura-footer-layout';
  /* The single computed attribute CSS keys the panel's visibility off —
     set on the panel itself (not the host) since the panel is body-level,
     not a DOM descendant the host's own :hover/:focus-within/attribute
     selectors can reach via a combinator. Mirrors the same "Opened" concept
     fmb-design.md's contract describes, computed here instead of expressed
     as a compound CSS selector. */
  var PANEL_OPEN_ATTR = 'data-footer-panel-open';
  /* #755 initial-load snap marker class, mirrored onto the panel for the
     same DOM-descendant reason as PANEL_OPEN_ATTR above. */
  var NO_TRANSITION_CLASS = 'aura-footer--no-transition';

  /* ---- Button/panel decoupling (v3.550, #1047) --------------------------
     ensureFooterPanel(): creates the single floating-panel wrapper (idempotent
     — self._panel guard) and moves every current non-mark child into it. This
     is the CSS-visible split that lets css/footer.css keep the HOST a fixed
     circle in every state while the panel floats independently, mirroring
     js/nav-header.js's ensureUserFmb() creating a sibling proxy for the same
     button-stability reason (fmb-design.md §Hard requirement).

     BODY-LEVEL, not a DOM child of the host (verified live, real bug found —
     not defensive guesswork): the host carries `.aura-glow`, whose base rule
     sets `translate: var(--aura-magnet-dx, 0) var(--aura-magnet-dy, 0)`
     unconditionally. Per the CSS Transforms spec, ANY element with a
     non-`none` computed `translate`/`transform`/`rotate`/`scale` becomes the
     containing block for its `position: fixed` descendants — so a panel
     nested INSIDE the host would resolve `position: fixed` relative to the
     host's own 48×48px circle box, not the viewport, collapsing the "spans
     the viewport" panel down to the circle's own size. This is the exact
     containing-block trap `docs/design/fmb-user-design.md`'s
     `ensureUserFmb()` already documents and works around by inserting its
     proxy as a body-level sibling — this function follows the same
     precedent. Because the panel is no longer a DOM descendant of the host,
     CSS can't reach it via a `>` child combinator keyed off the host's own
     attribute state; armPanelStateMirror() (below) mirrors the handful of
     state attributes the panel's CSS needs directly onto the panel element
     instead, so the panel's own visibility rules key off ITS OWN
     attributes. */
  function ensureFooterPanel(self) {
    if (self._panel) return self._panel;
    var panel = document.createElement('div');
    panel.className = PANEL_CLASS;
    /* Move every current child that is NOT the mark zone into the panel,
       preserving DOM order. Snapshot into an array first — childNodes is live
       and mutates as we move nodes. */
    var toMove = [];
    for (var i = 0; i < self.children.length; i++) {
      var child = self.children[i];
      if (child.getAttribute('data-footer-zone') !== 'mark') toMove.push(child);
    }
    for (var j = 0; j < toMove.length; j++) panel.appendChild(toMove[j]);
    document.body.appendChild(panel);
    self._panel = panel;
    syncPanelStateMirror(self);
    return panel;
  }

  /* Recomputes PANEL_OPEN_ATTR on the body-level panel from the host's
     current state: any of the attribute-driven signals (data-aura-revealed,
     data-footer-expanded, data-fmb-pinned) OR the live :hover/:focus-within
     pseudo-state (tracked via self._footerHovered/self._footerFocused,
     updated by real pointerenter/pointerleave/focusin/focusout listeners —
     :hover/:focus-within are not attributes, so they cannot be picked up by
     a MutationObserver). Also mirrors data-aura-footer-layout and the
     .aura-footer--no-transition class (#755 initial-load snap) unconditionally
     so the panel's own split-layout and no-transition rules stay in sync —
     both are DOM state on the host that the panel, no longer a DOM
     descendant, cannot reach via a CSS combinator. Idempotent — only touches
     an attribute/class when its value actually differs. */
  function syncPanelStateMirror(self) {
    if (!self._panel) return;
    var open = !!self._footerHovered || !!self._footerFocused;
    if (!open) {
      for (var i = 0; i < PANEL_OPEN_ATTRS.length; i++) {
        if (self.hasAttribute(PANEL_OPEN_ATTRS[i])) { open = true; break; }
      }
    }
    if (open !== self._panel.hasAttribute(PANEL_OPEN_ATTR)) {
      self._panel.toggleAttribute(PANEL_OPEN_ATTR, open);
    }
    if (self.hasAttribute(PANEL_LAYOUT_ATTR)) {
      if (self._panel.getAttribute(PANEL_LAYOUT_ATTR) !== self.getAttribute(PANEL_LAYOUT_ATTR)) {
        self._panel.setAttribute(PANEL_LAYOUT_ATTR, self.getAttribute(PANEL_LAYOUT_ATTR));
      }
    } else if (self._panel.hasAttribute(PANEL_LAYOUT_ATTR)) {
      self._panel.removeAttribute(PANEL_LAYOUT_ATTR);
    }
    var noTransition = self.classList.contains(NO_TRANSITION_CLASS);
    if (noTransition !== self._panel.classList.contains(NO_TRANSITION_CLASS)) {
      self._panel.classList.toggle(NO_TRANSITION_CLASS, noTransition);
    }
  }

  /* True when node is contained by either the host's OWN subtree or the
     body-level panel's subtree. The panel is a document.body sibling, not a
     DOM descendant of the host (ensureFooterPanel()'s containing-block doc
     comment above) — so a plain self.contains(node) silently misses anything
     that happens inside the panel. Shared by both the hover/focus mirror
     below and the pre-existing focus-reveal mechanism, which has the
     identical dual-location requirement. */
  function containsAcrossHostAndPanel(self, node) {
    if (!node) return false;
    if (self.contains(node)) return true;
    return !!(self._panel && self._panel.contains(node));
  }

  /* Arms the MutationObserver (attribute + class-driven signals) AND the
     real pointer/focus listeners (:hover/:focus-within-equivalent signals)
     that keep the panel's computed PANEL_OPEN_ATTR in sync with the host for
     the lifetime of the enhancement. Returns the disposer the caller stores
     and invokes from _teardown().

     Dual-location listeners (v3.550 reviewer fix, root cause: the panel is a
     document.body sibling, not a DOM descendant of the host — see
     ensureFooterPanel()'s doc comment): pointerenter/pointerleave do NOT
     bubble, so they must be attached directly to BOTH self and self._panel,
     not just delegated from one. Without this, a mouse gliding from the
     circle onto the panel's own surface fires pointerleave on the host with
     no compensating pointerenter on the panel, closing the panel while the
     cursor is still over it. focusin/focusout DO bubble, but only from
     descendants of the node they are attached to — a real focusable control
     living inside the panel never bubbles focusin up through the host at
     all, so keyboard focus moving into the panel could never register as
     "open" via a host-only listener. Wiring the same listeners onto both
     nodes, and computing containment via containsAcrossHostAndPanel() (which
     mirrors hasOpenPanel()'s existing "check both locations" pattern above),
     closes both gaps. */
  function armPanelStateMirror(self) {
    var disposers = [];
    if (typeof MutationObserver !== "undefined") {
      var mo = new MutationObserver(function () { syncPanelStateMirror(self); });
      mo.observe(self, { attributes: true, attributeFilter: PANEL_OPEN_ATTRS.concat([PANEL_LAYOUT_ATTR, 'class']) });
      disposers.push(function () { mo.disconnect(); });
    }
    var onEnter = function () { self._footerHovered = true; syncPanelStateMirror(self); };
    var onLeave = function () { self._footerHovered = false; syncPanelStateMirror(self); };
    var onFocusIn = function () { self._footerFocused = true; syncPanelStateMirror(self); };
    var onFocusOut = function (ev) {
      /* Only clear the "focused" mirror signal if focus is moving OUTSIDE
         both the host AND the panel — moving focus from a host control to a
         panel control (or vice versa) must not flicker the mirror closed. */
      if (!containsAcrossHostAndPanel(self, ev.relatedTarget)) {
        self._footerFocused = false;
        syncPanelStateMirror(self);
      }
    };
    self.addEventListener('pointerenter', onEnter);
    self.addEventListener('pointerleave', onLeave);
    self.addEventListener('focusin', onFocusIn);
    self.addEventListener('focusout', onFocusOut);
    /* Same four listeners on the panel itself — pointerenter/pointerleave
       never bubble, so the panel needs its OWN pair; focusin/focusout are
       wired identically for symmetry and so either surface's listener
       independently re-arms the "open" mirror regardless of which one the
       user is currently interacting with. */
    if (self._panel) {
      self._panel.addEventListener('pointerenter', onEnter);
      self._panel.addEventListener('pointerleave', onLeave);
      self._panel.addEventListener('focusin', onFocusIn);
      self._panel.addEventListener('focusout', onFocusOut);
    }
    disposers.push(function () {
      self.removeEventListener('pointerenter', onEnter);
      self.removeEventListener('pointerleave', onLeave);
      self.removeEventListener('focusin', onFocusIn);
      self.removeEventListener('focusout', onFocusOut);
      if (self._panel) {
        self._panel.removeEventListener('pointerenter', onEnter);
        self._panel.removeEventListener('pointerleave', onLeave);
        self._panel.removeEventListener('focusin', onFocusIn);
        self._panel.removeEventListener('focusout', onFocusOut);
      }
      self._footerHovered = false;
      self._footerFocused = false;
    });
    return function () { for (var i = 0; i < disposers.length; i++) disposers[i](); };
  }

  /* rehomeLooseChildren(): re-parents any child appended to the host directly
     (author markup evaluated after enhance, an HTMX swap injecting new footer
     content, etc.) into the existing panel, so `<aura-footer>` keeps behaving
     like a single container from the author's point of view even though the
     real content now lives one level deeper (and, since v3.550, one level
     ELSEWHERE — body-level, not nested). The mark zone is left alone — it
     stays a direct child of the host, the STABLE part of the button. */
  function rehomeLooseChildren(self) {
    if (!self._panel) return;
    var loose = [];
    for (var i = 0; i < self.children.length; i++) {
      var child = self.children[i];
      if (child.getAttribute('data-footer-zone') === 'mark') continue;
      loose.push(child);
    }
    for (var j = 0; j < loose.length; j++) self._panel.appendChild(loose[j]);
  }

  /* rAF-throttled proximity sync: fires for every active FMB footer instance. */
  function syncFmbHotzones() {
    fmbRafPending = false;
    for (var i = 0; i < fmbInstances.length; i++) {
      syncOneFmb(fmbInstances[i]);
    }
  }

  function syncOneFmb(self) {
    /* Permanently revealed — no FMB affordance needed. */
    if (self.hasAttribute(REVEALED_ATTR)) {
      if (self.hasAttribute(EXPANDED_ATTR)) self.removeAttribute(EXPANDED_ATTR);
      return;
    }
    /* Click-pinned: CSS handles expand state; skip proximity compute. */
    if (self.hasAttribute(PINNED_ATTR)) return;
    if (fmbPointerX < 0) return;

    /* Mobile convergence (v3.552, #1051): below --aura-bp-mobile the circle
       is hidden (visibility:hidden; pointer-events:none) by
       css/footer.css's mobile-convergence block whenever the merged
       <aura-fmb-column> reveal control has not been triggered — see
       docs/design/footer-design.md §Mobile convergence. getBoundingClientRect()
       still returns real geometry for a visibility:hidden box (the box still
       exists, just isn't painted/hit-testable), so without this guard a real
       pointer position that happens to land near the circle's own fixed
       corner — which, not coincidentally, is the SAME corner the reveal
       control itself occupies — could still satisfy the proximity radius
       check below and set EXPANDED_ATTR, opening the body-level panel with
       no visible trigger on screen. Skip proximity entirely while the host
       is not actually visible; the mobile hidden/revealed state is a CSS-only
       concept (no companion JS attribute), so read it back via
       getComputedStyle rather than duplicating the :has()/breakpoint
       condition here. */
    if (getComputedStyle(self).visibility === 'hidden') return;

    /* Compute the FMB circle center from the HOST's own bounding rect
       (v3.550 button/panel decoupling, #1047 — mirrors the identical fix
       already shipped in js/sidebar.js's syncOne() and js/nav-header.js's
       syncOneUserFmb()): pre-v3.550, the host's box itself resized between
       Stashed and Opened, so the proximity math derived the circle's
       position from the (stable) shell rect + CSS-token pad/radius instead
       of the host's own (unstable) rect. Post-decoupling, css/footer.css
       makes the host `position: fixed !important` with a fixed inset/size
       in EVERY state (Stashed/Opened/Pinned/Revealed — only opacity/filter
       ever animate, never geometry), so the host's OWN
       getBoundingClientRect() is now stable and viewport-relative in every
       state, and reading it directly is both simpler and more correct than
       re-deriving the same fixed position from a shell ancestor that may
       not even exist (a standalone, no-shell page) or may not be
       positioned the way this math assumed. */
    var r   = self._fmbRadius;
    var rect = self.getBoundingClientRect();
    var cx = rect.left + r;
    var cy = rect.top + r;
    var expand = self._fmbExpand;

    var dx = fmbPointerX - cx;
    var dy = fmbPointerY - cy;
    var inProximity = (dx * dx + dy * dy) <= (r + expand) * (r + expand);

    if (inProximity && !hasOpenPanel(self)) {
      if (!self.hasAttribute(EXPANDED_ATTR)) self.setAttribute(EXPANDED_ATTR, '');
    } else if (!inProximity) {
      if (self.hasAttribute(EXPANDED_ATTR)) self.removeAttribute(EXPANDED_ATTR);
    }
  }

  /* Global pointermove listener — installed once, serves all FMB instances. */
  var fmbMoveInstalled = false;
  function installFmbMove() {
    if (fmbMoveInstalled) return;
    fmbMoveInstalled = true;
    document.addEventListener('pointermove', function (e) {
      fmbPointerX = e.clientX;
      fmbPointerY = e.clientY;
      if (!fmbRafPending && fmbInstances.length > 0) {
        fmbRafPending = true;
        requestAnimationFrame(syncFmbHotzones);
      }
    }, { passive: true });
  }

  /* ---- Token reading (no layout writes) -------------------------------- */
  /* CSS custom properties that are themselves var() chains (e.g. --aura-space-7)
     cannot be resolved to px by parseFloat(getComputedStyle(...).getPropertyValue()).
     The browser returns the raw "var(--aura-space-7)" string, not the computed px
     value, so Aura.lengthPx would return 0 (#744).
     Fix: probe a px-typed property on a temporarily attached element and let the
     browser resolve the full var() chain to a computed px value.
     The probe is immediately removed — no layout write on the hot path. */
  function revealOffsetPx(el) {
    // CSS custom properties that are themselves var() chains cannot be
    // resolved by parseFloat. Probe a px-typed property on a temp element
    // to let the browser resolve the var() chain to a computed px value.
    var probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;width:var(--aura-footer-reveal-offset,0px)';
    el.appendChild(probe);
    var px = parseFloat(getComputedStyle(probe).width) || 0;
    el.removeChild(probe);
    return px;
  }

  /* ---- Scroll-root resolution (app-shell model) ------------------------ */
  /* In the app-shell layout the page itself never scrolls — html/body are
     locked and an inner <aura-region> owns the overflow (see css/layout.css),
     so the IntersectionObserver must be ROOTED on that region; a viewport-rooted
     observer would never see the sentinel cross the region's bottom. The shared
     Aura.scrollRootFor returns that region (or null — no shell — standalone
     pages use root:null, the layout viewport), and is the same resolver
     js/nav-header.js uses so the two agree on the scroll owner (#325). */
  var resolveScrollRoot = Aura.scrollRootFor;

  /* ---- Reveal element -------------------------------------------------- */
  /* Summary: site footer (contentinfo landmark) that, in reveal mode, stays
     concealed off the bottom edge and slides in when the user scrolls to the end
     of the content. Owns one IntersectionObserver + one injected sentinel. */
  Aura.define("aura-footer", class extends HTMLElement {
    connectedCallback() {
      this.classList.add("aura-footer");
      /* <aura-footer> is not a known landmark tag, so name the role.
         #736 #794: role="contentinfo" may already be present as a static HTML
         attribute (set in the master template for SSR/pre-JS landmark discovery).
         Respect the static attribute — do not overwrite it; just ensure it is set. */
      if (!this.hasAttribute("role")) this.setAttribute("role", "contentinfo");
      /* Assign a unique id for sentinel scoping (#754). */
      if (!this._uid) this._uid = Aura.uid();
      this._enhance();
    }

    disconnectedCallback() {
      this._teardown();
    }

    /* Re-resolve and re-arm when the behaviour changes at runtime (an author
       toggling reveal on/off). */
    static get observedAttributes() { return [BEHAVIOR_ATTR]; }
    attributeChangedCallback() {
      if (this.isConnected) { this._teardown(); this._enhance(); }
    }

    /* #782 — API parity with nav-header: data-aura-footer is the canonical
       attribute; data-nav-behavior="reveal" is accepted as an alias so
       consumers coming from the nav-header API pattern do not need to learn
       a second attribute name. data-aura-footer is always authoritative. */
    _isReveal() {
      return this.getAttribute(BEHAVIOR_ATTR) === "reveal" ||
             this.getAttribute("data-nav-behavior") === "reveal";
    }

    _enhance() {
      if (!this._isReveal()) return;             // static footer — nothing to do
      if (this._sentinel) return;                // already enhanced (idempotent)
      /* Button/panel decoupling (v3.550, #1047): split the host's real content
         (everything but the mark zone) into an independent floating panel
         BEFORE any geometry/proximity setup below, so the host's own box from
         this point on only ever contains the stable mark zone + the panel
         wrapper — never the raw link/theme-panel content directly. */
      ensureFooterPanel(this);
      if (typeof MutationObserver !== "undefined") {
        var selfForRehome = this;
        this._panelRehomeMo = new MutationObserver(function () {
          rehomeLooseChildren(selfForRehome);
        });
        this._panelRehomeMo.observe(this, { childList: true });
      }
      /* Keep the body-level panel's computed PANEL_OPEN_ATTR + mirrored
         layout attribute in sync with the host for as long as this instance
         is enhanced — see armPanelStateMirror()'s doc comment above.
         Returns a disposer function (not a MutationObserver — it also owns
         the pointer/focus listener teardown), invoked from _teardown(). */
      this._disposePanelStateMirror = armPanelStateMirror(this);
      /* Register this instance for FMB proximity detection and install the
         shared pointermove listener (idempotent — only installs once). */
      if (fmbInstances.indexOf(this) < 0) fmbInstances.push(this);
      installFmbMove();
      this._fmbRadius = fmbSizePx(this) / 2;
      this._fmbExpand = fmbExpandPx(this);
      /* Coverage principle (proximity-glow-design.md §Coverage principle): the
         whole FMB host is a real click target (pin-click below), so it gets the
         default proximity glow + magnetic lean like any other interactive
         widget — host-level whole-element glow, mirroring aura-card's
         _reflectTactile() pattern. Scoped to reveal mode (this branch only runs
         when _isReveal() is true) so a static footer stays matte. */
      this.classList.add("aura-glow");
      /* Click-to-pin: toggling data-fmb-pinned keeps the FMB expanded until
         the user clicks again. Ignore clicks on interactive descendants (links,
         buttons, inputs) so they still work normally when the footer is open. */
      var self = this;
      this._onFmbPinClick = function (e) {
        if (self.hasAttribute(REVEALED_ATTR)) return;
        if (e.target.closest("a, button, input, select, textarea")) return;
        self.toggleAttribute(PINNED_ATTR);
      };
      this.addEventListener("click", this._onFmbPinClick);
      /* Unified stash-state mirror (#1019): data-aura-stashed is present exactly
         while data-aura-revealed is absent. MutationObserver-driven so every
         reveal/conceal path (IO, focus-within, short-content, re-root, consumer
         flips) is covered from one place; armed BEFORE the no-IO fallback below
         so the mirror is correct on that path too. Torn down in _teardown(). */
      this._syncStashMirror = function () {
        var stashed = !self.hasAttribute(REVEALED_ATTR);
        if (stashed !== self.hasAttribute(STASHED_MIRROR_ATTR)) {
          self.toggleAttribute(STASHED_MIRROR_ATTR, stashed);
        }
      };
      this._syncStashMirror();
      if (typeof MutationObserver !== "undefined") {
        this._stashMirrorMo = new MutationObserver(this._syncStashMirror);
        this._stashMirrorMo.observe(this, { attributes: true, attributeFilter: [REVEALED_ATTR] });
      }
      if (!("IntersectionObserver" in window)) {
        /* No observer support → never hide essential chrome: reveal it. */
        this.setAttribute(REVEALED_ATTR, "");
        return;
      }
      /* The sentinel is a 1px-height marker at the END of the scrollable
         content, so the IntersectionObserver (rooted on the scroll region) sees
         it cross the region's bottom edge. A truly zero-height element may not
         fire IntersectionObserver reliably in all browsers — 1px is needed for
         reliable detection (#769 #799). The footer itself overlays the body
         (css/layout.css pins it, out of flow, to the shell's bottom edge), so it
         is a sibling of the region and cannot be its own sentinel; place the
         sentinel as the LAST child of the resolved scroll region instead. With
         no shell region (standalone layout) the observer uses documentElement as
         root (#784), so the sentinel sits just before the footer in normal flow. */
      var sentinel = document.createElement("div");
      sentinel.className = "aura-footer-sentinel";
      /* #807: aria-hidden="true" removes the sentinel from the AT tree entirely
         — screen readers will not encounter it in virtual cursor mode. Using
         role="presentation" would be wrong here because it only suppresses the
         element's implicit ARIA role, not its child content; aria-hidden hides
         the entire subtree. Do NOT change this to role="presentation". */
      sentinel.setAttribute("aria-hidden", "true");
      /* Scope this sentinel to this footer instance so two reveal footers on the
         same page each observe only their own sentinel (#754). */
      sentinel.dataset.footerId = this._uid;
      sentinel.style.cssText =
        "display:block;block-size:1px;inline-size:100%;margin:0;padding:0;pointer-events:none;";
      var initialRoot = resolveScrollRoot(this);
      if (initialRoot) {
        /* Check that no OTHER footer has already appended a sentinel to this root
           (#754). Each footer manages its own sentinel, scoped by data-footer-id. */
        initialRoot.appendChild(sentinel);
      } else {
        /* Standalone mode: place sentinel before the footer in normal flow.
           Guard against a null parentNode (#786). */
        if (this.parentNode) this.parentNode.insertBefore(sentinel, this);
        else document.body.appendChild(sentinel);
        /* Mark this footer as standalone so CSS can apply position:fixed (#770). */
        this.classList.add("aura-footer--standalone");
      }
      this._sentinel = sentinel;

      /* Short-content pages (#756 #789 #808): if the scroll root (or document) has
         no scrollable overflow, the sentinel is always in view but the user can never
         scroll past it to re-hide. Pin the footer as permanently revealed.
         Also add .aura-footer--short-content as a marker class so consumers can
         target this state in CSS, and apply the no-transition class so the instant
         reveal has no slide-in (#755 / #789 — short-content reveal must be instant). */
      var checkShortContent = function (root) {
        var el = root || document.documentElement;
        return el.scrollHeight <= el.clientHeight;
      };

      /* #741 — prefers-reduced-motion: when reduced motion is preferred and the
         user is mid-scroll (partial translate visible), we must not leave a
         half-translated footer stuck in view. The CSS already sets transition:none
         under this media query; the JS side ensures the attribute flip is immediate
         (which it always is — JS is synchronous). No extra JS action is needed
         beyond what IO already does: the attribute is set/removed synchronously
         and CSS applies the instant snap via transition:none. This is documented
         here as a proof that the reduced-motion contract is satisfied by the
         existing IO callback without extra JS. */

      /* #798 #800 — aria-live announcement region: a visually-hidden polite live
         region that announces footer visibility changes to screen reader users.
         Injected once and appended to document.body (outside the footer itself so
         it is reachable regardless of the footer's visibility state). Torn down in
         _teardown(). */
      this._liveRegion = document.createElement('div');
      this._liveRegion.setAttribute('aria-live', 'polite');
      this._liveRegion.setAttribute('aria-atomic', 'true');
      this._liveRegion.style.cssText =
        'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;';
      document.body.appendChild(this._liveRegion);

      /* #772 — scroll-padding-block-end: when the reveal footer is shown it
         overlays the bottom of the scroll region; scroll-padding-block-end pushes
         the "scroll to" resting position up by the footer height so anchored
         elements are not obscured. Cleared when the footer is concealed.
         Uses the scroll root resolved at call time (mirrors _observe).
         #787 — also publish --aura-footer-height-current as a CSS custom property
         so consumers can reference the live footer height in CSS without JS.
         Set to the real px value on reveal; removed (reverting to the CSS-set
         "auto" default in the data-aura-revealed rule) on conceal.
         Button/panel decoupling (v3.550, #1047): the HOST's own offsetHeight is
         now always the small fixed circle's height — the surface that actually
         overlays content on reveal is the independent .aura-footer__panel, so
         both the scroll-padding reserve and the published height token must
         read the PANEL's rendered height, falling back to the host's own height
         if the panel is somehow absent (defensive — should not happen once
         _enhance() has run). */
      var updateScrollPadding = function (self, revealed) {
        var root = self._scrollRoot || document.scrollingElement || document.documentElement;
        var measured = (self._panel || self).offsetHeight;
        root.style.scrollPaddingBlockEnd = revealed ? measured + 'px' : '';
        /* #787: publish/remove the live height token. */
        if (revealed) {
          self.style.setProperty('--aura-footer-height-current', measured + 'px');
        } else {
          self.style.removeProperty('--aura-footer-height-current');
        }
      };
      this._updateScrollPadding = updateScrollPadding;

      /* #766 #804 — focus-within reveal: keyboard users tabbing into the footer
         should cause it to reveal even before the sentinel intersects. Listen for
         focusin (bubbles from any descendant); on focusout only remove the revealed
         state if focus actually left the footer AND the sentinel is not intersecting.
         The FOCUSED_ATTR is a JS-only internal marker; CSS relies only on
         data-aura-revealed (set below).

         Dual-location (v3.550 reviewer fix, same root cause as
         armPanelStateMirror above): focusin bubbles, but ONLY from
         descendants of the node the listener is attached to. Since the real
         focusable content (links, controls) now lives in the body-level
         .aura-footer__panel — a document.body sibling of the host, not a
         DOM descendant (ensureFooterPanel()'s doc comment) — a listener
         wired only on `self` never sees a focusin that originates inside the
         panel at all, not even a suppressed/late one. Attach the identical
         pair to self._panel too, and resolve "did focus leave both surfaces"
         via containsAcrossHostAndPanel() (shared with armPanelStateMirror)
         instead of a plain self.contains() check. */
      this._onFocusIn = function () {
        self.setAttribute(REVEALED_ATTR, '');
        updateScrollPadding(self, true);
        if (self._liveRegion) self._liveRegion.textContent = 'Footer content available';
      };
      this._onFocusOut = function (ev) {
        /* Only conceal if focus is moving OUT of the footer entirely — i.e.
           out of BOTH the host circle and the body-level panel. */
        if (!containsAcrossHostAndPanel(self, ev.relatedTarget)) {
          /* Only remove the revealed state if the sentinel is NOT currently
             intersecting (i.e. we haven't naturally scrolled to the end). */
          if (!self._sentinelIntersecting) {
            self.removeAttribute(REVEALED_ATTR);
            updateScrollPadding(self, false);
            if (self._liveRegion) self._liveRegion.textContent = '';
          }
        }
      };
      this.addEventListener('focusin', this._onFocusIn);
      this.addEventListener('focusout', this._onFocusOut);
      if (this._panel) {
        this._panel.addEventListener('focusin', this._onFocusIn);
        this._panel.addEventListener('focusout', this._onFocusOut);
      }
      /* Track intersecting state so focusout can decide whether to re-hide. */
      this._sentinelIntersecting = false;

      this._observe = function () {
        if (self._io) { self._io.disconnect(); }
        var root = resolveScrollRoot(self);

        /* Clear any stale revealed state before re-arming on a new root (#751):
           the old root's position is irrelevant — start clean so the new
           observation reflects the sentinel's position relative to the NEW root. */
        self.removeAttribute(REVEALED_ATTR);

        /* Keep the sentinel anchored to the END of the current scroll root (a
           reflow can change which element scrolls); re-home it if needed. */
        if (root) {
          if (sentinel.parentNode !== root) root.appendChild(sentinel);
          /* Update standalone marker: sentinel is now shell-rooted. */
          self.classList.remove("aura-footer--standalone");
        } else {
          /* Standalone: sentinel must be inside the scroll container (body/html). */
          if (self.parentNode && sentinel.parentNode !== self.parentNode) {
            /* If footer has positioned siblings, document.body is the safer
               fallback container (#762). */
            self.parentNode.insertBefore(sentinel, self);
          } else if (!self.parentNode && sentinel.parentNode !== document.body) {
            document.body.appendChild(sentinel);
          }
          self.classList.add("aura-footer--standalone");
        }

        /* Short-content shortcut (#756 #789 #808): if the scroll container has no
           overflow, the user has already seen all content — reveal immediately and
           skip the IO.  Add .aura-footer--short-content marker so consumers can
           target this state in CSS (e.g. landscape-mobile permanent reveal, #808).
           Apply .aura-footer--no-transition BEFORE setting data-aura-revealed so
           the instant reveal has no slide-in animation; a rAF removes it so any
           subsequent re-reveal (e.g. after dynamic content addition) can animate. */
        if (checkShortContent(root)) {
          self.classList.add('aura-footer--short-content');
          self.classList.add('aura-footer--no-transition');
          self.setAttribute(REVEALED_ATTR, "");
          self._sentinelIntersecting = true;
          updateScrollPadding(self, true);
          if (self._liveRegion) self._liveRegion.textContent = 'Footer content available';
          requestAnimationFrame(function () {
            self.classList.remove('aura-footer--no-transition');
          });
          return;
        }
        /* If we previously marked this as short-content but the scroll container
           now has overflow (dynamic content was added), remove the marker. */
        self.classList.remove('aura-footer--short-content');

        /* Standalone pages (no shell) fall back to root:null (the layout
           viewport). documentElement as root was tried but does not behave as
           a viewport-equivalent root — it represents the full document box, so
           in-flow sentinels near the bottom may never intersect it after scroll.
           The mobile browser-UI resize flicker (#784) will be addressed with a
           resize debounce in a follow-up (#758). */
        var ioRoot = root || null;
        var offset = revealOffsetPx(self);
        /* #755 — initial-load snap: track whether this is the first IO callback.
           If the very first callback fires with isIntersecting:true (the user
           loaded the page already at the bottom, or the page is short), suppress
           the transition for that single paint so there is no slide-in on load.
           A rAF removes the no-transition class so all subsequent reveals animate
           normally. */
        var firstObservation = true;
        /* POSITIVE bottom rootMargin EXTENDS the root's detection zone downward
           by offset px, so the end-of-content sentinel counts as "intersecting"
           while it is still `offset` px below the visible area — i.e. the footer
           eases in just BEFORE the user reaches the true end. Re-conceals when
           they scroll back up out of that band (#779). */
        self._io = new IntersectionObserver(function (entries) {
          var e = entries[entries.length - 1];
          /* If the sentinel has been removed from the DOM (e.g. by an HTMX swap
             that replaced the scroll root or its contents), re-enhance (#743). */
          if (self._sentinel && self._sentinel.parentNode === null) {
            self._teardown();
            if (self.isConnected) self._enhance();
            return;
          }
          var isNowRevealed = self.hasAttribute(REVEALED_ATTR);
          /* Track the raw sentinel intersection so focus-leave knows whether the
             footer should stay visible due to scroll position (#766 #804). */
          self._sentinelIntersecting = e.isIntersecting;
          /* Only flip the attribute when the state actually changes — avoids
             flicker at the exact scroll boundary (#768). */
          if (e.isIntersecting && !isNowRevealed) {
            /* #755: on the first observation suppress the slide-in transition so a
               page loaded at the bottom snaps to revealed instantly, not animates. */
            if (firstObservation) {
              self.classList.add('aura-footer--no-transition');
              requestAnimationFrame(function () {
                self.classList.remove('aura-footer--no-transition');
              });
            }
            self.setAttribute(REVEALED_ATTR, "");
            updateScrollPadding(self, true);
            if (self._liveRegion) self._liveRegion.textContent = 'Footer content available';
            /* #740 — dispatch aura:footer-revealed so consumers can react
               (adjust scroll padding, log analytics, etc.).
               detail.revealed: true  = footer just became visible.
               Bubbles to the document root so event delegation works. */
            self.dispatchEvent(new CustomEvent('aura:footer-revealed', {
              bubbles: true,
              detail: { revealed: true }
            }));
          } else if (!e.isIntersecting && isNowRevealed) {
            /* Do not conceal if focus is currently inside the footer (#766).
               Dual-location (v3.550 reviewer fix): real focusable content now
               lives in the body-level panel, not under the host — check both
               subtrees, mirroring _onFocusOut's identical fix above. */
            if (!containsAcrossHostAndPanel(self, document.activeElement)) {
              self.removeAttribute(REVEALED_ATTR);
              updateScrollPadding(self, false);
              if (self._liveRegion) self._liveRegion.textContent = '';
              /* #740 — dispatch aura:footer-revealed on conceal too.
                 detail.revealed: false = footer just slid off-screen. */
              self.dispatchEvent(new CustomEvent('aura:footer-revealed', {
                bubbles: true,
                detail: { revealed: false }
              }));
            }
          }
          firstObservation = false;
        }, { root: ioRoot, rootMargin: "0px 0px " + offset + "px 0px", threshold: 0.01 });
        self._io.observe(sentinel);
      };
      this._observe();

      /* A responsive reflow can change which element owns the scroll (a region
         gains/loses overflow at a breakpoint), so re-resolve the root + offset.

         Performance (#739 #758 #777 #780): use a 100ms trailing debounce so that
         rapid resize sequences (e.g. dragging a window) only fire one IO re-root
         after the user stops. This avoids reconstructing the IntersectionObserver
         at up to 60 fps for the duration of a drag.

         #815: skip the re-arm entirely when a modal dialog is open — the modal
         obscures the footer, so animation and compositing work is wasted. */
      var resizeTimer = null;
      this._onResize = function () {
        if (self._dialogOpen) return;
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () {
          if (self._observe) self._observe();
        }, 100);
      };

      /* ResizeObserver on documentElement (#783 #759 #767): more precise than the
         window resize event (fires only when size ACTUALLY changes, not on every
         pixel), and also catches container-query breakpoints that never fire window
         resize. Keep window resize only as a cross-origin / unsupported fallback. */
      if (typeof ResizeObserver !== "undefined") {
        this._ro = new ResizeObserver(this._onResize);
        this._ro.observe(document.documentElement);
      } else {
        window.addEventListener("resize", this._onResize, { passive: true });
        this._usingWindowResize = true;
      }

      /* If an aura-shell or aura-region is inserted AFTER connectedCallback
         (e.g. progressive hydration), re-root the IntersectionObserver so it
         moves from the viewport to the shell's scroll region (#742). */
      this._shellObserver = new MutationObserver(function(mutations) {
        for (var m of mutations) {
          for (var node of m.addedNodes) {
            if (node.nodeType === 1 && (node.matches('aura-shell, aura-region') ||
                node.querySelector('aura-shell, aura-region'))) {
              self._teardown(); self._enhance(); return;
            }
          }
        }
      });
      this._shellObserver.observe(document.body, { childList: true, subtree: true });

      /* HTMX safety: when HTMX swaps the scroll root (or content inside it),
         the sentinel — which is a child of the root — is destroyed. Detect this
         via htmx:afterSwap and re-enhance if the sentinel is gone (#743 #813 #823).
         Also handle htmx:beforeSwap to record the current root element so we can
         detect root-level replacement in afterSwap (#823). */
      this._htmxBeforeSwap = function () {
        self._lastScrollRoot = resolveScrollRoot(self);
      };
      this._htmxAfterSwap = function () {
        /* Case 1: sentinel was removed (e.g. swap replaced its parent) (#743 #813). */
        if (self._sentinel && self._sentinel.parentNode === null) {
          self._teardown();
          if (self.isConnected) self._enhance();
          return;
        }
        /* Case 2: the root element itself was replaced (#823). */
        var newRoot = resolveScrollRoot(self);
        if (self._lastScrollRoot && newRoot !== self._lastScrollRoot &&
            !document.contains(self._lastScrollRoot)) {
          self._teardown();
          if (self.isConnected) self._enhance();
        }
      };
      this._htmxHistoryRestore = function () {
        /* History navigation may replace the page content (#823). */
        self._teardown();
        if (self.isConnected) self._enhance();
      };
      document.addEventListener("htmx:beforeSwap", this._htmxBeforeSwap);
      document.addEventListener("htmx:afterSwap", this._htmxAfterSwap);
      document.addEventListener("htmx:historyRestore", this._htmxHistoryRestore);

      /* #815 — Modal-dialog pause: when an aura-dialog[open][aria-modal] is present
         the footer is fully obscured, so pause the IO and suppress resize re-arms to
         avoid consuming compositing resources for nothing.
         Re-arm on the matching close event.
         We listen for both the Aura custom events (aura:dialog-open / aura:dialog-close)
         AND the native <dialog> toggle event (element-level) for resilience. On page
         load, also sync to any dialog that is ALREADY open. */
      this._dialogOpen = false;
      this._checkDialogState = function () {
        self._dialogOpen = !!document.querySelector('aura-dialog[open][aria-modal="true"]');
        if (self._dialogOpen) {
          /* Pause IO: disconnect so the reveal footer does not animate while obscured. */
          if (self._io) { self._io.disconnect(); }
        } else {
          /* Resume: re-arm if we had been paused. */
          if (self._observe) self._observe();
        }
      };
      this._onDialogOpen = function () { self._checkDialogState(); };
      this._onDialogClose = function () { self._checkDialogState(); };
      document.addEventListener("aura:dialog-open", this._onDialogOpen);
      document.addEventListener("aura:dialog-close", this._onDialogClose);
      /* Sync to any dialog already open at enhance-time. */
      this._dialogOpen = !!document.querySelector('aura-dialog[open][aria-modal="true"]');
      if (this._dialogOpen && this._io) this._io.disconnect();
    }

    _teardown() {
      /* Button/panel decoupling (v3.550, #1047): disconnect the re-home
         observer and unwrap the panel FIRST — before any other teardown step
         — so a reveal→static attribute switch (attributeChangedCallback calls
         _teardown() then _enhance(), which no-ops for a static footer) leaves
         the author's real content back as direct, in-flow children of the
         host instead of orphaned inside a wrapper that no CSS rule reaches
         once data-aura-footer stops being "reveal". Also runs on a genuine
         disconnectedCallback teardown, where unwrapping is harmless (the
         whole subtree is being discarded either way). */
      if (this._panelRehomeMo) { this._panelRehomeMo.disconnect(); this._panelRehomeMo = null; }
      if (this._disposePanelStateMirror) { this._disposePanelStateMirror(); this._disposePanelStateMirror = null; }
      if (this._panel) {
        /* Remove the panel-level focusin/focusout pair (#766 #804 dual-
           location fix) HERE, while this._panel is still a live reference —
           this._panel is nulled out at the end of this block, and the
           general focusin/focusout cleanup further down only knows about
           the HOST listener, so it cannot reach the panel once this runs. */
        if (this._onFocusIn) { this._panel.removeEventListener('focusin', this._onFocusIn); }
        if (this._onFocusOut) { this._panel.removeEventListener('focusout', this._onFocusOut); }
        /* The panel is body-level (v3.550 containing-block fix, see
           ensureFooterPanel()'s doc comment) — appendChild here re-parents
           its content back onto the host regardless of where the panel
           itself currently lives in the DOM. */
        var panelChildren = Array.prototype.slice.call(this._panel.childNodes);
        for (var pc = 0; pc < panelChildren.length; pc++) this.appendChild(panelChildren[pc]);
        if (this._panel.parentNode) this._panel.parentNode.removeChild(this._panel);
        this._panel = null;
      }
      /* Disconnect the stash mirror FIRST (#1019) — disconnect() discards any
         queued records, so the attribute removals below cannot re-trigger a
         late mirror sync after teardown. */
      if (this._stashMirrorMo) { this._stashMirrorMo.disconnect(); this._stashMirrorMo = null; }
      this._syncStashMirror = null;
      this.removeAttribute(STASHED_MIRROR_ATTR);
      /* Unregister from FMB proximity detection and remove any expanded attr. */
      var idx = fmbInstances.indexOf(this);
      if (idx >= 0) fmbInstances.splice(idx, 1);
      this.removeAttribute(EXPANDED_ATTR);
      if (this._io) { this._io.disconnect(); this._io = null; }
      if (this._shellObserver) { this._shellObserver.disconnect(); this._shellObserver = null; }
      /* ResizeObserver on documentElement (#783 #759 #767). */
      if (this._ro) { this._ro.disconnect(); this._ro = null; }
      /* The guard check (this._onResize !== null) is always satisfied here because
         we set it to null after removal — safe to call removeEventListener even if
         it was never added (a no-op), and the null check prevents a double-remove
         on rapid re-enhance cycles (#810). */
      if (this._onResize && this._usingWindowResize) {
        window.removeEventListener("resize", this._onResize);
      }
      this._onResize = null;
      this._usingWindowResize = false;
      /* Remove HTMX listeners (#743 #813 #823). */
      if (this._htmxBeforeSwap) { document.removeEventListener("htmx:beforeSwap", this._htmxBeforeSwap); this._htmxBeforeSwap = null; }
      if (this._htmxAfterSwap) { document.removeEventListener("htmx:afterSwap", this._htmxAfterSwap); this._htmxAfterSwap = null; }
      if (this._htmxHistoryRestore) { document.removeEventListener("htmx:historyRestore", this._htmxHistoryRestore); this._htmxHistoryRestore = null; }
      /* Remove dialog-pause listeners (#815). */
      if (this._onDialogOpen) { document.removeEventListener("aura:dialog-open", this._onDialogOpen); this._onDialogOpen = null; }
      if (this._onDialogClose) { document.removeEventListener("aura:dialog-close", this._onDialogClose); this._onDialogClose = null; }
      this._dialogOpen = false;
      this._checkDialogState = null;
      this._lastScrollRoot = null;
      /* Remove FMB pin-click handler. */
      if (this._onFmbPinClick) { this.removeEventListener("click", this._onFmbPinClick); this._onFmbPinClick = null; }
      this.removeAttribute(PINNED_ATTR);
      this._fmbRadius = this._fmbExpand = 0;
      /* Mirror the _enhance() glow add — unconditional, like the other FMB
         state above, so a still-reveal footer that is merely disconnected/
         reconnected (e.g. an HTMX swap) re-enhances cleanly via _enhance()
         rather than carrying a stale class across teardown. */
      this.classList.remove("aura-glow");
      /* Remove focus-within listeners (#766 #804). */
      if (this._onFocusIn) { this.removeEventListener('focusin', this._onFocusIn); this._onFocusIn = null; }
      if (this._onFocusOut) { this.removeEventListener('focusout', this._onFocusOut); this._onFocusOut = null; }
      this._sentinelIntersecting = false;
      /* #798 #800 — remove aria-live region from DOM. */
      if (this._liveRegion) {
        if (this._liveRegion.parentNode) this._liveRegion.parentNode.removeChild(this._liveRegion);
        this._liveRegion = null;
      }
      /* #772 — clear any scroll-padding-block-end we set. */
      if (this._updateScrollPadding) {
        this._updateScrollPadding(this, false);
        this._updateScrollPadding = null;
      }
      /* Guard: _sentinel may be null if _teardown is called before _enhance()
         assigns it (teardown-before-enhance timing race, #764). */
      if (this._sentinel && this._sentinel.parentNode) {
        this._sentinel.parentNode.removeChild(this._sentinel);
      }
      this._sentinel = null;
      this._observe = null;
      this.removeAttribute(REVEALED_ATTR);
      /* Remove standalone class on teardown so re-enhance can re-evaluate. */
      this.classList.remove("aura-footer--standalone");
      /* #789 #808: remove short-content marker class on teardown so re-enhance
         can re-evaluate whether the page is still short-content. */
      this.classList.remove("aura-footer--short-content");
      /* #755: remove any lingering no-transition class. */
      this.classList.remove("aura-footer--no-transition");
    }
  });
})();
