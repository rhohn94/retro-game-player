/* ==========================================================================
   Aura — number / value formatting utilities (Aura.format, #129).

   Thin, dependency-free wrappers over the platform Intl.NumberFormat so demos
   and apps format figures consistently (currency, percent, compact "1.2K")
   instead of hand-rolling each one. Pairs with `.aura-num` / tabular figures for
   aligned columns. All functions are pure and null-safe (a non-finite input
   returns the configured placeholder, default "—").

   Usage:
     Aura.format.currency(48200)            → "$48,200.00"
     Aura.format.currency(48200, { maximumFractionDigits: 0 }) → "$48,200"
     Aura.format.percent(0.124)             → "12%"   (input is a 0..1 fraction)
     Aura.format.compact(1234)              → "1.2K"
     Aura.format.number(1234.5)             → "1,234.5"

   Load order: core.js → format.js (no dependencies beyond Intl).
   See docs/design/formatting-design.md.
   ========================================================================== */
(function () {
  "use strict";
  /* SSR guard (#416): no-op outside the browser so SSR/RSC frameworks can
     evaluate this module (and the dist bundle) in Node without crashing. */
  if (typeof window === "undefined" || typeof document === "undefined") return;
  var Aura = window.Aura;
  if (!Aura) return;

  var PLACEHOLDER = "—";

  /* Coerce to a finite number or return null (never NaN/Infinity). */
  function finite(v) {
    var n = typeof v === "number" ? v : parseFloat(v);
    return isFinite(n) ? n : null;
  }

  /* Run an Intl.NumberFormat with the given options, falling back to a String()
     where Intl is unavailable (very old engines) so output is never "[object]". */
  function run(n, opts, locale) {
    try {
      return new Intl.NumberFormat(locale || undefined, opts).format(n);
    } catch (e) {
      return String(n);
    }
  }

  Aura.format = {
    /* The string returned for a non-finite input; override globally if needed. */
    placeholder: PLACEHOLDER,

    /* Plain grouped number with optional Intl options. */
    number: function (value, opts, locale) {
      var n = finite(value);
      if (n === null) return Aura.format.placeholder;
      return run(n, opts || {}, locale);
    },

    /* Currency. `currency` is an ISO 4217 code (default USD). */
    currency: function (value, currency, opts, locale) {
      var n = finite(value);
      if (n === null) return Aura.format.placeholder;
      var o = { style: "currency", currency: currency || "USD" };
      if (opts) for (var k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) o[k] = opts[k];
      return run(n, o, locale);
    },

    /* Percent. Input is a 0..1 FRACTION by default (0.124 → "12%"); pass
       { fromWhole: true } to treat the input as already-scaled (12.4 → "12%"). */
    percent: function (value, opts, locale) {
      var n = finite(value);
      if (n === null) return Aura.format.placeholder;
      var o = { style: "percent", maximumFractionDigits: 0 };
      var fromWhole = opts && opts.fromWhole;
      if (opts) for (var k in opts) if (k !== "fromWhole" && Object.prototype.hasOwnProperty.call(opts, k)) o[k] = opts[k];
      return run(fromWhole ? n / 100 : n, o, locale);
    },

    /* Compact notation: 1234 → "1.2K", 1_200_000 → "1.2M". */
    compact: function (value, opts, locale) {
      var n = finite(value);
      if (n === null) return Aura.format.placeholder;
      var o = { notation: "compact", maximumFractionDigits: 1 };
      if (opts) for (var k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) o[k] = opts[k];
      return run(n, o, locale);
    }
  };
})();
