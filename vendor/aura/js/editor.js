/* ==========================================================================
   Aura — text editing surface (aura-editor, v1.9).

   ONE foundation, two faces:
     • plain  — <aura-editor plain> is a minimal, formatting-free editing
                surface (the "sample text editor"): a styled, autosizing
                contenteditable region with selection states and no toolbar.
     • rich   — <aura-editor> (default) layers a WYSIWYG toolbar on the SAME
                surface: bold / italic / underline, headings, lists, link, and
                clear-formatting, with the toolbar buttons reflecting the
                current selection's active formats (aria-pressed).

   The toolbar is built from v1.8 icon-first buttons (aura-button[icon-only])
   with v1.8 tooltips, so it inherits the focus ring, tap targets, and the
   accessible-name-as-tooltip contract for free.

   Commands use document.execCommand. It is deprecated but remains the only
   broadly-supported one-call rich-edit primitive; a full editing model
   (custom Selection/Range command stack) is out of scope for this release and
   noted as a follow-up. Everything degrades gracefully when a command is
   unsupported.

   The element exposes value access: .getHTML() / .setHTML() / .getText(), and
   mirrors its HTML into an optional hidden <input name> for form posting.

   Load order: core.js → element-base.js → editor.js (self-registers).
   See docs/design/text-editing-design.md.
   ========================================================================== */
