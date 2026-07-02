/* ==========================================================================
   Aura — choreographed entrance replay (Aura.entrance, v1.7).

   The entrance animation itself is pure CSS (css/entrance.css): any
   [data-aura-entrance] container drops its elevated descendants in, staggered
   by depth, on first paint. This tiny helper only lets app code REPLAY the
   choreography on demand (e.g. after an HTMX swap, a route change, or revealing
   a previously-hidden panel) by toggling the trigger attribute off and back on.

   No animation logic lives here — removing the attribute clears the running
   animation, a forced reflow flushes it, and re-adding it restarts the CSS
   keyframes from the top. Reduced-motion users get no movement (the CSS opts
   out), so replay() is a harmless no-op for them.

   Load order: core.js → … → entrance.js.
   See docs/design/motion-depth-light-design.md §1.
   ========================================================================== */
(function () {
  "use strict";
  /* SSR guard (#416): no-op outside the browser so SSR/RSC frameworks can
     evaluate this module (and the dist bundle) in Node without crashing. */
  if (typeof window === "undefined" || typeof document === "undefined") return;
  var Aura = window.Aura;
  if (!Aura) return;

  function replayOne(el) {
    el.removeAttribute("data-aura-entrance");
    /* Force a reflow so the browser registers the animation removal before we
       re-add it — without this the toggle collapses and nothing restarts. */
    void el.offsetWidth;
    el.setAttribute("data-aura-entrance", "");
  }

  Aura.entrance = {
    /* Replay the entrance choreography for every [data-aura-entrance] container
       under `root` (default: document). Chainable. */
    replay: function (root) {
      var scope = root || document;
      var els = scope.querySelectorAll("[data-aura-entrance]");
      for (var i = 0; i < els.length; i++) replayOne(els[i]);
      return Aura.entrance;
    }
  };
})();
