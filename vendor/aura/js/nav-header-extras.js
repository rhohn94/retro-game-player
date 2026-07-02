/* ==========================================================================
   Aura — navigation header EXTRAS (opt-in; #395, v3.23).

   Design-language-flavoured opt-ins that the core <aura-nav-header> module
   deliberately does NOT ship: every no-build consumer pays for the core
   bundle on every page, so anything a typical header does not need lives
   here and is loaded only where it is used:

     - Notification bell ring replay (r20-5): replays the .aura-nav-bell ring
       animation when its [data-unread] count increases, via a document-level
       MutationObserver (covers EVERY bell on the page, including static
       specimens — the old core observer only covered the first header).
     - Sticky total-unread chip (r14-r5): sums [data-unread] inside each
       header into an injected .aura-nav-total-unread chip.
     - Recently-visited panel section (r12-r4 / r20-6): [data-nav-recent]
       panels get a session-scoped history section, with an empty state whose
       CTA renders only when [data-nav-recent-cta-href] is authored (#425).
     - Copy-link overlay (r20-7 / #383): [data-nav-copy-link] panels get the
       hover copy-link affordance on href menuitems.
     - Accent colour picker (r16-7 / #378): [data-nav-accent-picker] headers
       get a swatch button; the chosen preset overrides --aura-accent on
       <html> and persists in localStorage.
     - Chord navigation (r17-6): G → <key> jumps to [data-nav-chord="<key>"]
       targets; pending-chord HUD via [data-nav-chord-pending].
     - Panel sort controls (r19-9): [data-nav-sortable] panels get an
       A–Z / Recent sort toolbar (FLIP-animated, no persistence).

   Wiring contract: the core dispatches a bubbling "aura:nav-panel-open"
   CustomEvent (detail.trigger) from openMenu() while the panel is still
   hidden; this module listens on the document and injects its panel
   niceties there. All other wiring is this module's own document-level
   delegation — the core never references an extras symbol, so omitting this
   file (the default) costs nothing.

   Storage keys (all session/local keys are namespaced "aura-nav-*"):
     aura-nav-recent (sessionStorage) · aura-nav-accent (localStorage).

   Load AFTER js/nav-header.js:
     <link rel="stylesheet" href="css/nav-header-extras.css" />
     <script src="js/nav-header-extras.js"></script>
   Dist consumers: dist/aura-nav-extras.css + dist/aura-nav-extras.js (NOT
   part of the default two-file bundle). See docs/design/nav-header-design.md.
   ========================================================================== */
