/* ==========================================================================
   Aura — unsaved-changes guard (Aura.formGuard, #158).

   Marks a form dirty once the user edits it and warns before the page unloads
   while unsaved edits remain. Opt in with [data-aura-guard] on a <form>:

     <form data-aura-guard> … </form>

   Behaviour:
     • the first edit in the form flips it to dirty (data-aura-dirty) — a native
       input/change OR the uniform aura:change CustomEvent (switch/select/
       tag-input/editor), so every Aura control is covered (#610);
     • while ANY guarded form is dirty, beforeunload prompts the native
       "leave site?" dialog (the only cross-browser unsaved-changes affordance);
     • submitting (or calling Aura.formGuard.clear(form)) clears the dirty flag so
       a normal save doesn't trigger the prompt.

   Delegated + idempotent, so HTMX-swapped forms are covered with no re-init.
   The native beforeunload prompt is intentional — bespoke dialogs can't block
   navigation reliably. Authors wanting an in-app confirm should call
   Aura.formGuard.isDirty() from their own router guard.

   Load order: core.js → form-guard.js.  See docs/design/form-flow-design.md.
   ========================================================================== */
(function () {
  "use strict";
  /* SSR guard (#416): no-op outside the browser so SSR/RSC frameworks can
     evaluate this module (and the dist bundle) in Node without crashing. */
  if (typeof window === "undefined" || typeof document === "undefined") return;
  var Aura = window.Aura;
  if (!Aura || typeof document === "undefined") return;

  function guardFor(el) {
    return el && el.closest ? el.closest("form[data-aura-guard]") : null;
  }

  function markDirty(form) {
    if (form && !form.hasAttribute("data-aura-dirty")) {
      form.setAttribute("data-aura-dirty", "");
      form.dispatchEvent(new CustomEvent("aura:dirty", { bubbles: true }));
    }
  }

  function clear(form) {
    if (form) form.removeAttribute("data-aura-dirty");
  }

  /* Any guarded form currently carrying unsaved edits? */
  function anyDirty() {
    return !!document.querySelector("form[data-aura-guard][data-aura-dirty]");
  }

  // A real edit on a guarded field marks the form dirty. Native input/change
  // cover plain controls plus the Aura controls backed by a real input
  // (checkbox/radio) or that dispatch a native input (stepper); the uniform
  // `aura:change` namespace covers the controls that emit ONLY a CustomEvent —
  // aura-switch, aura-select, aura-tag-input, aura-editor — so toggling/picking/
  // editing those inside a guarded form also flips it dirty (#610).
  document.addEventListener("input", function (e) { markDirty(guardFor(e.target)); });
  document.addEventListener("change", function (e) { markDirty(guardFor(e.target)); });
  document.addEventListener("aura:change", function (e) { markDirty(guardFor(e.target)); });

  // A successful submit means the edits are being saved — clear the flag.
  document.addEventListener("submit", function (e) { clear(guardFor(e.target)); });

  // Warn before leaving while any guarded form is dirty.
  window.addEventListener("beforeunload", function (e) {
    if (anyDirty()) { e.preventDefault(); e.returnValue = ""; return ""; }
  });

  Aura.formGuard = {
    isDirty: function (form) { return !!(form && form.hasAttribute("data-aura-dirty")); },
    anyDirty: anyDirty,
    markDirty: markDirty,
    clear: clear
  };
})();
