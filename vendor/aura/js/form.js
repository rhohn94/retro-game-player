/* ==========================================================================
   Aura — aura-form: declarative form-flow orchestration.

   A coordinator element that reads dependency hints off its descendant
   aura-field wrappers and keeps their state consistent as values change —
   with no per-form scripting:

     depends-on="<field-id>"  a field is disabled until that blocker is
                              *satisfied* (has a non-empty value)
     auto-populate            show a pending state until the blocker resolves,
                              then enable and filter the field's own <option>s
     data-when="<v> [<v>…]"   (on <option>) the option is available only when
                              the blocker resolves to one of these values

   SELF-REGISTERING — defines aura-form here in its own module, so this
   release's parallel component work doesn't serialise on one file.

   HTMX-safe (see docs/design/architecture-design.md): connectedCallback runs
   the initial gate, delegated change/input/aura:change listeners pick up
   swapped-in fields, and a childList-only MutationObserver re-gates structural
   swaps. The gate mutates attributes/properties only (never adds/removes
   nodes), so the observer cannot loop — which is also why this does NOT use
   Aura.onMount (onMount callbacks must not mutate the DOM).

   Load order: core.js → element-base.js → aura-field.js → form.js.
   See docs/design/form-flow-design.md.
   ========================================================================== */
(function () {
  "use strict";
  /* SSR guard (#416): no-op outside the browser so SSR/RSC frameworks can
     evaluate this module (and the dist bundle) in Node without crashing. */
  if (typeof window === "undefined" || typeof document === "undefined") return;
  var Aura = window.Aura;
  if (!Aura || !Aura.BaseElement) return;

  var keySeq = 0; // stable key for managed fields that lack an id

  /* ---- Field / control resolution -------------------------------------- */

  /* Map id → aura-field for every identified field inside the form. Building a
     map (vs. per-lookup selectors) sidesteps id-escaping and keeps lookups O(1). */
  function indexFields(form) {
    var byId = {};
    var all = form.querySelectorAll("aura-field[id]");
    for (var i = 0; i < all.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(byId, all[i].id)) byId[all[i].id] = all[i];
    }
    return byId;
  }

  /* The field's logical control. Document order returns the visible control
     before any hidden input an inner custom element (e.g. aura-select) adds;
     the [type=hidden] guard skips that hidden input outright. */
  function controlOf(field) {
    return field.querySelector(
      "aura-select, aura-switch, input:not([type='hidden']), select, textarea"
    );
  }

  function tagOf(el) { return el ? el.tagName.toLowerCase() : ""; }

  function inputType(ctrl) {
    return (ctrl.getAttribute("type") || "text").toLowerCase();
  }

  /* Native <select> backing an auto-populate field, or null (option filtering
     only applies to native selects — see design doc, follow-ups). */
  function nativeSelect(field) {
    var c = controlOf(field);
    return tagOf(c) === "select" ? c : null;
  }

  /* ---- Value / satisfaction -------------------------------------------- */

  /* Current value of a field's control as a trimmed string ("" = empty). */
  function valueOf(field) {
    var c = controlOf(field);
    if (!c) return "";
    var tag = tagOf(c);
    if (tag === "aura-select") return (c.getAttribute("value") || "").trim();
    if (tag === "aura-switch") return c.hasAttribute("checked") ? "on" : "";
    if (tag === "input") {
      var t = inputType(c);
      if (t === "checkbox" || t === "radio") return c.checked ? (c.value || "on") : "";
      return (c.value || "").trim();
    }
    return (c.value || "").trim(); // select, textarea
  }

  function isSatisfied(field) { return valueOf(field) !== ""; }

  /* ---- Option filtering (native select, auto-populate) ----------------- */

  /* Space-separated data-when tokens, or null when the option carries none
     (always-present options such as the placeholder are author-owned and left
     untouched). */
  function whenTokens(opt) {
    var w = opt.getAttribute("data-when");
    return w ? w.trim().split(/\s+/) : null;
  }

  /* Select the empty-value placeholder if present (programmatic selection works
     even when it is author-disabled), else clear the selection. Never fires a
     change event, so the recompute pass cannot recurse. */
  function resetSelection(sel) {
    for (var i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === "") { sel.value = ""; return; }
    }
    sel.selectedIndex = -1;
  }

  /* Show/enable only the options valid for blockerVal; hide/disable the rest.
     A still-valid current selection (e.g. a server-prefilled edit value) is
     preserved; otherwise the selection resets to the placeholder. */
  function populateOptions(field, blockerVal) {
    var sel = nativeSelect(field);
    if (!sel) return;
    var current = sel.value;
    var currentStillValid = false;
    for (var i = 0; i < sel.options.length; i++) {
      var opt = sel.options[i];
      var toks = whenTokens(opt);
      if (!toks) continue; // author-owned (placeholder / always-present)
      var match = toks.indexOf(blockerVal) !== -1;
      opt.hidden = !match;
      opt.disabled = !match;
      if (match && current !== "" && opt.value === current) currentStillValid = true;
    }
    if (!currentStillValid) resetSelection(sel);
  }

  /* Blocker not resolved yet: hide every data-when option, keep author-owned
     ones, and fall back to the placeholder. */
  function resetOptions(field) {
    var sel = nativeSelect(field);
    if (!sel) return;
    for (var i = 0; i < sel.options.length; i++) {
      var toks = whenTokens(sel.options[i]);
      if (toks) { sel.options[i].hidden = true; sel.options[i].disabled = true; }
    }
    resetSelection(sel);
  }

  /* Clear a field's own value (used when an auto-populate field loses its
     blocker). No change event is dispatched. */
  function clearValue(field) {
    var c = controlOf(field);
    if (!c) return;
    var tag = tagOf(c);
    if (tag === "select") resetSelection(c);
    else if (tag === "aura-select") c.setAttribute("value", "");
    else if (tag === "aura-switch") c.removeAttribute("checked");
    else if (tag === "input" && (inputType(c) === "checkbox" || inputType(c) === "radio")) c.checked = false;
    else c.value = "";
  }

  /* ---- State application ----------------------------------------------- */

  /* Reflect availability state for CSS + assistive tech. aria-busy marks the
     populating ("pending") state; the authoritative disabled state is the
     control's native `disabled`. */
  function setFlow(field, state) {
    field.setAttribute("data-aura-flow", state);
    if (state === "pending") field.setAttribute("aria-busy", "true");
    else field.removeAttribute("aria-busy");
  }

  /* Enable/disable the control. Native `disabled` drops the control from the
     tab order, so focus can never land on a disabled field; for the custom
     controls the `disabled` attribute drives their own tabindex=-1. If focus is
     inside the field as it disables, blur it. */
  function setDisabled(field, disabled) {
    var c = controlOf(field);
    if (!c) return;
    if (disabled && field.contains(document.activeElement)) {
      try { document.activeElement.blur(); } catch (e) { /* ignore */ }
    }
    var tag = tagOf(c);
    if (tag === "aura-select" || tag === "aura-switch") c.toggleAttribute("disabled", disabled);
    else c.disabled = disabled;
    if (disabled) field.setAttribute("aria-disabled", "true");
    else field.removeAttribute("aria-disabled");
  }

  function warnOnce(field, key, msg) {
    field.__auraFormWarned = field.__auraFormWarned || {};
    if (field.__auraFormWarned[key]) return;
    field.__auraFormWarned[key] = true;
    Aura.warn("[Aura] aura-form: " + msg, field);
  }

  /* Gate one dependent field against its blocker's live value. */
  function applyField(field, byId, validate) {
    var blockerId = field.getAttribute("depends-on");
    var blocker = blockerId ? byId[blockerId] : null;
    var auto = field.hasAttribute("auto-populate");

    /* Missing target: fail open (ungated, usable) and surface the author
       error — disabling on a typo would itself be a form of misbehaving. */
    if (blockerId && !blocker) {
      if (validate) warnOnce(field, "missing", 'depends-on="' + blockerId + '" matches no field; treating field as ungated.');
      setFlow(field, "ready");
      setDisabled(field, false);
      field.__auraResolvedFor = null;
      return;
    }

    if (!isSatisfied(blocker)) {
      if (auto) { resetOptions(field); clearValue(field); }
      setFlow(field, auto ? "pending" : "blocked");
      setDisabled(field, true);
      field.__auraResolvedFor = null;
      return;
    }

    var bVal = valueOf(blocker);
    if (auto && field.__auraResolvedFor !== bVal) {
      populateOptions(field, bVal);
      field.__auraResolvedFor = bVal;
    }
    setFlow(field, "ready");
    setDisabled(field, false);
  }

  /* ---- Ordering (dependencies before dependents) ----------------------- */

  function fieldKey(field) {
    return field.id || (field.__auraFormKey || (field.__auraFormKey = "·" + (++keySeq)));
  }

  /* Topologically order managed fields so a blocker is processed before its
     dependents — a cleared parent then cascades to children within one pass.
     Validates blocker-precedes-dependent (document order) and breaks cycles,
     warning on each (once per field) only when `validate` is set. */
  function orderedManaged(form, byId, validate) {
    var managed = form.querySelectorAll("aura-field[depends-on]");
    var state = {}; // key → 1 visiting, 2 done
    var order = [];

    function visit(field) {
      var key = fieldKey(field);
      if (state[key] === 2) return;
      if (state[key] === 1) { // back-edge → cycle
        if (validate) warnOnce(field, "cycle", "dependency cycle detected; gating may be incomplete.");
        return;
      }
      state[key] = 1;
      var blockerId = field.getAttribute("depends-on");
      var blocker = blockerId ? byId[blockerId] : null;
      if (blocker) {
        if (validate &&
            !(blocker.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING)) {
          warnOnce(field, "order", 'blocker "' + blockerId + '" should precede this field in document order.');
        }
        if (blocker.hasAttribute("depends-on")) visit(blocker);
      }
      state[key] = 2;
      order.push(field);
    }

    for (var i = 0; i < managed.length; i++) visit(managed[i]);
    return order;
  }

  /* ---- Recompute pass -------------------------------------------------- */

  function refresh(form, validate) {
    var byId = indexFields(form);
    var order = orderedManaged(form, byId, validate);
    for (var i = 0; i < order.length; i++) applyField(order[i], byId, validate);
    form.dispatchEvent(new CustomEvent("aura:form-change", {
      bubbles: true,
      detail: { managed: order.length }
    }));
  }

  /* Coalesce the burst of events one interaction fires (input + change) to a
     single pass via a microtask. A microtask — not rAF — because gating is
     logic, not animation: it must run even when the page is backgrounded (rAF
     is throttled there) and must land before first paint (no flash of ungated
     fields). `validate` is sticky across coalesced calls so a structural change
     still re-runs the authoring checks. */
  function scheduleWork(form, validate) {
    if (validate) form.__auraFormValidate = true;
    if (form.__auraFormScheduled) return;
    form.__auraFormScheduled = true;
    Promise.resolve().then(function () {
      form.__auraFormScheduled = false;
      if (!form.isConnected) return;
      var v = !!form.__auraFormValidate;
      form.__auraFormValidate = false;
      // A refresh failure must not be swallowed — it can hide validation
      // errors from the user. Surface via Aura.error (#336 #362).
      try { refresh(form, v); } catch (e) { Aura.error("[Aura] aura-form refresh", e); }
    });
  }

  /* ---- Custom element -------------------------------------------------- */
  /* Summary: coordinates declarative field dependencies — gating, ordering,
     and auto-populate — for the aura-field descendants in its subtree.
     Extends Aura.BaseElement for the shared __init lifecycle guard. */
  Aura.define("aura-form", class extends Aura.BaseElement {
    /* Attach change/input/mutation listeners once (_bind hook). */
    _bind() {
      var self = this;
      var onChange = function () { scheduleWork(self, false); };
      this.__auraFormOnChange = onChange;
      this.addEventListener("change", onChange);
      this.addEventListener("input", onChange);
      this.addEventListener("aura:change", onChange); // aura-select / aura-switch

      /* childList only: the gate mutates attributes/properties, never nodes,
         so structural swaps re-gate without the gate retriggering us. */
      if ("MutationObserver" in window) {
        var mo = new MutationObserver(function () { scheduleWork(self, true); });
        mo.observe(this, { childList: true, subtree: true });
        this.__auraFormObserver = mo;
      }
    }

    /* Schedule an initial gate pass on every connect (_sync hook). */
    _sync() {
      scheduleWork(this, true); // microtask: lets child elements finish upgrading
    }

    /* Tear down listeners and observer on disconnect. This _bind() attaches ALL
       its listeners to the HOST (change/input/aura:change) plus a subtree
       observer — and removes every one of them here — so a re-insert genuinely
       needs a fresh _bind(). Clear __bound (the #439 bind-once flag) alongside
       the super __init reset so connectedCallback re-binds; without it the
       surviving-flag would skip _bind() and the re-inserted form would gate
       nothing. (Contrast a control that leaves its listeners attached across the
       disconnect — there __bound must SURVIVE to avoid duplicate handlers.) */
    disconnectedCallback() {
      if (this.__auraFormOnChange) {
        this.removeEventListener("change", this.__auraFormOnChange);
        this.removeEventListener("input", this.__auraFormOnChange);
        this.removeEventListener("aura:change", this.__auraFormOnChange);
        this.__auraFormOnChange = null;
      }
      if (this.__auraFormObserver) { this.__auraFormObserver.disconnect(); this.__auraFormObserver = null; }
      this.__bound = false; // listeners fully removed above — re-insert re-binds
      super.disconnectedCallback(); // resets __init so a re-insert re-builds + re-binds
    }
  });

  /* ---- Public hook ----------------------------------------------------- */
  /* Re-gate every aura-form under root (default document) — for manual inserts
     that bypass the element lifecycle and HTMX. */
  Aura.form = {
    refresh: function (root) {
      var forms = (root || document).querySelectorAll("aura-form");
      for (var i = 0; i < forms.length; i++) scheduleWork(forms[i], true);
    }
  };
})();