(function () {
  "use strict";
  /* SSR guard (#416): no-op outside the browser so SSR/RSC frameworks can
     evaluate this module (and the dist bundle) in Node without crashing. */
  if (typeof window === "undefined" || typeof document === "undefined") return;
  var Aura = window.Aura;
  if (!Aura || !("customElements" in window)) return;

  var ROOT_SEL = "aura-nav-header, .aura-nav-header";

  /* Strings resolve through the core's shared table (#426): Aura.nav.str /
     Aura.nav.format are defined by js/nav-header.js (which MUST load first —
     the documented extras contract). The defensive fallback keeps the module
     inert-safe if a consumer breaks the load order: keys echo back, which is
     visibly wrong rather than silently English. */
  var navStr = (Aura.nav && Aura.nav.str) || function (key) { return key; };
  var navFmt = (Aura.nav && Aura.nav.format) || function (key) { return key; };

  /* ---- Animated bell ring on unread count increase (nav r20-5) -------------
     The CSS `[data-unread]::before` animation fires once when the attribute is
     first set (CSS animation-fill-mode:both means it stays at frame 0 until it
     plays, then holds at the last frame).  To replay the shake when the COUNT
     increases (e.g. 2 → 5), we add the transient class `aura-nav-bell-new` for
     one animation duration, then remove it.  The class overrides the ::before
     animation so the shake plays again without requiring attribute removal.

     Only fires when:
       • The changed element is, or is inside, an .aura-nav-bell button.
       • The new count is strictly greater than the old count.
       • prefers-reduced-motion is not active.

     The replay class is cleaned up by an `animationend` listener rather than a
     fixed setTimeout so the timing is always correct even if the user's
     browser slows down.                                                        */

  function ringBellOnIncrease(el, oldValue) {
    /* Walk up to find the .aura-nav-bell if el is a descendant. */
    var bell = el.classList && el.classList.contains("aura-nav-bell")
      ? el
      : el.closest && el.closest(".aura-nav-bell");
    if (!bell) return;
    var oldCount = parseInt(oldValue || "0", 10);
    var newCount = parseInt(bell.getAttribute("data-unread") || "0", 10);
    if (isNaN(newCount) || newCount <= oldCount) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    /* Force-replay the animation by removing + re-adding the trigger class. */
    bell.classList.remove("aura-nav-bell-new");
    /* Flush style so the browser registers the removal before the add. */
    void bell.offsetWidth;
    bell.classList.add("aura-nav-bell-new");
    function cleanup() {
      bell.classList.remove("aura-nav-bell-new");
      bell.removeEventListener("animationend", cleanup);
    }
    bell.addEventListener("animationend", cleanup);
  }


  /* ---- Bell hardening (#409) --------------------------------------------
     The opt-in .aura-nav-bell is authored as an EMPTY button; this pass makes
     data-unread the single source of truth for everything attached to it:
       • .aura-glow host (compact radius via CSS) so the bell glows + leans
         like its zone siblings — structural fix: the unread dot is a REAL
         child span (.aura-nav-bell-dot), not ::after, which the glow engine
         owns on glow hosts (glow.css).
       • The accessible name is SYNTHESIZED from the count on every change —
         "<label> — N unread" (or the bare label at zero) — so dynamic updates
         (the documented r20-5 use case) never leave screen readers hearing a
         stale hand-authored count. data-nav-bell-label overrides the base
         label per bell.
     Idempotent; runs at mount and on every data-unread mutation. */
  function bellUnreadCount(bell) {
    var n = parseInt(bell.getAttribute("data-unread") || "0", 10);
    return isNaN(n) ? 0 : n;
  }

  function syncBellState(bell) {
    bell.classList.add("aura-glow"); /* #391/#409 — glow host */
    var n = bellUnreadCount(bell);
    /* Unread dot: a real child span so it coexists with the glow rim. */
    var dot = bell.querySelector(".aura-nav-bell-dot");
    if (n > 0 && !dot) {
      dot = document.createElement("span");
      dot.className = "aura-nav-bell-dot";
      dot.setAttribute("aria-hidden", "true");
      bell.appendChild(dot);
    } else if (n <= 0 && dot) {
      dot.remove();
    }
    /* Accessible name from the count — single source of truth. */
    var base = bell.getAttribute("data-nav-bell-label") || navStr("notifications", bell);
    var label = n > 0 ? navFmt("notificationsUnread", { label: base, n: n }, bell) : base;
    if (bell.getAttribute("aria-label") !== label) bell.setAttribute("aria-label", label);
  }

  function syncAllBells(root) {
    var bells = (root || document).querySelectorAll(".aura-nav-bell");
    for (var i = 0; i < bells.length; i++) syncBellState(bells[i]);
  }

  /* ---- Unread observer (bell ring + total-unread chip) -------------------
     One document-level MutationObserver watches [data-unread] changes
     anywhere on the page: a count increase replays the bell ring (r20-5) and
     any change re-tallies the per-header total-unread chip (r14-r5).
     Document-wide on purpose — the core's old observer was scoped to the
     FIRST header, so bells in static feature specimens (demo pages) never
     rang through the library path. */
  var unreadObserver = null;
  function armUnreadObserver() {
    if (unreadObserver) return;
    /* Last-header-out guard (#421): the mount pass triggered by the final
       header's removal must not resurrect the observer just torn down. */
    if (!document.querySelector(ROOT_SEL)) return;
    unreadObserver = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        if (m.attributeName !== "data-unread") continue;
        syncAllTotalUnread();
        ringBellOnIncrease(m.target, m.oldValue);
        /* Dot span + accessible-name sync (#409). */
        var bellEl = m.target.classList && m.target.classList.contains("aura-nav-bell")
          ? m.target
          : (m.target.closest ? m.target.closest(".aura-nav-bell") : null);
        if (bellEl) syncBellState(bellEl);
      }
    });
    unreadObserver.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeOldValue: true,
      attributeFilter: ["data-unread"]
    });
  }

  /* ---- Sticky total-unread mini-badge (nav r14-r5) ----------------------
     Scans all [data-unread] elements inside each header, sums their integer
     values, and displays the total in a .aura-nav-total-unread chip anchored
     to the start zone. Chip is hidden when total is 0.
     Called on mount and whenever badges change (reuses the existing badge
     MutationObserver already watching [data-unread]).                      */

  var TOTAL_UNREAD_CLASS = "aura-nav-total-unread";

  function ensureTotalUnreadChip(header, create) {
    /* Find — or, when `create` is set, create — the chip in the start zone
       (or first zone). Never created while the total is 0, so headers without
       unread state carry NO injected hidden markup (#425: no permanently-
       hidden dead markup in shared chrome). */
    var zone = header.querySelector("[data-nav-zone='start']") ||
               header.querySelector("[data-nav-zone]");
    if (!zone) return null;
    var existing = zone.querySelector("." + TOTAL_UNREAD_CLASS);
    if (existing || !create) return existing;
    var chip = document.createElement("span");
    chip.className = TOTAL_UNREAD_CLASS;
    chip.setAttribute("aria-hidden", "true");
    chip.setAttribute("role", "none");
    chip.hidden = true;
    zone.appendChild(chip);
    return chip;
  }

  function syncTotalUnread(header) {
    var sources = header.querySelectorAll("[data-unread]");
    var total = 0;
    for (var i = 0; i < sources.length; i++) {
      var n = parseInt(sources[i].getAttribute("data-unread"), 10);
      if (!isNaN(n) && n > 0) total += n;
    }
    var chip = ensureTotalUnreadChip(header, total > 0);
    if (!chip) return;
    var wasHidden = chip.hidden;
    if (total > 0) {
      chip.textContent = total > 99 ? "99+" : String(total);
      chip.hidden = false;
      /* Trigger entrance animation when newly shown. */
      if (wasHidden) {
        chip.removeAttribute("data-unread-visible");
        /* Force reflow then set attribute to trigger animation. */
        void chip.offsetWidth;
        chip.setAttribute("data-unread-visible", "");
      }
    } else {
      chip.hidden = true;
      chip.removeAttribute("data-unread-visible");
    }
  }

  function syncAllTotalUnread() {
    var headers = document.querySelectorAll(ROOT_SEL);
    for (var i = 0; i < headers.length; i++) syncTotalUnread(headers[i]);
  }


  /* ---- Panel "recently visited" section (nav r12-r4) ------------------- */
  var RECENT_KEY = "aura-nav-recent";
  var RECENT_MAX = 3;
  function loadRecent() {
    try { return JSON.parse(sessionStorage.getItem(RECENT_KEY) || "[]"); }
    catch (e) { return []; }
  }
  function saveRecent(list) {
    try { sessionStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch (e) {}
  }
  function recordCurrentPage() {
    var href  = window.location.href;
    var title = document.title || href;
    var list  = loadRecent().filter(function (r) { return r.href !== href; });
    list.unshift({ href: href, title: title });
    if (list.length > RECENT_MAX) list = list.slice(0, RECENT_MAX);
    saveRecent(list);
  }
  function refreshRecentSection(panel) {
    if (!panel.hasAttribute("data-nav-recent")) return;
    var existing = panel.querySelector(".aura-nav-recently-visited");
    if (existing) existing.remove();
    /* Remove any previously injected empty state (nav r20-6). */
    var existingEmpty = panel.querySelector(".aura-nav-recent-empty");
    if (existingEmpty) existingEmpty.remove();
    var list = loadRecent().filter(function (r) { return r.href !== window.location.href; });
    if (!list.length) {
      /* Show empty state only when there are also zero non-filtered items (r20-6).
         This avoids showing the notice when a search is active and hiding items. */
      var visibleItems = panel.querySelectorAll(
        "[role='menuitem']:not([data-nav-filtered]):not([aria-disabled='true'])"
      );
      if (visibleItems.length === 0) {
        injectRecentEmptyState(panel);
      }
      return;
    }
    var section = document.createElement("div");
    section.className = "aura-nav-recently-visited";
    section.setAttribute("role", "none");
    var label = document.createElement("div");
    label.setAttribute("role", "presentation");
    label.setAttribute("aria-hidden", "true");
    label.style.cssText = [
      "font-size:calc(var(--aura-text-xs,0.75rem)*0.9)",
      "font-weight:var(--aura-weight-semibold,600)",
      "color:var(--aura-text-muted)",
      "text-transform:uppercase",
      "letter-spacing:0.05em",
      "padding:var(--aura-space-2) var(--aura-space-3) var(--aura-space-1)",
      "opacity:0.7"
    ].join(";");
    label.textContent = navStr("recentlyVisited", panel);
    section.appendChild(label);
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      var a = document.createElement("a");
      a.setAttribute("role", "menuitem");
      a.className = "aura-glow"; /* #391: recents rows glow like their panel siblings */
      a.href = r.href;
      a.textContent = r.title.length > 40 ? r.title.slice(0, 38) + "…" : r.title;
      a.style.whiteSpace = "nowrap";
      section.appendChild(a);
    }
    panel.insertBefore(section, panel.firstChild);
  }

  /* ---- Recent panel empty state (nav r20-6, CTA contract reworked #425) ----
     When a [data-nav-recent] panel has no history AND no visible items, inject
     a friendly "No pages yet" notice, optionally with a call-to-action link.

     Design (#425 fixes folded in):
       • The notice wrapper is role="none" and NOT aria-live — the core's
         panel-open announcement (r20-9) already announces the panel, so a live
         region here double-announced the same open.
       • The CTA link renders ONLY when the author provides
         [data-nav-recent-cta-href] on the panel. The old default of "/"
         exited (or 404ed) any app not mounted at the site root.
       • When rendered, the CTA is role="menuitem" so it participates in the
         panel's menu semantics (arrow-key navigation, not a stray tab stop).
       • Fades in via the shared aura-nav-empty-fade keyframe.                  */

  function injectRecentEmptyState(panel) {
    var ctaHref = panel.getAttribute("data-nav-recent-cta-href");
    var wrapper = document.createElement("div");
    wrapper.className = "aura-nav-recent-empty";
    wrapper.setAttribute("role", "none");

    var icon = document.createElement("span");
    icon.className = "aura-nav-recent-empty-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.appendChild(Aura.icon("folder")); /* sprite, currentColor (#426) */

    var msg = document.createElement("p");
    msg.className = "aura-nav-recent-empty-msg";
    msg.textContent = navStr("noPagesYet", panel);

    wrapper.appendChild(icon);
    wrapper.appendChild(msg);

    if (ctaHref) {
      var sub = document.createElement("p");
      sub.className = "aura-nav-recent-empty-sub";
      var cta = document.createElement("a");
      cta.className = "aura-nav-recent-empty-cta aura-glow"; /* #391 */
      cta.setAttribute("role", "menuitem");
      cta.href = ctaHref;
      cta.textContent = navStr("browseToGetStarted", panel);
      sub.appendChild(cta);
      wrapper.appendChild(sub);
    }
    panel.insertBefore(wrapper, panel.firstChild);
  }


  /* ---- Copy-link affordance on panel menu items (nav r20-7, rework #383) --
     OPT-IN: injected only into panels carrying [data-nav-copy-link] — the
     other injected niceties (prefetch, sortable, reorderable) are opt-in
     attributes too; this one used to fire on EVERY panel open.

     The injected element is a NON-INTERACTIVE aria-hidden <span> with
     delegated click handling, not a <button> nested inside the anchor:
       • interactive-in-interactive is invalid HTML (axe nested-interactive,
         serious — injected at panel-open so the static a11y gate never saw it);
       • accname name-from-contents made every item announce as e.g.
         "Gallery Copy link" (transiently "Copied!").
     aria-hidden removes it from the a11y tree entirely; the overlay is a
     pointer convenience (AT/keyboard users copy via the browser's own link
     facilities; the menuitem itself stays the single interactive target).
       • Its own .aura-glow host (compact radius) so the glow affordance reads
         on the overlay; a :has() rule in nav-header.css keeps the PARENT
         item's rim from flooding while it is hovered.
       • Suppressed on coarse pointers in CSS (#383: it sat at 24px — far
         below --aura-tap-min — and stole navigation taps).
       • position:relative on the parent comes from a :has() rule in
         nav-header.css — JS writes no inline styles (component contract).
       • After a successful copy a transient [data-copied] attribute shows a
         check-mark glyph via CSS; it is removed after 1.5s.                 */

  function ensureCopyBtns(panel) {
    if (!panel.hasAttribute("data-nav-copy-link")) return;   // opt-in (#383)
    var items = panel.querySelectorAll("[role='menuitem'][href]");
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (item.querySelector(".aura-nav-copy-btn")) continue; // idempotent
      var btn = document.createElement("span");
      btn.className = "aura-nav-copy-btn aura-glow";
      btn.setAttribute("aria-hidden", "true");
      btn.setAttribute("title", navStr("copyLink", item));
      btn.appendChild(Aura.icon("copy")); /* sprite, currentColor (#426) */
      item.appendChild(btn);
    }
  }

  function onCopyBtnClick(btn, e) {
    e.preventDefault();
    e.stopPropagation();
    var item = btn.closest("[role='menuitem']");
    var href = item ? (item.href || item.getAttribute("href")) : null;
    if (!href || !navigator.clipboard) return;
    navigator.clipboard.writeText(href).then(function () {
      btn.setAttribute("data-copied", "");
      btn.setAttribute("title", navStr("copied", btn));
      window.setTimeout(function () {
        btn.removeAttribute("data-copied");
        btn.setAttribute("title", navStr("copyLink", btn));
      }, 1500);
    }).catch(function () { /* silently ignore — clipboard denied */ });
  }


  /* ---- Accent color picker (nav r16-7) ---------------------------------- */
  /* Nav headers with [data-nav-accent-picker] get a small color swatch button
     injected into the user zone. Clicking it opens a compact inline flyout with
     5 preset accent hues (oklch). The chosen hue is applied as --aura-accent
     on <html> and persisted in localStorage under "aura-nav-accent".
     The picker flyout is a non-modal popover with role="dialog" and inert on
     the scrim; Escape and outside-click close it. */
  var ACCENT_KEY = "aura-nav-accent";
  /* Labels resolve through the shared strings table (#426). */
  var ACCENT_PRESETS = [
    { str: "accentIndigo",  value: "oklch(65% 0.18 265)" },
    { str: "accentViolet",  value: "oklch(65% 0.20 300)" },
    { str: "accentEmerald", value: "oklch(68% 0.16 160)" },
    { str: "accentCoral",   value: "oklch(68% 0.17 30)"  },
    { str: "accentSky",     value: "oklch(68% 0.15 220)" }
  ];

  function applyAccent(value) {
    document.documentElement.style.setProperty("--aura-accent", value);
    try { localStorage.setItem(ACCENT_KEY, value); } catch (_) {}
  }
  function seedAccent() {
    try {
      var saved = localStorage.getItem(ACCENT_KEY);
      if (saved) document.documentElement.style.setProperty("--aura-accent", saved);
    } catch (_) {}
  }
  function armAccentPicker(header) {
    if (!header.hasAttribute("data-nav-accent-picker")) return;
    var userZone = header.querySelector("[data-nav-zone='user']");
    if (!userZone) return;
    if (userZone.querySelector(".aura-nav-accent-swatch")) return; /* idempotent */
    /* Swatch button. */
    var swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "aura-nav-accent-swatch aura-glow aura-glow--compact"; /* #391 */
    swatch.setAttribute("aria-label", navStr("accentColorPicker", header));
    swatch.setAttribute("aria-expanded", "false");
    swatch.setAttribute("aria-haspopup", "dialog");
    /* Build flyout. */
    var flyout = document.createElement("div");
    flyout.className = "aura-nav-accent-flyout";
    flyout.setAttribute("role", "dialog");
    flyout.setAttribute("aria-label", navStr("chooseAccentColor", header));
    flyout.setAttribute("aria-modal", "false");
    flyout.hidden = true;
    flyout.setAttribute("inert", "");
    var flyoutInner = document.createElement("div");
    flyoutInner.className = "aura-nav-accent-flyout-inner";
    for (var pi = 0; pi < ACCENT_PRESETS.length; pi++) {
      (function (preset) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "aura-nav-accent-option aura-glow aura-glow--compact"; /* #391 */
        btn.setAttribute("aria-label", navStr(preset.str, header));
        btn.style.setProperty("--aura-accent-preview", preset.value);
        btn.addEventListener("click", function () {
          applyAccent(preset.value);
          /* Mark the chosen one. */
          var all = flyoutInner.querySelectorAll(".aura-nav-accent-option");
          for (var ai = 0; ai < all.length; ai++) all[ai].removeAttribute("aria-pressed");
          btn.setAttribute("aria-pressed", "true");
          closeFlyout();
        });
        flyoutInner.appendChild(btn);
      })(ACCENT_PRESETS[pi]);
    }
    flyout.appendChild(flyoutInner);

    function openFlyout() {
      flyout.hidden = false;
      flyout.removeAttribute("inert");
      swatch.setAttribute("aria-expanded", "true");
      /* Mark the current accent. */
      var current = document.documentElement.style.getPropertyValue("--aura-accent").trim();
      var opts = flyoutInner.querySelectorAll(".aura-nav-accent-option");
      for (var oi = 0; oi < opts.length; oi++) {
        var preset = ACCENT_PRESETS[oi];
        if (preset && preset.value === current) opts[oi].setAttribute("aria-pressed", "true");
        else opts[oi].removeAttribute("aria-pressed");
      }
      window.requestAnimationFrame(function () {
        var first = flyoutInner.querySelector(".aura-nav-accent-option");
        if (first) first.focus({ preventScroll: true });
      });
    }
    function closeFlyout() {
      flyout.hidden = true;
      flyout.setAttribute("inert", "");
      swatch.setAttribute("aria-expanded", "false");
      swatch.focus({ preventScroll: true });
    }

    swatch.addEventListener("click", function (e) {
      e.stopPropagation();
      if (flyout.hidden) openFlyout(); else closeFlyout();
    });
    /* Close on outside click. */
    function onDocPointerDown(e) {
      if (!flyout.hidden && !flyout.contains(e.target) && e.target !== swatch) {
        closeFlyout();
      }
    }
    document.addEventListener("pointerdown", onDocPointerDown, true);
    /* Close on Escape. */
    flyout.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); closeFlyout(); }
    });

    userZone.insertBefore(swatch, userZone.firstChild);
    document.body.appendChild(flyout);

    /* Unmount undo (#421): the flyout lives on document.body and the
       outside-click listener closes over this header's instance — without
       the core's teardown hook every SPA remount stacked a fresh pair. The
       swatch is removed too so a re-mount re-arms (the idempotency guard
       above queries for it). */
    if (Aura.nav && Aura.nav.onHeaderTeardown) {
      Aura.nav.onHeaderTeardown(header, function () {
        document.removeEventListener("pointerdown", onDocPointerDown, true);
        flyout.remove();
        swatch.remove();
      });
    }

    /* Position flyout below the swatch on each open. */
    swatch.addEventListener("click", function () {
      if (!flyout.hidden) {
        var rect = swatch.getBoundingClientRect();
        flyout.style.insetInlineStart = rect.left + "px";
        flyout.style.insetBlockStart  = (rect.bottom + 8) + "px";
      }
    });
  }
  function armAllAccentPickers(root) {
    var scope = root || document;
    var headers = scope.querySelectorAll(ROOT_SEL);
    for (var i = 0; i < headers.length; i++) armAccentPicker(headers[i]);
  }


  /* ---- Chord navigation state (nav r17-6) ------------------------------ */
  var CHORD_TIMEOUT_MS = 1500; /* pending-chord window after the G leader */
  var chordLeaderActive = false;
  var chordTimeout      = null;
  function cancelChord() {
    chordLeaderActive = false;
    clearTimeout(chordTimeout);
    chordTimeout = null;
    var hs = document.querySelectorAll(ROOT_SEL + "[data-nav-chord-pending]");
    for (var i = 0; i < hs.length; i++) hs[i].removeAttribute("data-nav-chord-pending");
  }


  /* ---- Chord navigation keydown (nav r17-6) ------------------------------
     G → <key> navigates to items tagged [data-nav-chord="<key>"] (e.g.
     data-nav-chord="h" on the Home link so G+H goes Home). Active only when
     no panel is open and focus is not in an input. Registered in the CAPTURE
     phase so a consumed chord key never reaches the core keydown delegation
     (mirrors the swallow-and-return behaviour it had inside the core
     handler before the #395 split). */
  function onChordKeyDown(e) {
    var key = e.key;
    var t = e.target;
    if (!t || !t.closest) return;
    var chordLeaderKey = "g";
    if (key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
    var inputTag = (t.tagName || "").toLowerCase();
    var inInput = (inputTag === "input" || inputTag === "textarea" ||
                   inputTag === "select" || t.isContentEditable);
    if (inInput) return;
    var anyOpen = document.querySelector(
      "[role='menu']:not([hidden]), [data-aura-nav-portal]:not([hidden])"
    );
    if (anyOpen) {
      /* Panel opened while chord was pending — cancel. */
      if (chordLeaderActive) cancelChord();
      return;
    }
    /* Leader key pressed. */
    if (key.toLowerCase() === chordLeaderKey && !chordLeaderActive) {
      e.preventDefault();
      e.stopPropagation();
      chordLeaderActive = true;
      /* Show pending HUD. */
      var pendingHeaders = document.querySelectorAll(ROOT_SEL);
      for (var chi = 0; chi < pendingHeaders.length; chi++) {
        pendingHeaders[chi].setAttribute("data-nav-chord-pending", "G");
      }
      clearTimeout(chordTimeout);
      chordTimeout = setTimeout(cancelChord, CHORD_TIMEOUT_MS);
      return;
    }
    /* Second key (chord continuation). */
    if (chordLeaderActive) {
      e.preventDefault();
      e.stopPropagation();
      cancelChord();
      var secondKey = key.toLowerCase();
      /* Find a nav item with matching [data-nav-chord]. */
      var chordTarget = document.querySelector("[data-nav-chord='" + secondKey + "']");
      if (chordTarget) {
        var chordHref = chordTarget.tagName === "A"
          ? chordTarget.getAttribute("href")
          : (chordTarget.querySelector("a") ? chordTarget.querySelector("a").getAttribute("href") : null);
        if (chordHref && chordHref !== "#") {
          window.location.href = chordHref;
        } else {
          chordTarget.click();
        }
      }
    }
  }

  /* ---- Panel sort controls (nav r19-9) -------------------------------------
     Panels with [data-nav-sortable] receive a small sort toolbar with two
     toggle buttons: "A–Z" (alphabetical by label text) and "Recent" (restore
     original DOM order).  Clicking a sort button reorders the [role="menuitem"]
     items inside the panel via FLIP animation (first/last/invert/play technique
     using CSS transitions).

     Attributes:
       data-nav-sortable           — opt-in; activates the sort toolbar.

     The "Recent" button restores the original DOM order captured at arm time.
     Both buttons are aria-pressed to indicate the active sort.

     A11y: the toolbar wrapper is role="none" (transparent for the parent
     menu's aria-required-children, like the core's injected panel-search
     wrapper) and each sort button is role="menuitemradio" with aria-checked —
     the two sorts are mutually exclusive options INSIDE a menu, and closed
     Aura panels stay in the accessibility tree (CSS keeps them rendered for
     transitions), so plain <button>s here were a critical axe violation on
     page load.  Items are NOT removed from the DOM (just reordered), so tab
     order updates naturally with DOM order.

     Implementation detail: only [role="menuitem"] direct or descendant elements
     of the panel are reordered.  Group labels and hr separators stay in place
     (they are found between items and included in the sort as anchors for their
     group members, but for simplicity this initial implementation sorts ALL
     menuitem elements globally within the panel). */

  var SORTABLE_ARMED_ATTR = "data-nav-sortable-armed";

  function armSortablePanel(panel) {
    if (!panel.hasAttribute("data-nav-sortable")) return;
    if (panel.hasAttribute(SORTABLE_ARMED_ATTR)) return;
    panel.setAttribute(SORTABLE_ARMED_ATTR, "");

    /* Capture the original item order BEFORE inserting any controls. */
    var items = Array.prototype.slice.call(
      panel.querySelectorAll("[role='menuitem']")
    );
    /* Store the original parent + next-sibling for each item so "Recent" can
       reconstruct the original order exactly, even across multiple sort toggles. */
    var originalOrder = items.map(function (item) {
      return { el: item, parent: item.parentNode, next: item.nextSibling };
    });

    /* Build the toolbar. */
    var toolbar = document.createElement("div");
    toolbar.className = "aura-nav-sort-toolbar";
    toolbar.setAttribute("role", "none");

    function makeBtn(label, pressed) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "aura-nav-sort-btn aura-glow aura-glow--compact"; /* #391 */
      btn.textContent = label;
      btn.setAttribute("role", "menuitemradio");
      btn.setAttribute("aria-label", navFmt("sortLabel", { label: label }, panel));
      btn.setAttribute("aria-checked", pressed ? "true" : "false");
      return btn;
    }

    var btnAZ = makeBtn(navStr("sortAZ", panel), false);
    var btnRecent = makeBtn(navStr("sortRecent", panel), true);
    toolbar.appendChild(btnAZ);
    toolbar.appendChild(btnRecent);
    panel.insertBefore(toolbar, panel.firstChild);

    function setPressed(active) {
      btnAZ.setAttribute("aria-checked", active === "az" ? "true" : "false");
      btnRecent.setAttribute("aria-checked", active === "recent" ? "true" : "false");
    }

    function sortItems(sorted) {
      /* FLIP: record start positions. */
      var startRects = {};
      for (var i = 0; i < sorted.length; i++) {
        startRects[i] = sorted[i].getBoundingClientRect();
      }
      /* Move items into new DOM order (append to their current parent preserves
         the group structure — items are only reordered among siblings). */
      /* For simplicity: append sorted items to the panel directly. */
      for (var j = 0; j < sorted.length; j++) {
        panel.appendChild(sorted[j]);
      }
      /* FLIP: play (CSS transition on transform, then remove). */
      window.requestAnimationFrame(function () {
        for (var k = 0; k < sorted.length; k++) {
          var endRect = sorted[k].getBoundingClientRect();
          var dy = startRects[k].top - endRect.top;
          if (Math.abs(dy) < 1) continue;
          sorted[k].style.transform = "translateY(" + dy + "px)";
          sorted[k].style.transition = "none";
        }
        window.requestAnimationFrame(function () {
          for (var m = 0; m < sorted.length; m++) {
            sorted[m].style.transition = "transform var(--aura-nav-header-menu-duration) var(--aura-ease-out)";
            sorted[m].style.transform = "";
          }
          window.setTimeout(function () {
            for (var n = 0; n < sorted.length; n++) {
              sorted[n].style.transition = "";
            }
          }, 300);
        });
      });
    }

    btnAZ.addEventListener("click", function () {
      var sorted = items.slice().sort(function (a, b) {
        var ta = (a.textContent || "").trim().toLowerCase();
        var tb = (b.textContent || "").trim().toLowerCase();
        return ta < tb ? -1 : ta > tb ? 1 : 0;
      });
      sortItems(sorted);
      setPressed("az");
    });

    btnRecent.addEventListener("click", function () {
      /* Restore original order by re-inserting each item before its original next. */
      for (var i = 0; i < originalOrder.length; i++) {
        var o = originalOrder[i];
        if (o.next && o.next.parentNode === o.parent) {
          o.parent.insertBefore(o.el, o.next);
        } else {
          o.parent.appendChild(o.el);
        }
      }
      setPressed("recent");
    });
  }

  function armAllSortablePanels(root) {
    var scope = root || document;
    var panels = scope.querySelectorAll(
      "[role='menu'][data-nav-sortable], [data-aura-nav-portal][data-nav-sortable]"
    );
    for (var i = 0; i < panels.length; i++) armSortablePanel(panels[i]);
  }


  /* ---- Panel-open hook + document delegation ----------------------------- */
  /* Injected niceties piggyback on the core's "aura:nav-panel-open" event
     (dispatched from openMenu while the panel is still hidden). Each helper
     is idempotent, so re-injection on every open is safe. */
  document.addEventListener("aura:nav-panel-open", function (e) {
    var panel = e.target;
    if (!panel || !panel.getAttribute) return;
    refreshRecentSection(panel);
    ensureCopyBtns(panel);
    armSortablePanel(panel);
  });

  /* Copy-link clicks intercept in the CAPTURE phase so the core's bubble
     delegation never treats them as a menuitem navigation click. */
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var copyBtn = t.closest(".aura-nav-copy-btn");
    if (copyBtn) onCopyBtnClick(copyBtn, e);
  }, true);

  /* Recently-visited recording: a menuitem navigation inside a nav region
     records the page about to be left (the core did this inline pre-#395). */
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var menuItem = t.closest("[role='menuitem']");
    if (!menuItem) return;
    if (!menuItem.closest("[data-nav-submenu], [data-nav-user-menu], [data-aura-nav-portal]")) return;
    var href = menuItem.getAttribute("href") || "";
    if (href && href.charAt(0) !== "#") recordCurrentPage();
  });

  /* Chord navigation — capture phase (see onChordKeyDown). */
  document.addEventListener("keydown", onChordKeyDown, true);

  /* Last-header-out teardown (#421): the core runs this when the final
     header leaves the document; the next mount pass re-arms everything. */
  if (Aura.nav && Aura.nav.onSharedTeardown) {
    Aura.nav.onSharedTeardown(function () {
      if (unreadObserver) { unreadObserver.disconnect(); unreadObserver = null; }
      cancelChord();
    });
  }

  Aura.onMount(function (root) {
    /* Each step isolated, mirroring the core's mountStep contract (#384). */
    function step(name, fn) {
      try { fn(); } catch (err) { Aura.error("[Aura] nav-header-extras step '" + name + "' failed:", err); }
    }
    step("recordCurrentPage", function () { recordCurrentPage(); });
    step("seedAccent", function () { seedAccent(); });
    step("armAllAccentPickers", function () { armAllAccentPickers(root); });
    step("armAllSortablePanels", function () { armAllSortablePanels(root); });
    step("syncAllBells", function () { syncAllBells(root); });
    step("syncAllTotalUnread", function () { syncAllTotalUnread(); });
    step("armUnreadObserver", function () { armUnreadObserver(); });
  });
})();
