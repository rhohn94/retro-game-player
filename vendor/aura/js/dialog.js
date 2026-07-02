/* ==========================================================================
   Aura — dialog engine.

   Modal and non-modal dialog panels with focus trap, ARIA dialog semantics,
   ESC dismissal, scrim-click dismissal, and a close-button affordance.

   Opened declaratively via [data-aura-dialog="#id"] on any element (delegated,
   never per-trigger binding at load — HTMX-safe). Closed via
   [data-aura-dialog-close] inside the panel, ESC, or scrim click.
   Programmatic API: Aura.dialog.open() / .close() / .closeAll().

   Exit animation: JS adds [data-aura-closing] while [open] is still set,
   awaits animationend on the panel (with a timeout fallback so a missing event
   never leaves the node stuck), then calls _finishDialogClose. Every dismiss
   path — ESC, scrim-click, close-button, and Aura.dialog.close() — routes
   through closeDialog(). Rapid open/close is safe: opening a mid-close dialog
   cancels the close immediately (via a token object) and re-enters normally.
   prefers-reduced-motion → instant close, no animation.

   Load order: core.js → theme.js → glow.js → element-base.js → menu.js → dialog.js
   See docs/design/dialog-design.md.
   ========================================================================== */
(function () {
  "use strict";
  /* SSR guard (#416): no-op outside the browser so SSR/RSC frameworks can
     evaluate this module (and the dist bundle) in Node without crashing. */
  if (typeof window === "undefined" || typeof document === "undefined") return;
  var Aura = window.Aura;
  if (!Aura) return;

  /* ---- State ------------------------------------------------------------- */
  var openDialogs = []; // array of { dialog, opener, scrim, modal } — newest last
  var scrimPool   = []; // reuse scrim divs to avoid allocation churn

  /* Extra wait past the CSS exit duration before the close fallback fires. */
  var CLOSE_FALLBACK_BUFFER_MS = 100;

  /* ---- Dismissal predicates (pure; unit-testable) ------------------------ */
  /* Whether ESC should dismiss `dialog`. persistent suppresses ESC entirely;
     a non-modal dialog opts out with [no-esc]; modal dialogs dismiss on ESC by
     default. Returns a boolean — no DOM mutation, safe to call standalone.     */
  function escDismisses(dialog) {
    if (dialog.hasAttribute("persistent")) return false;
    if (dialog.hasAttribute("non-modal") && dialog.hasAttribute("no-esc")) return false;
    return true;
  }
  /* Whether a scrim click should dismiss `dialog`. persistent and
     no-scrim-dismiss both suppress it; otherwise a modal dialog dismisses.     */
  function scrimDismisses(dialog) {
    if (dialog.hasAttribute("persistent")) return false;
    if (dialog.hasAttribute("no-scrim-dismiss")) return false;
    return true;
  }

  /* ---- Size → token mapping (pure; unit-testable) ------------------------ */
  /* Maps a size keyword to the component-scoped custom property that caps the
     panel width. Returns null for an unknown/absent size (default width used). */
  var SIZE_TO_VAR = {
    sm: "--aura-dialog-size-sm",
    md: "--aura-dialog-size-md",
    lg: "--aura-dialog-size-lg"
  };
  function sizeVar(size) {
    if (!size) return null;
    return Object.prototype.hasOwnProperty.call(SIZE_TO_VAR, size)
      ? SIZE_TO_VAR[size]
      : (size === "full" ? "full" : null);
  }

  /* ---- Focusable selector ------------------------------------------------ */
  /* The canonical focusable-elements selector lives in core (#327). */
  var FOCUSABLE_SEL = Aura.FOCUSABLE_SELECTOR;

  /* Visibility test for trap membership. offsetParent is null for any
     position:fixed element even when fully visible, so it wrongly excluded
     fixed focusables (a pinned action bar, a fixed close button) from the Tab
     order (#460). getClientRects().length covers fixed elements correctly; the
     visibility/display check excludes elements hidden by CSS (which still have
     client rects only when laid out — but be defensive against detached subtrees). */
  function isFocusableVisible(el, dialog) {
    if (el === dialog) return true;
    if (el.getClientRects().length === 0) return false;
    var cs = (el.ownerDocument.defaultView || window).getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none";
  }

  function focusableEls(dialog) {
    return Array.prototype.filter.call(
      dialog.querySelectorAll(FOCUSABLE_SEL),
      function (el) { return isFocusableVisible(el, dialog); }
    );
  }

  /* ---- Scrim pool -------------------------------------------------------- */
  function acquireScrim(dialog) {
    var scrim = scrimPool.length ? scrimPool.pop() : document.createElement("div");
    scrim.className = "aura-dialog-scrim";
    scrim.__auraDialog = dialog;
    return scrim;
  }

  function releaseScrim(scrim) {
    if (scrim.parentNode) scrim.parentNode.removeChild(scrim);
    scrim.__auraDialog = null;
    scrimPool.push(scrim);
  }

  /* ---- Decoration (idempotent) ------------------------------------------ */
  /* Called once on first open. Builds the .aura-dialog__header containing the
     close button and wires aria-labelledby to any heading inside the header.  */
  function decorate(dialog) {
    if (dialog.__auraDialogDecorated) return;
    dialog.__auraDialogDecorated = true;

    /* Find or create the header row ---------------------------------------- */
    var header = dialog.querySelector(":scope > .aura-dialog__header");
    if (!header) {
      header = document.createElement("div");
      header.className = "aura-dialog__header";

      /* If the dialog's first child is a heading, absorb it into the header
         so the title sits beside the close button.                            */
      var firstEl = dialog.firstElementChild;
      if (firstEl && /^H[1-6]$/.test(firstEl.tagName)) {
        dialog.removeChild(firstEl);
        firstEl.classList.add("aura-dialog__title");
        header.appendChild(firstEl);
      }

      /* Prepend header (insertBefore firstChild covers the case where the
         removed heading was the only child and dialog is now empty).         */
      if (dialog.firstChild) {
        dialog.insertBefore(header, dialog.firstChild);
      } else {
        dialog.appendChild(header);
      }
    }

    /* Wire aria-labelledby to first heading (if present) ------------------- */
    var heading = header.querySelector("h1, h2, h3, h4, h5, h6") ||
                  header.querySelector(".aura-dialog__title");
    if (heading) {
      if (!heading.id) heading.id = Aura.nextId("aura-dlg-title-");
      if (!dialog.getAttribute("aria-labelledby")) {
        dialog.setAttribute("aria-labelledby", heading.id);
      }
    }

    /* Inject close button using the icon registry (Aura.icon("x")) --------- */
    if (!header.querySelector(".aura-dialog__close")) {
      var btn = document.createElement("button");
      btn.className      = "aura-dialog__close aura-glow";
      btn.type           = "button";
      btn.setAttribute("aria-label", "Close dialog");
      btn.setAttribute("data-aura-dialog-close", "");
      btn.appendChild(Aura.icon("x"));
      header.appendChild(btn);
    }
  }

  /* ---- Modal background isolation (#546) -------------------------------- */
  /* A modal dialog promises AT that everything outside it is unavailable. The
     visual scrim alone does not back that promise: a screen-reader virtual
     cursor, find-in-page, and programmatic focus() can still reach background
     content. We make the promise real by inerting every sibling of the dialog
     (and of each ancestor, up to <body>) while a modal dialog is open, and by
     locking body scroll. Both are reference-counted so stacked modals only
     restore once the LAST modal closes; only the topmost dialog (and the chain
     from it to the root) stays interactive.

     `inert` (with an `aria-hidden` companion for engines lacking inert support)
     is applied to the off-path siblings; each touched node records whether it
     already carried the attribute so restore is exact and never clobbers an
     author-set value. */

  /* The set of nodes we have inerted for the current topmost modal, plus the
     saved body-scroll state. Recomputed each time the modal set changes so a
     stacked dialog re-targets the new topmost panel's off-path siblings. */
  var inertedNodes = [];          // [{ node, hadInert, hadAriaHidden }]
  var scrollLock   = null;        // { overflow, paddingRight, scrollY } | null
  var nativeInert  = ("inert" in HTMLElement.prototype);

  /* Mark `node` inert + aria-hidden, recording prior state for exact restore. */
  function inertNode(node) {
    var rec = {
      node: node,
      hadInert: node.hasAttribute("inert"),
      hadAriaHidden: node.hasAttribute("aria-hidden")
    };
    if (nativeInert) node.inert = true; else node.setAttribute("inert", "");
    node.setAttribute("aria-hidden", "true");
    inertedNodes.push(rec);
  }

  /* Restore every node we inerted to its pre-inert state. */
  function clearInert() {
    for (var i = 0; i < inertedNodes.length; i++) {
      var rec = inertedNodes[i];
      if (!rec.hadInert) {
        if (nativeInert) rec.node.inert = false;
        rec.node.removeAttribute("inert");
      }
      if (!rec.hadAriaHidden) rec.node.removeAttribute("aria-hidden");
    }
    inertedNodes = [];
  }

  /* Walk up from `el` to <body>, invoking fn(kid) for every off-path sibling at
     each level — skipping the on-path node and any dialog scrim (the scrim must
     stay visible and is itself non-focusable / aria-hidden by nature). The
     shared tree-walk behind inertBackgroundFor and isolateBackground
     (coding-standards §DRY). */
  function forEachOffPathSibling(el, fn) {
    var onPath = el;
    while (onPath && onPath !== document.body && onPath.parentNode) {
      var parent = onPath.parentNode;
      var kids = parent.children;
      for (var i = 0; i < kids.length; i++) {
        var kid = kids[i];
        if (kid === onPath) continue;
        if (kid.classList && kid.classList.contains("aura-dialog-scrim")) continue;
        fn(kid);
      }
      onPath = parent;
    }
  }

  /* Inert everything outside the path from <body> down to `dialog`. */
  function inertBackgroundFor(dialog) {
    forEachOffPathSibling(dialog, inertNode);
  }

  /* Lock background scroll, compensating for the scrollbar width so the page
     does not shift. The lock uses overflow:hidden (not position:fixed), so the
     page never scroll-jumps and no scroll-position restore is needed — we only
     stash the inline overflow/paddingRight to restore on unlock (#651). */
  function lockScroll() {
    if (scrollLock) return;
    var doc = document.documentElement;
    var body = document.body;
    var scrollbar = window.innerWidth - doc.clientWidth;
    scrollLock = {
      overflow: body.style.overflow,
      paddingRight: body.style.paddingRight
    };
    body.style.overflow = "hidden";
    if (scrollbar > 0) {
      var existing = parseFloat(getComputedStyle(body).paddingRight) || 0;
      body.style.paddingRight = (existing + scrollbar) + "px";
    }
  }

  function unlockScroll() {
    if (!scrollLock) return;
    var body = document.body;
    body.style.overflow = scrollLock.overflow;
    body.style.paddingRight = scrollLock.paddingRight;
    scrollLock = null;
  }

  /* The topmost OPEN modal entry, or null when none is modal. */
  function topmostModal() {
    for (var i = openDialogs.length - 1; i >= 0; i--) {
      if (openDialogs[i].modal) return openDialogs[i];
    }
    return null;
  }

  /* Re-apply background isolation after the open-dialog set changed: clear any
     existing inert, then (if a modal is open) inert the background of the
     topmost modal and ensure scroll is locked. With no modal open, also unlock
     scroll. Idempotent — safe to call after every open and close. */
  function refreshModalIsolation() {
    clearInert();
    var top = topmostModal();
    if (top) {
      inertBackgroundFor(top.dialog);
      lockScroll();
    } else {
      unlockScroll();
    }
  }

  /* ---- Open -------------------------------------------------------------- */
  function openDialog(dialog, opener) {
    if (!dialog) return;

    /* If mid-close, cancel the ongoing animation and re-open cleanly.
       Token cancellation stops the close's finish() from running after we
       restore state; the scrim is released so openDialog creates a fresh one
       with the entry animation. Removing [open] momentarily ensures the
       browser restarts the entry animation when we re-add it below.          */
    if (dialog._auraClosing) {
      if (dialog._auraCloseToken) dialog._auraCloseToken.cancelled = true;
      var stalescrim = dialog._auraClosingScrim;
      dialog._auraClosing      = false;
      dialog._auraCloseToken   = null;
      dialog._auraClosingScrim = null;
      dialog.removeAttribute("data-aura-closing");
      if (stalescrim) {
        stalescrim.removeAttribute("data-aura-closing");
        releaseScrim(stalescrim);
      }
      dialog.removeAttribute("open");  /* restart entry animation below */
      /* eslint-disable-next-line no-unused-expressions */
      void dialog.offsetHeight;        /* force reflow so animation restarts */
    }

    /* Tolerate re-opening the same dialog (no-op). */
    for (var i = 0; i < openDialogs.length; i++) {
      if (openDialogs[i].dialog === dialog) return;
    }

    decorate(dialog);

    var isModal = !dialog.hasAttribute("non-modal");

    /* ARIA ----------------------------------------------------------------- */
    dialog.setAttribute("open", "");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", isModal ? "true" : "false");
    if (!dialog.hasAttribute("tabindex")) dialog.setAttribute("tabindex", "-1");

    /* Scrim (modal only) --------------------------------------------------- */
    var scrim = null;
    if (isModal) {
      scrim = acquireScrim(dialog);
      /* Insert the scrim as the dialog's previous sibling — i.e. in the SAME
         stacking context as the panel — not on <body>. The panel sits one
         z-tier above the scrim (--aura-dialog-z = z-modal + 1), so within a
         shared context the panel paints above the scrim and stays crisp. A
         body-level scrim breaks this whenever the dialog lives inside a
         stacking-context ancestor (e.g. aura-app has isolation: isolate): the
         panel's z-index is then trapped inside that context while the scrim
         floats above the whole thing, painting its blur OVER the panel.
         Fixed positioning still spans the viewport here because aura-app sets
         no transform/filter (which would establish a containing block). */
      (dialog.parentNode || document.body).insertBefore(scrim, dialog);
    }

    var entry = { dialog: dialog, opener: opener || null, scrim: scrim, modal: isModal };
    openDialogs.push(entry);

    /* Back the aria-modal promise: inert the background + lock scroll while a
       modal dialog is open. Non-modal dialogs leave the page interactive (#546). */
    refreshModalIsolation();

    /* Move focus into the dialog — defer one frame so display: none → flex
       transition has settled and layout is measurable.                        */
    requestAnimationFrame(function () {
      var target = dialog.querySelector("[autofocus]") || focusableEls(dialog)[0] || dialog;
      target.focus({ preventScroll: true });
    });

    dialog.dispatchEvent(new CustomEvent("aura:dialog-open", {
      bubbles: true,
      detail: { dialog: dialog, opener: entry.opener }
    }));
  }

  /* ---- Close ------------------------------------------------------------- */
  /* _finishDialogClose: final DOM cleanup called after the exit animation
     (or immediately under reduced-motion / instant close).                   */
  function _finishDialogClose(dialog, scrim) {
    dialog.removeAttribute("data-aura-closing");
    dialog.removeAttribute("open");
    if (scrim) releaseScrim(scrim);
  }

  function closeDialog(dialog) {
    /* Guard: already mid-close — double-close is a no-op. */
    if (dialog._auraClosing) return;

    var idx = -1;
    for (var i = 0; i < openDialogs.length; i++) {
      if (openDialogs[i].dialog === dialog) { idx = i; break; }
    }
    if (idx === -1) return;

    /* Remove from stack immediately so Tab/ESC no longer route to this dialog
       while it is animating out.                                              */
    var entry = openDialogs.splice(idx, 1)[0];

    /* Recompute background isolation now that the stack changed: lift inert
       from the (formerly off-path) opener so focus can return to it, and
       unlock scroll once the last modal is gone (#546). Re-targets the new
       topmost modal's background for a stacked close. */
    refreshModalIsolation();

    /* Restore focus immediately (before the animation) for responsiveness.   */
    if (entry.opener && typeof entry.opener.focus === "function") {
      entry.opener.focus({ preventScroll: true });
    }

    dialog.dispatchEvent(new CustomEvent("aura:dialog-close", {
      bubbles: true,
      detail: { dialog: dialog }
    }));

    /* Instant close under reduced-motion — no animation, no stuck state.     */
    if (Aura.env.reducedMotion()) {
      _finishDialogClose(dialog, entry.scrim);
      return;
    }

    /* -- Animated close ---------------------------------------------------- */
    dialog._auraClosing      = true;
    dialog._auraClosingScrim = entry.scrim;

    /* Cancellation token: openDialog() sets .cancelled = true to abort this
       close mid-flight without a double-cleanup race.                        */
    var token = { cancelled: false };
    dialog._auraCloseToken = token;

    dialog.setAttribute("data-aura-closing", "");
    if (entry.scrim) entry.scrim.setAttribute("data-aura-closing", "");

    /* Read the token-driven duration for the timeout fallback.               */
    var dur = Aura.parseDuration(
      getComputedStyle(dialog).getPropertyValue("--aura-dialog-dur-out")
    );
    var scrim = entry.scrim;

    var done = false;
    function finish() {
      if (done || token.cancelled) return;
      done = true;
      dialog._auraClosing      = false;
      dialog._auraClosingScrim = null;
      dialog._auraCloseToken   = null;
      _finishDialogClose(dialog, scrim);
    }

    /* Primary: animationend on the panel itself (not bubbled child events).  */
    dialog.addEventListener("animationend", function handler(e) {
      if (e.target !== dialog) return;
      dialog.removeEventListener("animationend", handler);
      finish();
    });

    /* Fallback: timeout ensures no node is ever left stuck (e.g. if the
       browser cancels the animation due to a tab becoming inactive).         */
    setTimeout(finish, dur + CLOSE_FALLBACK_BUFFER_MS);
  }

  /* ---- Focus trap -------------------------------------------------------- */
  /* A single delegated keydown listener handles Tab and ESC for all open
     dialogs. Only the topmost dialog in the stack is active at any moment.   */
  document.addEventListener("keydown", function (e) {
    if (!openDialogs.length) return;
    var entry  = openDialogs[openDialogs.length - 1];
    var dialog = entry.dialog;

    /* ESC: dismiss --------------------------------------------------------- */
    if (e.key === "Escape") {
      e.preventDefault();
      /* escDismisses() centralises the rule: persistent suppresses ESC entirely
         (close() only) while the focus trap stays active — we still
         preventDefault so ESC cannot bubble out of the trapped dialog.         */
      if (escDismisses(dialog)) closeDialog(dialog);
      return;
    }

    /* Tab: trap focus within the panel ------------------------------------- */
    if (e.key !== "Tab") return;

    /* Only MODAL dialogs trap Tab. A non-modal dialog (aria-modal="false")
       explicitly keeps the rest of the page interactive, so Tab/Shift+Tab must
       flow naturally into and out of the panel — trapping it would strand
       keyboard users inside a non-blocking panel (#553). */
    if (dialog.hasAttribute("non-modal")) return;

    var els   = focusableEls(dialog);
    var first = els[0];
    var last  = els[els.length - 1];
    var active = document.activeElement;

    if (!els.length) { e.preventDefault(); return; }

    if (e.shiftKey) {
      /* Shift+Tab from first focusable → wrap to last */
      if (active === first || active === dialog) {
        e.preventDefault();
        last.focus({ preventScroll: true });
      }
    } else {
      /* Tab from last focusable → wrap to first */
      if (active === last) {
        e.preventDefault();
        first.focus({ preventScroll: true });
      }
    }
  });

  /* ---- Delegated click handler ------------------------------------------ */
  /* Three click cases, all handled by a single document listener:
     1. A [data-aura-dialog-close] element inside an open dialog → close it.
     2. A [data-aura-dialog="#id"] trigger → open the target dialog.
     3. A click on the scrim itself → close the associated modal dialog.      */
  document.addEventListener("click", function (e) {

    /* Case 1: close-trigger inside open dialog */
    var closeEl = e.target.closest("[data-aura-dialog-close]");
    if (closeEl) {
      var hostDlg = closeEl.closest("aura-dialog[open]");
      if (hostDlg) { closeDialog(hostDlg); return; }
    }

    /* Case 2: open-trigger */
    var triggerEl = e.target.closest("[data-aura-dialog]");
    if (triggerEl) {
      var sel = triggerEl.getAttribute("data-aura-dialog");
      if (sel) {
        try {
          var target = document.querySelector(sel);
          if (target) { e.preventDefault(); openDialog(target, triggerEl); return; }
        } catch (_) { /* invalid CSS selector — ignore */ }
      }
    }

    /* Case 3: scrim click → close associated modal dialog */
    if (e.target && e.target.classList && e.target.classList.contains("aura-dialog-scrim")) {
      var scrimDlg = e.target.__auraDialog;
      /* persistent suppresses scrim-click dismissal too (programmatic close
         only); no-scrim-dismiss remains the narrower opt-out for that gesture. */
      if (scrimDlg && scrimDismisses(scrimDlg)) {
        closeDialog(scrimDlg);
      }
    }
  });

  /* ---- Reusable modal-surface utilities (#619/#638) --------------------- */
  /* Other modal surfaces (the aura-editor link prompt, the aura-image lightbox)
     need the same background-isolation + focus-trap guarantees a dialog gets,
     but they are not aura-dialog elements on the openDialogs stack. Rather than
     re-roll inert/aria-hidden walking and a Tab trap in each (duplicated code,
     coding-standards §DRY), expose the engine's primitives as small standalone
     helpers. These keep their own per-call node bookkeeping so they never
     interfere with the dialog stack's reference-counted inertedNodes. */

  /* Inert + aria-hidden every off-path sibling of `el` up to <body> and lock
     body scroll, reusing forEachOffPathSibling/lockScroll exactly as a modal
     dialog does, but recording state locally so the returned restore() reverses
     precisely this call. Returns a function that clears inert/aria-hidden and
     unlocks scroll. The dialog-stack lockScroll/unlockScroll are reused so a
     dialog and a standalone surface never double-lock or fight over restore. */
  function isolateBackground(el) {
    var recs = [];
    forEachOffPathSibling(el, function (kid) {
      var rec = {
        node: kid,
        hadInert: kid.hasAttribute("inert"),
        hadAriaHidden: kid.hasAttribute("aria-hidden")
      };
      if (nativeInert) kid.inert = true; else kid.setAttribute("inert", "");
      kid.setAttribute("aria-hidden", "true");
      recs.push(rec);
    });
    lockScroll();
    var released = false;
    return function restore() {
      if (released) return;
      released = true;
      for (var j = 0; j < recs.length; j++) {
        var r = recs[j];
        if (!r.hadInert) {
          if (nativeInert) r.node.inert = false;
          r.node.removeAttribute("inert");
        }
        if (!r.hadAriaHidden) r.node.removeAttribute("aria-hidden");
      }
      /* Only unlock if no modal dialog still needs the lock. */
      if (!topmostModal()) unlockScroll();
    };
  }

  /* Trap Tab focus within `container` using the same focusableEls + wrap logic
     the dialog focus trap uses. Returns a teardown function that removes the
     listener. Escape handling stays the caller's concern (the caller decides
     what dismiss means); this helper owns only the Tab cycle. */
  function trapFocus(container) {
    function onKeydown(e) {
      if (e.key !== "Tab") return;
      var els = focusableEls(container);
      if (!els.length) { e.preventDefault(); return; }
      var first = els[0], last = els[els.length - 1];
      var active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || active === container) {
          e.preventDefault();
          last.focus({ preventScroll: true });
        }
      } else if (active === last) {
        e.preventDefault();
        first.focus({ preventScroll: true });
      }
    }
    container.addEventListener("keydown", onKeydown);
    return function untrap() { container.removeEventListener("keydown", onKeydown); };
  }

  /* ---- Public API -------------------------------------------------------- */
  Aura.dialog = {
    /* Open a dialog by CSS selector or element reference. `opener` is the
       element that should regain focus on close (defaults to null).           */
    open: function (selectorOrEl, opener) {
      var el = typeof selectorOrEl === "string"
        ? document.querySelector(selectorOrEl)
        : selectorOrEl;
      if (el) openDialog(el, opener || null);
    },

    /* Close a specific dialog by CSS selector or element reference. */
    close: function (selectorOrEl) {
      var el = typeof selectorOrEl === "string"
        ? document.querySelector(selectorOrEl)
        : selectorOrEl;
      if (el) closeDialog(el);
    },

    /* Close all currently-open dialogs. */
    closeAll: function () {
      /* Snapshot the array since closeDialog splices from it. */
      var all = openDialogs.slice();
      for (var i = all.length - 1; i >= 0; i--) {
        closeDialog(all[i].dialog);
      }
    },

    /* True if the given dialog element is currently open in the runtime stack. */
    isOpen: function (selectorOrEl) {
      var el = typeof selectorOrEl === "string"
        ? document.querySelector(selectorOrEl)
        : selectorOrEl;
      if (!el) return false;
      return openDialogs.some(function (e) { return e.dialog === el; });
    },

    /* ---- Pure predicates / mappings (exposed for tests & advanced authors) -- */
    /* True if ESC should dismiss the given dialog element (false when
       persistent, or non-modal+no-esc). */
    escDismisses: escDismisses,
    /* True if a scrim click should dismiss the given dialog element (false when
       persistent or no-scrim-dismiss). */
    scrimDismisses: scrimDismisses,
    /* Map a size keyword ("sm"|"md"|"lg") to its component-scoped width var,
       "full" to the sentinel "full", or null for an unknown/absent size. */
    sizeVar: sizeVar,

    /* ---- Reusable modal-surface helpers (#619/#638) ---------------------- */
    /* Inert + aria-hidden the background of a non-dialog modal surface and lock
       scroll; returns restore(). For surfaces that aren't aura-dialog elements
       (editor link prompt, image lightbox) but make the same modal promise. */
    isolateBackground: isolateBackground,
    /* Trap Tab within a container; returns a teardown function. Caller owns
       Escape/dismissal semantics. */
    trapFocus: trapFocus
  };

  /* ---- aura-dialog custom element ---------------------------------------- */
  /* Default elevation tier (5 = modal/dialog) applied when none is authored. */
  var DIALOG_ELEVATION = "5";

  /* Counter for generated title ids — monotonically increasing, collision-free. */
  var _dlgTitleSeq = 0;

  /* Summary: declarative dialog element. Sets the default elevation, reflects
     role/aria-modal, and synthesizes BEM chrome from the `title` attribute when
     no hand-authored .aura-dialog__header child is present (backward-compatible).
     The open/close behaviour, focus trap, and scrim are owned by the engine above
     (Aura.dialog / the delegated handlers).
     Extends Aura.BaseElement for the shared lifecycle + attribute-guard boilerplate. */
  if ("customElements" in window && Aura.BaseElement) {
    Aura.define("aura-dialog", class extends Aura.BaseElement {
      static get observedAttributes() { return ["non-modal", "title"]; }

      /* Set the default elevation + synthesize chrome on first connect. */
      _build() {
        /* Default to the modal/dialog elevation tier unless already set. */
        if (!this.hasAttribute("elevation") &&
            !this.hasAttribute("data-aura-elevation") &&
            !/(^|\s)aura-e-\d(\s|$)/.test(this.className)) {
          this.setAttribute("elevation", DIALOG_ELEVATION);
        }
        this._synthesizeChrome();
      }

      /* Re-sync ARIA + title text on every connect (BaseElement._sync hook). */
      _sync() {
        this._reflectAria();
        this._syncTitleText();
      }

      /* Route attribute changes — BaseElement already guards isConnected/__init. */
      _onAttr(name) {
        if (name === "title") this._syncTitleText();
        this._reflectAria();
      }

      /* Synthesize .aura-dialog__header / __title / __body / __footer from plain
         content + the `title` attribute when no hand-authored header exists yet.
         Idempotent: skips entirely if a .aura-dialog__header child is already
         present (legacy BEM markup — backward-compatible). */
      _synthesizeChrome() {
        var titleAttr = this.getAttribute("title");
        if (!titleAttr) return;                                    // no title → nothing to synthesize
        if (this.querySelector(":scope > .aura-dialog__header")) return; // already hand-authored

        /* Partition existing children into action nodes ([slot=actions]) and body
           content (everything else). Snapshot before DOM mutation. */
        var children = Array.prototype.slice.call(this.childNodes);
        var actionNodes = [];
        var bodyNodes   = [];
        for (var i = 0; i < children.length; i++) {
          var child = children[i];
          if (child.nodeType === 1 && child.getAttribute("slot") === "actions") {
            actionNodes.push(child);
          } else {
            bodyNodes.push(child);
          }
        }

        /* Remove all children — they will be redistributed into BEM wrappers. */
        while (this.firstChild) this.removeChild(this.firstChild);

        /* .aura-dialog__header containing the synthesized <h2> title. */
        var header = document.createElement("div");
        header.className = "aura-dialog__header";

        var h2 = document.createElement("h2");
        h2.className = "aura-dialog__title";
        h2.id = "aura-dlg-title-" + (++_dlgTitleSeq);
        h2.textContent = titleAttr;
        header.appendChild(h2);
        this.appendChild(header);

        /* Wire aria-labelledby to the synthesized title. */
        if (!this.getAttribute("aria-labelledby")) {
          this.setAttribute("aria-labelledby", h2.id);
        }

        /* .aura-dialog__body wrapping the original body content. */
        if (bodyNodes.length) {
          var body = document.createElement("div");
          body.className = "aura-dialog__body";
          for (var j = 0; j < bodyNodes.length; j++) body.appendChild(bodyNodes[j]);
          this.appendChild(body);
        }

        /* .aura-dialog__footer for [slot=actions] children. */
        if (actionNodes.length) {
          var footer = document.createElement("div");
          footer.className = "aura-dialog__footer";
          for (var k = 0; k < actionNodes.length; k++) footer.appendChild(actionNodes[k]);
          this.appendChild(footer);
        }

        /* Record the synthesized title element for later text-sync. */
        this._synthTitle = h2;
      }

      /* Update the synthesized title <h2>'s text when the `title` attribute
         changes at runtime. Only touches elements the synthesis created. */
      _syncTitleText() {
        var titleAttr = this.getAttribute("title");
        if (this._synthTitle) {
          if (titleAttr) {
            this._synthTitle.textContent = titleAttr;
          }
        }
      }

      /* Reflect the dialog role + aria-modal (driven by the non-modal attr). */
      _reflectAria() {
        if (!this.getAttribute("role")) this.setAttribute("role", "dialog");
        this.setAttribute("aria-modal", this.hasAttribute("non-modal") ? "false" : "true");
      }
    });
  }
})();
