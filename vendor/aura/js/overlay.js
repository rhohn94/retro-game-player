/* ==========================================================================
   Aura — anchored-overlay primitive.

   The spatial + lifecycle half of a floating popup, with NO keyboard model and
   NO ARIA opinion. It anchors an element below a trigger (flipping above when
   it would overflow the viewport), detaches it to <body> so it escapes
   overflow:hidden / stacking-context ancestors, runs the enter/exit animation,
   dismisses on the usual global gestures (outside-pointer, scroll, resize,
   window blur, Escape, focus leaving the panel), and returns focus to the
   opener on close.

   Why this exists: the context-menu engine (js/menu.js) historically coupled
   placement and dismissal to a *menuitem* keyboard model, which is wrong for the
   v1.3 pickers (datepicker grid, timepicker listbox, color-picker) — they are
   role="dialog" popups with their own 2-D / listbox key handling. Rather than
   fork the menu engine per picker, the shared spatial machinery lives here.
   menu.js now delegates BOTH its anchored geometry (Aura.overlay.placeAtAnchor)
   and its global-gesture dismissal (Aura.overlay.createDismisser) here, so the
   *menuitem keyboard model + submenu stack* is the only menu-specific concern
   left (#333). Each picker layers its own keyboard controller on top of
   Aura.overlay.open/close.

   Single active overlay at a time (pickers do not nest); opening a second
   instantly closes the first. See docs/design/datepicker-design.md
   (overlay-integration decision) and context-menu-design.md.

   Load order: core.js → overlay.js → menu.js → (pickers).
   ========================================================================== */