(function () {
  "use strict";
  /* SSR guard (#416): no-op outside the browser so SSR/RSC frameworks can
     evaluate this module (and the dist bundle) in Node without crashing. */
  if (typeof window === "undefined" || typeof document === "undefined") return;
  var Aura = window.Aura;
  if (!Aura || !("customElements" in window)) return;

  /* ---- Register the formatting icons the toolbar needs (Feather-ish). ---- */
  var ICONS = {
    bold:      '<path d="M6 4h8a4 4 0 0 1 0 8H6z"/><path d="M6 12h9a4 4 0 0 1 0 8H6z"/>',
    italic:    '<line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/>',
    underline: '<path d="M6 3v7a6 6 0 0 0 12 0V3"/><line x1="4" y1="21" x2="20" y2="21"/>',
    heading:   '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>',
    "list-ul": '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3.5" cy="6" r="1.2"/><circle cx="3.5" cy="12" r="1.2"/><circle cx="3.5" cy="18" r="1.2"/>',
    "list-ol": '<line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M3 16h2.5L3 19h2.5"/>',
    link:      '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5"/>',
    "remove-format": '<path d="M4 7V4h16v3"/><line x1="5" y1="20" x2="19" y2="20"/><line x1="9" y1="4" x2="6" y2="20"/><line x1="18" y1="14" x2="22" y2="18"/><line x1="22" y1="14" x2="18" y2="18"/>'
  };
  Object.keys(ICONS).forEach(function (n) {
    if (!Aura.icons.has(n)) Aura.icons.register(n, ICONS[n]);
  });

  /* Toolbar spec: [command, arg, icon, label]. queryable via execCommand. */
  var RICH_TOOLS = [
    ["bold", null, "bold", "Bold"],
    ["italic", null, "italic", "Italic"],
    ["underline", null, "underline", "Underline"],
    ["SEP"],
    ["formatBlock", "<h2>", "heading", "Heading"],
    ["insertUnorderedList", null, "list-ul", "Bulleted list"],
    ["insertOrderedList", null, "list-ol", "Numbered list"],
    ["SEP"],
    ["createLink", "PROMPT", "link", "Insert link"],
    ["removeFormat", null, "remove-format", "Clear formatting"]
  ];

  /* Commands whose pressed-state we reflect from queryCommandState. */
  var STATE_CMDS = ["bold", "italic", "underline", "insertUnorderedList", "insertOrderedList"];

  var AuraEditor = class extends HTMLElement {
    /* Real form association (#538): the rich-text editor posts name=value (its
       HTML) to a native <form> via ElementInternals, participates in reset
       (restore the as-authored content), and propagates <fieldset disabled>. */
    static formAssociated = true;

    /* Re-name the textbox when aura-field wires (or rewires) its labelling onto
       the host, or when an author changes aria-label/labelledby at runtime
       (#694). placeholder is also a name fallback, so observe it too. */
    static get observedAttributes() {
      return ["aria-label", "aria-labelledby", "aria-describedby",
        "aria-invalid", "placeholder", "disabled"];
    }

    attributeChangedCallback(name) {
      if (!this.__built) return;
      /* A directly-authored `disabled` attribute must disable the editor, not
         just a <fieldset disabled> ancestor (#714). Re-reflect the effective
         disabled state (attribute OR fieldset) whenever the attribute toggles,
         matching switch/stepper/range/tag-input which all honor _isDisabled(). */
      if (name === "disabled") this._reflectDisabled();
      else this._nameArea();
    }

    connectedCallback() {
      this._initFormInternals();
      /* Build + bind exactly once per element instance. __built (not reset on
         disconnect) guards against re-running _build on an HTMX re-insert —
         which would otherwise re-capture the already-built toolbar/area as
         "initial content" and corrupt the editor. The selectionchange listener
         is the only thing managed per connect (added here, removed on
         disconnect), since it lives on document, not on this element. */
      if (!this.__built) {
        this.__built = true;
        this._build();
        this._bind();
      }
      if (this._onSel) document.addEventListener("selectionchange", this._onSel);
      /* Re-resolve the accessible name on every connect: aura-field forwards its
         label onto the host AFTER the editor first built, and an HTMX re-insert
         can land the editor under a (new) field/label (#694). */
      if (this.__built) this._nameArea();
      /* Snapshot the as-authored HTML once (after the first build, so getHTML()
         reflects the authored content) for formResetCallback, then publish the
         current value to the owning form. */
      if (this.__formDefaultHTML === undefined) this.__formDefaultHTML = this.getHTML();
      this._applyMirror();
      /* Honor a directly-authored `disabled` attribute from the initial render
         (#714): _build always sets the area editable, so reflect the effective
         disabled state on connect — both <aura-editor disabled> and a
         <fieldset disabled> ancestor land here. */
      this._reflectDisabled();
    }

    /* Resolve and apply the editable area's accessible name AND description/
       validity (#694, #717, WCAG 4.1.2 / 1.3.1). Precedence for the name, first
       hit wins: an aura-field association (aria-labelledby on the host) → host
       aria-label → enclosing <label> text → placeholder. The host's labelling
       attributes are forwarded onto the role=textbox so the name lands on the
       actual widget, and — like stepper/tag-input _forwardAria — the host's
       aria-describedby (the field's hint/error ids, #465) and aria-invalid (its
       error state) are forwarded too, so an aura-field error/hint set on the host
       becomes AT-visible when focus is inside the editor. */
    _nameArea() {
      if (!this._area) return;
      var labelledby = this.getAttribute("aria-labelledby");
      var label = this.getAttribute("aria-label");
      if (labelledby) {
        this._area.setAttribute("aria-labelledby", labelledby);
      } else {
        this._area.removeAttribute("aria-labelledby");
      }
      var name = label || this._enclosingLabelText() || this.getAttribute("placeholder");
      if (!labelledby && name) {
        this._area.setAttribute("aria-label", name);
      } else {
        this._area.removeAttribute("aria-label");
      }
      /* Forward description + validity from the host onto the textbox (#717),
         mirroring the stepper/tag-input _forwardAria convention. The editor owns
         no status live region of its own, so the host's aria-describedby (set by
         aura-field for its hint/error ids, #465) is the sole description source —
         forward it verbatim; clear it when the host drops it. aria-invalid lets
         AT announce the field's error state with focus inside the editor. */
      this._forwardHostAttr("aria-describedby");
      this._forwardHostAttr("aria-invalid");
    }

    /* Copy one host attribute onto the editable area, or clear it when absent —
       the editor's local _forwardAria equivalent for the non-name attributes
       (#717). Idempotent; safe to call from connect/attributeChangedCallback. */
    _forwardHostAttr(attr) {
      if (!this._area) return;
      var v = this.getAttribute(attr);
      if (v != null) this._area.setAttribute(attr, v);
      else this._area.removeAttribute(attr);
    }

    /* Trimmed text of the nearest ancestor <label> with this editor's own
       content removed, or "" — mirrors BaseElement._enclosingLabelText so a
       standalone <label>…<aura-editor></label> names the textbox (#694). */
    _enclosingLabelText() {
      var lab = this.closest("label");
      if (!lab) return "";
      var clone = lab.cloneNode(true);
      Array.prototype.forEach.call(
        clone.querySelectorAll("aura-editor"),
        function (n) { n.parentNode && n.parentNode.removeChild(n); }
      );
      return (clone.textContent || "").replace(/\s+/g, " ").trim();
    }

    /* ---- Build (idempotent) -------------------------------------------- */
    _build() {
      this.classList.add("aura-editor");
      var plain = this.hasAttribute("plain");

      // Capture any author-provided initial content, then re-home it.
      var initial = this.innerHTML.trim();
      this.innerHTML = "";

      // Toolbar (rich mode only).
      if (!plain) {
        this._toolbar = document.createElement("div");
        this._toolbar.className = "aura-editor__toolbar";
        this._toolbar.setAttribute("role", "toolbar");
        this._toolbar.setAttribute("aria-label", "Text formatting");
        this._buildToolbar(this._toolbar);
        this.appendChild(this._toolbar);
      }

      // Editable region.
      this._area = document.createElement("div");
      this._area.className = "aura-editor__area";
      this._area.contentEditable = plain ? "plaintext-only" : "true";
      // plaintext-only is not universally supported; fall back to true.
      if (this._area.contentEditable !== "plaintext-only" && plain) {
        this._area.contentEditable = "true";
        this.__forcePlain = true;
      }
      this._area.setAttribute("role", "textbox");
      this._area.setAttribute("aria-multiline", "true");
      if (this.hasAttribute("placeholder")) {
        this._area.setAttribute("data-placeholder", this.getAttribute("placeholder"));
      }
      this._area.innerHTML = initial;
      this.appendChild(this._area);

      /* Name the role=textbox so it is never a nameless field (#694, WCAG
         4.1.2). aura-field forwards its label onto the host (aura-labelledby);
         this picks that up plus the standalone fallbacks (host aria-label →
         enclosing <label> → placeholder). Re-run on connect/attr via _nameArea. */
      this._nameArea();

      // Optional hidden input mirror for form posting.
      var name = this.getAttribute("name");
      if (name) {
        this._mirror = document.createElement("input");
        this._mirror.type = "hidden";
        this._mirror.name = name;
        this._mirror.value = this.getHTML();
        this.appendChild(this._mirror);
      }
    }

    _buildToolbar(bar) {
      var first = true;
      RICH_TOOLS.forEach(function (t) {
        if (t[0] === "SEP") {
          var sep = document.createElement("span");
          sep.className = "aura-editor__sep";
          sep.setAttribute("role", "separator");
          bar.appendChild(sep);
          return;
        }
        var btn = document.createElement("aura-button");
        btn.setAttribute("icon-only", "");
        btn.setAttribute("icon", t[2]);
        btn.setAttribute("variant", "ghost");
        btn.setAttribute("aria-label", t[3]);
        btn.setAttribute("data-aura-tooltip-from-label", "");
        btn.setAttribute("data-cmd", t[0]);
        if (t[1] != null) btn.setAttribute("data-arg", t[1]);
        if (STATE_CMDS.indexOf(t[0]) !== -1) btn.setAttribute("aria-pressed", "false");
        /* Roving tabindex (WAI-ARIA Toolbar pattern, #547): the toolbar is a
           SINGLE tab stop — only the first button is tabbable (tabindex=0); the
           rest are tabindex=-1 and reachable via the arrow keys wired in _bind.
           aura-button reads `tabindex` (it sets tabIndex itself, but an authored
           tabindex attribute is honored as the focusable surface's index). */
        btn.setAttribute("tabindex", first ? "0" : "-1");
        first = false;
        // Keep focus in the editable area when a toolbar button is pressed.
        btn.addEventListener("mousedown", function (e) { e.preventDefault(); });
        bar.appendChild(btn);
      });
    }

    /* The toolbar's focusable buttons in DOM order (separators excluded). */
    _toolbarButtons() {
      if (!this._toolbar) return [];
      return Array.prototype.slice.call(this._toolbar.querySelectorAll("[data-cmd]"));
    }

    /* Move the roving tab stop to button at `index` (wrapping) and focus it. */
    _focusToolbarButton(index) {
      var btns = this._toolbarButtons();
      if (!btns.length) return;
      var i = ((index % btns.length) + btns.length) % btns.length;
      for (var b = 0; b < btns.length; b++) {
        btns[b].setAttribute("tabindex", b === i ? "0" : "-1");
      }
      btns[i].focus();
    }

    /* ---- Behaviour ----------------------------------------------------- */
    _bind() {
      var self = this;

      if (this._toolbar) {
        this._toolbar.addEventListener("click", function (e) {
          var btn = e.target.closest("[data-cmd]");
          if (!btn) return;
          self._exec(btn.getAttribute("data-cmd"), btn.getAttribute("data-arg"));
        });

        /* Roving-tabindex arrow navigation (WAI-ARIA Toolbar pattern, #547):
           ArrowLeft/Right move (wrapping), Home/End jump to first/last, skipping
           separators. Tab is intentionally NOT handled here so it leaves the
           toolbar to the editable area / next control. */
        this._toolbar.addEventListener("keydown", function (e) {
          var btns = self._toolbarButtons();
          if (!btns.length) return;
          var cur = btns.indexOf(e.target.closest("[data-cmd]"));
          if (cur === -1) return;
          switch (e.key) {
            case "ArrowRight": e.preventDefault(); self._focusToolbarButton(cur + 1); break;
            case "ArrowLeft":  e.preventDefault(); self._focusToolbarButton(cur - 1); break;
            case "Home":       e.preventDefault(); self._focusToolbarButton(0); break;
            case "End":        e.preventDefault(); self._focusToolbarButton(btns.length - 1); break;
            default: break;
          }
        });

        /* Keep the roving tab stop in sync when a button receives focus by any
           means (pointer, programmatic) so a later Tab return lands on the
           last-used control rather than always the first. */
        this._toolbar.addEventListener("focusin", function (e) {
          var btn = e.target.closest("[data-cmd]");
          if (!btn) return;
          var btns = self._toolbarButtons();
          for (var b = 0; b < btns.length; b++) {
            btns[b].setAttribute("tabindex", btns[b] === btn ? "0" : "-1");
          }
        });
      }

      // Mirror content on input. (The selectionchange listener is added per
      // connect in connectedCallback, since it lives on document.)
      this._area.addEventListener("input", function () { self._syncMirror(); });
      this._onSel = function () {
        // Only react while the selection is inside this editor.
        var sel = document.getSelection();
        if (!sel || !sel.anchorNode || !self._area.contains(sel.anchorNode)) return;
        self._reflectState();
      };

      // Plain-mode safety: strip pasted HTML to text when we had to fall back
      // from plaintext-only to a normal contenteditable.
      if (this.__forcePlain) {
        this._area.addEventListener("paste", function (e) {
          e.preventDefault();
          var text = (e.clipboardData || window.clipboardData).getData("text");
          document.execCommand("insertText", false, text);
        });
      }
    }

    disconnectedCallback() {
      // Keep __built set so a re-insert reuses the existing DOM (idempotent).
      if (this._onSel) document.removeEventListener("selectionchange", this._onSel);
      /* If the editor is removed while the link prompt is open, close it so the
         dialog.js background isolation (inert/aria-hidden/scroll-lock) and the
         focus trap are torn down — otherwise pop.__restoreBg/__untrap would
         never run and the detached page is left permanently locked + inert
         (#673; same disconnect-while-open leak class as #455/#502/#624). */
      var pop = this._linkPrompt;
      if (pop && !pop.hidden && pop.__close) pop.__close();
    }

    _exec(cmd, arg) {
      /* A disabled editor (authored `disabled` or fieldset, #714) accepts no
         formatting commands, matching the no-mutation-when-disabled contract the
         value-bearing controls share (#509). */
      if (this._isDisabled()) return;
      this._area.focus();
      if (arg === "PROMPT") {
        /* Link insertion uses a non-blocking, token-styled in-component prompt
           instead of window.prompt — the native dialog can't be themed, is
           suppressed in some sandboxed/embedded contexts (silent no-op), and
           jars next to Aura's glass design language (#568). The selection is
           captured now and restored before execCommand runs, since opening the
           prompt moves focus out of the editable area. */
        this._openLinkPrompt(cmd);
        return;
      }
      try { document.execCommand(cmd, false, arg); }
      catch (e) { Aura.warn("[aura-editor] command failed:", cmd, e); }
      this._syncMirror();
      this._reflectState();
    }

    /* Apply a queued command + arg with the saved selection restored. */
    _applyCommand(cmd, arg, savedRange) {
      this._area.focus();
      if (savedRange) {
        var sel = document.getSelection();
        if (sel) { sel.removeAllRanges(); sel.addRange(savedRange); }
      }
      try { document.execCommand(cmd, false, arg); }
      catch (e) { Aura.warn("[aura-editor] command failed:", cmd, e); }
      this._syncMirror();
      this._reflectState();
    }

    /* Build (once) and open the in-component link prompt popover. Captures the
       current selection so it survives the focus move into the prompt input. */
    _openLinkPrompt(cmd) {
      var self = this;
      var sel = document.getSelection();
      var savedRange = (sel && sel.rangeCount && this._area.contains(sel.anchorNode))
        ? sel.getRangeAt(0).cloneRange() : null;

      var pop = this._linkPrompt;
      if (!pop) {
        pop = document.createElement("div");
        pop.className = "aura-editor__link-prompt";
        pop.setAttribute("role", "dialog");
        pop.setAttribute("aria-label", "Insert link");

        var field = document.createElement("aura-field");
        var lab = document.createElement("span");
        lab.className = "label";
        lab.textContent = "Link URL";
        var input = document.createElement("input");
        input.type = "url";
        input.className = "aura-input aura-editor__link-input";
        input.placeholder = "https://";
        field.append(lab, input);

        var actions = document.createElement("div");
        actions.className = "aura-editor__link-actions";
        var insertBtn = document.createElement("aura-button");
        insertBtn.setAttribute("variant", "primary");
        insertBtn.textContent = "Insert";
        var cancelBtn = document.createElement("aura-button");
        cancelBtn.setAttribute("variant", "ghost");
        cancelBtn.textContent = "Cancel";
        actions.append(cancelBtn, insertBtn);

        pop.append(field, actions);
        this.appendChild(pop);
        this._linkPrompt = pop;
        this._linkInput = input;

        /* Real modal focus management (#619). Rather than re-rolling a focus
           trap + background inert, reuse the shared dialog.js machinery
           (Aura.dialog.trapFocus / .isolateBackground), the same utilities
           aura-dialog uses since #546. close() tears both down and restores
           focus to the editable area; Escape from ANYWHERE inside the prompt
           (input or buttons) dismisses, and Tab cycles only the prompt's
           controls. aria-modal advertises the semantics the trap now backs. */
        pop.setAttribute("aria-modal", "true");
        function close() {
          if (pop.__untrap) { pop.__untrap(); pop.__untrap = null; }
          if (pop.__restoreBg) { pop.__restoreBg(); pop.__restoreBg = null; }
          pop.hidden = true;
          self._area.focus();
        }
        function confirm() {
          var url = (input.value || "").trim();
          var c = pop.__cmd, r = pop.__range;
          close();
          if (url) self._applyCommand(c, url, r);
        }
        pop.__close = close;
        cancelBtn.addEventListener("click", close);
        insertBtn.addEventListener("click", confirm);
        input.addEventListener("keydown", function (e) {
          if (e.key === "Enter") { e.preventDefault(); confirm(); }
        });
        /* Escape on any control inside the prompt closes it (not just the
           input), matching dialog ESC semantics. */
        pop.addEventListener("keydown", function (e) {
          if (e.key === "Escape") { e.preventDefault(); close(); }
        });
      }

      pop.__cmd = cmd;
      pop.__range = savedRange;
      pop.hidden = false;
      /* Isolate the background + trap focus while open, reusing dialog.js. */
      if (Aura.dialog) {
        if (Aura.dialog.isolateBackground) pop.__restoreBg = Aura.dialog.isolateBackground(pop);
        if (Aura.dialog.trapFocus) pop.__untrap = Aura.dialog.trapFocus(pop);
      }
      this._linkInput.value = "https://";
      this._linkInput.focus();
      this._linkInput.select();
    }

    _reflectState() {
      if (!this._toolbar) return;
      var btns = this._toolbar.querySelectorAll("[aria-pressed]");
      for (var i = 0; i < btns.length; i++) {
        var cmd = btns[i].getAttribute("data-cmd");
        var on = false;
        try { on = document.queryCommandState(cmd); } catch (e) { on = false; }
        btns[i].setAttribute("aria-pressed", on ? "true" : "false");
      }
    }

    /* Quiet core (#687, the #642/#633 convention): reflect the current content
       into the hidden `name` mirror WITHOUT emitting aura:change. This is the
       programmatic path — the public setHTML setter uses it, matching every
       other value-bearing control (stepper _apply / tag-input _applyTags /
       switch/checkbox/select). A controlled binding, draft restore, or React
       render therefore does NOT falsely dirty a data-aura-guard form. */
    _applyMirror() {
      if (this._mirror) this._mirror.value = this.getHTML();
      this._syncFormValue(); // publish name=HTML to the owning form (#538)
    }

    /* User-gesture path: reflect the mirror then emit aura:change. Reached only
       from a real edit (the `input` listener), preserving the real-gesture
       contract. Uses the uniform `aura:change` namespace shared by every
       value-bearing control so framework bridges need no editor special-case
       (#459); the detail carries { html, text }. */
    _syncMirror() {
      this._applyMirror();
      this.dispatchEvent(new CustomEvent("aura:change", {
        bubbles: true, detail: { html: this.getHTML(), text: this.getText() }
      }));
    }

    /* ---- Public value API ---------------------------------------------- */
    getHTML() { return this._area ? this._area.innerHTML : ""; }
    getText() { return this._area ? this._area.textContent : ""; }
    /* Programmatic value write: quiet (no aura:change), so a controlled write /
       draft restore never dirties a guarded form (#687). */
    setHTML(html) { if (this._area) { this._area.innerHTML = html || ""; this._applyMirror(); } return this; }

    /* Fieldset-disable propagation (#538): the platform fires this when an
       ancestor <fieldset disabled> (or the form) toggles. Record the flag and
       re-reflect the EFFECTIVE state (#714). We deliberately do NOT mirror the
       fieldset state onto the host `disabled` content attribute: on a
       form-associated custom element a disabled content attribute makes the
       element "actually disabled", pinning the state and suppressing the
       platform's re-ENABLE callback — so the fieldset could never be undone. */
    formDisabledCallback(disabled) {
      this.__formDisabled = !!disabled;
      this._reflectDisabled();
    }

    /* The editor's EFFECTIVE disabled state: a directly-authored `disabled`
       content attribute OR a fieldset/form-driven disable recorded by
       formDisabledCallback (#714). Mirrors the shared FormAssociated
       _isDisabled() the other controls use; the editor overrides nothing here
       since the mixin already installs that helper. */
    _reflectDisabled() {
      var disabled = this._isDisabled();
      if (disabled) this.setAttribute("data-disabled", "");
      else this.removeAttribute("data-disabled");
      this.setAttribute("aria-disabled", disabled ? "true" : "false");
      if (this._area) this._area.setAttribute("contenteditable", disabled ? "false" : (this.hasAttribute("plain") && !this.__forcePlain ? "plaintext-only" : "true"));
      /* Propagate the effective disabled state to the formatting toolbar (#718).
         _exec already early-returns when disabled, but without this the toolbar
         <aura-button>s stay focusable (the first is tabindex=0) and AT announces
         them operable even though they silently no-op. aura-button supports
         `disabled` fully, so setting it makes them non-focusable (it forces
         tabindex=-1) and announced disabled. On re-enable, aura-button leaves the
         now -1 authored tabindex untouched (it honors an authored tabindex for
         the roving-tabindex toolbar, #547), so we re-establish the single roving
         tab stop here — first button tabbable, the rest reachable via arrows. */
      var btns = this._toolbarButtons();
      btns.forEach(function (btn, i) {
        if (disabled) {
          btn.setAttribute("disabled", "");
        } else {
          btn.removeAttribute("disabled");
          btn.setAttribute("tabindex", i === 0 ? "0" : "-1");
        }
      });
    }
  };

  /* Form-association layer (#538): the editor is formAssociated so native
     <form>.reset() restores the as-authored content and <fieldset disabled>
     propagates. Submission delegates to the legacy host-named hidden mirror when
     one exists (it is built only when `name` is set), so we publish via
     ElementInternals ONLY when there is no mirror — avoiding a double `name=…`
     field while still posting the HTML in both shapes. */
  Aura.FormAssociated && Aura.FormAssociated.install(AuraEditor, {
    value: function () { return this._mirror ? null : this.getHTML(); },
    reset: function () { this.setHTML(this.__formDefaultHTML || ""); }
  });

  Aura.define("aura-editor", AuraEditor);
})();
