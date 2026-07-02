/* ==========================================================================
   Aura — glow-host wiring mixin for BaseElement.

   Patches proximity-glow host-wiring methods onto Aura.BaseElement.prototype
   so the glow coupling lives in its own module, separate from the lifecycle
   scaffolding in element-base.js. Every BaseElement subclass inherits these
   methods automatically — no call-site changes required.

   Extracted from element-base.js (v3.85 — #340, element-base decomposition).
   See docs/design/element-base-design.md for the full decomposition rationale.

   Summary: glow-host wiring collaborator — _wireGlowTarget / _invalidateGlow.

   Load order: core.js → glow.js → element-base.js → glow-host.js
   ========================================================================== */
(function () {
  "use strict";
  /* SSR guard (#416): no-op outside the browser so SSR/RSC frameworks can
     evaluate this module (and the dist bundle) in Node without crashing. */
  if (typeof window === "undefined" || typeof document === "undefined") return;
  var Aura = window.Aura;
  if (!Aura || !Aura.BaseElement) return;

  var proto = Aura.BaseElement.prototype;

  /* Mark this element a glow host and route the rim glow to a sub-part.
     The host governs proximity detection + magnetic lean; the target gets
     its own --aura-glow-x/-y coordinate space. classList.add is idempotent,
     so this is safe to call from both the build and reuse branches. */
  proto._wireGlowTarget = function (target) {
    this.classList.add("aura-glow");
    if (target) target.classList.add("aura-glow__target");
  };

  /* Tell the glow engine the sub-part moved so it re-measures the cached
     offset on the next frame. No-op on coarse-pointer devices where the glow
     engine (and invalidateTarget) is absent. */
  proto._invalidateGlow = function () {
    var g = Aura.glow;
    if (g && g.invalidateTarget) g.invalidateTarget(this);
  };
})();
