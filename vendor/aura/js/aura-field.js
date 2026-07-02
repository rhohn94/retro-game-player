/* ==========================================================================
   Aura — aura-field: labelled form-field wrapper.

   Wraps a form control — a native <input>/<select>/<textarea> OR an Aura
   control host (aura-checkbox/aura-radio/aura-switch/aura-range and any
   [role=slider]) — rendering the label, the hint/error text, and the
   proximity-glow affordance, and wiring for / aria-labelledby /
   aria-describedby / aria-invalid. Light-DOM + CSS-first; JS builds the
   surrounding structure and keeps ARIA in sync. See the matcher contract in
   docs/design/form-flow-design.md and docs/design/declarative-markup-design.md.

   Load order: core.js → element-base.js → aura-field.js (self-registers).
   ========================================================================== */
(function () {
  "use strict";
  /* SSR guard (#416): no-op outside the browser so SSR/RSC frameworks can
     evaluate this module (and the dist bundle) in Node without crashing. */
  if (typeof window === "undefined" || typeof document === "undefined") return;
  var Aura = window.Aura;
  if (!Aura || !Aura.BaseElement) return;

  /* Recognised field controls, matched in document order (querySelector returns
     the first in the tree, not in list order). A custom control HOST is listed
     so it — not a hidden form input it nests — becomes the label target; the
     [type=hidden] guard keeps such inputs from ever winning. Adding a new
     control type (e.g. a future picker host) is a one-token edit here, never a
     new code branch — see the matcher contract in form-flow-design.md. */
  var CONTROL_SELECTOR =
    "input:not([type='hidden']), select, textarea, " +
    "aura-checkbox, aura-radio, aura-switch, aura-range, aura-stepper, " +
    "aura-tag-input, aura-editor, [role='slider']";

  /* Native form controls a plain <label for> can name (and that the glow span
     can wrap). Everything else the matcher returns is a custom host, named via
     aria-labelledby and owning its own glow. */
  function isNativeControl(el) {
    if (!el) return false;
    var tag = el.tagName.toLowerCase();
    return tag === "input" || tag === "select" || tag === "textarea";
  }

  /* Append id to an element's aria-* token list (deduplicated). */
  function addToken(ctrl, attr, id) {
    var cur = (ctrl.getAttribute(attr) || "").split(/\s+/).filter(Boolean);
    if (cur.indexOf(id) === -1) cur.push(id);
    ctrl.setAttribute(attr, cur.join(" "));
  }

  function addDescribedBy(ctrl, id) { addToken(ctrl, "aria-describedby", id); }

  /* Remove id from an element's aria-* token list, dropping the attribute
     entirely once empty so no stale/empty token list lingers. */
  function removeToken(ctrl, attr, id) {
    if (!ctrl || !ctrl.hasAttribute(attr)) return;
    var cur = (ctrl.getAttribute(attr) || "").split(/\s+/).filter(Boolean);
    var next = cur.filter(function (t) { return t !== id; });
    if (next.length) ctrl.setAttribute(attr, next.join(" "));
    else ctrl.removeAttribute(attr);
  }

  function removeDescribedBy(ctrl, id) { removeToken(ctrl, "aria-describedby", id); }

  /* Summary: labelled field wrapper; builds label/hint/error nodes around a
     contained native control and wires for / aria-describedby / aria-invalid.
     Extends Aura.BaseElement for the shared lifecycle + attribute-guard boilerplate. */
  Aura.define("aura-field", class extends Aura.BaseElement {
    static get observedAttributes() { return ["label", "hint", "error", "layout"]; }

    /* _build and _wrapControl run once on first connect (BaseElement._build hook). */
    _build() {
      this._buildField();
      this._wrapControl();
    }

    /* Reflect error state + layout on every connect (BaseElement._sync hook). */
    _sync() {
      this._reflectError();
      this._reflectLayout();
    }

    /* Route attribute changes without repeating the isConnected/__init guard
       (BaseElement.attributeChangedCallback already checks both). */
    _onAttr(name) {
      if (name === "label") this._syncLabel();
      else if (name === "hint") this._buildField();
      else if (name === "layout") this._reflectLayout();
      else this._reflectError();
    }

    /* The field's logical control: a native input/select/textarea OR an Aura
       control host (checkbox/radio/switch/slider). Null when the field wraps
       neither. See the matcher contract in form-flow-design.md. */
    _control() { return this.querySelector(CONTROL_SELECTOR); }

    /* Put the edge glow on the control itself, never the label/hint. Native
       form controls are replaced elements and can't host the rim pseudo, so we
       wrap the control in a span that carries .aura-glow. Custom control hosts
       (and controls nested in a child custom element, e.g. aura-select) manage
       their own glow — skip. */
    _wrapControl() {
      var ctrl = this._control();
      if (!isNativeControl(ctrl)) return; // custom hosts own their glow
      if (ctrl.parentNode !== this) return; // nested or already wrapped
      var wrap = document.createElement("span");
      wrap.className = "aura-field__control aura-glow";
      this.insertBefore(wrap, ctrl);
      wrap.appendChild(ctrl);
    }

    /* Bind the field label to its control. A native control uses the platform
       <label for> link (which also makes the label click-to-focus); a custom
       host is not labelable by `for`, so it is named via aria-labelledby on the
       host instead. */
    _associateLabel(labelEl, ctrl) {
      if (isNativeControl(ctrl)) {
        labelEl.htmlFor = ctrl.id;
      } else {
        if (!labelEl.id) labelEl.id = Aura.nextId("aura-lbl-");
        addToken(ctrl, "aria-labelledby", labelEl.id);
      }
    }

    /* Build (idempotently) the label and hint nodes from the host attributes,
       assigning the control an id and wiring for / aria-describedby. */
    _buildField() {
      var ctrl = this._control();
      if (ctrl && !ctrl.id) ctrl.id = Aura.nextId("aura-ctrl-");
      this._ensureLabel(ctrl);
      var hint = this.getAttribute("hint");
      var existingHint = this.querySelector(":scope > .aura-field__hint");
      if (hint) {
        if (!existingHint) {
          var h = document.createElement("small");
          h.className = "aura-field__hint";
          h.id = Aura.nextId("aura-hint-");
          h.textContent = hint;
          this.appendChild(h);
          if (ctrl) addDescribedBy(ctrl, h.id);
        } else {
          existingHint.textContent = hint;
        }
      } else if (existingHint) {
        /* Hint cleared: drop its id from aria-describedby before removing the
           node so no dangling AT reference remains (#615), mirroring the error
           path. */
        if (ctrl) removeDescribedBy(ctrl, existingHint.id);
        existingHint.remove();
      }
    }

    /* Create-or-update-or-remove the label node to match the `label` attribute,
       associating it with the control and inserting it at the field head. Shared
       by _buildField (first build) and the runtime `label` attribute path so a
       label set AFTER build — when none existed at connect — creates the node
       rather than no-opping (#649), and clearing it back to empty removes the
       node + its for/aria-labelledby association leaving no dangling token.

       Only labels THIS element creates are managed (marked data-aura-label-auto):
       an author-rendered <label class="aura-field__label" for> (the common
       server-rendered form) is never created, rewritten, or removed here — the
       host's `label` attribute and an authored label node are mutually exclusive
       authoring paths. This is what makes the no-`label`-attribute settings.html
       fields keep their authored labels (and accessible names). */
    _ensureLabel(ctrl) {
      if (arguments.length === 0) ctrl = this._control();
      var lblText = this.getAttribute("label");
      var existing = this.querySelector(":scope > label.aura-field__label");
      var auto = existing && existing.hasAttribute("data-aura-label-auto") ? existing : null;
      if (lblText) {
        /* An authored label already names the control — defer to it, don't add a
           competing managed one. */
        if (existing && !auto) return;
        if (!auto) {
          auto = document.createElement("label");
          auto.className = "aura-field__label";
          auto.setAttribute("data-aura-label-auto", "");
          if (ctrl) this._associateLabel(auto, ctrl);
          this.insertBefore(auto, this.firstChild);
        }
        auto.textContent = lblText;
      } else if (auto) {
        /* `label` cleared back to empty: drop the association before removing the
           managed node so no stale <label for> / aria-labelledby token remains
           (#649), mirroring the hint/error cleanup paths (#615). An authored
           label (no auto marker) is left untouched. */
        if (ctrl && !isNativeControl(ctrl) && auto.id) {
          removeToken(ctrl, "aria-labelledby", auto.id);
        }
        auto.remove();
      }
    }

    /* Route a runtime `label` change through the create-if-absent path (#649). */
    _syncLabel() { this._ensureLabel(); }

    /* Reflect the `layout` attribute as a data-layout attribute on the host.
       When layout="row" is set, the host gets data-layout="row" which CSS
       targets to produce a horizontal label+control flex layout (#410B). */
    _reflectLayout() {
      if (this.getAttribute("layout") === "row") {
        this.setAttribute("data-layout", "row");
      } else {
        this.removeAttribute("data-layout");
      }
    }

    /* Show/hide the error node and reflect aria-invalid + the [invalid] hook. */
    _reflectError() {
      var ctrl = this._control();
      var msg = this.getAttribute("error");
      var node = this.querySelector(":scope > .aura-field__error");
      if (msg) {
        if (!node) {
          node = document.createElement("small");
          node.className = "aura-field__error";
          node.id = Aura.nextId("aura-err-");
          /* role=alert makes the node an assertive live region so a runtime-set
             error is ANNOUNCED on appearance — aria-describedby alone is only
             read at focus time, leaving an error set while focus is elsewhere
             silent to AT (WCAG 4.1.3; #677). */
          node.setAttribute("role", "alert");
          this.appendChild(node);
        }
        node.textContent = msg;
        this.setAttribute("invalid", "");
        if (ctrl) { ctrl.setAttribute("aria-invalid", "true"); addDescribedBy(ctrl, node.id); }
      } else {
        if (node) {
          /* Strip the now-dead id from aria-describedby BEFORE removing the
             node, otherwise the control keeps a token pointing at a missing
             element — a broken AT reference after every set-then-clear cycle
             (#615). */
          if (ctrl) removeDescribedBy(ctrl, node.id);
          node.remove();
        }
        this.removeAttribute("invalid");
        if (ctrl) ctrl.removeAttribute("aria-invalid");
      }
    }
  });
})();
