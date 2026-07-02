/* ==========================================================================
   Aura — aura-sparkline: declarative inline sparkline element (v3.72).

   Replaces hand-authored SVG coordinate pairs inside .aura-sparkline
   containers. The element accepts a comma-separated `values` attribute,
   normalises the data to [0, 1], and synthesises both the fill area path
   (__area) and the line path (__series) inside a viewBox="0 0 100 32" SVG.

   CSS classes (__plot / __area / __series) match the existing .aura-sparkline
   vocabulary in css/chart.css, so theming and sizing come for free.

   Attributes:
     values  — comma-separated numbers, e.g. "24,22,25,16,18,10,6"
     label   — accessible name; written to aria-label on the inner SVG
     trend   — boolean; adds data-trend="" on the host for CSS styling

   Accessibility: role="img" is set on the host element; aria-label mirrors
   the `label` attribute.  The inner <svg> is aria-hidden="true".

   SSR-safe (#416): no window/document access at module evaluation time.

   Load order: core.js → element-base.js → aura-sparkline.js
   See docs/design/declarative-markup-design.md.
   ========================================================================== */
(function () {
  "use strict";
  /* SSR guard (#416): no-op outside the browser so SSR/RSC frameworks can
     evaluate this module (and the dist bundle) in Node without crashing. */
  if (typeof window === "undefined" || typeof document === "undefined") return;
  var Aura = window.Aura;
  if (!Aura || !Aura.BaseElement) return;

  /* ViewBox dimensions — chosen to match the existing hand-authored demos. */
  var VB_W = 100;
  var VB_H = 32;
  /* Vertical padding in viewBox units so the line stroke is never clipped. */
  var PAD_TOP = 2;
  var PAD_BOT = 2;

  /* Parse a comma-separated numbers string into a clean numeric array.
     Returns null when the string is absent or yields fewer than 2 values
     (a single-point sparkline has no geometry to draw). */
  function parseValues(raw) {
    if (!raw) return null;
    var nums = raw.split(",").map(function (s) { return parseFloat(s.trim()); });
    nums = nums.filter(function (n) { return isFinite(n); });
    return nums.length >= 2 ? nums : null;
  }

  /* Normalise an array of numbers to [0, 1] range (min/max).
     When all values are equal the range is 0 — clamp to 0.5 so a flat
     line appears centred rather than collapsed to the bottom. */
  function normalise(nums) {
    var min = nums[0], max = nums[0];
    for (var i = 1; i < nums.length; i++) {
      if (nums[i] < min) min = nums[i];
      if (nums[i] > max) max = nums[i];
    }
    var range = max - min;
    return nums.map(function (v) {
      return range === 0 ? 0.5 : (v - min) / range;
    });
  }

  /* Build the SVG path for the series line and the closed area fill.
     Returns { series, area } path `d` strings.

     X positions are evenly distributed across VB_W (0 … VB_W).
     Y is inverted: a high normalised value → small Y (near top of viewBox).
     The drawable band is [PAD_TOP … VB_H - PAD_BOT]. */
  function buildPaths(normalised) {
    var n = normalised.length;
    var drawH = VB_H - PAD_TOP - PAD_BOT;
    var points = normalised.map(function (v, i) {
      var x = n === 1 ? VB_W / 2 : (i / (n - 1)) * VB_W;
      var y = PAD_TOP + (1 - v) * drawH;
      /* Round to 2 decimal places for compact output. */
      return [Math.round(x * 100) / 100, Math.round(y * 100) / 100];
    });

    /* Series: open polyline M x0,y0 L x1,y1 … */
    var series = "M" + points[0][0] + "," + points[0][1];
    for (var i = 1; i < points.length; i++) {
      series += " L" + points[i][0] + "," + points[i][1];
    }

    /* Area: series path + close to baseline corners. */
    var baseline = VB_H;
    var last = points[points.length - 1];
    var first = points[0];
    var area = series
      + " L" + last[0] + "," + baseline
      + " L" + first[0] + "," + baseline
      + " Z";

    return { series: series, area: area };
  }

  /* Summary: declarative sparkline; synthesises an SVG from a `values`
     attribute; reuses .aura-sparkline__* CSS classes from css/chart.css. */
  Aura.define("aura-sparkline", class extends Aura.BaseElement {
    static get observedAttributes() { return ["values", "label", "trend"]; }

    /* Build the inner SVG skeleton once. _sync() fills the path data. */
    _build() {
      /* Reuse an existing build (HTMX / server-render) if already present. */
      if (this.querySelector(":scope > svg.aura-sparkline__plot")) return;

      var SVG_NS = "http://www.w3.org/2000/svg";
      var svg = document.createElementNS(SVG_NS, "svg");
      svg.setAttribute("class", "aura-sparkline__plot");
      svg.setAttribute("viewBox", "0 0 " + VB_W + " " + VB_H);
      svg.setAttribute("preserveAspectRatio", "none");
      svg.setAttribute("aria-hidden", "true");

      var area = document.createElementNS(SVG_NS, "path");
      area.setAttribute("class", "aura-sparkline__area");

      var series = document.createElementNS(SVG_NS, "path");
      series.setAttribute("class", "aura-sparkline__series");

      svg.appendChild(area);
      svg.appendChild(series);
      this.appendChild(svg);
    }

    /* Sync host attributes → accessible role, label, and SVG path data. */
    _sync() {
      /* role="img" on the host so the whole sparkline reads as an image. */
      if (!this.hasAttribute("role")) this.setAttribute("role", "img");

      /* aria-label from the `label` attribute. */
      var label = this.getAttribute("label");
      if (label) this.setAttribute("aria-label", label);
      else this.removeAttribute("aria-label");

      /* data-trend="" from the boolean `trend` attribute. */
      if (this.hasAttribute("trend")) {
        this.setAttribute("data-trend", "");
      } else {
        this.removeAttribute("data-trend");
      }

      /* Regenerate SVG paths from the `values` attribute. */
      this._renderPaths();
    }

    _onAttr() { this._sync(); }

    /* Parse values and write path data into the inner SVG. */
    _renderPaths() {
      var svg = this.querySelector(":scope > svg.aura-sparkline__plot");
      if (!svg) return;

      var nums = parseValues(this.getAttribute("values"));
      if (!nums) {
        /* No valid data — clear any stale paths. */
        var areaPl = svg.querySelector(".aura-sparkline__area");
        var seriesPl = svg.querySelector(".aura-sparkline__series");
        if (areaPl) areaPl.setAttribute("d", "");
        if (seriesPl) seriesPl.setAttribute("d", "");
        return;
      }

      var normalised = normalise(nums);
      var paths = buildPaths(normalised);

      var areaEl = svg.querySelector(".aura-sparkline__area");
      var seriesEl = svg.querySelector(".aura-sparkline__series");
      if (areaEl) areaEl.setAttribute("d", paths.area);
      if (seriesEl) seriesEl.setAttribute("d", paths.series);
    }
  });
})();