(function () {
  "use strict";
  /* SSR guard (#416): no-op outside the browser so SSR/RSC frameworks can
     evaluate this module (and the dist bundle) in Node without crashing. */
  if (typeof window === "undefined" || typeof document === "undefined") return;
  var Aura = window.Aura;
  if (!Aura) return;

  var VIEWPORT_PAD = 8;               // min gap from any viewport edge (px)
  var ANCHOR_GAP = 4;                 // gap between the panel and its anchor (px)
  var CLOSE_FALLBACK_BUFFER_MS = 100; // wait past the CSS exit duration for the fallback timer
  var EXIT_DUR_PROP = "--aura-overlay-dur-out"; // CSS <time> the exit timer reads

  var active = null; // the open overlay record, or null. { panel, opener, onClose }

  /* ---- Geometry -------------------------------------------------------- */
  function viewportWidth() { return window.innerWidth; }
  function viewportHeight() { return window.innerHeight; }

  /* Position `panel` (already display:block) anchored to `rect`, flipping above
     and clamping horizontally so it always stays within the padded viewport.
     Records the transform-origin so the enter/exit scale grows from the anchored
     corner. `originProp` lets a consumer that animates from a differently-named
     custom property (the menu engine's --aura-menu-origin) reuse this geometry. */
  /* `gap` (optional, px) overrides the default anchor gap so a consumer whose
     spacing is token-driven (the nav-header panels' --aura-space-2) shares the
     flip/clamp geometry without inheriting the default 4px gap (#393). */
  function placeAtAnchor(panel, rect, originProp, gap) {
    var anchorGap = typeof gap === "number" ? gap : ANCHOR_GAP;
    var box = panel.getBoundingClientRect();
    var left = rect.left;
    var top = rect.bottom + anchorGap;
    var originY = "top";

    if (left + box.width > viewportWidth() - VIEWPORT_PAD) {
      left = Math.max(VIEWPORT_PAD, rect.right - box.width);
    }
    left = Math.min(Math.max(VIEWPORT_PAD, left), viewportWidth() - VIEWPORT_PAD - box.width);

    if (top + box.height > viewportHeight() - VIEWPORT_PAD) {
      top = Math.max(VIEWPORT_PAD, rect.top - anchorGap - box.height);
      originY = "bottom";
    }
    /* Final clamp keeps the panel within the padded viewport even when neither
       side fully fits (very tall panel / anchor near an edge). */
    top = Math.min(Math.max(VIEWPORT_PAD, top), Math.max(VIEWPORT_PAD, viewportHeight() - VIEWPORT_PAD - box.height));

    panel.style.left = left + "px";
    panel.style.top = top + "px";
    panel.style.setProperty(originProp || "--aura-overlay-origin", originY + " left");
  }

  /* ---- Mobile bottom-sheet presentation (v1.6) ------------------------- *
     On a coarse pointer or a viewport narrower than --aura-bp-mobile, an
     anchored overlay is far better presented as a bottom sheet than flipped
     around a near-edge trigger. The decision is recomputed per open() so
     rotating / resizing between opens switches presentation. CSS owns all sheet
     geometry (css/mobile.css); placeAtAnchor is skipped in this mode.        */
  function wantsSheet(opts) {
    if (opts && opts.sheet === false) return false;     // explicit opt-out
    /* A degenerate (zero-width) viewport is never a real mobile device — it is
       an unlaid-out / headless / detached state. `(max-width: 40rem)` matches
       at width 0, which would force sheet mode and collapse the sheet to ~0px,
       making it render invisibly (presents as "the menu does not open"). Guard
       it so anchored placement is used until the viewport has real geometry. */
    if (window.innerWidth <= 0) return false;
    if (Aura.env.coarsePointer()) return true;
    var bp = getComputedStyle(document.documentElement)
      .getPropertyValue("--aura-bp-mobile").trim() || "40rem";
    return window.matchMedia("(max-width: " + bp + ")").matches;
  }

  /* Insert a dismiss scrim behind the sheet; returns the scrim element. */
  function addScrim() {
    var scrim = document.createElement("div");
    scrim.className = "aura-overlay-scrim";
    document.body.appendChild(scrim);
    return scrim;
  }
  /* Remove a scrim, animating it out unless instant / reduced motion. */
  function removeScrim(scrim, instant) {
    if (!scrim) return;
    if (instant || Aura.env.reducedMotion()) { scrim.remove(); return; }
    scrim.classList.add("aura-overlay-scrim--closing");
    var dur = Aura.parseDuration(
      getComputedStyle(scrim).getPropertyValue("--aura-overlay-dur-out")
    );
    setTimeout(function () { scrim.remove(); }, dur + CLOSE_FALLBACK_BUFFER_MS);
  }

  /* ---- Detach / restore ------------------------------------------------ */
  function detachToBody(panel) {
    panel.__auraOverlayHome = { parent: panel.parentNode, next: panel.nextSibling };
    document.body.appendChild(panel);
  }
  function restoreHome(panel) {
    var home = panel.__auraOverlayHome;
    if (home && home.parent) home.parent.insertBefore(panel, home.next);
    panel.__auraOverlayHome = null;
  }

  /* ---- Close ----------------------------------------------------------- */
  /* Final DOM cleanup; runs once per close (after the exit animation, or
     immediately under reduced motion / instant close). */
  function finishClose(panel) {
    panel.classList.remove("aura-overlay--open");
    panel.classList.remove("aura-overlay--closing");
    panel.classList.remove("aura-overlay--sheet");
    panel.style.left = "";
    panel.style.top = "";
    panel.style.removeProperty("--aura-overlay-origin");
    restoreHome(panel);
  }

  /* Abort an in-flight exit animation so the panel can be re-opened cleanly.
     Invalidates the pending settle() via its token and snaps the panel to a
     fully-closed state — without this, a stale flag would block the next
     close() and the orphaned timer would later tear down the re-opened panel. */
  function cancelClose(panel) {
    if (!panel._auraOverlayClosing) return;
    if (panel._auraOverlayCloseToken) panel._auraOverlayCloseToken.cancelled = true;
    panel._auraOverlayClosing = false;
    panel._auraOverlayCloseToken = null;
    finishClose(panel);
  }

  /* Close the given panel. `instant` skips the exit animation (used when a new
     overlay supersedes this one). Returns focus to the opener and fires the
     consumer's onClose callback after the panel is fully torn down. */
  function close(panel, instant) {
    if (!panel || !active || active.panel !== panel) return;
    if (panel._auraOverlayClosing) return;

    var record = active;
    active = null;
    teardownDismissal(panel, record);

    function done() {
      finishClose(panel);
      removeScrim(record.scrim, instant);
      panel._auraOverlayClosing = false;
      panel._auraOverlayCloseToken = null;
      if (record.opener && typeof record.opener.focus === "function") {
        record.opener.focus({ preventScroll: true });
      }
      if (typeof record.onClose === "function") record.onClose();
    }

    if (instant || Aura.env.reducedMotion()) { done(); return; }

    panel._auraOverlayClosing = true;
    panel.classList.add("aura-overlay--closing");

    var token = { cancelled: false };
    panel._auraOverlayCloseToken = token;

    var dur = Aura.parseDuration(
      getComputedStyle(panel).getPropertyValue(EXIT_DUR_PROP)
    );
    var finished = false;
    function onAnimEnd(e) {
      if (e.target !== panel) return;
      settle();
    }
    // settle() detaches the animationend listener on EVERY path — whether the
    // animation fired, the setTimeout fallback won, or the close was cancelled
    // by a re-open. Previously only the animationend path removed it, so when
    // the fallback (or a cancel) settled first the handler leaked and could fire
    // later on a reused panel node (#59). The fallback timeout always runs, so
    // the listener is guaranteed to be detached even on the cancel path.
    function settle() {
      if (finished) return;
      finished = true;
      panel.removeEventListener("animationend", onAnimEnd);
      if (token.cancelled) return;
      done();
    }
    panel.addEventListener("animationend", onAnimEnd);
    setTimeout(settle, dur + CLOSE_FALLBACK_BUFFER_MS);
  }

  /* ---- Open ------------------------------------------------------------ */
  /* Open `panel` anchored to `anchorEl`. Options:
       opener   — element focused when the overlay closes (defaults to anchorEl)
       onClose  — callback fired after teardown (sync aria-expanded, etc.)
     Closes any currently-open overlay first. The panel must carry the
     .aura-overlay class (display toggling + animation live in css/overlay.css). */
  function open(panel, anchorEl, opts) {
    if (!panel || !anchorEl) throw new Error("[Aura.overlay] open requires a panel and an anchor element");
    opts = opts || {};

    if (active) close(active.panel, true); // supersede instantly, no flicker
    cancelClose(panel); // re-open cleanly if this panel was mid-close

    detachToBody(panel);
    panel.classList.add("aura-overlay--open");

    /* Sheet vs. anchored decision, recomputed per open. */
    var scrim = null;
    if (wantsSheet(opts)) {
      panel.classList.add("aura-overlay--sheet");
      scrim = addScrim();
    } else {
      placeAtAnchor(panel, anchorEl.getBoundingClientRect());
    }

    active = {
      panel: panel,
      opener: opts.opener || anchorEl,
      onClose: opts.onClose || null,
      scrim: scrim,
      // Unique per-open token: setupDismissal's deferred attach is validated
      // against this rather than panel identity, so a fast open→close→reopen of
      // the SAME panel can't have a stale timer attach for (or reject) the wrong
      // open — each open is its own instance (#60).
      token: {}
    };
    setupDismissal(active.token);
  }

  /* ---- Shared global-gesture dismisser --------------------------------- *
     The canonical "dismiss a floating popup on the usual global gestures"
     controller — outside-pointer, ancestor/page scroll, resize, and window
     blur. Factored out of open()'s own lifecycle so any consumer that runs its
     OWN open/close lifecycle (the context-menu engine's submenu stack) reuses
     the identical gesture set instead of duplicating these listeners. The
     consumer supplies the policy via callbacks:
       onDismiss   — invoked when a dismiss gesture fires (consumer closes)
       isInside(t) — true when target t is within the popup(s) (no dismiss)
       isOnOpener(t) — true when t is the trigger (it owns the toggle; no dismiss)
       pointer    — when false, the outside-pointer listener is omitted (a
                    consumer whose outside-press dismissal is fused with its own
                    trigger-toggle resolution keeps that path; only scroll /
                    resize / blur are shared). Defaults to true.
     Returns { arm, disarm }. arm() defers the attach by a tick so the same
     click/keydown that opened the popup does not immediately dismiss it; the
     deferred attach is validated against `armed` so a disarm before the tick
     elapses cancels it cleanly.

     #1038 — native mousedown focus-shift vs. focus-return: for a genuine
     mouse click, the browser fires pointerdown → mousedown → (default
     action: shift focus, typically to <body> when the clicked target isn't
     natively focusable) → mouseup → click. onPointerDown runs during the
     pointerdown phase, BEFORE mousedown's default action — so when a
     consumer configures a real focus-return target (passes `isOnOpener`) and
     its onDismiss chain calls opener.focus() synchronously from here, that
     focus call happens first and is immediately undone by the native
     mousedown default action. Traced and confirmed in
     tests/layout/sidebar-fmb.spec.js's follow-up notes: deferring the
     refocus to a microtask/rAF does NOT reliably win this race (a
     MutationObserver-microtask-deferred refocus was observed losing to the
     native blur too), because the native default action can run before a
     microtask checkpoint. The robust fix is to suppress the native action
     directly: arm a same-gesture, capture-phase `mousedown` listener that
     calls preventDefault() — cancelable per spec, and the standard technique
     for keeping focus put across a click (the same trick rich-text toolbar
     buttons use to avoid stealing the editor's selection). Scoped tightly so
     it never touches a dismisser with no focus-return target configured, and
     to mouse/pen only — touch's compatibility mousedown lands long after
     dismissal has already settled and was already unaffected (confirmed by
     the issue's own tracing), so it stays untouched. Keyboard dismissal
     (Escape) never runs through pointer handling at all, so it too is
     unaffected. */
  function createDismisser(opts) {
    var onDismiss = opts.onDismiss;
    var isInside = opts.isInside || function () { return false; };
    var isOnOpener = opts.isOnOpener || function () { return false; };
    var usePointer = opts.pointer !== false;
    /* A real (non-default) isOnOpener means the consumer actually has an
       opener to return focus to on dismiss — only then is the native-blur
       race in play, and only then do we touch mousedown at all. */
    var hasFocusReturn = typeof opts.isOnOpener === "function";
    var armed = false;

    /* One-shot guard: suppress the native mousedown default action (the
       focus-shift/blur) for the SAME gesture that just dismissed via
       onPointerDown. Added on demand (not for the popup's whole open
       duration) and always torn down — either when its mousedown fires, or,
       defensively, after FOCUS_GUARD_FALLBACK_MS if the paired mousedown
       never arrives (e.g. a cancelled pointer), so it can never leak onto an
       unrelated later click. The fallback is a generous macrotask delay, not
       0ms: pointerdown and mousedown are two separate native events, and
       under real-world load (a busy machine, several overlays' worth of
       concurrent test/automation traffic) the gap between them — while still
       reliably one same-gesture synchronous dispatch chain in practice — is
       safer treated as "eventually", not "immediately"; a bare setTimeout(0)
       risks firing in a genuine gap and clearing the guard a moment before
       its own paired mousedown lands, reopening the exact bug this exists to
       close. Bounding the leak window at a few hundred ms instead of one
       macrotask trades an infinitesimal, purely cosmetic risk (an unrelated
       mousedown within that window losing a focus-shift default it likely
       didn't need anyway) for eliminating a real one. */
    var FOCUS_GUARD_FALLBACK_MS = 400;
    var focusGuard = null;
    function clearFocusGuard() {
      if (!focusGuard) return;
      clearTimeout(focusGuard.timer);
      document.removeEventListener("mousedown", focusGuard.handler, true);
      focusGuard = null;
    }
    function armNativeFocusGuard() {
      clearFocusGuard(); // defensive: never double-arm
      function handler(e) {
        clearFocusGuard();
        e.preventDefault();
      }
      focusGuard = { handler: handler, timer: setTimeout(clearFocusGuard, FOCUS_GUARD_FALLBACK_MS) };
      document.addEventListener("mousedown", handler, true);
    }

    function onPointerDown(e) {
      if (isInside(e.target)) return;           // pointer inside the popup
      if (isOnOpener(e.target)) return;         // on the trigger (it toggles)
      if (hasFocusReturn && e.pointerType !== "touch") armNativeFocusGuard();
      onDismiss();
    }
    function onScroll(e) {
      /* Scrolling the popup's own content (a tall sheet/listbox) must not
         dismiss it — only an ancestor/page scroll repositions the anchor. */
      var t = e && e.target;
      if (t && t.nodeType === 1 && isInside(t)) return;
      onDismiss();
    }
    function onResize() { onDismiss(); }
    function onBlur() { onDismiss(); }

    return {
      arm: function () {
        armed = true;
        setTimeout(function () {
          if (!armed) return;
          if (usePointer) document.addEventListener("pointerdown", onPointerDown, true);
          window.addEventListener("scroll", onScroll, true);
          window.addEventListener("resize", onResize);
          window.addEventListener("blur", onBlur);
        }, 0);
      },
      disarm: function () {
        armed = false;
        /* Deliberately does NOT clearFocusGuard() here. disarm() is exactly
           what a consumer's own onDismiss chain calls to tear itself down
           (e.g. js/sidebar.js's releasePinned(), invoked from a
           MutationObserver watching the pinned attribute onDismiss just
           cleared) — and that MutationObserver callback is a MICROTASK that
           runs BEFORE the native mousedown even fires (confirmed via
           tracing, see the #1038 comment above createDismisser). Clearing
           the guard here raced it: disarm() would tear down the very guard
           armed a moment ago for THIS gesture before it ever saw its
           mousedown, reopening the native-blur bug. The guard cleans itself
           up on its own (its mousedown handler, or the defensive
           FOCUS_GUARD_FALLBACK_MS fallback), so disarm() doesn't need to
           touch it. */
        if (usePointer) document.removeEventListener("pointerdown", onPointerDown, true);
        window.removeEventListener("scroll", onScroll, true);
        window.removeEventListener("resize", onResize);
        window.removeEventListener("blur", onBlur);
      }
    };
  }

  /* ---- Global dismissal (the built-in single-overlay lifecycle) -------- */
  function onKeyDown(e) {
    if (active && e.key === "Escape") { e.preventDefault(); close(active.panel); }
  }
  /* Focus leaving the panel entirely (e.g. Tab past the last control) closes it.
     Deferred so the check sees the settled activeElement, not the transient blur. */
  function onFocusOut() {
    if (!active) return;
    var panel = active.panel;
    setTimeout(function () {
      if (!active || active.panel !== panel) return;
      var here = document.activeElement;
      if (panel.contains(here)) return;
      if (active.opener && active.opener.contains(here)) return;
      close(panel);
    }, 0);
  }

  function setupDismissal(openToken) {
    /* Gesture dismissal (pointer/scroll/resize/blur) rides the shared
       dismisser; Escape + focus-out are part of THIS lifecycle's keyboard/focus
       contract and stay local. The dismisser's arm/disarm is deferred + token
       safe, matching the prior inline behaviour (#60). */
    var record = active;
    record.dismisser = createDismisser({
      onDismiss: function () { if (active && active.token === openToken) close(active.panel); },
      isInside: function (t) { return record.panel.contains(t); },
      isOnOpener: function (t) { return !!record.opener && record.opener.contains(t); }
    });
    record.dismisser.arm();

    setTimeout(function () {
      if (!active || active.token !== openToken) return;
      var panel = active.panel;
      document.addEventListener("keydown", onKeyDown, true);
      panel.addEventListener("focusout", onFocusOut);
      panel.__auraOverlayFocusOut = onFocusOut;
    }, 0);
  }
  function teardownDismissal(panel, record) {
    if (record && record.dismisser) { record.dismisser.disarm(); record.dismisser = null; }
    document.removeEventListener("keydown", onKeyDown, true);
    if (panel && panel.__auraOverlayFocusOut) {
      panel.removeEventListener("focusout", panel.__auraOverlayFocusOut);
      panel.__auraOverlayFocusOut = null;
    }
  }

  /* ---- Public API ------------------------------------------------------ */
  Aura.overlay = {
    open: open,
    close: function (panel) { close(panel, false); },
    placeAtAnchor: placeAtAnchor,
    isOpen: function (panel) { return !!active && active.panel === panel; },
    /* Sheet helpers, shared so the context-menu engine (which runs its own
       stack-based lifecycle) presents as a bottom sheet on mobile too, without
       duplicating the breakpoint/scrim logic. */
    wantsSheet: wantsSheet,
    addScrim: addScrim,
    removeScrim: removeScrim,
    /* Shared global-gesture dismisser, so a consumer running its own
       open/close lifecycle (the context-menu engine's submenu stack) reuses the
       canonical outside-pointer / scroll / resize / blur gesture set instead of
       duplicating those listeners. See createDismisser. */
    createDismisser: createDismisser
  };
})();
