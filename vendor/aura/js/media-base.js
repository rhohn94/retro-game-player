/* ==========================================================================
   Aura — shared base for content-first media elements (image / video).

   MediaElementBase consolidates the media-frame scaffold + media-state
   attribute mirroring that aura-image.js and aura-video.js previously
   hand-rolled near-verbatim (issue #336), mirroring how FormControlBase unifies
   the native-input controls. Both media elements are the same shape: a
   light-DOM custom element that renders ONE media node (an <img> / a <video>)
   fill-to-extents in a glass frame, exposes an authored aspect ratio, supports
   native lazy-loading, and floats glass control chrome over the media.

   What the base owns (identical across both elements):
     - the `aura-media` frame marker class (added once on build),
     - the `ratio` → `--aura-media-ratio` custom-property mirror,
     - the `loading` lazy-load attribute mirror onto the backing media node,
     - the glass icon-button factory used to populate the control chrome.

   Subclasses declare one static describing their BEM block:
     _prefix   BEM block, e.g. "aura-image" / "aura-video"
   and override the BaseElement hooks (_build/_bind/_sync). A subclass _sync()
   calls _mirrorMedia(node) to apply the shared ratio + loading mirror, and
   _iconBtn(icon, label) to build a control-chrome button.

   Not registered itself; aura-image / aura-video extend it.

   Load order: core.js → element-base.js → media-base.js →
   (aura-image / aura-video). See docs/design/content-first-display-design.md.
   ========================================================================== */
(function () {
  "use strict";
  /* SSR guard (#416): no-op outside the browser so SSR/RSC frameworks can
     evaluate this module (and the dist bundle) in Node without crashing. */
  if (typeof window === "undefined" || typeof document === "undefined") return;
  var Aura = window.Aura;
  if (!Aura || !Aura.BaseElement) return;

  /* Suffix appended to a subclass's BEM block for its glass chrome buttons,
     e.g. "aura-image" → "aura-image__btn". Declared once to avoid a magic
     string at each call site. */
  var BTN_SUFFIX = "__btn";

  /* Summary: HTMLElement subclass (via Aura.BaseElement) hosting the shared
     media-frame marker, the ratio + lazy-load attribute mirror, and the glass
     control-chrome button factory for content-first media elements. Not
     registered itself; aura-image / aura-video extend it. */
  Aura.MediaElementBase = class extends Aura.BaseElement {
    /* Subclasses MUST override this static (their BEM block). */
    static get _prefix() { return ""; }

    /* Convenience instance read of the subclass static. */
    get _prefix() { return this.constructor._prefix; }

    /* ---- frame marker ----------------------------------------------------- */
    /* Add the shared media-frame marker class. Idempotent; subclasses call this
       from their own _build() before assembling element-specific structure. */
    _markFrame() {
      this.classList.add("aura-media");
    }

    /* ---- media-state attribute mirror ------------------------------------- */
    /* Reflect the host's media-state attributes onto the backing media node:
         - `ratio` (e.g. "3/2") → the `--aura-media-ratio` custom property,
           normalised to the CSS `aspect-ratio` shorthand ("3 / 2");
         - `loading` (e.g. "lazy" / "eager") → the native lazy-load attribute on
           the media node, so authors get browser-native deferred loading
           without either element hand-rolling intersection observation.
       Subclasses call this from _sync() with their media node. */
    _mirrorMedia(node) {
      this._mirrorRatio();
      this._mirrorLoading(node);
    }

    /* Mirror the authored `ratio` onto the frame's aspect-ratio custom property
       (or clear it when absent). */
    _mirrorRatio() {
      var ratio = this.getAttribute("ratio");
      if (ratio) this.style.setProperty("--aura-media-ratio", ratio.replace("/", " / "));
      else this.style.removeProperty("--aura-media-ratio");
    }

    /* Mirror the authored `loading` attribute onto the backing media node for
       browser-native lazy-loading (cleared on the node when absent). */
    _mirrorLoading(node) {
      if (!node) return;
      var loading = this.getAttribute("loading");
      if (loading) node.setAttribute("loading", loading);
      else node.removeAttribute("loading");
    }

    /* ---- glass control chrome --------------------------------------------- */
    /* Build a glass chrome button (icon + accessible name + tooltip) for the
       subclass's control bar, classed under its BEM block. Shared by the
       image lightbox bar and the video control bar. */
    _iconBtn(icon, label) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = this._prefix + BTN_SUFFIX + " aura-glow";
      b.setAttribute("aria-label", label);
      b.setAttribute("data-aura-tooltip", label);
      b.appendChild(Aura.icon(icon));
      return b;
    }
  };
})();
