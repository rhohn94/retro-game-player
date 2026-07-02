/* ==========================================================================
   Aura — textarea auto-grow fallback (#152).

   Modern browsers auto-grow a textarea natively via CSS `field-sizing: content`
   (set in components.css for [autogrow]/[data-autogrow] textareas). This module
   is the progressive-enhancement fallback for engines that lack field-sizing:
   it grows the textarea to fit its content on input by syncing block-size to
   scrollHeight, capped by the same --aura-textarea-max as the CSS path.

   It is a no-op where field-sizing is supported (the browser already does it),
   and a no-op when no opted-in textareas are present. Delegates from the
   document so dynamically inserted textareas (HTMX swaps) are covered without
   re-scanning. See docs/design/form-flow-design.md.

   Load order: core.js → autogrow.js (no dependencies beyond the DOM).
   ========================================================================== */
(function () {
  "use strict";
  /* SSR guard (#416): no-op outside the browser so SSR/RSC frameworks can
     evaluate this module (and the dist bundle) in Node without crashing. */
  if (typeof window === "undefined" || typeof document === "undefined") return;
  var Aura = window.Aura;
  if (!Aura || typeof document === "undefined") return;

  /* Native field-sizing makes this fallback redundant — bail early so we never
     fight the browser's own sizing. */
  var nativeSupported =
    typeof CSS !== "undefined" && CSS.supports &&
    CSS.supports("field-sizing", "content");
  if (nativeSupported) return;

  /* A textarea is opted in when it carries [data-autogrow] or sits inside an
     aura-field[autogrow]. */
  function isAutogrow(ta) {
    if (!ta || ta.tagName !== "TEXTAREA") return false;
    if (ta.hasAttribute("data-autogrow")) return true;
    var field = ta.closest && ta.closest("aura-field[autogrow]");
    return !!field;
  }

  /* Resize one textarea to fit its content: reset height so scrollHeight
     reflects the true content height, then grow to it. The CSS max-block-size
     cap still applies (overflow-y:auto scrolls past it), so we never exceed it. */
  function resize(ta) {
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
  }

  /* Initial sizing for any opted-in textarea already in the DOM. */
  function sizeAll(root) {
    var list = (root || document).querySelectorAll(
      "textarea[data-autogrow], aura-field[autogrow] textarea"
    );
    Array.prototype.forEach.call(list, function (ta) { resize(ta); });
  }

  /* Delegated input handler — grows whichever opted-in textarea changed. */
  document.addEventListener("input", function (e) {
    var ta = e.target;
    if (isAutogrow(ta)) resize(ta);
  });

  /* Initial sizing must re-run whenever new DOM mounts (HTMX settle /
     Aura.refresh), not just once at load — otherwise a swapped-in, pre-filled
     textarea stays at its default single-row height until first input, on
     exactly the non-field-sizing engines this fallback targets (#464). resize()
     only sets inline block-size (idempotent, no childList mutation), so it is a
     safe onMount callback per the core.js contract. */
  Aura.onMount(function (root) { sizeAll(root); });

  /* Expose for tests + manual re-sizing after programmatic value changes. */
  Aura.autogrow = { resize: resize, sizeAll: sizeAll, nativeSupported: nativeSupported };
})();
