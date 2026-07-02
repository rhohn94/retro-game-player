/* ==========================================================================
   Aura — shared base for native-input-backed labeled controls.

   FormControlBase consolidates the DOM scaffold + native-input mirror + form
   accessors that checkbox.js and radio.js previously hand-rolled near-verbatim
   (issue #194). Both controls are the same shape: a light-DOM custom element
   that styles ONE addressable visual sub-part (the box / the dot) while a real,
   visually-hidden native <input> is the engine — it supplies the keyboard
   semantics, native form submission (name=value), and the implicit
   role/aria-checked. A wrapping <label> makes the whole control clickable and
   names the input from the authored label content.

   Subclasses declare three statics describing their BEM + input shape:
     _prefix       BEM block, e.g. "aura-checkbox" / "aura-radio"
     _inputType    native input type, e.g. "checkbox" / "radio"
     _visualClass  the addressable visual sub-part suffix, e.g. "box-visual" / "dot"
   and may override the BaseElement hooks (_bind for control-specific change
   wiring, _sync for extra attribute mirroring) — calling super._sync() first.

   The visual sub-part is the glow target (host detects approach; only the box /
   dot lights, never the label text) — wired here once via _wireGlowTarget.

   Load order: core.js → element-base.js → form-control-base.js →
   (checkbox/radio). See docs/design/control-widgets-design.md.
   ========================================================================== */
