/* ==========================================================================
   Aura — attribute-mirroring and accessible-name mixin for BaseElement.

   Patches ARIA-forwarding and accessible-name resolution methods onto
   Aura.BaseElement.prototype so those concerns live in their own module,
   separate from the lifecycle scaffolding in element-base.js. Every
   BaseElement subclass inherits these methods automatically.

   Extracted from element-base.js (v3.85 — #340, element-base decomposition).
   See docs/design/element-base-design.md for the full decomposition rationale.

   Summary: attribute-mirroring collaborator — _forwardAria /
   _ensureAccessibleName / _enclosingLabelText.

   Load order: core.js → element-base.js → attr-mirror.js
   ========================================================================== */
(function () {
  "use strict";
  /* SSR guard (#416): no-op outside the browser so SSR/RSC frameworks can
     evaluate this module (and the dist bundle) in Node without crashing. */
  if (typeof window === "undefined" || typeof document === "undefined") return;
  var Aura = window.Aura;
  if (!Aura || !Aura.BaseElement) return;

  var proto = Aura.BaseElement.prototype;

  /* ---- Labelling forwarding ----------------------------------------------- */
  /* For composite controls whose real ARIA widget is a nested input (stepper,
     tag-input), aura-field names/describes the HOST (aria-labelledby etc.),
     but the accessible name must land on the focusable inner control. Copy the
     host's labelling attributes onto `inner` so screen readers announce the
     field label against the actual widget. Subclasses that use this MUST list
     these attributes in observedAttributes so a later field-wiring change
     re-forwards. Idempotent; safe to call from _sync and _onAttr. */
  proto._forwardAria = function (inner) {
    if (!inner) return;
    var attrs = ["aria-labelledby", "aria-describedby", "aria-label", "aria-invalid"];
    for (var i = 0; i < attrs.length; i++) {
      var v = this.getAttribute(attrs[i]);
      if (v != null) inner.setAttribute(attrs[i], v);
      else inner.removeAttribute(attrs[i]);
    }
  };

  /* ---- Uniform accessible-name convention (v3.6) -------------------------- */
  /* Ensure the focusable widget `target` (the host itself, or a nested input)
     carries a programmatic accessible name even when the control is used WITHOUT
     an aura-field. Resolution order, first hit wins:
       1. an aria-label / aria-labelledby ALREADY on target  → leave it (and on
          the host, mirror an authored host aria-label down to a nested target),
       2. the host's own `label` / `aria-label` attribute     → aria-label,
       3. the text of an enclosing <label> element (minus this control's own
          content)                                             → aria-label.
     Returns true once a name is in place. Idempotent; safe to call from _sync.
     The host carries data-aura-named once a derived name is applied so a later
     call doesn't clobber a name the author added in the meantime. */
  proto._ensureAccessibleName = function (target) {
    var t = target || this;
    /* Already named directly — nothing to do (but mirror a host aria-label to a
       nested target so the name lands on the actual widget). */
    if (t !== this && (t.getAttribute("aria-label") || t.getAttribute("aria-labelledby"))) return true;
    if (t === this && (this.getAttribute("aria-label") || this.getAttribute("aria-labelledby"))) return true;

    var name = this.getAttribute("label") || this.getAttribute("aria-label");
    if (!name) name = this._enclosingLabelText();
    if (!name) return false;
    t.setAttribute("aria-label", name);
    this.setAttribute("data-aura-named", "");
    return true;
  };

  /* The trimmed text of the nearest ancestor <label> with this control removed
     from consideration, or "" when there is no such label / it is empty. Used
     to name a control wrapped in a plain <label> that cannot natively name a
     custom widget (role=slider/switch) or whose inner native input is shadowed
     by the control's own inner <label>. */
  proto._enclosingLabelText = function () {
    var lab = this.closest("label");
    if (!lab) return "";
    /* Clone, drop any nested controls, and read the remaining label text so
       the control's own value/markup doesn't pollute the name. */
    var clone = lab.cloneNode(true);
    Array.prototype.forEach.call(
      clone.querySelectorAll("input, select, textarea, " + this.tagName.toLowerCase()),
      function (n) { n.parentNode && n.parentNode.removeChild(n); }
    );
    return (clone.textContent || "").replace(/\s+/g, " ").trim();
  };
})();
