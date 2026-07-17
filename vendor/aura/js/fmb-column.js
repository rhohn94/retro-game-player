/* Aura — <aura-fmb-column> FMB column/anchor registration + positioning engine (v3.549)
   Rewritten for v3.549 ITEM-2 (docs/design/fmb-design.md §Column positioning,
   §The three states) onto the generic column/anchor model whose CSS shipped in
   ITEM-1 (css/fmb-column.css). Members register into one of four logical
   stacks — (column, anchor) pairs read from data-fmb-column / data-fmb-anchor —
   instead of a hardcoded 4-slot nav/sidebar/footer/user registry. Any number of
   members may register at the same (column, anchor); they stack in
   registration (DOM) order, matching the CSS's block-start-grows-down /
   block-end-grows-up (column-reverse) convention.

   Hard architectural rule this file enforces (fmb-design.md §Column
   positioning): "the column reserves space only for the Stashed state." A
   stack is populated with one slot cell per member that is currently PRESENT
   in the DOM — but a member only counts as "active" (paints the stack's glass
   surface, sets data-fmb-column-active) while it is Stashed. An Opened/Pinned
   member's menu panel is a separate floating panel the member's own host CSS
   already renders outside this column entirely (js/fmb-column.js never sees
   it) — so the column's own box model never grows to fit it.

   Migration default (v3.549 ITEM-2): the four pre-v3.549 members
   (nav-header, sidebar, footer, user-profile FMB) keep their exact current
   visual positions. Each is auto-registered with a default data-fmb-column /
   data-fmb-anchor / data-fmb-slot value IF THE HOST HASN'T ALREADY AUTHORED
   one, reproducing today's layout:
     nav-header  → column=start, anchor=start  (top-left, registers first)
     sidebar     → column=start, anchor=start  (top-left, stacks below nav)
     footer      → column=start, anchor=end    (bottom-left)
     user-profile→ column=end,   anchor=start  (top-right)
   Any host that authors its own data-fmb-column/data-fmb-anchor overrides
   this default — the engine has no hardcoded 4-name allowlist; it discovers
   ANY element carrying [data-fmb-column][data-fmb-anchor] (plus the four
   known legacy selectors for back-compat auto-tagging) each sync.

   This item is the CONTAINER mechanism only: button/panel decoupling (#1047)
   and the user-profile FMB's open/pin unification (#1048) are separate,
   later releases — the four members keep their existing internal
   button/panel/pin behavior unchanged; only which column/anchor slot they
   sit in, and how the column's footprint accounting works, changes here.

   ITEM-3 (mobile merge + reveal control, fmb-design.md §Mobile): below
   --aura-bp-mobile the CSS (css/fmb-column.css) merges both columns onto
   the inline-start edge and hides every stack by default
   (visibility:hidden + pointer-events:none) until the host carries
   data-fmb-column-revealed. This file owns two new responsibilities: (1)
   creating/wiring a single reveal <button> (_ensureRevealControl(),
   [data-fmb-reveal]) that toggles that attribute on click or Enter/Space —
   a real focusable element, not a hover-only affordance
   (space-economy-design.md §Accessibility); (2) resetting the revealed
   state closed whenever the breakpoint transitions AWAY from mobile, so
   re-entering mobile later always starts hidden again ("hidden by
   default", not "hidden until first opened, ever after remembered"). Member
   registration/layout/activation (_discoverMembers/_layoutStack) run
   IDENTICALLY in mobile and desktop mode — the merge is pure CSS
   repositioning of the SAME stacks; there is no separate mobile data model.

   ITEM-13 (v3.554, #1080): the reveal <button> is a document.body child,
   not a DOM descendant of <aura-fmb-column> — see _ensureRevealControl()'s
   doc comment for the aura-app isolation-boundary/stacking-context fix this
   corrects (mirrors js/footer.js's ensureFooterPanel() escape).

   v3.555 ITEM-2 (docs/design/fmb-choreography-design.md §Seam contract): this
   file gained a narrow seam for the new js/fmb-choreography.js engine, which
   drives the Detach → Decay → re-stash return path (fmb-design.md §State-
   transition choreography, movement 5) — NO choreography logic lives here.
   Three additions: (1) Aura.fmbColumn.members(), a module-level read
   accessor exposing the SAME member discovery this file already does, so the
   choreography engine (or any future consumer) never needs a second
   LEGACY_MEMBERS-shaped dispatch; (2) isStashed() now returns false for a
   host carrying data-fmb-decaying — a mid-decay member has not yet actually
   returned to Stashed, so it must not count toward stack activation while
   still keeping its slot cell (isEligible() is unchanged and still governs
   cell reservation); (3) the MutationObserver attributeFilter now watches
   data-fmb-detached/-decaying too, so a sync re-runs the moment the
   choreography engine flips either one. */

