/* ==========================================================================
   Aura — derivation-aware token model (Aura.tokens).

   Some design tokens are DERIVED: in source they hold a `var()` reference to
   another token (e.g. `--aura-info: var(--aura-secondary)`), so editing the
   source updates every dependant for free. A naive editor that writes a flat
   literal onto such a token SEVERS that relationship — the defect the config
   playground's old "Advanced — fidelity-reducing" quarantine warned about.

   This module records those derivations so an editor can offer a real choice:
     • stay LINKED — write `--token: var(--source)`; the token tracks its source
       live via the CSS cascade (no JS recompute needed), or
     • DETACH — freeze the token to its current computed literal and drop the
       link, so later source edits no longer propagate.

   Pure-ish: the only side effects are inline custom-property writes on a scope
   element (default :root). No DOM structure, no rendering. See
   docs/design/theming-and-configuration-design.md §5.
   ========================================================================== */
(function () {
  "use strict";
  /* SSR guard (#416): no-op outside the browser so SSR/RSC frameworks can
     evaluate this module (and the dist bundle) in Node without crashing. */
  if (typeof window === "undefined" || typeof document === "undefined") return;
  var Aura = window.Aura;
  if (!Aura) return;

  function root() { return document.documentElement; }

  /* token (string) → source var (string). A token present here is "linked". */
  var registry = {};

  /* Seed the derivations Aura ships (declared in the generated css/tokens.css,
     authored in tokens.json), so an editor can show link state without the
     author re-declaring them. Kept in sync with the token source (tokens.json). */
  var SEED = {
    "--aura-info": "--aura-secondary",
    "--aura-glow-color": "--aura-primary",
    "--aura-edge-color": "--aura-glow-color"
  };
  Object.keys(SEED).forEach(function (t) { registry[t] = SEED[t]; });

  /* Read a token's resolved value on a scope (computed, so var() is followed). */
  function computed(token, scope) {
    return getComputedStyle(scope || root()).getPropertyValue(token).trim();
  }

  var tokens = {
    /* Record that `token` derives from `var(sourceVar)`. Chainable. */
    link: function (token, sourceVar) {
      registry[token] = sourceVar;
      return tokens;
    },
    /* Forget a derivation (does not touch the live value). Chainable. */
    unlink: function (token) {
      delete registry[token];
      return tokens;
    },
    isLinked: function (token) { return Object.prototype.hasOwnProperty.call(registry, token); },
    /* The source var a token derives from, or null. */
    source: function (token) { return tokens.isLinked(token) ? registry[token] : null; },
    /* Snapshot of every known derivation as [{ token, source }]. */
    links: function () {
      return Object.keys(registry).map(function (t) { return { token: t, source: registry[t] }; });
    },

    /* Make a linked token's relationship LIVE in the cascade: write
       `--token: var(--source)` on the scope. The token now follows its source
       through pure CSS. No-op (returns false) if the token isn't linked. */
    applyLinked: function (token, scope) {
      var src = tokens.source(token);
      if (!src) return false;
      (scope || root()).style.setProperty(token, "var(" + src + ")");
      return true;
    },

    /* Set a SOURCE token's value. Any token linked to it updates automatically
       via the CSS var() relationship — no recompute here. Chainable. */
    setSource: function (sourceVar, value, scope) {
      (scope || root()).style.setProperty(sourceVar, value);
      return tokens;
    },

    /* DETACH a token: freeze it to its current computed literal and drop the
       link, so subsequent source edits no longer propagate to it. Returns the
       frozen literal (or null if the token was not linked). */
    detach: function (token, scope) {
      if (!tokens.isLinked(token)) return null;
      var el = scope || root();
      var literal = computed(token, el);
      el.style.setProperty(token, literal);
      delete registry[token];
      return literal;
    }
  };

  Aura.tokens = tokens;
})();
