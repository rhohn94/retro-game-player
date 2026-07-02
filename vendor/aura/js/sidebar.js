/* ==========================================================================
   Aura — sidebar FMB (v3.88)

   Enhances every .aura-sidebar[data-aura-sidebar] element:
     - JS proximity detection: sets data-sidebar-expanded when the cursor
       approaches within --aura-sidebar-fmb-expand-px of the FMB circle edge,
       mirroring the nav-header / footer FMB proximity mechanics.
     - Click-to-pin: toggles data-fmb-pinned to keep the panel open until
       the user clicks again (any non-interactive area on the sidebar).

   Load order: after element-base.js.
   ========================================================================== */
(function () {
  "use strict";

  /* SSR guard (#416): no-op outside the browser so SSR/RSC frameworks can
     import the module tree without crashing on missing globals. */
  if (typeof window === "undefined" || typeof document === "undefined") return;

  var BEHAVIOR_ATTR = "data-aura-sidebar";
  /* JS proximity expand: set while the cursor is inside the expand-px ring. */
  var EXPANDED_ATTR = "data-sidebar-expanded";
  /* Click-pin: toggles the open state independent of hover / proximity. */
  var PINNED_ATTR   = "data-fmb-pinned";
  /* Unified FMB stash-state mirror (v3.541, #1019): data-aura-stashed is present
     while the sidebar is collapsed per the states this module tracks — neither
     JS-proximity-expanded (data-sidebar-expanded) nor click-pinned
     (data-fmb-pinned). Positive polarity matches nav-header/footer. Purely
     additive — CSS and fmb-column.js keep reading the legacy attributes. */
  var STASHED_MIRROR_ATTR = "data-aura-stashed";

  /* ---- Pointer-position cache (module-level) ---------------------------- */
  var pointerX = -1;
  var pointerY = -1;
  var rafPending = false;

  /* Active sidebar instances registered for the proximity sync loop. */
  var instances = [];

  /* ---- CSS token probes ------------------------------------------------- */
  /* Resolves --aura-sidebar-fmb-size → px via a width-probe child element.
     Defaults to 48px (3rem at 16px root). */
  function fmbSizePx(el) {
    var probe = document.createElement("div");
    probe.style.cssText = "position:absolute;visibility:hidden;width:var(--aura-sidebar-fmb-size,3rem)";
    el.appendChild(probe);
    var px = parseFloat(getComputedStyle(probe).width) || 48;
    el.removeChild(probe);
    return px;
  }

  /* Resolves --aura-sidebar-fmb-expand-px → numeric px. Defaults to 14. */
  function fmbExpandPx(el) {
    var v = parseFloat(getComputedStyle(el).getPropertyValue("--aura-sidebar-fmb-expand-px")) || 14;
    return v >= 0 ? v : 14;
  }

  /* ---- Proximity sync -------------------------------------------------- */
  function syncFmbHotzones() {
    rafPending = false;
    for (var i = 0; i < instances.length; i++) {
      syncOne(instances[i]);
    }
  }

  function syncOne(el) {
    /* Skip when pinned — CSS data-fmb-pinned keeps it open regardless. */
    if (el.hasAttribute(PINNED_ATTR)) return;
    if (pointerX < 0) return;

    /* The sidebar is position:fixed; its top-left corner is always at the
       inset values regardless of collapsed / expanded state.  The FMB circle
       occupies the top-left fmbSize×fmbSize square, so its center is
       (rect.left + r, rect.top + r) in all states. */
    var r = el._fmbRadius;
    var rect = el.getBoundingClientRect();
    var cx = rect.left + r;
    var cy = rect.top  + r;
    var expand = el._fmbExpand;

    var dx = pointerX - cx;
    var dy = pointerY - cy;
    var inProximity = (dx * dx + dy * dy) <= (r + expand) * (r + expand);

    if (inProximity) {
      if (!el.hasAttribute(EXPANDED_ATTR)) el.setAttribute(EXPANDED_ATTR, "");
    } else {
      if (el.hasAttribute(EXPANDED_ATTR)) el.removeAttribute(EXPANDED_ATTR);
    }
  }

  /* ---- Global pointermove (installed once, serves all instances) -------- */
  var moveInstalled = false;
  function installMove() {
    if (moveInstalled) return;
    moveInstalled = true;
    document.addEventListener("pointermove", function (e) {
      pointerX = e.clientX;
      pointerY = e.clientY;
      if (!rafPending && instances.length > 0) {
        rafPending = true;
        requestAnimationFrame(syncFmbHotzones);
      }
    }, { passive: true });
  }

  /* ---- MutationObserver helper ----------------------------------------- */
  function applyToNodes(nodes, fn) {
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node.nodeType !== 1) continue;
      if (node.hasAttribute(BEHAVIOR_ATTR)) fn(node);
      var nested = node.querySelectorAll("[" + BEHAVIOR_ATTR + "]");
      for (var qi = 0; qi < nested.length; qi++) fn(nested[qi]);
    }
  }

  /* ---- Unified stash-state mirror (v3.541, #1019) ------------------------ */
  /* Reflect data-aura-stashed while collapsed (no expand, no pin). Mutation-
     Observer-driven so every expand/pin path — proximity sync, click-to-pin,
     consumer attribute flips — is covered from one place. */
  function syncStashMirror(el) {
    var stashed = !el.hasAttribute(EXPANDED_ATTR) && !el.hasAttribute(PINNED_ATTR);
    if (stashed !== el.hasAttribute(STASHED_MIRROR_ATTR)) {
      el.toggleAttribute(STASHED_MIRROR_ATTR, stashed);
    }
  }
  function armStashMirror(el) {
    syncStashMirror(el);
    if (typeof MutationObserver === "undefined") return;   // mirror stays static
    el._stashMirrorMo = new MutationObserver(function () { syncStashMirror(el); });
    el._stashMirrorMo.observe(el, {
      attributes: true,
      attributeFilter: [EXPANDED_ATTR, PINNED_ATTR]
    });
  }

  /* ---- Per-element enhance / teardown ----------------------------------- */
  function enhance(el) {
    if (el._sidebarEnhanced) return;
    el._sidebarEnhanced = true;
    /* Cache the FMB geometry tokens once at enhance time — these design-system
       constants don't change at runtime, so probing them on every rAF tick is
       unnecessary. Cached on the element so teardown can clear them. */
    el._fmbRadius = fmbSizePx(el) / 2;
    el._fmbExpand = fmbExpandPx(el);
    if (instances.indexOf(el) < 0) instances.push(el);
    installMove();
    /* Unified stash-state mirror (#1019) — armed once per enhance; torn down
       (observer + attribute) in teardown(). */
    armStashMirror(el);

    /* Coverage principle (proximity-glow-design.md §Coverage principle): the
       whole FMB host is a real click target (click-to-pin below), so it gets
       the default proximity glow + magnetic lean like any other interactive
       widget — host-level whole-element glow, mirroring aura-card's
       _reflectTactile() pattern. Sidebar is an attribute-based enhancer (no
       connectedCallback), so this is wired here at enhance-time instead. */
    el.classList.add("aura-glow");

    /* Click-to-pin: clicking any non-interactive part of the sidebar toggles
       data-fmb-pinned.  Interactive descendants (links, buttons, form elements)
       fire their own default actions and are excluded from the toggle. */
    el._sidebarPinClick = function (e) {
      if (e.target.closest("a, button, input, select, textarea")) return;
      el.toggleAttribute(PINNED_ATTR);
    };
    el.addEventListener("click", el._sidebarPinClick);
  }

  function teardown(el) {
    var idx = instances.indexOf(el);
    if (idx >= 0) instances.splice(idx, 1);
    /* Disconnect the stash mirror BEFORE the attribute removals below —
       disconnect() discards queued records, so removing the expand/pin
       attributes cannot re-add the mirror attribute after teardown (#1019). */
    if (el._stashMirrorMo) { el._stashMirrorMo.disconnect(); el._stashMirrorMo = null; }
    el.removeAttribute(STASHED_MIRROR_ATTR);
    el.removeAttribute(EXPANDED_ATTR);
    el.removeAttribute(PINNED_ATTR);
    if (el._sidebarPinClick) {
      el.removeEventListener("click", el._sidebarPinClick);
      el._sidebarPinClick = null;
    }
    el._fmbRadius = el._fmbExpand = 0;
    el._sidebarEnhanced = false;
  }

  /* ---- Init: scan existing elements + observe future additions ---------- */
  function enhanceAll() {
    var els = document.querySelectorAll("[" + BEHAVIOR_ATTR + "]");
    for (var i = 0; i < els.length; i++) enhance(els[i]);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", enhanceAll);
  } else {
    enhanceAll();
  }

  /* MutationObserver: handle sidebars injected after initial page load. */
  var mo = new MutationObserver(function (mutations) {
    for (var mi = 0; mi < mutations.length; mi++) {
      applyToNodes(mutations[mi].addedNodes, enhance);
      applyToNodes(mutations[mi].removedNodes, teardown);
    }
  });
  mo.observe(document.body || document.documentElement, { childList: true, subtree: true });

})();