(function () {
  "use strict";
  /* SSR guard (#416): no-op outside the browser so SSR/RSC frameworks can
     evaluate this module (and the dist bundle) in Node without crashing. */
  if (typeof window === "undefined" || typeof document === "undefined") return;
  var Aura = window.Aura;
  if (!Aura || !Aura.BaseElement) return;

  /* Summary: HTMLElement subclass (via Aura.BaseElement) hosting the shared
     label/input/visual scaffold, the native-input attribute mirror, and the
     checked/value accessors for native-input-backed labeled controls. Not
     registered itself; aura-checkbox / aura-radio extend it. */
  Aura.FormControlBase = class extends Aura.BaseElement {
    /* Real form association (#538): the HOST is the form-associated element via
       ElementInternals, not the inner native <input>. When internals are
       available the inner input is taken OUT of form submission (its name is
       cleared in _sync) so the field is submitted exactly once — by the host —
       and native <form>.reset() / fieldset-disable route through the shared
       form-association layer. On engines without ElementInternals the layer is a
       no-op and the inner input keeps its name, preserving legacy submission. */
    static formAssociated = true;

    connectedCallback() {
      this._initFormInternals();   // attach ElementInternals once (idempotent)
      /* Snapshot the as-authored checked default for formResetCallback, once. */
      if (this.__formDefaultChecked === undefined) {
        this.__formDefaultChecked = this.hasAttribute("checked");
      }
      super.connectedCallback();   // BaseElement: build/bind/_sync (publishes value)
      this._syncFormValue();
    }

    /* Subclasses MUST override these three statics. */
    static get _prefix() { return ""; }
    static get _inputType() { return "checkbox"; }
    static get _visualClass() { return "visual"; }

    /* Convenience instance reads of the subclass statics. */
    get _prefix() { return this.constructor._prefix; }
    get _inputType() { return this.constructor._inputType; }
    get _visualClass() { return this.constructor._visualClass; }

    /* ---- internal DOM (idempotent; reuses an existing build on reconnect) -- */
    /* Build <label><input><visual><label-text></label> from authored content,
       or reuse a server-rendered / HTMX-reconnected structure. The wrapping
       <label> gives the native input its accessible name from the label text. */
    _build() {
      var p = this._prefix;
      this.__box = this.querySelector(":scope > ." + p + "__box");
      if (this.__box) {
        // Reuse the existing structure (HTMX reconnect / repeated connectedCallback).
        this.__input     = this.__box.querySelector("." + p + "__input");
        this.__boxVisual = this.__box.querySelector("." + p + "__" + this._visualClass);
        this.__label     = this.__box.querySelector("." + p + "__label");
      } else {
        var box = document.createElement("label");
        box.className = p + "__box";

        var input = document.createElement("input");
        input.type = this._inputType;
        input.className = p + "__input";

        var boxVisual = document.createElement("span");
        boxVisual.className = p + "__" + this._visualClass;
        boxVisual.setAttribute("aria-hidden", "true");

        var label = document.createElement("span");
        label.className = p + "__label";
        /* Move the authored label content (text or markup) into the label span,
           so the wrapping <label> gives the input its accessible name. */
        while (this.firstChild) label.appendChild(this.firstChild);

        box.appendChild(input);
        box.appendChild(boxVisual);
        box.appendChild(label);
        this.appendChild(box);

        this.__box       = box;
        this.__input     = input;
        this.__boxVisual = boxVisual;
        this.__label     = label;
      }

      // Sub-part glow: host detects approach; the box / dot lights — not the
      // label text. (Inherited from Aura.BaseElement; idempotent on reconnect.)
      this._wireGlowTarget(this.__boxVisual);
    }

    /* ---- mirror host attributes onto the native input --------------------- */
    /* Reflect name / value (default = label text) / checked / disabled from the
       host onto the backing native input. Runs on connect and attribute changes.
       Subclasses needing extra attributes (e.g. indeterminate) override and call
       super._sync() first. */
    _sync() {
      var input = this.__input;
      if (!input) return;
      /* When the HOST is form-associated via ElementInternals, the host submits
         the field — so the inner native input MUST NOT also submit it (that
         would post name=value twice). Clear its name in that case; otherwise
         (no internals) keep mirroring name so legacy submission still works.
         EXCEPTION (radio): a radio group's mutual-exclusion + arrow-key roving
         is driven by the inner inputs SHARING a name within the form, so radio
         keeps its inner name and delegates submission to that native input
         (_submitsViaInnerInput=true); its host internals exist purely for
         formReset/formDisabled coordination and publish no value (#538). */
      input.name  = (this.__internals && !this._submitsViaInnerInput)
        ? "" : (this.getAttribute("name") || "");
      input.value = this.hasAttribute("value")
        ? this.getAttribute("value")
        : (this.__label ? this.__label.textContent.trim() : "");
      input.checked  = this.hasAttribute("checked");
      input.disabled = this._isDisabled();
      /* The role=checkbox/radio lives on the visually-hidden inner input, not the
         roleless host, so forward aura-field's labelling + validity (aria-invalid,
         aria-describedby, aria-labelledby) onto it — mirroring the stepper/tag-
         input _forwardAria path so an erroring field is announced against the
         actual widget (#679). _nameInput runs AFTER to own the aria-label
         resolution (inner <label> wins over a forwarded host aria-label). */
      this._forwardAria(input);
      this._nameInput();
      this._syncFormValue(); // publish host name=value to the owning form
    }

    /* Ensure the backing native input has a programmatic accessible name. The
       wrapping inner <label> already names it from the authored label content;
       this only kicks in when that content is EMPTY (icon-only control, or text
       supplied by an OUTER label that the inner <label> shadows) — deriving the
       name from the host's label/aria-label attribute or an enclosing <label>
       (the shared v3.6 accessible-name convention). */
    _nameInput() {
      var input = this.__input;
      if (!input) return;
      var labelText = this.__label ? this.__label.textContent.replace(/\s+/g, " ").trim() : "";
      if (labelText) { input.removeAttribute("aria-label"); return; } // inner label names it
      if (this.getAttribute("aria-labelledby")) return;
      var name = this.getAttribute("label") || this.getAttribute("aria-label") || this._enclosingLabelText();
      if (name) input.setAttribute("aria-label", name);
    }

    /* ---- public accessors -------------------------------------------------- */
    /* Whether the control is checked (reflected to the [checked] attribute). */
    get checked() { return this.hasAttribute("checked"); }
    set checked(v) {
      if (v) this.setAttribute("checked", "");
      else   this.removeAttribute("checked");
    }

    /* The value submitted with the form when checked (defaults to label text). */
    get value() {
      return this.__input
        ? this.__input.value
        : (this.getAttribute("value") || "");
    }
    set value(v) { this.setAttribute("value", String(v)); }
  };

  /* Form-association layer (#538): a checkbox/radio submits name=value only when
     checked (value defaults to the label text, matching the inner-input value),
     and is omitted from FormData when unchecked — the native convention. Reset
     restores the as-authored checked state. */
  Aura.FormAssociated && Aura.FormAssociated.install(Aura.FormControlBase, {
    value: function () {
      /* Radio delegates submission to its native inner input (shared-name group
         semantics), so the host publishes no value to avoid double submission. */
      if (this._submitsViaInnerInput) return null;
      if (!this.hasAttribute("checked")) return null; // unchecked → omitted
      return this.value;                              // label text or [value]
    },
    reset: function () {
      if (this.__formDefaultChecked) this.setAttribute("checked", "");
      else this.removeAttribute("checked");
    }
  });
})();
