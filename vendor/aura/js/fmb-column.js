/* Aura — <aura-fmb-column> FMB column (v3.527)
   A fixed top-bar that houses the nav, sidebar, and footer FMBs when all
   (or a configured minimum number of) chrome elements are stashed. Observes
   data-stashed (nav header), FMB state (sidebar), and footer FMB state.

   The element:
   - Renders three <div data-fmb-slot="nav|sidebar|footer"> slot containers.
   - Hides slots for absent chrome elements (display: none).
   - Sets [data-fmb-column-active] on itself when the required stash threshold
     is met (default: ALL present elements stashed; data-fmb-column-min overrides).
   - Sets --aura-fmb-column-active-offset-block-start on :root so page content
     shifts DOWN below the bar, plus the legacy --aura-fmb-column-active-width.
   - Horizontal bar is direction-agnostic: no RTL-specific token or CSS needed. */

(function () {
  "use strict";
  /* SSR guard (#416): no-op outside the browser so SSR/RSC frameworks can
     import the module tree without crashing on missing globals. This must be
     the IIFE's first statement — the previous `(function (Aura) {...}(window.Aura
     || (window.Aura = {})))` shape evaluated the `window.Aura` argument
     expression BEFORE the function body (and its guard) ever ran, crashing at
     parse/call time in window-less Node before the guard had a chance to
     short-circuit anything. */
  if (typeof window === "undefined" || typeof document === "undefined") return;

  var Aura = window.Aura || (window.Aura = {});

  /* Canonical FMB column size token (v3.541, #1019). tokens.css defines
     --aura-fmb-column-size as var(--aura-fmb-column-width, 96px), so legacy
     --aura-fmb-column-width overrides still flow through this value. */
  var FMB_WIDTH_VAL = "var(--aura-fmb-column-size, 96px)";
  var DOC_EL       = document.documentElement;
  var DOC_STYLE    = DOC_EL.style;
  var DOC_COMPUTED = getComputedStyle(DOC_EL);  /* live CSSStyleDeclaration — getPropertyValue() always reflects current :root computed values */

  /* Parse a raw data-fmb-column-min string into a valid integer or null.
     null → null (absent attribute); non-finite or < 1 → null (invalid); else → n. (#942, #968) */
  function parseMinVal(raw) {
    if (raw === null) return null;
    var n = parseInt(raw, 10);
    return (!Number.isFinite(n) || n < 1) ? null : n;
  }

  /* Read --aura-fmb-column-breakpoint from :root computed styles; fall back to 640px. (#900, #969) */
  function readBreakpoint() {
    return DOC_COMPUTED.getPropertyValue('--aura-fmb-column-breakpoint').trim() || '640px';
  }

  class AuraFmbColumn extends HTMLElement {
    constructor() {
      super();
      var self = this;
      /* --- stable per-element-lifetime bound functions (#945, #946) --- */
      this._syncBound = function syncBound() { self._rafId = null; self._sync(); }; /* pre-bound rAF callback; _rafId = null clears the spent ID so _scheduleSync() skips a stale cancelAnimationFrame (#910, #944) */
      /* _scheduleSyncBound inspects MO record types to set _presenceDirty (#956).
         MO always passes a non-empty records array; MQL uses _mqlChangeBound (#956). */
      this._scheduleSyncBound = function scheduleSyncBound(records) {
        for (var i = 0; i < records.length; i++) {
          if (records[i].type === 'childList') { self._presenceDirty = true; break; }  /* early-exit: once dirty, remaining records can't change the outcome */
        }
        self._scheduleSync();
      };
      /* Separate MQL change listener — viewport change may show/hide elements (#956). */
      this._mqlChangeBound = function mqlChangeBound() { self._presenceDirty = true; self._scheduleSync(); };
      this._checkHover = function checkHover() { /* pre-bound rAF cb for pointerout — avoids per-event closure allocation (#914, #945) */
        var stillIn = (self._navEl           && self._navEl.matches(':hover'))               ||
                      (self._sidebarChromeEl && self._sidebarChromeEl.matches(':hover'))       ||
                      (self._footerChromeEl  && self._footerChromeEl.matches(':hover'));
        if (!stillIn && self._hoverSlot !== null) {  /* _hoverSlot non-null implies _isActive — no explicit guard needed */
          self.removeAttribute('data-slot-hover');
          self._hoverSlot = null;
        }
      };
      this._checkFocus = function checkFocus() { /* pre-bound rAF cb for focusout — avoids per-event closure allocation (#914, #945) */
        var active = document.activeElement;
        var stillFocused = (self._navEl           && self._navEl.contains(active))            ||
                           (self._sidebarChromeEl && self._sidebarChromeEl.contains(active))   ||
                           (self._footerChromeEl  && self._footerChromeEl.contains(active));
        if (!stillFocused && self._hoverSlot !== null) {  /* _hoverSlot non-null implies _isActive — no explicit guard needed */
          self.removeAttribute('data-slot-hover');
          self._hoverSlot = null;
        }
      };
      this._hoverOver = function hoverOver(e) { /* pre-bound pointerover handler — avoids per-connect closure allocation (#946) */
        if (!self._isActive) return;
        var el;
        el = self._navEl;
        if (el && el.contains(e.target)) {
          if (self._hoverSlot !== 'nav') { self.setAttribute('data-slot-hover', 'nav'); self._hoverSlot = 'nav'; }
          return;
        }
        el = self._sidebarChromeEl;
        if (el && el.contains(e.target)) {
          if (self._hoverSlot !== 'sidebar') { self.setAttribute('data-slot-hover', 'sidebar'); self._hoverSlot = 'sidebar'; }
          return;
        }
        el = self._footerChromeEl;
        if (el && el.contains(e.target)) {
          if (self._hoverSlot !== 'footer') { self.setAttribute('data-slot-hover', 'footer'); self._hoverSlot = 'footer'; }
          return;
        }
        /* Pointer moved to a non-FMB element — clear immediately. */
        if (self._hoverSlot !== null) { self.removeAttribute('data-slot-hover'); self._hoverSlot = null; }
      };
      this._hoverOut = function hoverOut() { /* pre-bound pointerout handler — avoids per-connect closure allocation (#946) */
        if (!self._isActive) return;
        /* Skip rAF entirely when no slot is highlighted — _checkHover would bail
           immediately anyway, so the rAF allocation is wasted (#931). */
        if (self._hoverSlot !== null) requestAnimationFrame(self._checkHover);
      };
      this._focusIn = function focusIn(e) { /* pre-bound focusin handler — avoids per-connect closure allocation (#946) */
        if (!self._isActive) return;
        var el;
        el = self._navEl;
        if (el && el.contains(e.target)) {
          if (self._hoverSlot !== 'nav') { self.setAttribute('data-slot-hover', 'nav'); self._hoverSlot = 'nav'; }
          return;
        }
        el = self._sidebarChromeEl;
        if (el && el.contains(e.target)) {
          if (self._hoverSlot !== 'sidebar') { self.setAttribute('data-slot-hover', 'sidebar'); self._hoverSlot = 'sidebar'; }
          return;
        }
        el = self._footerChromeEl;
        if (el && el.contains(e.target)) {
          if (self._hoverSlot !== 'footer') { self.setAttribute('data-slot-hover', 'footer'); self._hoverSlot = 'footer'; }
          return;
        }
        /* Focus moved to a non-FMB element — clear immediately, matching _hoverOver fallthrough (#981). */
        if (self._hoverSlot !== null) { self.removeAttribute('data-slot-hover'); self._hoverSlot = null; }
      };
      this._focusOut = function focusOut() { /* pre-bound focusout handler — avoids per-connect closure allocation (#946) */
        if (!self._isActive) return;
        /* Skip rAF entirely when no slot is highlighted — _checkFocus would bail
           immediately anyway, so the rAF allocation is wasted (#931). */
        if (self._hoverSlot !== null) requestAnimationFrame(self._checkFocus);
      };
      /* --- mutable instance state (null until populated) --- */
      this._mo = null;
      this._mql = null;
      this._lastBreakpoint = null;   /* tracks last mql breakpoint value for reactive token updates (#900) */
      this._rafId = null;
      this._minCache = null;  /* cached parsed data-fmb-column-min; null = require all present elements (presentCount); updated in connectedCallback + attributeChangedCallback (#906, #962) */
      this._navEl         = null;   /* cached nav header presence ref; also serves as the slot hover ref — nav has no FMB-mode filtering (#956, #963) */
      this._sidebarEl     = null;   /* cached sidebar presence ref; hover ref is _sidebarChromeEl (null when not in FMB mode — unlike _navEl which has no FMB-mode filter) (#956) */
      this._footerEl      = null;   /* cached footer presence ref; hover ref is _footerChromeEl (null when not in FMB mode) (#956) */
      this._presenceDirty = true;   /* true → re-query on next _sync(); set on childList mutations (#956) */
      this._sidebarChromeEl = null;   /* direct chrome element refs for slot hover (#934) */
      this._footerChromeEl  = null;
      this._navSlot     = null;   /* cached slot div refs; populated in connectedCallback (#897) */
      this._sidebarSlot = null;
      this._footerSlot  = null;
      this._lastSlotLast = null;  /* tracks last slot with data-fmb-slot-last for idempotent DOM mutations (#902) */
      this._hoverSlot = null;  /* tracks current highlighted slot name for idempotency (#918) */
      this._isActive = false;  /* tracks activation state for O(1) fast-path guards (#919, #920) */
      this._lastLayout = null;  /* tracks last data-fmb-layout value for idempotency (#922) */
      this._navVisible     = null;  /* cached display value for nav slot (#924) */
      this._sidebarVisible = null;
      this._footerVisible  = null;
    }

    static get observedAttributes() { return ["data-fmb-column-min"]; }

    attributeChangedCallback(_name, _oldVal, newVal) {
      if (this.isConnected) {
        /* Use newVal directly — avoids a redundant getAttribute DOM read (#932). */
        this._minCache = parseMinVal(newVal);
        this._scheduleSync();  /* schedule (not direct _sync()) to run after pending mutations settle and coalesce rapid attribute changes (#879) */
      }
    }

    connectedCallback() {
      /* The column is purely decorative — hide it from AT unconditionally. */
      this.setAttribute("aria-hidden", "true");

      /* Render the three slot containers if not already present, then cache refs.
         On first connect, assign from the local creation vars to avoid 3 redundant
         querySelector calls (creation path); on reconnect, query the existing divs
         (else path). This eliminates 3 of 4 querySelector calls on the happy path (#935). */
      if (!this.querySelector('[data-fmb-slot="nav"]')) {
        var nav = document.createElement("div");
        nav.setAttribute("data-fmb-slot", "nav");
        nav.setAttribute("aria-hidden", "true");
        var sidebar = document.createElement("div");
        sidebar.setAttribute("data-fmb-slot", "sidebar");
        sidebar.setAttribute("aria-hidden", "true");
        var footer = document.createElement("div");
        footer.setAttribute("data-fmb-slot", "footer");
        footer.setAttribute("aria-hidden", "true");
        this.appendChild(nav);
        this.appendChild(sidebar);
        this.appendChild(footer);
        this._navSlot     = nav;
        this._sidebarSlot = sidebar;
        this._footerSlot  = footer;
      } else {
        this._navSlot     = this.querySelector('[data-fmb-slot="nav"]');
        this._sidebarSlot = this.querySelector('[data-fmb-slot="sidebar"]');
        this._footerSlot  = this.querySelector('[data-fmb-slot="footer"]');
      }

      /* Observe the document for attribute changes on the three chrome elements
         (data-stashed on nav header; data-aura-sidebar / FMB state on sidebar;
         data-aura-footer (FMB-mode eligibility) and data-aura-revealed (stash state) on footer).
         data-fmb-pinned is excluded:
         sidebar stash state is sidebarFmb itself — pin state is not read (#964, #966).
         The horizontal bar is direction-agnostic and does not re-activate on
         direction changes (#949), so `dir` is excluded from attributeFilter (#953).
         MO callbacks are coalesced via _scheduleSync() (rAF debounce — #879).
         childList mutations set _presenceDirty so _sync() re-queries presence (#956). */
      this._mo = new MutationObserver(this._scheduleSyncBound);
      this._mo.observe(DOC_EL, {
        attributes: true,
        childList: true,
        subtree: true,
        attributeFilter: ["data-stashed", "data-aura-revealed", "data-aura-sidebar", "data-aura-footer"]
      });

      /* Register pre-bound document event handlers for slot hover/focus tracking.
         All four event handlers are allocated in the constructor (#945, #946). */
      document.addEventListener('pointerover', this._hoverOver, { passive: true });
      document.addEventListener('pointerout',  this._hoverOut,  { passive: true });
      document.addEventListener('focusin',     this._focusIn,   { passive: true });
      document.addEventListener('focusout',    this._focusOut,  { passive: true });

      /* Mobile breakpoint: deactivate on narrow viewports.
         Uses _mqlChangeBound (not _scheduleSyncBound) so viewport changes
         set _presenceDirty before scheduling a sync (#956). */
      var bp = readBreakpoint();
      this._mql = window.matchMedia('(max-width: ' + bp + ')');
      this._mql.addEventListener('change', this._mqlChangeBound);
      this._lastBreakpoint = bp;   /* record initial value for reactive mql recreation (#900) */

      /* Cache data-fmb-column-min now (attribute may have been set before connect). */
      this._minCache = parseMinVal(this.getAttribute('data-fmb-column-min'));

      /* Sync immediately — direct _sync() call (not _scheduleSync()) so elements
         already stashed at connect time activate without a one-frame delay. */
      this._sync();
    }

    disconnectedCallback() {
      if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }  /* optimization: skip the rAF callback; _sync() guards on isConnected anyway (#944) */
      this._mql.removeEventListener('change', this._mqlChangeBound);
      this._mql = null;
      this._lastBreakpoint = null;
      document.removeEventListener('pointerover', this._hoverOver);
      document.removeEventListener('pointerout',  this._hoverOut);
      document.removeEventListener('focusin',     this._focusIn);
      document.removeEventListener('focusout',    this._focusOut);
      this._mo.disconnect();
      this._mo = null;
      /* Null slot div refs for GC hygiene (#897, #902). */
      this._navSlot = this._sidebarSlot = this._footerSlot = null;
      this._lastSlotLast = null;   /* slot div ref — GC hygiene (#902) */
      this._navVisible = this._sidebarVisible = this._footerVisible = null;  /* reset visibility cache (#924) */
      this._sidebarChromeEl = this._footerChromeEl = null;   /* null element refs for GC hygiene (#934) */
      /* Null presence cache and reset dirty flag for GC hygiene (#956). */
      this._navEl = this._sidebarEl = this._footerEl = null;
      this._presenceDirty = true;
      this._minCache = null;   /* reset cache; repopulated in connectedCallback on next connect (#906, #962) */
      if (this._isActive) this._deactivate();   /* guard: avoid CSSOM calls when never activated (#926) */
    }

    /* Coalesce MutationObserver callbacks within one animation frame so _sync()
       runs at most once per frame regardless of DOM mutation burst size (#879).
       Uses the pre-bound _syncBound callback (set in constructor) to avoid
       allocating a new closure on every call (#910, #944). _syncBound is always
       non-null (bound in constructor); _sync() guards on isConnected so a late
       post-disconnect rAF fires harmlessly (#944). */
    _scheduleSync() {
      if (this._rafId) cancelAnimationFrame(this._rafId);
      this._rafId = requestAnimationFrame(this._syncBound);
    }

    _sync() {
      /* Guard: late rAF after disconnectedCallback can still fire before _mo is torn
         down. isConnected is false once the element is removed from the document. */
      if (!this.isConnected) return;
      /* Reactive breakpoint: if --aura-fmb-column-breakpoint changed since the last
         _sync(), tear down the old mql listener and rebuild it for the new value (#900).
         A full rebuild is required because MediaQueryList is immutable — the media
         string cannot be changed after creation.
         readBreakpoint() calls getComputedStyle(...).getPropertyValue() which always
         returns a string in a real browser — no try/catch needed (#901). */
      var bp = readBreakpoint();
      if (bp !== this._lastBreakpoint) {
        this._mql.removeEventListener('change', this._mqlChangeBound);
        this._mql = window.matchMedia('(max-width: ' + bp + ')');
        this._mql.addEventListener('change', this._mqlChangeBound);
        this._lastBreakpoint = bp;
      }
      /* Mobile guard: column never activates on narrow viewports. */
      if (this._mql.matches) {
        if (this._isActive) this._deactivate();
        return;
      }

      /* Detect which chrome elements are present in the DOM.
         Cache presence refs and skip querySelector on attribute-only frames (#956).
         Presence is re-queried only when _presenceDirty is set: childList MO records
         and MQL viewport changes set _presenceDirty = true; attribute-only MO records
         leave it false so the cached refs are reused (#958). */
      var navEl, sidebarEl, footerEl;
      if (this._presenceDirty) {
        navEl     = document.querySelector("aura-nav-header, .aura-nav-header");
        sidebarEl = document.querySelector("[data-aura-sidebar]");
        footerEl  = document.querySelector("aura-footer, [data-aura-footer]");
        this._navEl     = navEl;
        this._sidebarEl = sidebarEl;
        this._footerEl  = footerEl;
        this._presenceDirty = false;
      } else {
        navEl     = this._navEl;
        sidebarEl = this._sidebarEl;
        footerEl  = this._footerEl;
      }

      /* FMB-mode eligibility: only elements in "reveal" (FMB) mode count toward
         slot visibility and the stash threshold. A sidebar/footer in "standard"
         panel mode is present in the DOM but not participating in the FMB column
         (#891). */
      var sidebarFmb = sidebarEl && sidebarEl.getAttribute('data-aura-sidebar') === 'reveal';
      var footerFmb  = footerEl  && footerEl.getAttribute('data-aura-footer')   === 'reveal';

      /* Count present FMB-mode elements using inline arithmetic. Computed here so
         the presentCount === 0 early exit (after the slot-visibility block) can skip
         the navStashed and footerStashed computations entirely (#937). */
      var presentCount = (navEl ? 1 : 0) + (sidebarFmb ? 1 : 0) + (footerFmb ? 1 : 0);

      /* Refresh slot hover element cache (v3.469, #883).
         Nav has no FMB-mode filtering — _navEl serves directly as the hover ref (#963). */
      this._sidebarChromeEl = sidebarFmb ? sidebarEl : null;
      this._footerChromeEl  = footerFmb  ? footerEl  : null;

      /* Update slot visibility based on FMB-mode presence.
         Cache the computed display value so repeated _sync() calls with unchanged
         visibility produce zero style.display writes (#924). */
      var navDisplay     = navEl      ? "" : "none";
      var sidebarDisplay = sidebarFmb ? "" : "none";
      var footerDisplay  = footerFmb  ? "" : "none";
      if (this._navVisible     !== navDisplay)     { this._navSlot.style.display     = navDisplay;     this._navVisible     = navDisplay;     }
      if (this._sidebarVisible !== sidebarDisplay) { this._sidebarSlot.style.display = sidebarDisplay; this._sidebarVisible = sidebarDisplay; }
      if (this._footerVisible  !== footerDisplay)  { this._footerSlot.style.display  = footerDisplay;  this._footerVisible  = footerDisplay;  }

      /* Mark the last visible slot with data-fmb-slot-last (v3.463).
         The CSS suppresses the ::after separator on that slot so no trailing
         separator appears at the bar's trailing edge when some slots are hidden.
         Idempotent: only mutate the DOM when the last-visible slot changes (#902).
         Uses the already-computed navDisplay/sidebarDisplay/footerDisplay locals
         instead of re-reading style.display from the DOM (#925). */
      var lastVisible = null;
      if (navDisplay     !== 'none') lastVisible = this._navSlot;
      if (sidebarDisplay !== 'none') lastVisible = this._sidebarSlot;
      if (footerDisplay  !== 'none') lastVisible = this._footerSlot;
      if (this._lastSlotLast !== lastVisible) {
        if (this._lastSlotLast) this._lastSlotLast.removeAttribute('data-fmb-slot-last');
        if (lastVisible)        lastVisible.setAttribute('data-fmb-slot-last', '');
        this._lastSlotLast = lastVisible;
      }

      /* Edge case: no FMB-mode elements at all → stay inactive. Early exit placed
         after the slot-last marking block (so slot visibility/last-slot state is
         updated for the empty case) but before the stash-boolean reads — when
         presentCount === 0, navStashed and footerStashed are trivially false and
         their computation is wasted (#937). */
      if (presentCount === 0) {
        if (this._isActive) this._deactivate();
        return;
      }

      /* Stash booleans — only computed when presentCount > 0 (#937).
         data-fmb-layout="tripartite" when all three FMB-mode elements are stashed or in their FMB-active state.
         Inline attribute checks avoid redundant getAttribute calls: sidebarFmb already
         confirms data-aura-sidebar="reveal"; footerFmb confirms data-aura-footer="reveal"
         (#913).

         sidebarFmb is purely about whether the sidebar is in reveal (FMB) mode —
         not about pinned state. The sidebar FMB slot stays in the column regardless of
         whether the panel is pinned open (data-fmb-pinned). When the panel is open,
         the column remains active so the FMB button stays visible in the bar. */
      var navStashed    = navEl     && navEl.hasAttribute('data-stashed');
      var footerStashed = footerFmb && !footerEl.hasAttribute('data-aura-revealed');   /* revealed = footer FMB expanded; absent = stashed */

      var layout = (navStashed && sidebarFmb && footerStashed) ? 'tripartite' : null;
      if (this._lastLayout !== layout) {
        if (layout) this.setAttribute('data-fmb-layout', layout);
        else        this.removeAttribute('data-fmb-layout');
        this._lastLayout = layout;
      }

      /* Stashed count using inline arithmetic.
         Elements in standard panel mode are excluded from the threshold (#891).
         Avoids allocating up to 3 objects per _sync() call (#908). */
      var stashedCount = (navStashed ? 1 : 0) + (sidebarFmb ? 1 : 0) + (footerStashed ? 1 : 0);

      /* Determine the required stash count.
         _minCache null → no data-fmb-column-min attr → require all present;
         otherwise clamp to presentCount so required never exceeds what's available (#906, #962, #965). */
      var required = this._minCache !== null ? Math.min(this._minCache, presentCount) : presentCount;

      /* Idempotency guard: only call _activate()/_deactivate() on genuine state
         transitions — avoids redundant style mutations on every MO observation.
         Horizontal bar is direction-agnostic: no direction check needed (#949). */
      if (stashedCount >= required) {
        if (!this._isActive) this._activate();
      } else {
        if (this._isActive)  this._deactivate();
      }
    }

    _activate() {
      /* Horizontal top-bar is direction-agnostic — no dir parameter needed (#949).
         Sets a single block-start offset token so content shifts DOWN below the bar. */
      this.setAttribute("data-fmb-column-active", "");
      this._isActive = true;
      DOC_STYLE.setProperty("--aura-fmb-column-active-offset-block-start", FMB_WIDTH_VAL);
      /* Keep the legacy token for back-compat with any existing consumers. */
      DOC_STYLE.setProperty("--aura-fmb-column-active-width", FMB_WIDTH_VAL);
    }

    _deactivate() {
      this.removeAttribute("data-fmb-column-active");
      this._isActive = false;
      if (this._hoverSlot !== null) {
        this.removeAttribute("data-slot-hover");
        this._hoverSlot = null;
      }
      if (this._lastLayout !== null) {
        this.removeAttribute("data-fmb-layout");
        this._lastLayout = null;
      }
      DOC_STYLE.removeProperty("--aura-fmb-column-active-offset-block-start");
      DOC_STYLE.removeProperty("--aura-fmb-column-active-width");
    }
  }

  Aura.define("aura-fmb-column", AuraFmbColumn);

})();