(function () {
  "use strict";
  /* SSR guard (#416): no-op outside the browser — see js/fmb-column.js history. */
  if (typeof window === "undefined" || typeof document === "undefined") return;

  var Aura = window.Aura || (window.Aura = {});

  var DOC_EL       = document.documentElement;
  var DOC_STYLE    = DOC_EL.style;
  var DOC_COMPUTED = getComputedStyle(DOC_EL);

  var COLUMNS = ["start", "end"];
  var ANCHORS = ["start", "end"];

  /* v3.549 ITEM-3 (fmb-design.md §Mobile) — the merged-column reveal control.
     REVEALED_ATTR lives on the <aura-fmb-column> HOST (mirrors the existing
     data-fmb-column-active/data-slot-hover convention of hanging transient
     JS-driven state off attributes the CSS keys on); REVEAL_SEL identifies
     the reveal <button> itself.

     v3.554 ITEM-13 (#1080): the button is now a document.body child, NOT a
     DOM descendant of <aura-fmb-column> — see _ensureRevealControl()'s doc
     comment for why (css/theme.css's `aura-app { isolation: isolate; }`
     traps any descendant of <aura-app> in a losing stacking context against
     js/footer.js's body-level floating panel; mirrors ensureFooterPanel()'s
     own containing-block/stacking-context escape). */
  var REVEALED_ATTR = "data-fmb-column-revealed";
  var REVEAL_SEL = "[data-fmb-reveal]";

  /* Legacy 4-member migration defaults (v3.549 ITEM-2). Each entry maps a
     member's PRESENCE selector to the column/anchor/slot-name it is
     auto-tagged with if (and only if) the host element does not already
     carry an authored data-fmb-column attribute — see autoTagLegacyMembers().
     Order here is also the fallback registration order within a stack
     (nav before sidebar keeps nav nearest the block-start edge, matching
     today's visual stacking). */
  var LEGACY_MEMBERS = [
    { selector: "aura-nav-header, .aura-nav-header",   slot: "nav",     column: "start", anchor: "start" },
    { selector: "[data-aura-sidebar]",                 slot: "sidebar", column: "start", anchor: "start" },
    { selector: "aura-footer, [data-aura-footer]",     slot: "footer",  column: "start", anchor: "end"   },
    { selector: "[data-aura-user-fmb]",                slot: "user",    column: "end",   anchor: "start" }
  ];

  /* Parse a raw data-fmb-column-min string into a valid integer or null.
     Preserved from the pre-v3.549 implementation (#942, #968) — the min-count
     activation override is unchanged by this item's column/anchor rework. */
  function parseMinVal(raw) {
    if (raw === null) return null;
    var n = parseInt(raw, 10);
    return (!Number.isFinite(n) || n < 1) ? null : n;
  }

  /* Read --aura-fmb-column-breakpoint from :root computed styles; fall back to 640px. */
  function readBreakpoint() {
    return DOC_COMPUTED.getPropertyValue('--aura-fmb-column-breakpoint').trim() || '640px';
  }

  /* A single registered member: the host element the FMB lives on, and its
     resolved column/anchor/slot identity. One MemberEntry is created per
     present legacy host and per any element authoring its own
     data-fmb-column/data-fmb-anchor pair — see
     AuraFmbColumn.prototype._discoverMembers(). The member's slot cell
     itself lives in a Map on the stack element (stackEl._fmbCellMap, keyed
     by host), not on the entry — a fresh MemberEntry is created every
     _discoverMembers() pass, while the cell must persist across passes for
     DOM-reuse idempotency (see _layoutStack()). */
  function MemberEntry(host, column, anchor, slotName) {
    this.host = host;
    this.column = column;
    this.anchor = anchor;
    this.slotName = slotName;
  }

  /* Stashed-state predicate — generalizes the pre-v3.549 per-member stash
     booleans (navStashed/footerStashed/userStashed) into one dispatch keyed
     by slot name for the four legacy members, and a generic fallback for any
     future consumer-authored member (present + not carrying data-fmb-pinned
     nor its own data-{member}-expanded-shaped attribute is NOT assumed here —
     a generic member is considered Stashed unless it exposes the unified
     data-aura-stashed mirror and that mirror is absent; see fmb-design.md's
     unified-contract note reused from the pre-v3.549 user-FMB template). */
  function isStashed(entry) {
    var host = entry.host;
    /* v3.555 ITEM-2 seam (fmb-choreography-design.md §Seam contract point 2):
       a member mid-decay (Opened+unpinned, js/fmb-choreography.js's timed
       auto-fade running) has NOT yet returned to Stashed — the reverse-morph
       hasn't completed — so it must not count as Stashed here, regardless of
       slot name. This mirrors hasVisibleContent()'s box-model-stability
       precedent below, one attribute over: a decaying member still keeps its
       slot cell (isEligible() below is what governs cell reservation, and is
       untouched by decay state), it just doesn't count toward
       eligibleStashedCount / stack activation while still visibly fading. */
    if (host.hasAttribute("data-fmb-decaying")) return false;
    switch (entry.slotName) {
      case "nav":
        return host.hasAttribute("data-stashed");
      case "sidebar":
        /* FMB-mode eligibility (pre-v3.549 #891, unchanged): only a sidebar in
           "reveal" mode participates at all; a sidebar in "standard" panel
           mode is present in the DOM but not an FMB member this sync. Pinned
           state does NOT evict the sidebar from the column (#951, unchanged
           by this item) — its slot cell stays put while its panel floats
           above/past the column. */
        return host.getAttribute("data-aura-sidebar") === "reveal";
      case "footer":
        return host.getAttribute("data-aura-footer") === "reveal" && !host.hasAttribute("data-aura-revealed");
      case "user":
        return host.hasAttribute("data-aura-stashed");
      default:
        /* Generic member template (fmb-design.md's unified contract): presence
           of the shared data-aura-stashed mirror, when authored, is read
           directly rather than inventing a bespoke per-host attribute. A
           generic host that authors no stash mirror at all is treated as
           always-Stashed (it has no Opened/Pinned distinction this engine
           knows about) so it still reserves a column slot. */
        return host.hasAttribute("data-aura-stashed") || !host.hasAttribute("data-fmb-pinned");
    }
  }

  /* Present-eligibility predicate — mirrors isStashed()'s per-slot dispatch
     but answers "does this member participate in the column AT ALL right
     now" (pre-v3.549's sidebarFmb/footerFmb "FMB-mode eligibility" concept),
     independent of stash state. A present-but-not-stashed member still
     reserves its slot cell (so the column doesn't jump size when it opens)
     but does not count toward stack activation. */
  function isEligible(entry) {
    var host = entry.host;
    switch (entry.slotName) {
      case "sidebar":
        return host.getAttribute("data-aura-sidebar") === "reveal";
      case "footer":
        return host.getAttribute("data-aura-footer") === "reveal";
      default:
        return true;
    }
  }

  /* Migration default (v3.549 ITEM-2), extracted to a free function (v3.555
     ITEM-2 seam) — tag each present legacy host with its default
     data-fmb-column/data-fmb-anchor/data-fmb-slot triplet, UNLESS the host
     already authors its own data-fmb-column (an explicit author override
     always wins). Idempotent: checks hasAttribute before writing so re-
     running this on every discovery pass never clobbers a value a consumer
     or a prior run already set. Never depended on `this` — it always just
     scanned `document` — so it is now a standalone function the
     AuraFmbColumn.prototype._autoTagLegacyMembers() method below delegates
     to, and the module-level discoverMembers() (also below) reuses directly. */
  function autoTagLegacyMembers() {
    for (var i = 0; i < LEGACY_MEMBERS.length; i++) {
      var def = LEGACY_MEMBERS[i];
      var hosts = document.querySelectorAll(def.selector);
      for (var h = 0; h < hosts.length; h++) {
        var host = hosts[h];
        if (!host.hasAttribute("data-fmb-column")) host.setAttribute("data-fmb-column", def.column);
        if (!host.hasAttribute("data-fmb-anchor"))  host.setAttribute("data-fmb-anchor", def.anchor);
        if (!host.hasAttribute("data-fmb-slot"))    host.setAttribute("data-fmb-slot", def.slot);
      }
    }
  }

  /* Re-discover every registered member in the document (v3.555 ITEM-2 seam:
     the SAME logic AuraFmbColumn.prototype._discoverMembers() below uses,
     extracted to a free function so it needs no <aura-fmb-column> instance).
     Any element carrying BOTH data-fmb-column and data-fmb-anchor (after
     autoTagLegacyMembers() has run) is a registered member, EXCEPT this
     file's own internal stack containers (_ensureStacks() also gives those
     the same two attributes as positioning markers, not member hosts) —
     detected via host.closest("aura-fmb-column") rather than a `parentElement
     === this` instance check, which is equivalent for the single-instance-
     per-page model this file already assumes (file banner comment) but
     instance-independent, which is what makes this function extractable as
     the module-level read accessor Aura.fmbColumn.members() exposes just
     below: js/fmb-choreography.js (or any future consumer) reads the SAME
     discovered member list instead of re-implementing the
     LEGACY_MEMBERS-shaped dispatch a second time (fmb-choreography-design.md
     §Seam contract point 1). Registration order = DOM (document) order.
     Returns plain {host, column, anchor, slotName} records — not
     MemberEntry instances, which are this file's own internal type; the
     public accessor stays dependency-free of it. */
  function discoverMembers() {
    autoTagLegacyMembers();
    var hosts = document.querySelectorAll("[data-fmb-column][data-fmb-anchor]");
    var members = [];
    for (var i = 0; i < hosts.length; i++) {
      var host = hosts[i];
      if (host.closest && host.closest("aura-fmb-column")) continue; // our own stack container, not a member
      var column = host.getAttribute("data-fmb-column");
      var anchor = host.getAttribute("data-fmb-anchor");
      if (COLUMNS.indexOf(column) === -1 || ANCHORS.indexOf(anchor) === -1) continue;
      var slotName = host.getAttribute("data-fmb-slot") || null;
      members.push({ host: host, column: column, anchor: anchor, slotName: slotName });
    }
    return members;
  }

  /* Public read accessor (v3.555 ITEM-2 seam, fmb-choreography-design.md
     §Seam contract point 1): the current FMB member list, freshly discovered
     from the live DOM on every call — mirrors this file's own back-compat
     getters' "always correct for the CURRENT DOM state" convention (see
     AuraFmbColumn.prototype's _navEl-shaped getters below) rather than a
     cached snapshot that could go stale between calls. Namespace-level, not
     tied to any <aura-fmb-column> instance, because member discovery is a
     page-wide DOM query, not per-element state. */
  Aura.fmbColumn = Aura.fmbColumn || {};
  Aura.fmbColumn.members = function () {
    return discoverMembers();
  };

  /* Content-occupancy predicate (#1074 fix). isStashed()/isEligible() answer
     from MEMBER STATE alone (attributes) — neither one ever asks whether the
     member's host is actually rendering anything a stack's glass surface
     would visually contain. A host can be logically "Stashed" (isStashed()
     true) while its own CSS has collapsed it to a zero-area box (e.g. a
     sidebar rail closed to width:0) — the corner slab then activates and
     paints an ~0.88-alpha glass tile over hero/content with nothing inside
     it, because the count-based threshold below never looked at the
     rendered box. hasVisibleContent() closes that gap: a Stashed member only
     counts toward eligibleStashedCount (and therefore toward stack
     activation) once its host actually paints a non-zero-area box.
     getBoundingClientRect() (not offsetWidth/Height) so this also correctly
     reads position:fixed hosts, which the legacy chrome members always are.
     Disconnected hosts (mid-teardown) are treated as having no content. Note
     this does NOT gate presentCount/slot-cell reservation — a member mid-
     collapse-animation still keeps its cell so the stack's box model doesn't
     jump; it only gates whether that member's Stashed-ness counts toward the
     activation threshold. */
  function hasVisibleContent(host) {
    if (!host || !host.isConnected) return false;
    var rect = host.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  class AuraFmbColumn extends HTMLElement {
    constructor() {
      super();
      var self = this;
      this._syncBound = function syncBound() { self._rafId = null; self._sync(); };
      /* Guard against observing our OWN DOM writes (#1046 hang fix): _sync()
         creates/reorders stack containers and slot cells INSIDE this element
         (_ensureStacks(), _layoutStack()'s cell append/reorder). Those are
         childList mutations under document.documentElement's subtree just
         like any external change, so without this guard every _sync() call
         would re-trigger itself via its own writes — an infinite
         resync loop. A record whose target is this element or a descendant
         of it is our own bookkeeping, never a member's state changing, so it
         must never mark presence dirty or schedule another sync. */
      this._scheduleSyncBound = function scheduleSyncBound(records) {
        var relevant = false;
        for (var i = 0; i < records.length; i++) {
          var target = records[i].target;
          if (self.contains(target) || target === self) continue; /* our own subtree write — ignore */
          relevant = true;
          if (records[i].type === 'childList' || records[i].type === 'attributes') { self._presenceDirty = true; }
        }
        if (relevant) self._scheduleSync();
      };
      this._mqlChangeBound = function mqlChangeBound() { self._presenceDirty = true; self._scheduleSync(); };

      /* Pre-bound pointer/focus slot-hover handlers — allocated once per
         element lifetime (mirrors the pre-v3.549 pattern, #945/#946), now
         dispatching through the live member registry instead of four
         hardcoded refs. */
      this._checkHover = function checkHover() {
        var stillIn = false;
        for (var i = 0; i < self._members.length; i++) {
          if (self._members[i].host.matches(':hover')) { stillIn = true; break; }
        }
        if (!stillIn && self._hoverHost !== null) { self._clearHover(); }
      };
      this._checkFocus = function checkFocus() {
        var active = document.activeElement;
        var stillFocused = false;
        for (var i = 0; i < self._members.length; i++) {
          if (self._members[i].host.contains(active)) { stillFocused = true; break; }
        }
        if (!stillFocused && self._hoverHost !== null) { self._clearHover(); }
      };
      this._hoverOver = function hoverOver(e) {
        if (!self._anyStackActive) return;
        self._setHoverFromEvent(e.target);
      };
      this._hoverOut = function hoverOut() {
        if (!self._anyStackActive) return;
        if (self._hoverHost !== null) requestAnimationFrame(self._checkHover);
      };
      this._focusIn = function focusIn(e) {
        if (!self._anyStackActive) return;
        self._setHoverFromEvent(e.target);
      };
      this._focusOut = function focusOut() {
        if (!self._anyStackActive) return;
        if (self._hoverHost !== null) requestAnimationFrame(self._checkFocus);
      };

      this._mo = null;
      this._mql = null;
      this._lastBreakpoint = null;
      this._rafId = null;
      this._minCache = null; /* per-stack data-fmb-column-min override; read from the STACK element, see _sync() */
      this._presenceDirty = true;
      this._members = [];        /* flat list of MemberEntry, rebuilt on every presence-dirty sync */
      this._stacks = {};         /* "start:start" -> stack <div> element, created lazily in _ensureStacks() */
      /* Hover identity is keyed off the stable DOM host element (_hoverHost),
         NOT a cached MemberEntry reference (_hoverEntry, kept only for the
         slotName it carries at set-time — see _setHoverFromEvent()). Every
         presence-dirty _sync() re-runs _discoverMembers(), which allocates a
         brand-new MemberEntry per host every pass (by design — see the
         MemberEntry doc comment), and presence-dirty now fires on ANY
         observed attribute change (not just childList). Comparing by entry
         identity meant `this._hoverEntry === entry` silently stopped
         matching the same still-hovered host after any unrelated DOM
         mutation triggered re-discovery — the per-cell
         data-fmb-slot-hovered highlight could drop while the pointer was
         still over the button, and the stale entry reference lingered until
         the next real pointer/focus event recomputed it (reviewer finding,
         v3.549 review-fix). Comparing by host element sidesteps this: hosts
         are stable across re-discovery, only the wrapping MemberEntry is
         reallocated. */
      this._hoverHost = null;    /* host element of the currently slot-hovered member, or null */
      this._hoverEntry = null;   /* MemberEntry last seen for _hoverHost (slotName source, may be stale — never compared by identity) */
      this._anyStackActive = false; /* fast-path guard: true once ANY stack carries data-fmb-column-active */

      /* v3.549 ITEM-3 — mobile reveal control. this._reveal is the JS-created
         <button> (lazily built in _ensureRevealControl(), same
         idempotent-on-reconnect pattern as _ensureStacks()); this._isMobile
         tracks the LAST-SYNCED breakpoint match so _sync() can detect the
         mobile->desktop transition edge and reset the revealed state (see
         _sync()) without re-querying matchMedia twice per call. */
      this._reveal = null;
      this._isMobile = false;
      this._toggleRevealBound = function toggleRevealBound() { self._toggleReveal(); };
    }

    static get observedAttributes() { return ["data-fmb-column-min"]; }

    /* ---- Back-compat read-only accessors (v3.549 ITEM-2) -------------------
       The pre-v3.549 engine cached four hardcoded per-member host refs
       (_navEl/_sidebarChromeEl/_footerChromeEl/_userChromeEl) as plain
       instance properties, always current because every DOM mutation the
       old code cared about ran through its own synchronous _sync() path
       before any test assertion read them. This engine replaces the
       hardcoded refs with the generic _members registry (only refreshed
       lazily, on the next _presenceDirty sync), but
       tests/unit/fmb-column.test.js (rewritten in ITEM-4, not this item)
       still reads those legacy names directly, sometimes immediately after
       mutating the DOM with only a setTimeout(0) (no guaranteed rAF tick)
       before asserting — a gap the old synchronous-cache model never had to
       account for.

       Two failure modes without these getters: (1) the property is simply
       `undefined`, or (2) it resolves from the STALE cached _members list.
       Either way, a MISMATCHED actual-vs-expected pair where the expected
       side is a live DOM node hangs the web-test-runner/chai reporting
       pipeline outright on ANY failing `.to.equal()` comparison of that
       shape (confirmed via isolated repro with both `undefined` and `null`
       as the actual value — a latent trap in the test tooling itself, not
       specific to this engine's logic). To avoid that class of hang
       entirely — not just the specific cases the current test file happens
       to hit — every getter below re-discovers members freshly from the
       live DOM on each read (mirroring _discoverMembers(), not the cached
       _members list), so the answer is always correct for the CURRENT DOM
       state regardless of whether a _sync() pass has caught up yet. These
       are pure derived read-only views for compatibility, not new mutable
       state, and do not replace _members (used by the hot _sync() path,
       where the cached list is the correct, perf-conscious choice). */
    get _navEl() { return this._liveMemberHost("nav", null); }
    get _sidebarChromeEl() { return this._liveMemberHost("sidebar", isEligible); }
    get _footerChromeEl() { return this._liveMemberHost("footer", isEligible); }
    get _userChromeEl() { return this._liveMemberHost("user", isStashed); }
    /* Bare presence refs (pre-v3.549: cached regardless of FMB-mode
       eligibility, distinct from the *ChromeEl getters above which filter to
       eligible members only). */
    get _sidebarEl() { return this._liveMemberHost("sidebar", null); }
    get _footerEl() { return this._liveMemberHost("footer", null); }
    get _userEl() { return this._liveMemberHost("user", null); }

    /* Shared helper for the back-compat getters above: freshly discover
       every registered member from the live DOM (auto-tagging the four
       legacy hosts first, exactly like _discoverMembers()) and return the
       host whose slotName matches, optionally filtered by a predicate
       (isEligible/isStashed) — or null if none matches. */
    _liveMemberHost(slotName, predicate) {
      var members = this._discoverMembers();
      for (var i = 0; i < members.length; i++) {
        var m = members[i];
        if (m.slotName === slotName && (!predicate || predicate(m))) return m.host;
      }
      return null;
    }
    /* Slot-cell refs (pre-v3.549: one fixed <div> per named slot, direct
       children of the root). This engine keys cells by host in a per-stack
       Map (_fmbCellMap) instead of four named instance fields — these
       getters resolve the same "cell for this named member" question by
       searching every stack's map for a host with a matching slotName. */
    get _navSlot() { return this._slotCellFor("nav"); }
    get _sidebarSlot() { return this._slotCellFor("sidebar"); }
    get _footerSlot() { return this._slotCellFor("footer"); }
    get _userSlot() { return this._slotCellFor("user"); }
    _slotCellFor(slotName) {
      for (var key in this._stacks) {
        if (!Object.prototype.hasOwnProperty.call(this._stacks, key)) continue;
        var stackEl = this._stacks[key];
        if (!stackEl._fmbCellMap) continue;
        var found = null;
        stackEl._fmbCellMap.forEach(function (cell, host) {
          if (!found && host.getAttribute("data-fmb-slot") === slotName) found = cell;
        });
        if (found) return found;
      }
      return null;
    }

    attributeChangedCallback() {
      if (this.isConnected) this._scheduleSync();
    }

    connectedCallback() {
      /* v3.549 reviewer fix (a11y-tree finding): aria-hidden used to be set
         HERE, on the whole <aura-fmb-column> host — correct in the
         pre-mobile-reveal model, where every child was a decorative
         positioning stack and the real FMB hosts were announced by their
         own elements elsewhere in the DOM. Scoping aria-hidden to just the
         actually-decorative stack <div> containers (_ensureStacks(), each
         already carries its own aria-hidden="true") is the narrower, safer
         fix — the host itself is display:contents and was never itself an
         AT-relevant node, so it needs no aria-hidden of its own.

         v3.554 ITEM-13 (#1080): the [data-fmb-reveal] <button> is no longer
         even a descendant of this host (see _ensureRevealControl() — it is
         now a document.body child, escaping the aura-app isolation
         boundary), so this host's aria-hidden posture can no longer reach
         or affect it either way — the button's own accessibility markup
         (aria-label/aria-expanded, set in _ensureRevealControl()) is now
         the sole source of truth for how it is announced. */
      this._ensureStacks();
      this._ensureRevealControl();

      /* Auto-tag the four legacy members with default data-fmb-column/
         data-fmb-anchor/data-fmb-slot values if they don't already author
         their own (v3.549 ITEM-2 migration default) — see LEGACY_MEMBERS. */
      this._autoTagLegacyMembers();

      /* Observe the whole document for the union of every attribute this
         engine or any known member's stash/expand vocabulary cares about,
         plus childList for presence changes and generic data-fmb-column/
         data-fmb-anchor authoring on ANY element (new/consumer members). */
      this._mo = new MutationObserver(this._scheduleSyncBound);
      this._mo.observe(document.documentElement, {
        attributes: true,
        childList: true,
        subtree: true,
        attributeFilter: [
          "data-stashed", "data-aura-revealed", "data-aura-sidebar", "data-aura-footer",
          "data-aura-stashed", "data-aura-user-fmb", "data-fmb-pinned",
          "data-fmb-column", "data-fmb-anchor",
          /* v3.555 ITEM-2 seam (fmb-choreography-design.md §Seam contract
             point 3): js/fmb-choreography.js flips these on a member host
             while it's Opened+unpinned — a sync must re-run the moment it
             does, or the column's own slot/eligibility bookkeeping (the
             isStashed() decaying-member rule above) goes stale mid-decay. */
          "data-fmb-detached", "data-fmb-decaying"
        ]
      });

      document.addEventListener('pointerover', this._hoverOver, { passive: true });
      document.addEventListener('pointerout',  this._hoverOut,  { passive: true });
      document.addEventListener('focusin',     this._focusIn,   { passive: true });
      document.addEventListener('focusout',    this._focusOut,  { passive: true });

      var bp = readBreakpoint();
      this._mql = window.matchMedia('(max-width: ' + bp + ')');
      this._mql.addEventListener('change', this._mqlChangeBound);
      this._lastBreakpoint = bp;

      this._sync();
    }

    disconnectedCallback() {
      if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
      this._mql.removeEventListener('change', this._mqlChangeBound);
      this._mql = null;
      this._lastBreakpoint = null;
      document.removeEventListener('pointerover', this._hoverOver);
      document.removeEventListener('pointerout',  this._hoverOut);
      document.removeEventListener('focusin',     this._focusIn);
      document.removeEventListener('focusout',    this._focusOut);
      /* v3.554 ITEM-13 (#1080): the reveal button is a document.body child,
         not a DOM descendant of this host (see _ensureRevealControl()), so
         a genuine disconnect (the host itself being removed) must remove
         the body-level button outright — mirroring js/footer.js's
         _teardown() unwinding its own body-level panel. Left in the DOM, a
         stale button would leak across element lifecycles (a later
         reconnect's _ensureRevealControl() would find and silently adopt
         someone else's abandoned node, or — with no second instance ever
         reconnecting — just sit there forever as dead, unreachable-by-any-
         column chrome) and single-instance semantics (only one
         [data-fmb-reveal] button ever exists) would erode over repeated
         connect/disconnect cycles. */
      if (this._reveal) {
        this._reveal.removeEventListener('click', this._toggleRevealBound);
        if (this._reveal.parentNode) this._reveal.parentNode.removeChild(this._reveal);
        this._reveal = null;
      }
      this._mo.disconnect();
      this._mo = null;
      this._presenceDirty = true;
      this._members = [];
      if (this._anyStackActive) this._deactivateAll();
      this.removeAttribute(REVEALED_ATTR);
      this._isMobile = false;
    }

    /* Coalesce MutationObserver callbacks within one animation frame (#879). */
    _scheduleSync() {
      if (this._rafId) cancelAnimationFrame(this._rafId);
      this._rafId = requestAnimationFrame(this._syncBound);
    }

    /* Create the (up to) four stack containers — one per (column, anchor)
       combination — as direct children, matching ITEM-1's CSS selectors
       ([data-fmb-column][data-fmb-anchor]). Idempotent: reuses existing
       stacks on reconnect rather than duplicating them (mirrors the
       pre-v3.549 slot-div creation guard, #935). */
    _ensureStacks() {
      for (var c = 0; c < COLUMNS.length; c++) {
        for (var a = 0; a < ANCHORS.length; a++) {
          var column = COLUMNS[c], anchor = ANCHORS[a];
          var key = column + ":" + anchor;
          var existing = this.querySelector('[data-fmb-column="' + column + '"][data-fmb-anchor="' + anchor + '"]');
          if (existing) {
            this._stacks[key] = existing;
            continue;
          }
          var stack = document.createElement("div");
          stack.setAttribute("data-fmb-column", column);
          stack.setAttribute("data-fmb-anchor", anchor);
          stack.setAttribute("aria-hidden", "true");
          this.appendChild(stack);
          this._stacks[key] = stack;
        }
      }
    }

    /* v3.549 ITEM-3 (fmb-design.md §Mobile) — create the single mobile reveal
       control as a real, focusable <button>.

       v3.554 ITEM-13 (#1080): appended to document.body, NOT this host —
       css/theme.css's `aura-app { isolation: isolate; }` traps any
       descendant of <aura-app> (this host lives inside it) in its own
       stacking context, while js/footer.js's floating panel
       (ensureFooterPanel()) is deliberately a document.body child (for a
       containing-block reason — see that function's doc comment) appended
       AFTER <aura-app> in document order. A body-level sibling painted
       after <aura-app> beats everything inside the isolated context
       regardless of z-index (confirmed via elementFromPoint), so no
       --aura-z-fmb-reveal value on a button still nested inside
       <aura-fmb-column>/<aura-app> could ever win against the open panel.
       Moving the button out to document.body — mirroring
       ensureFooterPanel()'s own escape — is the fix: both elements now
       compete in the SAME (non-isolated) top-level stacking context, where
       z-index (--aura-z-fmb-reveal, one tier above --aura-z-fmb-active,
       #1067) and DOM/paint order are meaningful again.

       Looked up/created at the DOCUMENT level (not `this.querySelector`)
       for the same reason — the button is no longer inside this host's
       subtree. <aura-fmb-column> remains a single-instance-per-page root
       (file banner comment above), so a document-level lookup still
       resolves to exactly one button; disconnectedCallback() removes it
       outright on teardown (rather than merely detaching this host's
       listener) so a torn-down instance never leaves a stale button behind
       for a later instance to silently adopt.

       Idempotent on reconnect, same guard shape as _ensureStacks(). CSS-only
       gates its visibility to <640px (@media (max-width: 639px)); the
       element itself always exists in the DOM at desktop widths too (an
       inert, display:none-by-default-media-query button costs nothing and
       keeps this method's logic breakpoint-agnostic — _sync() decides
       WHETHER the column is "revealed", not whether the button exists). */
    _ensureRevealControl() {
      var existing = document.querySelector(REVEAL_SEL);
      if (existing) { this._reveal = existing; }
      else {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.setAttribute("data-fmb-reveal", "");
        btn.className = "aura-glow";
        btn.setAttribute("aria-label", "Show menu buttons");
        btn.setAttribute("aria-expanded", "false");
        btn.appendChild(Aura.icon ? Aura.icon("menu") : document.createTextNode("≡"));
        document.body.appendChild(btn);
        this._reveal = btn;
      }
      this._reveal.addEventListener('click', this._toggleRevealBound);
    }

    /* Toggle the merged column's visibility (click, or Enter/Space — a real
       <button> gets both activation keys for free with no keydown handler
       needed). Mirrors js/shell-nav.js's toggle()/aria-expanded convention.

       v3.549 reviewer fix (mobile phantom-offset finding): REVEALED_ATTR
       lives on THIS host, but it is deliberately excluded from both the
       MutationObserver's attributeFilter allowlist and (redundantly) would
       be ignored anyway by _scheduleSyncBound's "target === self is our own
       bookkeeping" guard — see the constructor comment. That was harmless
       before this fix (nothing downstream read the revealed state), but
       _syncStartStartOffset() now depends on it (this._isMobile && not
       revealed → force the export to 0). Without an explicit resync here,
       toggling reveal would only update the exported offset by accident, on
       whatever LATER mutation happened to also fire _sync() — schedule one
       directly so the offset (and any other _sync()-derived state) reflects
       the new revealed state immediately. */
    _toggleReveal() {
      var next = !this.hasAttribute(REVEALED_ATTR);
      this.toggleAttribute(REVEALED_ATTR, next);
      if (this._reveal) this._reveal.setAttribute("aria-expanded", next ? "true" : "false");
      this._scheduleSync();
    }

    /* Force the revealed state closed (idempotent) — used on the
       mobile->desktop breakpoint transition (_sync()) and available for any
       future dismiss trigger (outside click/Escape are not required by this
       item's acceptance bar, so none is wired yet; #1052 tracks broader
       mobile-fallback coordination that may want one).

       NOT calling _scheduleSync() here: _closeReveal() is only ever invoked
       synchronously FROM WITHIN _sync() itself (the mobile->desktop
       breakpoint-transition edge) — scheduling another sync from inside the
       current one would be redundant at best. */
    _closeReveal() {
      if (!this.hasAttribute(REVEALED_ATTR)) return;
      this.removeAttribute(REVEALED_ATTR);
      if (this._reveal) this._reveal.setAttribute("aria-expanded", "false");
    }

    /* Migration default (v3.549 ITEM-2): tag each present legacy host with
       its default data-fmb-column/data-fmb-anchor/data-fmb-slot triplet,
       UNLESS the host already authors its own data-fmb-column (an explicit
       author override always wins — this engine is not hardcoded to the
       four names, it only supplies defaults for them). Idempotent: checks
       hasAttribute before writing so re-running this on every _sync() (via
       the childList-driven presence re-discovery) never clobbers a value a
       consumer or a prior run already set.

       v3.555 ITEM-2 seam: the actual scan/tag logic is now the module-level
       autoTagLegacyMembers() function above (it never depended on `this`) —
       this instance method is kept as a thin delegate so every existing call
       site below is unchanged. */
    _autoTagLegacyMembers() {
      autoTagLegacyMembers();
    }

    /* Re-discover every registered member in the document: any element
       carrying BOTH data-fmb-column and data-fmb-anchor (after
       _autoTagLegacyMembers() has run, so the four legacy hosts are
       included). Registration order = DOM (document) order, which
       _sync()/_layoutStack() preserve into each stack's slot order —
       satisfying "stacking order within an anchor... registration order".

       v3.555 ITEM-2 seam: delegates to the module-level discoverMembers()
       function above (the same one Aura.fmbColumn.members() exposes
       publicly), wrapping its plain {host, column, anchor, slotName} records
       into this file's internal MemberEntry type — a single discovery
       implementation, not two. */
    _discoverMembers() {
      return discoverMembers().map(function (m) {
        return new MemberEntry(m.host, m.column, m.anchor, m.slotName);
      });
    }

    _sync() {
      if (!this.isConnected) return;

      var bp = readBreakpoint();
      if (bp !== this._lastBreakpoint) {
        this._mql.removeEventListener('change', this._mqlChangeBound);
        this._mql = window.matchMedia('(max-width: ' + bp + ')');
        this._mql.addEventListener('change', this._mqlChangeBound);
        this._lastBreakpoint = bp;
      }

      /* v3.549 ITEM-3 (fmb-design.md §Mobile): mobile mode no longer
         short-circuits into _deactivateAll() — the merge is pure CSS
         repositioning of the SAME stacks (css/fmb-column.css re-anchors
         [data-fmb-column="end"] onto the inline-start edge and gates
         visibility on data-fmb-column-revealed), so member
         discovery/layout/activation below must run identically in both
         modes for the revealed column to show the correct populated state
         the instant the user reveals it — deactivating on every mobile
         _sync() would leave a freshly revealed column empty until the next
         mutation happened to fire.
         The one mobile-specific step: reset the revealed state CLOSED the
         moment the breakpoint crosses FROM mobile INTO desktop, so the
         column doesn't carry a stale "revealed" attribute into a width
         where it means nothing, and re-entering mobile later starts hidden
         again ("hidden by default" — fmb-design.md §Mobile). Entering
         mobile sets no attribute at all; the resting default (attribute
         absent) IS hidden, per the CSS's :not([data-fmb-column-revealed])
         rule. */
      var isMobile = this._mql.matches;
      if (this._isMobile && !isMobile) this._closeReveal();
      this._isMobile = isMobile;

      if (this._presenceDirty) {
        this._members = this._discoverMembers();
        this._presenceDirty = false;
      }

      this._minCache = parseMinVal(this.getAttribute('data-fmb-column-min'));

      /* Group members by stack key, preserving DOM (registration) order —
         Array.prototype.sort is not needed since querySelectorAll already
         returns document order and we iterate that order below. */
      var byStack = { "start:start": [], "start:end": [], "end:start": [], "end:end": [] };
      for (var i = 0; i < this._members.length; i++) {
        var m = this._members[i];
        byStack[m.column + ":" + m.anchor].push(m);
      }

      var anyActive = false;
      for (var key in byStack) {
        if (!Object.prototype.hasOwnProperty.call(byStack, key)) continue;
        var active = this._layoutStack(this._stacks[key], byStack[key]);
        if (active) anyActive = true;
      }
      this._anyStackActive = anyActive;

      /* Reflow-offset export (fmb-design.md §Reflow policy: the column itself
         causes NO page-content reflow — this token is retained ONLY for the
         start/start stack's own collision-avoidance consumer, css/sidebar.css,
         which positions a full-height Opened surface below whatever occupies
         that corner. It is NOT re-applied as generic aura-region/aura-split
         padding — see the js/fmb-column.js file banner and
         docs/release-planning/release-planning-v3.549.md §5 for the full
         reasoning. Retired: unlike the pre-v3.549 model, no reflow token is
         set here when only OTHER stacks are active.

         v3.549 reviewer fix (mobile phantom-offset finding): the offset must
         read as zero whenever the merged column exists but is not actually
         visible to the user — mirrors the @media print block's "present in
         :has()-matchable DOM, but not rendered" handling below in
         css/fmb-column.css. On mobile the start/start stack can be
         data-fmb-column-active while the whole column sits behind the
         reveal control (_sync() no longer deactivates on mobile, by
         design — see the comment above), so gate this export on "mobile AND
         not revealed" the same way print gates on "always invisible". */
      this._syncStartStartOffset();

      /* v3.549 reviewer fix (mobile stack-overlap finding): below the
         breakpoint both columns merge onto the inline-start edge (CSS
         re-anchors [data-fmb-column="end"]), so the pre-existing
         inline-start/inline-end separation that kept start:start and
         end:start from ever needing to avoid each other no longer holds.
         Compute a live per-stack push-down/push-up offset so the four
         logical stacks resolve to four visually distinct positions in the
         one merged column instead of two pairs landing exactly on top of
         each other. No-op (and cleared) outside mobile mode — desktop still
         uses the two independent inline edges and needs no offset. */
      this._syncMobileStackOffsets(isMobile);
    }

    /* Live px footprint of one stack's currently-active slot cells — shared
       by _syncStartStartOffset() (the sidebar collision-avoidance export)
       and _syncMobileStackOffsets() (the mobile merged-column
       anti-overlap offset) so both derive the same "how tall is this stack
       right now" measurement from one place. Returns 0 for an empty/absent
       stack. */
    _stackFootprintPx(stack) {
      var cellCount = stack && stack._fmbCellMap ? stack._fmbCellMap.size : 0;
      if (cellCount === 0) return 0;
      var slotSize = Aura.lengthPx ? Aura.lengthPx(DOC_EL, "--aura-fmb-column-size", 96) : 96;
      var gap = Aura.lengthPx ? Aura.lengthPx(DOC_EL, "--aura-fmb-column-gap", 12) : 12;
      return cellCount * slotSize + Math.max(0, cellCount - 1) * gap;
    }

    /* v3.549 reviewer fix — mobile stack-overlap finding. Below the
       breakpoint, css/fmb-column.css re-anchors [data-fmb-column="end"]'s
       two stacks onto the SAME inline-start edge the [data-fmb-column="start"]
       stacks already occupy, merging 4 independent (column, anchor) stacks
       into what must read as ONE coherent column. Reconciled here as two
       groups rather than 4 arbitrary positions (matches the reviewer's
       suggested shape): every block-start-anchored stack (start:start,
       end:start) stacks sequentially from the top edge; every
       block-end-anchored stack (start:end, end:end) stacks sequentially from
       the bottom edge. Concretely: end:start is pushed down by start:start's
       own live footprint (so it begins where start:start ends), and
       end:end is pushed up by start:end's own live footprint (so it begins
       where start:end ends, growing upward per its column-reverse
       direction) — no two stacks ever occupy the same rect. Desktop is
       untouched: both offsets are cleared (0px) outside mobile mode, where
       the two columns sit on independent inline edges and never need to
       avoid each other. */
    _syncMobileStackOffsets(isMobile) {
      var endStart = this._stacks["end:start"];
      var endEnd = this._stacks["end:end"];
      if (endStart) {
        var pushDown = isMobile ? this._stackFootprintPx(this._stacks["start:start"]) : 0;
        var gap = pushDown > 0 ? (Aura.lengthPx ? Aura.lengthPx(DOC_EL, "--aura-fmb-column-gap", 12) : 12) : 0;
        endStart.style.setProperty("--aura-fmb-column-mobile-push", (pushDown + gap) + "px");
      }
      if (endEnd) {
        var pushUp = isMobile ? this._stackFootprintPx(this._stacks["start:end"]) : 0;
        var gap2 = pushUp > 0 ? (Aura.lengthPx ? Aura.lengthPx(DOC_EL, "--aura-fmb-column-gap", 12) : 12) : 0;
        endEnd.style.setProperty("--aura-fmb-column-mobile-push", (pushUp + gap2) + "px");
      }
    }

    /* Lay out one stack's slot cells from its member list; returns whether
       the stack should be marked data-fmb-column-active (has ≥1 member that
       is both present/eligible AND Stashed — "the column reserves space only
       for the Stashed state"). A present-but-Opened member still gets a slot
       cell (so its button position and the stack's box model don't jump when
       it opens — the fixed-envelope cells never resize for content) but does
       NOT itself satisfy activation; the min-count override (data-fmb-column-min
       on the <aura-fmb-column> root, unchanged from pre-v3.549) still governs
       how many STASHED members are required before the stack paints. */
    _layoutStack(stackEl, members) {
      if (!stackEl) return false;

      /* Reconcile slot cells 1:1 with the CURRENT member list, in order —
         reuse existing cells by host identity so idempotent re-syncs don't
         thrash the DOM (mirrors the pre-v3.549 display-toggle idempotency
         guards, generalized from "4 fixed named slots" to "N discovered
         members"). Map keyed by host element -> its slot cell, cached on the
         stack element itself so repeated _sync() calls reuse cells across
         frames without a global registry. */
      if (!stackEl._fmbCellMap) stackEl._fmbCellMap = new Map();
      var cellMap = stackEl._fmbCellMap;
      var seenHosts = new Set();
      var eligibleStashedCount = 0;
      var presentCount = 0;

      for (var mi = 0; mi < members.length; mi++) {
        var entry = members[mi];
        var eligible = isEligible(entry);
        if (!eligible) continue; /* a sidebar/footer NOT in FMB/reveal mode does not occupy a column slot at all (#891, unchanged) */
        presentCount++;
        seenHosts.add(entry.host);

        var cell = cellMap.get(entry.host);
        if (!cell) {
          cell = document.createElement("div");
          cell.setAttribute("data-fmb-slot", entry.slotName || "member");
          cell.setAttribute("data-fmb-slot-host", "");
          cell.setAttribute("aria-hidden", "true");
          cellMap.set(entry.host, cell);
        }
        /* Re-append in registration order every sync — inexpensive (existing
           node move, not a fresh create) and keeps DOM order authoritative
           for the CSS's column/column-reverse stacking direction even if
           members were discovered in a different relative order this pass. */
        stackEl.appendChild(cell);

        var stashed = isStashed(entry) && hasVisibleContent(entry.host);
        if (stashed) eligibleStashedCount++;

        if (this._hoverHost === entry.host) {
          cell.setAttribute("data-fmb-slot-hovered", "");
        } else {
          cell.removeAttribute("data-fmb-slot-hovered");
        }
      }

      /* Remove cells for members no longer present/eligible this sync. */
      cellMap.forEach(function (cell, host) {
        if (!seenHosts.has(host)) {
          if (cell.parentNode) cell.parentNode.removeChild(cell);
          cellMap.delete(host);
        }
      });

      /* data-fmb-column-min semantics changed in v3.549 (documented in
         docs/design/fmb-column-design.md §data-fmb-column-min attribute,
         reviewer finding). Pre-v3.549 this threshold was evaluated ONCE,
         GLOBALLY, against presentCount/stashedCount summed across every
         chrome element combined (one monolithic bar, one combined count).
         _layoutStack() now runs once per (column, anchor) stack, and both
         presentCount and eligibleStashedCount above are already scoped to
         ONLY this stack's own registered members — so the same _minCache
         value (one host-settable attribute, not four) is clamped and
         applied PER STACK, independently. This is an intentional
         architectural consequence of retiring the single column-wide state
         (fmb-design.md), not an oversight: a column with N independent
         stacks has no single combined count left to threshold against. */
      var required = this._minCache !== null ? Math.min(this._minCache, presentCount) : presentCount;
      var active = presentCount > 0 && eligibleStashedCount >= required;

      if (active) {
        stackEl.setAttribute("data-fmb-column-active", "");
        /* data-slot-hover itself is owned exclusively by _setHoverFromEvent()/
           _clearHover() (event-driven, not re-derived every _sync() pass) —
           this reconciliation only needs to avoid leaving a STALE hover
           attribute on a stack that just went inactive, handled in the else
           branch below. */
      } else {
        stackEl.removeAttribute("data-fmb-column-active");
        if (stackEl.hasAttribute("data-slot-hover")) stackEl.removeAttribute("data-slot-hover");
      }

      return active;
    }

    _stackKeyOf(entry) { return entry.column + ":" + entry.anchor; }

    /* Slot-hover dispatch: find which registered member (if any) contains
       the event target, set data-slot-hover on ITS stack (scoped per-stack,
       generalizing the pre-v3.549 single-root attribute) and data-fmb-slot-hovered
       on its cell. */
    _setHoverFromEvent(target) {
      var found = null;
      for (var i = 0; i < this._members.length; i++) {
        if (this._members[i].host.contains(target)) { found = this._members[i]; break; }
      }
      /* Compare by HOST identity, not MemberEntry identity — `found` is a
         freshly-allocated MemberEntry from the current `this._members` list
         every time, but `this._hoverHost` is the stable underlying element,
         so this correctly no-ops when the pointer/focus is still on the same
         member across re-discovery passes (see the _hoverHost field comment
         in the constructor). */
      var foundHost = found ? found.host : null;
      if (foundHost === this._hoverHost) return;
      this._hoverHost = foundHost;
      this._hoverEntry = found;
      /* Re-run the stack layout's hover-attribute pass cheaply: just update
         the data-slot-hover/data-fmb-slot-hovered attributes without a full
         _sync(). */
      for (var key in this._stacks) {
        if (!Object.prototype.hasOwnProperty.call(this._stacks, key)) continue;
        var stackEl = this._stacks[key];
        if (!stackEl.hasAttribute("data-fmb-column-active")) continue;
        var isThisStack = found && this._stackKeyOf(found) === key;
        if (isThisStack) stackEl.setAttribute("data-slot-hover", found.slotName || "member");
        else stackEl.removeAttribute("data-slot-hover");
        if (stackEl._fmbCellMap) {
          stackEl._fmbCellMap.forEach(function (cell, host) {
            if (foundHost && host === foundHost) cell.setAttribute("data-fmb-slot-hovered", "");
            else cell.removeAttribute("data-fmb-slot-hovered");
          });
        }
      }
    }

    _clearHover() {
      this._hoverHost = null;
      this._hoverEntry = null;
      for (var key in this._stacks) {
        if (!Object.prototype.hasOwnProperty.call(this._stacks, key)) continue;
        var stackEl = this._stacks[key];
        stackEl.removeAttribute("data-slot-hover");
        if (stackEl._fmbCellMap) {
          stackEl._fmbCellMap.forEach(function (cell) { cell.removeAttribute("data-fmb-slot-hovered"); });
        }
      }
    }

    /* Exports the start/start stack's live footprint (in px) as
       --aura-fmb-column-active-offset-block-start on :root — the sole
       surviving consumer of this pre-v3.549 token is css/sidebar.css's
       top-left collision-avoidance rule (an Opened sidebar surface clearing
       whatever occupies the top-left corner). Set to 0 (removed) when the
       start/start stack has no active (Stashed) members, so the sidebar's
       coexistence rule and print media both see a clean zero rather than a
       stale measurement. NOT applied as generic page-content reflow (see
       _sync()'s banner comment) — this is the one narrow migration path for
       a real, still-needed per-member collision-avoidance concern, not a
       revival of the old column-wide reflow mechanism.

       v3.549 reviewer fix (mobile phantom-offset finding): pre-ITEM-3, mobile
       mode short-circuited into _deactivateAll() before this method could
       ever be reached, so "the column is active" and "the column is
       actually visible" were structurally the same fact. ITEM-3 removed
       that early-return (member registration/layout must keep running on
       mobile so a freshly revealed column shows the correct populated state
       immediately — see _sync()'s banner comment) — so the start/start
       stack can now be data-fmb-column-active while the merged column sits
       entirely behind the reveal control, invisible
       (visibility:hidden/pointer-events:none, css/fmb-column.css's mobile
       block) until the user taps it. css/sidebar.css's consumer has no
       width/mobile guard of its own (.aura-sidebar is explicitly exempt
       from the generic mobile drawer conversion), so left ungated here it
       would visibly shift the sidebar to "clear" a column the user cannot
       see yet — a phantom reflow. Mirrors the @media print block's
       identical "present/:has()-matchable in the DOM, but not actually
       rendered" handling (css/fmb-column.css's print block reasserts a
       zero for the same underlying reason: activity in the data model does
       not imply visibility). Treated as an additional "not really active"
       condition alongside the existing Stashed-membership check, so both
       share the same clearing branch below. */
    _syncStartStartOffset() {
      var stack = this._stacks["start:start"];
      var stashedActive = stack && stack.hasAttribute("data-fmb-column-active");
      var hiddenOnMobile = this._isMobile && !this.hasAttribute(REVEALED_ATTR);
      var active = stashedActive && !hiddenOnMobile;
      if (!active) {
        if (this._lastOffsetActive) {
          DOC_STYLE.removeProperty("--aura-fmb-column-active-offset-block-start");
          DOC_STYLE.removeProperty("--aura-fmb-column-active-width");
          this._lastOffsetActive = false;
        }
        return;
      }
      var px = this._stackFootprintPx(stack) + "px";
      DOC_STYLE.setProperty("--aura-fmb-column-active-offset-block-start", px);
      DOC_STYLE.setProperty("--aura-fmb-column-active-width", px);
      this._lastOffsetActive = true;
    }

    _deactivateAll() {
      for (var key in this._stacks) {
        if (!Object.prototype.hasOwnProperty.call(this._stacks, key)) continue;
        this._stacks[key].removeAttribute("data-fmb-column-active");
        this._stacks[key].removeAttribute("data-slot-hover");
      }
      this._anyStackActive = false;
      this._clearHover();
      if (this._lastOffsetActive) {
        DOC_STYLE.removeProperty("--aura-fmb-column-active-offset-block-start");
        DOC_STYLE.removeProperty("--aura-fmb-column-active-width");
        this._lastOffsetActive = false;
      }
    }
  }

  Aura.define("aura-fmb-column", AuraFmbColumn);

})();
