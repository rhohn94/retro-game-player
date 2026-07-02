/* ==========================================================================
   Aura — toast notifications.

   Transient, stackable notifications with auto-dismiss timers, pause-on-hover,
   ARIA live-region announcements, and reduced-motion support. Built on the
   elevation system and icon registry. All visual values are CSS-driven via
   tokens or component-scoped --aura-toast-* vars (configurable-aesthetics).

   Public API:
     Aura.toast(message)                  — shorthand, default options
     Aura.toast({ message, variant,       — full options object
                  duration, onClose })
     Returns the created toast Element.

   Load order: core.js → … → toast.js (no other Aura deps at runtime beyond
   core.js — icon() and env.reducedMotion() come from there).
   See docs/design/toast-design.md.
   ========================================================================== */
(function () {
  "use strict";
  /* SSR guard (#416): no-op outside the browser so SSR/RSC frameworks can
     evaluate this module (and the dist bundle) in Node without crashing. */
  if (typeof window === "undefined" || typeof document === "undefined") return;

  var Aura = window.Aura;
  if (!Aura) return;

  /* ---- Constants -------------------------------------------------------- */

  /* Default auto-dismiss duration (ms). Override with { duration: N } or
     set --aura-toast-duration on :root (CSS handles animation timing;
     this JS default governs the countdown timer only). */
  var DEFAULT_DURATION = 4000;

  /* Variant → icon name (all from the built-in Feather registry). */
  var VARIANT_ICONS = {
    info:         "info",
    success:      "check",
    warning:      "zap",
    danger:       "x",
    notification: "bell"
  };

  /* Variant → live-region politeness (#688). Time-sensitive variants (danger,
     warning) announce ASSERTIVELY so a screen reader interrupts in-progress
     speech — a polite announcement queues behind ongoing speech and the toast
     can auto-dismiss (DEFAULT_DURATION) before the queue drains, so a critical
     error may never be spoken. Table-driven (co-located with VARIANT_ICONS),
     no per-variant branch; variants absent here default to polite. */
  var VARIANT_POLITENESS = {
    danger:  "assertive",
    warning: "assertive"
  };
  function politenessFor(variant) {
    return VARIANT_POLITENESS[variant] || "polite";
  }

  /* Delay (ms) before writing to the aria-live region so the DOM settles
     and screen readers pick up the insertion as a new announcement. */
  var ANNOUNCE_DELAY = 50;

  /* How long the announced text lingers in the live region before it is
     cleared, so the same message can be re-announced later. */
  var LIVE_REGION_CLEAR_MS = 1000;

  /* Fallback (ms) to detach a toast if its exit transitionend never fires
     (e.g. in a display:none subtree). */
  var EXIT_FALLBACK_MS = 500;

  /* ---- Stack & live-region bootstrap ------------------------------------ */

  var _stack = null;   // <div data-aura-toast-stack>
  var _live  = {};     // politeness → its <div aria-live> region (#688)
  var _queue = [];     // messages enqueued before DOMContentLoaded

  /* Build (or return existing) the fixed stack container. Guarded so HTMX
     swaps that re-trigger init never create a second stack. */
  function getStack() {
    if (_stack && _stack.isConnected) return _stack;
    _stack = document.querySelector("[data-aura-toast-stack]");
    if (_stack) return _stack;
    _stack = document.createElement("div");
    _stack.setAttribute("data-aura-toast-stack", "");
    _stack.setAttribute("role", "region");
    _stack.setAttribute("aria-label", "Notifications");
    document.body.appendChild(_stack);
    return _stack;
  }

  /* Build (or return existing) the visually-hidden aria-live region for a given
     politeness ("polite" | "assertive"). Two distinct regions exist so danger/
     warning toasts can interrupt while info/success stay polite (#688); each is
     id'd by politeness and cached. The polite region keeps its historical id
     (#aura-toast-live) so existing references/tests stay valid. */
  function getLive(politeness) {
    var level = politeness === "assertive" ? "assertive" : "polite";
    if (_live[level] && _live[level].isConnected) return _live[level];
    var id = level === "assertive" ? "aura-toast-live-assertive" : "aura-toast-live";
    var region = document.getElementById(id);
    if (!region) {
      region = document.createElement("div");
      region.id = id;
      region.setAttribute("aria-live", level);
      region.setAttribute("aria-atomic", "true");
      region.setAttribute("aria-relevant", "additions text");
      /* Visually hidden but reachable by AT (clip-path technique). */
      region.style.cssText =
        "position:absolute;width:1px;height:1px;padding:0;overflow:hidden;" +
        "clip:rect(0,0,0,0);white-space:nowrap;border:0;";
      document.body.appendChild(region);
    }
    _live[level] = region;
    return region;
  }

  /* ---- Toast creation --------------------------------------------------- */

  /* Build the DOM node for a single toast. */
  function buildToast(opts) {
    var variant  = opts.variant || "info";
    var iconName = VARIANT_ICONS[variant] || "info";
    var message  = opts.message || "";

    /* Outer wrapper: glass surface at elevation 4. */
    var el = document.createElement("div");
    el.className = "aura-toast aura-surface";
    el.setAttribute("data-aura-elevation", "4");
    el.setAttribute("data-variant", variant);
    /* The visible toast is NOT an announcement channel: the dedicated
       #aura-toast-live region (getLive) owns announcements and supports the
       clear-and-rewrite re-announce path. Marking the node role="presentation"
       avoids the implicit role=status live region announcing the same text a
       second time (#457). */
    el.setAttribute("role", "presentation");

    /* Icon column. */
    var iconEl = Aura.icon(iconName, "aura-toast__icon");
    iconEl.setAttribute("data-variant", variant);

    /* Message. */
    var msgEl = document.createElement("span");
    msgEl.className = "aura-toast__message";
    msgEl.textContent = message;

    /* Close button. */
    var closeEl = document.createElement("button");
    closeEl.type = "button";
    closeEl.className = "aura-toast__close aura-glow";
    closeEl.setAttribute("aria-label", "Dismiss notification");
    closeEl.appendChild(Aura.icon("x"));

    el.appendChild(iconEl);
    el.appendChild(msgEl);
    el.appendChild(closeEl);
    return el;
  }

  /* ---- Timer management ------------------------------------------------- */

  /* Start (or resume) the auto-dismiss countdown on a toast element.
     Stores remaining time and timer ID as expando properties for clean
     pause/resume. Does nothing when duration is 0 (sticky). */
  function startTimer(el, remaining, onExpire) {
    if (!remaining || remaining <= 0) return;
    el.__aura_toast_start    = Date.now();
    el.__aura_toast_remain   = remaining;
    el.__aura_toast_timer    = setTimeout(onExpire, remaining);
  }

  function pauseTimer(el) {
    if (!el.__aura_toast_timer) return;
    clearTimeout(el.__aura_toast_timer);
    el.__aura_toast_timer  = null;
    /* Record how much time remains so resume picks up from here. */
    var elapsed = Date.now() - (el.__aura_toast_start || Date.now());
    el.__aura_toast_remain = Math.max(0, (el.__aura_toast_remain || 0) - elapsed);
  }

  function resumeTimer(el, onExpire) {
    if (el.__aura_toast_timer) return; // already running
    startTimer(el, el.__aura_toast_remain, onExpire);
  }

  /* ---- Enter / exit animation ------------------------------------------ */

  /* Kick off the entrance animation by toggling a CSS class.
     The CSS transition from .aura-toast (off-screen) → .aura-toast--visible
     (in-place) handles the actual movement. */
  function animateIn(el) {
    /* RAF ensures the initial state has been painted before we add the
       transition target class (avoids instant-jump on first frame). */
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        el.classList.add("aura-toast--visible");
      });
    });
  }

  /* Move focus off a toast that is about to be detached, but ONLY when focus
     currently lives inside that toast (a keyboard dismiss, not a pointer-elsewhere
     auto-expire). Mirrors the menu/overlay return-focus-to-a-survivor contract
     (#706, WCAG 2.4.3): prefer the next remaining toast's close button, else the
     previous one's, else the toast region, else document.body as a last resort —
     so a keyboard/AT user is never dropped to the top of the document. */
  function restoreFocusBeforeDetach(el) {
    var active = document.activeElement;
    if (!active || !el.contains(active)) return; // focus is elsewhere — don't steal it

    /* Scan following siblings, then preceding ones, for a live survivor toast
       and focus its close button. */
    function survivorClose(start, step) {
      for (var n = start; n; n = n[step]) {
        if (n.classList && n.classList.contains("aura-toast") && !n.__aura_toast_removing) {
          var btn = n.querySelector(".aura-toast__close");
          if (btn) return btn;
        }
      }
      return null;
    }
    var target = survivorClose(el.nextElementSibling, "nextElementSibling") ||
                 survivorClose(el.previousElementSibling, "previousElementSibling");
    if (target) { target.focus(); return; }

    /* No survivor toast: fall back to the toast region, else body. The region is
       given a momentary tabindex=-1 so it can receive programmatic focus. */
    var region = _stack && _stack.isConnected ? _stack : document.querySelector("[data-aura-toast-stack]");
    if (region) {
      region.setAttribute("tabindex", "-1");
      region.focus();
      return;
    }
    if (document.body) document.body.focus();
  }

  /* Remove a toast: play exit animation then detach from DOM. */
  function remove(el, callback) {
    if (el.__aura_toast_removing) return;
    el.__aura_toast_removing = true;

    /* Relocate focus BEFORE detach so a keyboard/AT user isn't dropped to <body>
       (#706). No-op unless focus is inside this toast. */
    restoreFocusBeforeDetach(el);

    /* Pause any running timer to avoid double-remove. */
    pauseTimer(el);
    el.classList.remove("aura-toast--visible");
    el.classList.add("aura-toast--exit");

    /* Run-once guard: transitionend and the EXIT_FALLBACK_MS safety net can
       both fire, but the node removal and the public onClose callback must run
       exactly once (#456). Mirrors the `done` guard in tabs.js / dialog.js. */
    var done = false;
    function cleanup() {
      if (done) return;
      done = true;
      el.removeEventListener("transitionend", onExitEnd);
      if (el.parentNode) el.parentNode.removeChild(el);
      if (typeof callback === "function") callback(el);
    }

    /* Only the exit movement (transform/opacity) ends the toast; a stray
       transition on a sub-property (glow, etc.) must not remove it early (#456). */
    function onExitEnd(e) {
      if (e.target !== el) return;
      if (e.propertyName !== "transform" && e.propertyName !== "opacity") return;
      cleanup();
    }

    if (Aura.env.reducedMotion()) {
      /* Skip the transition wait; remove after one frame. */
      requestAnimationFrame(cleanup);
    } else {
      el.addEventListener("transitionend", onExitEnd);
      /* Safety net: if transitionend never fires (e.g. display:none tree),
         fall back to a short timeout so the element is never stranded. */
      setTimeout(cleanup, EXIT_FALLBACK_MS);
    }
  }

  /* ---- Core enqueue function -------------------------------------------- */

  /* Insert + wire a toast. `el` may be a node already built (the pre-DOM-ready
     path builds it eagerly so Aura.toast can return the REAL element — #571);
     when omitted we build it here from opts. */
  function enqueue(opts, el) {
    if (!el) el = buildToast(opts);
    var duration = typeof opts.duration === "number" ? opts.duration : DEFAULT_DURATION;
    var onClose  = opts.onClose || null;

    var stack = getStack();
    stack.appendChild(el);

    /* Announce to screen readers after a brief settle delay. danger/warning
       route through the assertive region so they interrupt; others stay polite
       (#688). */
    var live = getLive(politenessFor(opts.variant));
    setTimeout(function () {
      live.textContent = opts.message || "";
      /* Clear after a moment so the same text can be re-announced later. */
      setTimeout(function () { live.textContent = ""; }, LIVE_REGION_CLEAR_MS);
    }, ANNOUNCE_DELAY);

    /* Entrance animation. */
    animateIn(el);

    /* Pause timer on hover / focus; resume on leave / blur. */
    function onExpire() { remove(el, onClose); }

    if (duration > 0) {
      el.addEventListener("mouseenter", function () { pauseTimer(el); });
      el.addEventListener("mouseleave", function () { resumeTimer(el, onExpire); });
      el.addEventListener("focus",      function () { pauseTimer(el); }, true);
      el.addEventListener("blur",       function () { resumeTimer(el, onExpire); }, true);
      startTimer(el, duration, onExpire);
    }

    /* Close button. */
    el.querySelector(".aura-toast__close").addEventListener("click", function () {
      remove(el, onClose);
    });

    return el;
  }

  /* ---- Flush enqueued pre-DOM-ready calls -------------------------------- */

  function flushQueue() {
    for (var i = 0; i < _queue.length; i++) {
      var q = _queue[i];
      enqueue(q.opts, q.el);
    }
    _queue = [];
  }

  /* ---- Public API ------------------------------------------------------- */

  /* Aura.toast(message | options) → Element */
  Aura.toast = function (input) {
    /* Normalise shorthand string to options object. */
    var opts = (typeof input === "string") ? { message: input } : (input || {});

    if (document.readyState === "loading") {
      /* Build the real toast node NOW and queue it (node + opts), so the
         element returned here is the SAME instance that flushQueue() inserts and
         animates after DOMContentLoaded. The documented contract — "returns the
         created toast Element" — must hold on the early-load path too, so a
         caller holding the return value (t.remove(), t.dataset) drives the real
         toast, not a throwaway detached <div> (#571). */
      var el = buildToast(opts);
      _queue.push({ opts: opts, el: el });
      return el;
    }
    return enqueue(opts);
  };

  /* Flush any toasts enqueued before the DOM was ready: build the stack/live
     region and insert+animate every queued node. Exposed so the early-load
     return contract (#571) is testable, and so an author who injects the runtime
     unusually late can drain the queue on demand. Idempotent — a no-op once the
     queue is empty. */
  Aura.toast.flush = function () {
    getStack();
    getLive("polite");
    getLive("assertive");
    flushQueue();
  };

  /* ---- Wire up after DOM is ready -------------------------------------- */

  Aura.ready(Aura.toast.flush);

})();
