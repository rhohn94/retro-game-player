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
   so css/footer.css can apply position:fixed to take them out of document flow
   (they use a sentinel for the trigger, so in-flow space is not needed, #770).

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

  /* Read --aura-footer-pad-inline in px for FMB position computation. */
  function fmbPadPx(el) {
    var probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;width:var(--aura-footer-pad-inline,1.5rem)';
    el.appendChild(probe);
    var px = parseFloat(getComputedStyle(probe).width) || 24;
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
     while the user has a panel open. */
  function hasOpenPanel(el) {
    return !!el.querySelector('button[aria-expanded="true"]');
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

    /* Compute the FMB circle center from CSS tokens + shell bounding rect
       so the proximity check is accurate even when the footer is currently
       expanded via CSS :hover (getBoundingClientRect would return the
       expanded dimensions, not the stashed FMB circle). */
    var r   = self._fmbRadius;
    var pad = self._fmbPad;
    var shell = self.parentElement;
    var shellRect = shell
      ? shell.getBoundingClientRect()
      : { left: 0, bottom: window.innerHeight };
    var cx = shellRect.left + pad + r;
    var cy = shellRect.bottom - pad - r;
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
      /* Register this instance for FMB proximity detection and install the
         shared pointermove listener (idempotent — only installs once). */
      if (fmbInstances.indexOf(this) < 0) fmbInstances.push(this);
      installFmbMove();
      this._fmbRadius = fmbSizePx(this) / 2;
      this._fmbPad  = fmbPadPx(this);
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
         "auto" default in the data-aura-revealed rule) on conceal. */
      var updateScrollPadding = function (self, revealed) {
        var root = self._scrollRoot || document.scrollingElement || document.documentElement;
        root.style.scrollPaddingBlockEnd = revealed ? self.offsetHeight + 'px' : '';
        /* #787: publish/remove the live height token. */
        if (revealed) {
          self.style.setProperty('--aura-footer-height-current', self.offsetHeight + 'px');
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
         data-aura-revealed (set below). */
      this._onFocusIn = function () {
        self.setAttribute(REVEALED_ATTR, '');
        updateScrollPadding(self, true);
        if (self._liveRegion) self._liveRegion.textContent = 'Footer content available';
      };
      this._onFocusOut = function (ev) {
        /* Only conceal if focus is moving OUT of the footer entirely. */
        if (!self.contains(ev.relatedTarget)) {
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
            /* Do not conceal if focus is currently inside the footer (#766). */
            if (!self.contains(document.activeElement)) {
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
      this._fmbRadius = this._fmbPad = this._fmbExpand = 0;
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
