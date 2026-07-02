/* ==========================================================================
   Aura — aura-steps: declarative step indicator element (v3.84).

   NOTE: This is NOT aura-stepper (the number-input spinbutton at js/aura-stepper.js).
   This element renders the `.aura-steps` wizard/step-indicator recipe.

   The CSS-first declarative form of the `.aura-steps` recipe (css/components.css).
   The author can either supply authored <li> children (pass-through mode):

     <aura-steps>
       <li data-state="complete"><span class="aura-steps__marker">1</span>
         <span class="aura-steps__label">Account</span></li>
       <li data-state="current"><span class="aura-steps__marker">2</span>
         <span class="aura-steps__label">Shipping</span></li>
     </aura-steps>

   Or use the codegen mode with `data-steps` JSON:

     <aura-steps data-steps='[{"label":"Account","state":"complete"},
       {"label":"Shipping","state":"current"},{"label":"Payment","state":"upcoming"}]'>
     </aura-steps>

   In both modes the element manages aria-current="step" on the current step's <li>.
   The legacy `<ol class="aura-steps">` markup keeps working unchanged (#405).

   Lifecycle comes from Aura.BaseElement (js/element-base.js): _build runs once,
   _sync reflects attributes on every connect, _onAttr re-syncs on change.

   Load order: core.js → element-base.js → aura-steps.js (self-registers).
   See docs/design/declarative-markup-design.md.
   ========================================================================== */
(function () {
  "use strict";
  /* SSR guard (#416): no-op outside the browser so SSR/RSC frameworks can
     evaluate this module (and the dist bundle) in Node without crashing. */
  if (typeof window === "undefined" || typeof document === "undefined") return;
  var Aura = window.Aura;
  if (!Aura || !Aura.BaseElement) return;

  /* Summary: declarative step indicator; reuses the .aura-steps recipe, rendering
     steps from either authored <li> light-DOM children (pass-through) or a
     data-steps JSON attribute (codegen), and managing aria-current="step". */
  Aura.define("aura-steps", class extends Aura.BaseElement {
    static get observedAttributes() {
      return ["data-steps"];
    }

    /* One-time: wrap authored <li> children into an <ol>, or render from
       data-steps JSON if present. Reuses an existing <ol> on reconnect. */
    _build() {
      this.classList.add("aura-steps");
      var stepsJson = this.getAttribute("data-steps");
      if (stepsJson) {
        /* Codegen mode: render the <ol> from JSON. */
        this._renderFromJson(stepsJson);
      } else {
        /* Pass-through mode: wrap authored <li> children into an <ol>. */
        this._wrapLooseSteps();
      }
    }

    /* Reflect aria-current on each connect (idempotent). */
    _sync() {
      this._markCurrentStep();
    }

    /* On data-steps attribute change, re-render the list from JSON. */
    _onAttr(name) {
      if (name === "data-steps") {
        var stepsJson = this.getAttribute("data-steps");
        if (stepsJson) this._renderFromJson(stepsJson);
      }
    }

    /* Build or replace the inner <ol> from a JSON array of
       { label: string, state: "complete" | "current" | "upcoming" | "pending" }. */
    _renderFromJson(json) {
      var steps;
      try { steps = JSON.parse(json); } catch (e) { return; }
      if (!Array.isArray(steps)) return;

      /* Replace any existing <ol> with a fresh render. */
      var ol = this.querySelector(":scope > ol");
      if (ol) ol.remove();

      ol = document.createElement("ol");
      ol.className = "aura-steps";
      steps.forEach(function (step, i) {
        var li = document.createElement("li");
        li.className = "aura-steps__step";
        /* Normalise "pending" → "upcoming" to match the CSS data-state taxonomy. */
        var state = step.state === "pending" ? "upcoming" : (step.state || "upcoming");
        li.setAttribute("data-state", state);

        var marker = document.createElement("span");
        marker.className = "aura-steps__marker";
        marker.textContent = String(i + 1);
        li.appendChild(marker);

        var label = document.createElement("span");
        label.className = "aura-steps__label";
        label.textContent = step.label || "";
        li.appendChild(label);

        ol.appendChild(li);
      });
      this.appendChild(ol);
      this._markCurrentStep();
    }

    /* Wrap loose <li> direct children (pass-through mode) into an <ol>,
       reusing a server-rendered/reconnected <ol> if already present. */
    _wrapLooseSteps() {
      var ol = this.querySelector(":scope > ol");
      if (!ol) {
        ol = document.createElement("ol");
        ol.className = "aura-steps";
      }
      /* Fold any direct <li> children that aren't inside the <ol> yet. */
      var loose = Array.prototype.slice.call(
        this.querySelectorAll(":scope > li")
      );
      loose.forEach(function (li) {
        li.classList.add("aura-steps__step");
        ol.appendChild(li);
      });
      if (ol.parentNode !== this) this.appendChild(ol);
      this._markCurrentStep();
    }

    /* Set aria-current="step" on the <li> with data-state="current", clear others. */
    _markCurrentStep() {
      var steps = this.querySelectorAll("li.aura-steps__step, ol > li");
      steps.forEach(function (li) {
        if (li.getAttribute("data-state") === "current") {
          li.setAttribute("aria-current", "step");
        } else {
          li.removeAttribute("aria-current");
        }
      });
    }
  });
})();
