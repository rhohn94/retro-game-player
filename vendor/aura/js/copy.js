/* ==========================================================================
   Aura — copy-to-clipboard affordance (Aura.copy, #132).

   A delegated behaviour: any element with [data-aura-copy] copies text to the
   clipboard on click. The text source is, in order:
     • the [data-aura-copy] value, if non-empty (copy a literal / token name);
     • else the element referenced by [data-aura-copy-target] (a CSS selector);
     • else the text of the nearest .aura-code block.
   On success the trigger flips to a "Copied" state (data-copied + swapped label)
   for a short window. The visible swap label comes from [data-copied-label]
   (default "Copied"); the SEPARATE screen-reader announcement comes from
   [data-copied-announce] (default "Copied to clipboard"), so a glyph-only visible
   label never silences the AT status (#705). The trigger MUST carry an accessible
   name (aria-label or text). Auto-injects a copy button into any
   <aura-code copyable> block.

   Uses navigator.clipboard with a textarea+execCommand fallback for non-secure
   contexts. HTMX-safe: one delegated listener; injection runs on mount.

   Load order: core.js → copy.js.  See docs/design/control-widgets-design.md.
   ========================================================================== */
(function () {
  "use strict";
  /* SSR guard (#416): no-op outside the browser so SSR/RSC frameworks can
     evaluate this module (and the dist bundle) in Node without crashing. */
  if (typeof window === "undefined" || typeof document === "undefined") return;
  var Aura = window.Aura;
  if (!Aura || typeof document === "undefined") return;

  var RESET_MS = 1600;

  /* The message announced to AT on a successful copy (#689). */
  var COPIED_MESSAGE = "Copied to clipboard";

  /* How long the announced text lingers before it is cleared, so a second copy
     re-announces the same text (mirrors toast.js LIVE_REGION_CLEAR_MS). */
  var LIVE_REGION_CLEAR_MS = 1000;

  /* The single module-global polite live region (#689, WCAG 4.1.3). Copy
     success is otherwise silent to screen readers — the visual "Copied" flip
     carries no AT-perceivable status. One shared region (not one per trigger),
     reusing the toast/tag-input visually-hidden clip technique. */
  var _live = null;
  function getLive() {
    if (_live && _live.isConnected) return _live;
    _live = document.getElementById("aura-copy-live");
    if (_live) return _live;
    _live = document.createElement("div");
    _live.id = "aura-copy-live";
    _live.setAttribute("aria-live", "polite");
    _live.setAttribute("aria-atomic", "true");
    _live.setAttribute("aria-relevant", "additions text");
    _live.style.cssText =
      "position:absolute;width:1px;height:1px;padding:0;overflow:hidden;" +
      "clip:rect(0,0,0,0);white-space:nowrap;border:0;";
    document.body.appendChild(_live);
    return _live;
  }

  /* Write a polite status into the shared live region, then clear it so a
     repeat copy re-announces. */
  function announce(message) {
    var live = getLive();
    live.textContent = message;
    clearTimeout(live.__auraCopyClear);
    live.__auraCopyClear = setTimeout(function () { live.textContent = ""; }, LIVE_REGION_CLEAR_MS);
  }

  /* Resolve the text a trigger should copy (see header for precedence). */
  function textFor(trigger) {
    var literal = trigger.getAttribute("data-aura-copy");
    if (literal) return literal;
    var sel = trigger.getAttribute("data-aura-copy-target");
    if (sel) {
      var target = document.querySelector(sel);
      if (target) return target.textContent;
    }
    var code = trigger.closest(".aura-code, aura-code");
    if (code) {
      var inner = code.querySelector("code") || code;
      return inner.textContent;
    }
    return "";
  }

  /* Copy text to the clipboard; returns a Promise<boolean>. */
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; },
        function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }

  /* execCommand fallback for insecure contexts / old engines. */
  function legacyCopy(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;top:-9999px;left:-9999px;";
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  /* Flash the "copied" state on the trigger, then restore it. */
  function flash(trigger) {
    trigger.setAttribute("data-copied", "");
    var labelEl = trigger.querySelector(".aura-copy__label") || trigger;
    var prev = trigger.__copyPrev;
    if (prev === undefined) { prev = labelEl.textContent; trigger.__copyPrev = prev; }
    /* Key the restore on whether a label swap actually happened, NOT on prev's
       truthiness: an icon-only trigger whose initial label is "" must still reset
       out of the "Copied" state, otherwise it stays stuck (#511). */
    var swapped = labelEl !== trigger || prev;
    if (swapped) labelEl.textContent = trigger.getAttribute("data-copied-label") || "Copied";
    clearTimeout(trigger.__copyTimer);
    trigger.__copyTimer = setTimeout(function () {
      trigger.removeAttribute("data-copied");
      if (swapped) labelEl.textContent = prev;
    }, RESET_MS);
  }

  /* Inject a copy button into <aura-code copyable> blocks lacking one. */
  function injectCodeButtons(root) {
    var blocks = (root || document).querySelectorAll("aura-code[copyable], .aura-code[data-copyable]");
    Array.prototype.forEach.call(blocks, function (block) {
      if (block.querySelector(":scope > .aura-copy")) return;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "aura-copy";
      btn.setAttribute("data-aura-copy", "");
      btn.setAttribute("aria-label", "Copy code");
      btn.innerHTML = '<span class="aura-copy__label">Copy</span>';
      block.appendChild(btn);
    });
  }

  document.addEventListener("click", function (e) {
    var trigger = e.target.closest && e.target.closest("[data-aura-copy]");
    if (!trigger) return;
    var text = textFor(trigger);
    if (!text) return;
    /* Compute the trimmed string ONCE and use it for both the clipboard write
       and the aura:copy detail, so the event reports exactly what was copied
       (code blocks carry trailing newlines that the trim strips) — #507. */
    var copied = String(text).replace(/\s+$/, "");
    copyText(copied).then(function (ok) {
      if (ok) {
        flash(trigger);
        /* Announce the success to AT — the visual "Copied" flip alone is silent
           to screen readers (#689, WCAG 4.1.3). The AT status is decoupled from
           the visible label: a glyph-only data-copied-label ("✓") would re-silence
           the announcement, so the AT channel uses a dedicated data-copied-announce
           if present, else always the self-describing COPIED_MESSAGE — never the
           visible glyph (#705). */
        announce(trigger.getAttribute("data-copied-announce") || COPIED_MESSAGE);
        trigger.dispatchEvent(new CustomEvent("aura:copy", { bubbles: true, detail: { text: copied } }));
      }
    });
  });

  Aura.onMount(function () { injectCodeButtons(); });

  Aura.copy = {
    copyText: copyText,
    textFor: textFor,
    injectCodeButtons: injectCodeButtons,
    /* Exposed so the success-announcement (#689) is unit-testable without a
       live clipboard, and so an author driving a custom copy path can mirror
       the AT status. */
    announce: announce
  };
})();
