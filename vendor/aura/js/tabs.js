/* ==========================================================================
   Aura — tabs component.

   Implements the WAI-ARIA Tabs design pattern with roving-tabindex keyboard
   navigation. Four custom elements cooperate:

     aura-tabs       — root coordinator (structural wrapper)
     aura-tablist    — gets role="tablist"; owns keyboard-nav event listeners
     aura-tab        — gets role="tab" / aria-selected / aria-controls / tabindex
     aura-tabpanel   — gets role="tabpanel" / aria-labelledby / tabindex="0"

   Progressive-enhancement contract:
     CSS drives initial appearance (aura-tab[selected], aura-tabpanel[hidden]).
     JS adds ARIA and keyboard behavior; markup is correct without it.
     connectedCallback is idempotent so HTMX swaps re-init automatically.

   Panel-wiring priority:
     1. aria-controls attribute on aura-tab (explicit)
     2. Positional match: tab[n] → nth aura-tabpanel child of aura-tabs

   See docs/design/tabs-design.md.
   ========================================================================== */
(function () {
  "use strict";
  /* SSR guard (#416): no-op outside the browser so SSR/RSC frameworks can
     evaluate this module (and the dist bundle) in Node without crashing. */
  if (typeof window === "undefined" || typeof document === "undefined") return;
  var Aura = window.Aura;
  if (!Aura || !Aura.BaseElement) return;

  /* Extra wait past the CSS transition duration before the fallback cleanup. */
  var TRANSITION_FALLBACK_BUFFER_MS = 100;

  /* Descendants that take the panel out of the tab order: per the WAI-ARIA Tabs
     pattern a tabpanel is itself a tab stop ONLY when it has no focusable
     content (otherwise the user tabs straight into that content) — #503. */
  var FOCUSABLE_SEL =
    'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable]';

  function nextId(prefix) { return Aura.nextId(prefix); }
  function define(name, ctor) { Aura.define(name, ctor); }

  /* ---- Internal helpers ------------------------------------------------- */

  /* The element that owns the tabs: the nearest aura-tablist if one is
     present, otherwise the aura-tabs root itself.  The aura-tablist wrapper
     is the canonical structure, but authors may place aura-tab elements as
     direct children of aura-tabs; in that case aura-tabs acts as the implicit
     tablist so click + keyboard delegation still has a host to attach to.    */
  function tablistOf(tab) {
    return tab.closest("aura-tablist") || tab.closest("aura-tabs");
  }

  /* Direct aura-tab children of a container (a tablist or the tabs root).
     Excludes tabs nested inside a deeper aura-tablist.                       */
  function tabsOf(container) {
    return Array.prototype.filter.call(container.children, function (el) {
      return el.tagName.toLowerCase() === "aura-tab";
    });
  }

  /* Direct aura-tabpanel children of the aura-tabs root. */
  function panelsOf(root) {
    return Array.prototype.filter.call(root.children, function (el) {
      return el.tagName.toLowerCase() === "aura-tabpanel";
    });
  }

  /* Resolve the panel for a tab.
     Looks up aria-controls first; falls back to positional index. */
  function panelFor(tab) {
    var ctrl = tab.getAttribute("aria-controls");
    if (ctrl) return document.getElementById(ctrl);
    var container = tablistOf(tab);
    var root      = container && container.closest("aura-tabs");
    if (!root) return null;
    var idx     = tabsOf(container).indexOf(tab);
    var panels  = panelsOf(root);
    return (idx >= 0 && panels[idx]) ? panels[idx] : null;
  }

  /* Ensure both tab and panel have IDs, then wire aria-controls / aria-labelledby. */
  function wirePanel(tab) {
    var panel = panelFor(tab);
    if (!panel) return;
    if (!panel.id) panel.id = nextId("aura-panel-");
    if (!tab.id)   tab.id   = nextId("aura-tab-");
    if (!tab.hasAttribute("aria-controls"))     tab.setAttribute("aria-controls", panel.id);
    if (!panel.hasAttribute("aria-labelledby")) panel.setAttribute("aria-labelledby", tab.id);
  }

  /* Cross-fade + slide panel transition, or an instant switch when motion
     is not available / not yet ready.  Handles rapid-click cancellation
     via root.__auraTransitionCleanup.                                       */
  function transitionPanels(outgoing, incoming, root) {
    if (!incoming) return;
    var samePanel = (outgoing === incoming);

    /* Cancel any in-flight transition immediately. */
    if (root && root.__auraTransitionCleanup) {
      root.__auraTransitionCleanup();
    }

    /* Animate only when:
         – root has completed its first sync (__auraReady)
         – the user has not opted out of motion
         – there is a distinct outgoing panel to transition from            */
    var motionOk  = !Aura.env.reducedMotion();
    var canAnimate = root && root.__auraReady && motionOk && outgoing && !samePanel;

    if (!canAnimate) {
      /* Instant switch: show incoming, hide every other panel.             */
      incoming.removeAttribute("hidden");
      if (root) {
        panelsOf(root).forEach(function (p) {
          if (p !== incoming) p.setAttribute("hidden", "");
        });
      } else if (outgoing && !samePanel) {
        outgoing.setAttribute("hidden", "");
      }
      return;
    }

    /* Read CSS duration for the fallback timeout.                          */
    var dur = Aura.parseDuration(
      getComputedStyle(root).getPropertyValue("--aura-tabs-dur")
    );

    /* -- Phase 1: take outgoing out of flow, begin fade-out -------------- */
    var outTop = outgoing.offsetTop;           /* capture while in flow     */
    outgoing.setAttribute("data-aura-leaving", "");
    outgoing.style.top = outTop + "px";        /* pin absolute position     */

    /* -- Phase 2: show incoming, but keep it invisible ------------------- */
    incoming.removeAttribute("hidden");
    incoming.setAttribute("data-aura-entering", "");

    /* -- Phase 3: force a reflow so the browser commits start state ------ */
    /* eslint-disable-next-line no-unused-expressions */
    void incoming.offsetHeight;

    /* -- Phase 4: trigger entering transition ----------------------------- */
    incoming.setAttribute("data-aura-entering-active", "");
    /* The leaving transition started in Phase 1: CSS sees opacity 1 → 0.  */

    /* -- Cleanup: restore clean DOM state after the transition completes - */
    var done = false;
    function cleanup() {
      if (done) return;
      done = true;

      incoming.removeEventListener("transitionend", onEnd);

      outgoing.removeAttribute("data-aura-leaving");
      outgoing.style.top = "";
      outgoing.setAttribute("hidden", "");

      /* Snap the entering panel to full visibility before removing the
         state attributes.  Without this, if cleanup fires via the fallback
         timeout before the CSS transition has progressed (e.g. background-
         tab freeze), the panel can be left invisible.
         Steps:
           1. Disable transitions inline so the browser doesn't start a
              reverse-fade when we strip the data attributes.
           2. Remove the data attributes (opacity cascades back to 1).
           3. Force a synchronous style recalculation so the browser
              "commits" opacity=1 before we lift the transition override.
           4. Clear the inline override — no opacity change is pending,
              so no new transition fires.                                  */
      incoming.style.transition = "none";
      incoming.removeAttribute("data-aura-entering");
      incoming.removeAttribute("data-aura-entering-active");
      /* eslint-disable-next-line no-unused-expressions */
      void incoming.offsetWidth; /* force recalculation (step 3)          */
      incoming.style.transition = "";

      if (root) root.__auraTransitionCleanup = null;
    }

    root.__auraTransitionCleanup = cleanup;

    function onEnd(e) {
      /* Wait for the incoming panel's opacity transition to finish.        */
      if (e.target === incoming && e.propertyName === "opacity") cleanup();
    }

    incoming.addEventListener("transitionend", onEnd);
    /* Fallback in case transitionend never fires (e.g. tab hidden, fast). */
    setTimeout(cleanup, dur + TRANSITION_FALLBACK_BUFFER_MS);
  }

  /* Activate a tab: update selection state and show/hide panels.
     moveFocus — when true, moves keyboard focus to the tab.                 */
  function selectTab(tab, moveFocus) {
    var tablist = tablistOf(tab);
    if (!tablist) return;
    var root = tablist.closest("aura-tabs");

    /* Snapshot the outgoing panel + previously-selected tab before ARIA
       state changes (previous is surfaced on the aura:tab-change event).    */
    var outgoing = null;
    var prevTab = null;
    tabsOf(tablist).forEach(function (t) {
      if (t.getAttribute("aria-selected") === "true") { outgoing = panelFor(t); prevTab = t; }
    });

    /* Update ARIA selection state immediately (no visual side-effects).    */
    tabsOf(tablist).forEach(function (t) {
      var active = (t === tab);
      t.setAttribute("aria-selected", active ? "true" : "false");
      t.setAttribute("tabindex",       active ? "0"    : "-1");
      if (active) t.setAttribute("selected", "");
      else        t.removeAttribute("selected");
    });

    if (moveFocus) tab.focus({ preventScroll: false });

    /* Transition panels (animated or instant depending on conditions).     */
    transitionPanels(outgoing, panelFor(tab), root);

    tab.dispatchEvent(new CustomEvent("aura:tab-change", {
      bubbles: true,
      /* previous is the tab that was selected before this change (null on the
         initial sync), so listeners can diff without tracking state. */
      detail:  { tab: tab, previous: (prevTab === tab ? null : prevTab) }
    }));
  }

  /* ---- Delegated click + keyboard handlers ------------------------------ */
  /* Shared by aura-tablist (canonical) and aura-tabs (when no tablist wraps
     the tabs).  `container` is the element the listener is attached to —
     the tab container — so we only act on its own direct tabs.              */

  function onTabClick(container, e) {
    var tab = e.target.closest("aura-tab");
    if (!tab || tablistOf(tab) !== container) return;
    if (tab.getAttribute("aria-disabled") === "true" || tab.hasAttribute("disabled")) return;
    selectTab(tab, false);
  }

  function onTabKey(container, e) {
    /* Tabs that are enabled and reachable. */
    var enabledTabs = tabsOf(container).filter(function (t) {
      return t.getAttribute("aria-disabled") !== "true" && !t.hasAttribute("disabled");
    });
    if (!enabledTabs.length) return;

    /* Determine which tab currently has focus. */
    var active = document.activeElement;
    var curTab = (active && active.tagName.toLowerCase() === "aura-tab") ? active : null;
    if (!curTab || tablistOf(curTab) !== container) return;
    var idx = enabledTabs.indexOf(curTab);
    if (idx === -1) return;

    /* Orientation lives on aura-tablist; default horizontal otherwise. */
    var orient  = container.getAttribute("aria-orientation") || "horizontal";
    var isHoriz = orient !== "vertical";

    switch (e.key) {
      case (isHoriz ? "ArrowRight" : "ArrowDown"):
        e.preventDefault();
        selectTab(enabledTabs[(idx + 1) % enabledTabs.length], true);
        break;
      case (isHoriz ? "ArrowLeft" : "ArrowUp"):
        e.preventDefault();
        selectTab(enabledTabs[(idx - 1 + enabledTabs.length) % enabledTabs.length], true);
        break;
      case "Home":
        e.preventDefault();
        selectTab(enabledTabs[0], true);
        break;
      case "End":
        e.preventDefault();
        selectTab(enabledTabs[enabledTabs.length - 1], true);
        break;
      /* Tab key leaves the tablist (browser default — no preventDefault). */
    }
  }

  /* Attach delegated click + keyboard listeners to a tab container exactly
     once (idempotent, HTMX-swap safe).                                      */
  function bindTabHandlers(container) {
    if (container.__auraTabsBound) return;
    container.__auraTabsBound = true;
    container.addEventListener("click",   function (e) { onTabClick(container, e); });
    container.addEventListener("keydown", function (e) { onTabKey(container, e); });
  }

  /* ---- aura-tabs: root coordinator -------------------------------------- */
  /* Ensures exactly one tab is selected and syncs initial panel visibility.
     Uses requestAnimationFrame so children's connectedCallback has fired.
     Extends Aura.BaseElement for the shared __init lifecycle guard. */
  define("aura-tabs", class extends Aura.BaseElement {
    /* Kick off the rAF-deferred sync once on first connect (_build hook).
       Naming: _syncTabs (not _sync) so it does not double-fire — BaseElement
       calls _sync() synchronously after _build(); delaying via rAF here is
       intentional so the children's connectedCallback has had time to fire. */
    _build() {
      var self = this;
      requestAnimationFrame(function () { self._syncTabs(); });
    }
    _syncTabs() {
      /* Canonical structure wraps tabs in an aura-tablist. Authors may place
         aura-tab elements directly under aura-tabs; in that case SYNTHESIZE a
         role=tablist wrapper around them so the role=tab children always have a
         valid role=tablist parent (axe aria-required-parent, #fix family B).
         The synthesized tablist is the canonical container, so click/keyboard
         delegation + positional panel matching route through the normal path. */
      var tablist = this.querySelector("aura-tablist") || this._synthesizeTablist();
      var tabs = tabsOf(tablist);
      if (!tabs.length) return;

      var selTabs = tabs.filter(function (t) { return t.hasAttribute("selected"); });
      if (!selTabs.length) selTabs = [tabs[0]]; // default to first

      // Activate the first selected (and deactivate the rest)
      var primary = selTabs[0];
      selectTab(primary, false);
      this.__auraReady = true; // allow animated transitions after first _syncTabs
    }

    /* Wrap the direct aura-tab children in a generated <aura-tablist> so the
       role=tab children have a valid role=tablist parent. The wrapper is
       inserted at the position of the first tab; aura-tabpanel children stay as
       direct children of the root (panelsOf reads them there). Idempotent — a
       prior synthesized wrapper is reused on an HTMX reconnect. The wrapper's
       own connectedCallback sets role=tablist and binds the delegated handlers. */
    _synthesizeTablist() {
      var directTabs = tabsOf(this);
      if (!directTabs.length) return this; // nothing to wrap
      var list = document.createElement("aura-tablist");
      this.insertBefore(list, directTabs[0]);
      directTabs.forEach(function (t) { list.appendChild(t); });
      return list;
    }
  });

  /* ---- aura-tablist: keyboard navigation -------------------------------- */
  /* The canonical tab container; binds the shared delegated handlers. */
  define("aura-tablist", class extends HTMLElement {
    connectedCallback() {
      if (!this.hasAttribute("role")) this.setAttribute("role", "tablist");
      bindTabHandlers(this);
    }
  });

  /* ---- aura-tab: individual tab ---------------------------------------- */
  define("aura-tab", class extends HTMLElement {
    connectedCallback() {
      if (!this.id) this.id = nextId("aura-tab-");
      if (!this.hasAttribute("role")) this.setAttribute("role", "tab");

      /* Proximity glow (v3.2): the tab is interactive, so it glows + leans like
         every other clickable widget. The tab's OWN ::after is the selected-state
         underline indicator, so the rim cannot ride it — route the rim to a
         dedicated inner sub-part (.aura-glow__target) instead, exactly as
         checkbox/range do (glow.css §Sub-part targeting). The target is an inert
         overlay span sized to the tab; glow.js lights its rim, the host governs
         proximity + the magnetic lean, and the indicator ::after is untouched.
         classList.add + the once-guard keep this idempotent across HTMX swaps.
         Append LAST (the rim target is an absolutely-positioned overlay per
         glow.css, so flow position is irrelevant) so authored content stays the
         tab's first child — `aura-tab > :first-child` and tab.firstChild text
         extraction keep resolving to the label, not the injected span (#513). */
      this.classList.add("aura-glow");
      if (!this.__auraGlowTarget) {
        var t = document.createElement("span");
        t.className = "aura-glow__target aura-tab__glow";
        t.setAttribute("aria-hidden", "true");
        this.appendChild(t);
        this.__auraGlowTarget = t;
      }

      var isSel = this.hasAttribute("selected");
      if (!this.hasAttribute("aria-selected")) {
        this.setAttribute("aria-selected", isSel ? "true" : "false");
      }
      /* Guard the INITIAL write like role/aria-selected above: don't clobber an
         author- or server-set tabindex on connect (incl. HTMX reconnects).
         selectTab manages the roving tabindex thereafter (#463). */
      if (!this.hasAttribute("tabindex")) {
        this.setAttribute("tabindex", isSel ? "0" : "-1");
      }

      /* Defer panel wiring: the panel's connectedCallback may not have fired. */
      var self = this;
      Promise.resolve().then(function () { wirePanel(self); });
    }
  });

  /* ---- aura-tabpanel: content panel ------------------------------------- */
  define("aura-tabpanel", class extends HTMLElement {
    connectedCallback() {
      if (!this.hasAttribute("role")) this.setAttribute("role", "tabpanel");
      if (!this.id) this.id = nextId("aura-panel-");
      /* Make the panel a tab stop only when it holds NO focusable content, so a
         panel of static text stays keyboard-scrollable while a panel of links/
         buttons doesn't add a redundant phantom stop (#503). Author-set tabindex
         is never touched. Defer to a microtask so HTMX/SPA content that mounts
         after the panel is counted — mirrors the deferred wirePanel pattern. */
      if (this.hasAttribute("tabindex")) { this.__authorTabindex = true; return; }
      this.__authorTabindex = false;
      var self = this;
      Promise.resolve().then(function () { self._reflectTabindex(); });
      /* The microtask above runs ONCE, but focusable content can mount later
         (SPA hydration, HTMX inner swap, lazy panel body) — so re-evaluate on
         every content mutation, the behaviour #503's comment always promised but
         never wired. The observer is torn down on disconnect (the #455/#673
         teardown family) so it never leaks. */
      this.__contentObs = new MutationObserver(function () { self._reflectTabindex(); });
      this.__contentObs.observe(this, { childList: true, subtree: true });
    }

    disconnectedCallback() {
      if (this.__contentObs) { this.__contentObs.disconnect(); this.__contentObs = null; }
    }

    /* Set tabindex=0 only when the panel has no focusable descendant; otherwise
       remove it (leave the panel out of the tab order). Idempotent — safe to run
       again on content mutation. Never overrides an author-set tabindex (the
       __authorTabindex guard, so the mutation observer can't clobber it). */
    _reflectTabindex() {
      if (!this.isConnected || this.__authorTabindex) return;
      if (this.querySelector(FOCUSABLE_SEL)) this.removeAttribute("tabindex");
      else this.tabIndex = 0;
    }
  });
})();
