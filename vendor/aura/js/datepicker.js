/* ==========================================================================
   Aura — aura-datepicker: form-associated calendar date input.

   A themeable, accessible replacement for <input type="date">. A trigger button
   (localized label + calendar icon) opens an anchored calendar popup built on
   the Aura.overlay primitive (js/overlay.js) for placement / flip / dismissal /
   focus-return. The popup is a role="dialog" carrying a role="grid" month
   calendar; this module owns the 2-D grid keyboard model (the menu engine's
   linear menuitem nav is deliberately NOT reused — see datepicker-design.md).

   Canonical value is ISO YYYY-MM-DD (local calendar date, no timezone shift),
   mirrored to a hidden <input> for form submission (the aura-select precedent;
   no ElementInternals). Display is localized via Intl. Re-skins purely by
   swapping --aura-datepicker-* / menu / elevation tokens.

   Load order: core.js → element-base.js → overlay.js → datepicker.js.
   See docs/design/datepicker-design.md.
   ========================================================================== */
(function () {
  "use strict";
  /* SSR guard (#416): no-op outside the browser so SSR/RSC frameworks can
     evaluate this module (and the dist bundle) in Node without crashing. */
  if (typeof window === "undefined" || typeof document === "undefined") return;
  var Aura = window.Aura;
  if (!Aura || !("customElements" in window) || !Aura.pickers) return;

  /* Shared picker scaffolding (js/picker-base.js): the dual-endpoint range
     value model both pickers carry. This file owns the calendar grid keyboard
     model and uses Aura.overlay directly for its dialog popup (#338). */
  var pickers = Aura.pickers;

  /* ---- Calendar structural constants (not aesthetic; named per no-magic) -- */
  var DAYS_PER_WEEK = 7;
  var WEEKS_SHOWN = 6;                 // a fixed 6-row grid keeps popup height stable
  var GRID_CELLS = DAYS_PER_WEEK * WEEKS_SHOWN; // 42 day cells
  var ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  /* A known Sunday, used only to source weekday names for the header row. */
  var REFERENCE_SUNDAY = new Date(2023, 0, 1);
  /* Intl.Locale.weekInfo.firstDay is 1=Mon..7=Sun; `% 7` maps it to the
     0=Sun..6=Sat convention this component uses everywhere. */
  var ISO_WEEKDAY_TO_SUNDAY_BASED = 7;
  var MIN_DOW = 0, MAX_DOW = 6;

  /* ---- Pure local-date helpers ----------------------------------------- */
  /* Parse an ISO YYYY-MM-DD string into a LOCAL Date (midnight). Returns null
     for anything malformed or non-existent (e.g. 2025-02-30), so callers can
     validate/reject rather than silently accept a rolled-over date. Never uses
     Date.parse, whose bare-ISO path is UTC and can shift the calendar day. */
  function parseISO(str) {
    if (typeof str !== "string") return null;
    var m = ISO_DATE_RE.exec(str.trim());
    if (!m) return null;
    var year = +m[1], month = +m[2], day = +m[3];
    var d = new Date(year, month - 1, day);
    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
      return null; // out-of-bounds component (e.g. month 13, day 32) rolled over
    }
    return d;
  }

  function toISO(date) {
    var y = String(date.getFullYear()).padStart(4, "0");
    var m = String(date.getMonth() + 1).padStart(2, "0");
    var d = String(date.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }

  function isSameDay(a, b) {
    return !!a && !!b &&
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
  }

  /* Strictly-between (exclusive) day comparison for range-fill highlighting. */
  function isBetween(d, lo, hi) {
    return !!lo && !!hi && d > lo && d < hi;
  }

  /* Separator between the two ISO dates in a range value ("start/end"). */
  var RANGE_SEP = pickers.RANGE_SEP;

  function addDays(date, n) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
  }
  /* Add months keeping the day-of-month, clamping to the target month's last
     day (e.g. Jan 31 + 1 month → Feb 28/29) so navigation never skips a month. */
  function addMonths(date, n) {
    var y = date.getFullYear();
    var m = date.getMonth() + n;
    var targetY = y + Math.floor(m / 12);
    var targetM = ((m % 12) + 12) % 12;
    var lastDay = new Date(targetY, targetM + 1, 0).getDate();
    return new Date(targetY, targetM, Math.min(date.getDate(), lastDay));
  }
  function addYears(date, n) { return addMonths(date, n * 12); }

  /* Clamp `date` to the inclusive [min, max] window (either bound may be null). */
  function clampDate(date, min, max) {
    if (min && date < min) return min;
    if (max && date > max) return max;
    return date;
  }
  function inRange(date, min, max) {
    if (min && date < min) return false;
    if (max && date > max) return false;
    return true;
  }

  /* ---- Locale resolution ------------------------------------------------ */
  /* Resolved BCP-47 tag: explicit attr → <html lang> → undefined (browser
     default). Returns undefined rather than "" so Intl picks the runtime
     default instead of throwing on an empty string. */
  function resolveLocale(el) {
    return el.getAttribute("locale") ||
      document.documentElement.getAttribute("lang") ||
      undefined;
  }

  /* First day of week (0=Sun..6=Sat): explicit override → locale's weekInfo →
     Sunday. Wrapped because Intl.Locale / weekInfo is absent on some engines. */
  function resolveFirstDow(el, locale) {
    var attr = el.getAttribute("first-day-of-week");
    if (attr !== null && attr !== "") {
      var n = parseInt(attr, 10);
      if (!isNaN(n) && n >= MIN_DOW && n <= MAX_DOW) return n;
      Aura.warn("[aura-datepicker] ignoring invalid first-day-of-week:", attr);
    }
    try {
      var loc = new Intl.Locale(locale || undefined);
      var info = typeof loc.getWeekInfo === "function" ? loc.getWeekInfo() : loc.weekInfo;
      if (info && info.firstDay) return info.firstDay % ISO_WEEKDAY_TO_SUNDAY_BASED;
    } catch (e) { /* fall through to Sunday */ }
    return MIN_DOW;
  }

  /* Build the Intl formatters once per (locale) and cache them on the instance.
     A bad locale tag throws; we retry with the runtime default so the control
     still renders. */
  function makeFormatters(locale) {
    function fmt(opts) {
      try { return new Intl.DateTimeFormat(locale, opts); }
      catch (e) { return new Intl.DateTimeFormat(undefined, opts); }
    }
    return {
      label: fmt({ dateStyle: "medium" }),
      full: fmt({ weekday: "long", year: "numeric", month: "long", day: "numeric" }),
      monthYear: fmt({ month: "long", year: "numeric" }),
      weekdayShort: fmt({ weekday: "short" }),
      weekdayLong: fmt({ weekday: "long" })
    };
  }

  /* ---- Icons (registered once; core.js ships neither) ------------------- */
  if (!Aura.icons.has("calendar")) {
    Aura.icons.register(
      "calendar",
      '<rect x="3" y="4" width="18" height="18" rx="2"/>' +
      '<line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>' +
      '<line x1="3" y1="10" x2="21" y2="10"/>'
    );
  }
  if (!Aura.icons.has("chevron-left")) {
    Aura.icons.register("chevron-left", '<polyline points="15 18 9 12 15 6"/>');
  }

  /* ======================================================================
     Summary: form-associated calendar date picker. Manages a trigger, a hidden
     input, and a lazily-built calendar dialog; delegates positioning/dismissal
     to Aura.overlay and owns the grid keyboard model, value, and localization.
     ====================================================================== */
  var AuraDatepicker = class extends Aura.BaseElement {
    static get observedAttributes() {
      return ["value", "name", "min", "max", "locale", "first-day-of-week", "placeholder", "disabled", "range"];
    }

    /* Real form association (#538): formAssociated so native <form>.reset()
       restores the value and <fieldset disabled> propagates; submission rides
       the host-named hidden input(s) (the well-tested path), so the host
       publishes no setFormValue (the delegation pattern). */
    static formAssociated = true;

    connectedCallback() {
      this._initFormInternals();
      if (this.__formDefaultValue === undefined) {
        this.__formDefaultValue = this.getAttribute("value");
      }
      super.connectedCallback();
    }

    /* Range (start–end) mode when range is "dual" / "" (bare). */
    get _isRange() {
      var r = this.getAttribute("range");
      return r === "dual" || r === "";
    }

    /* ---- Lifecycle hooks (Aura.BaseElement) ---------------------------- */
    _build() {
      this._id = Aura.nextId("aura-dp-");
      this._panel = null;            // built lazily on first open
      this._selected = null;         // Date | null  (range mode: start)
      this._selectedEnd = null;      // Date | null  (range mode: end)
      this._min = null;
      this._max = null;
      this._focusDate = null;        // Date carrying the roving tabindex
      this._viewYear = 0;
      this._viewMonth = 0;

      this._buildTrigger();
    }

    _bind() {
      var self = this;
      this._trigger.addEventListener("click", function () { self._onTriggerClick(); });
    }

    _sync() {
      this._locale = resolveLocale(this);
      this._firstDow = resolveFirstDow(this, this._locale);
      this._fmt = makeFormatters(this._locale);
      this._min = this._parseBound("min");
      this._max = this._parseBound("max");
      this._readSelected();
      this._reflectTrigger();
      if (this._panel && Aura.overlay.isOpen(this._panel)) {
        this._renderMonth(this._viewYear, this._viewMonth, this._focusDate);
      }
    }

    _onAttr(name) {
      if (name === "name") {
        this._reflectName();
        return;
      }
      if (name === "range") {
        /* Mode flip: rebuild the trigger/input(s), close any open panel so the
           grid rebuilds with the new selection model, then re-sync. */
        if (this._panel && Aura.overlay.isOpen(this._panel)) Aura.overlay.close(this._panel);
        this._panel = null;
        this._buildTrigger();
        this._sync();
        return;
      }
      this._sync();
    }

    /* Mirror the host name onto the hidden input(s). In range mode both inputs
       carry the host name so a submit sends name=start&name=end. */
    _reflectName() {
      var nm = this.getAttribute("name") || "";
      if (this._input) this._input.name = nm;
      if (this._inputEnd) this._inputEnd.name = nm;
    }

    disconnectedCallback() {
      if (this._panel && Aura.overlay.isOpen(this._panel)) Aura.overlay.close(this._panel);
      super.disconnectedCallback();
    }

    /* ---- Public value API --------------------------------------------- */
    /* Single mode: ISO "YYYY-MM-DD". Range mode: "start/end" (either side may be
       empty). Accepts an array [start, end] on set in range mode. */
    get value() { return this.getAttribute("value") || ""; }
    set value(v) {
      if (Array.isArray(v)) {
        this.setAttribute("value", (v[0] || "") + RANGE_SEP + (v[1] || ""));
      } else {
        this.setAttribute("value", String(v == null ? "" : v));
      }
    }

    /* ---- Trigger + hidden input --------------------------------------- */
    _buildTrigger() {
      /* Idempotent: drop any nodes a prior build left behind, so re-inserting
         the SAME element node (an HTMX move, which resets __init via
         disconnectedCallback) rebuilds cleanly instead of duplicating. */
      var stale = this.querySelectorAll(
        ":scope > .aura-datepicker__trigger, :scope > .aura-datepicker__value, :scope > .aura-datepicker__panel"
      );
      Array.prototype.forEach.call(stale, function (n) { n.remove(); });

      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "aura-datepicker__trigger";
      btn.setAttribute("aria-haspopup", "dialog");
      btn.setAttribute("aria-expanded", "false");

      var label = document.createElement("span");
      label.className = "aura-datepicker__label";
      btn.appendChild(label);
      btn.appendChild(Aura.icon("calendar", "aura-datepicker__icon"));

      var name = this.getAttribute("name");
      var input = document.createElement("input");
      input.type = "hidden";
      input.className = "aura-datepicker__value";
      if (name) input.name = name;

      /* Hidden input precedes the trigger so form-flow's controlOf() resolves
         the logical control first in document order. */
      this.insertBefore(btn, this.firstChild);
      this.insertBefore(input, btn);

      this._trigger = btn;
      this._label = label;
      this._input = input;

      /* Range mode submits a SECOND host-named hidden input (the end date). */
      this._inputEnd = null;
      if (this._isRange) {
        var inputEnd = document.createElement("input");
        inputEnd.type = "hidden";
        inputEnd.className = "aura-datepicker__value aura-datepicker__value--end";
        if (name) inputEnd.name = name;
        this.insertBefore(inputEnd, input.nextSibling);
        this._inputEnd = inputEnd;
      }

      this._wireGlowTarget(btn); // whole-trigger rim glow (BaseElement)
    }

    /* Reflect the selected value + disabled state onto the trigger/input. */
    _reflectTrigger() {
      var disabled = this._isDisabled();
      this._trigger.disabled = disabled;

      if (this._isRange) { this._reflectTriggerRange(); return; }

      if (this._selected) {
        var iso = toISO(this._selected);
        this._label.textContent = this._fmt.label.format(this._selected);
        this._label.removeAttribute("data-placeholder");
        this._input.value = iso;
      } else {
        this._label.textContent = this.getAttribute("placeholder") || "";
        this._label.setAttribute("data-placeholder", "");
        this._input.value = "";
      }
    }

    /* Range-mode trigger label: "start – end" (en-dash), plus both hidden
       inputs. A half-formed range (start only) still shows the start. */
    _reflectTriggerRange() {
      var s = this._selected, e = this._selectedEnd;
      this._input.value = s ? toISO(s) : "";
      if (this._inputEnd) this._inputEnd.value = e ? toISO(e) : "";

      if (s && e) {
        this._label.textContent =
          this._fmt.label.format(s) + " – " + this._fmt.label.format(e);
        this._label.removeAttribute("data-placeholder");
      } else if (s) {
        this._label.textContent = this._fmt.label.format(s) + " – …";
        this._label.removeAttribute("data-placeholder");
      } else {
        this._label.textContent = this.getAttribute("placeholder") || "";
        this._label.setAttribute("data-placeholder", "");
      }
    }

    /* Parse the value attribute into _selected, rejecting (not clamping) a
       malformed or out-of-range date with a warning. In range mode the value is
       "start/end"; either side may be empty for a half-formed range. */
    _readSelected() {
      if (this._isRange) { this._readSelectedRange(); return; }
      var raw = this.getAttribute("value");
      if (!raw) { this._selected = null; return; }
      var d = parseISO(raw);
      if (!d) {
        Aura.warn("[aura-datepicker] ignoring invalid value (expected YYYY-MM-DD):", raw);
        this._selected = null;
        return;
      }
      if (!inRange(d, this._min, this._max)) {
        Aura.warn("[aura-datepicker] value out of [min,max] range, rejected:", raw);
        this._selected = null;
        return;
      }
      this._selected = d;
    }

    /* Parse a "start/end" range value, ordering start <= end. Either bound may
       be empty; a malformed or out-of-[min,max] date is dropped (logged). */
    _readSelectedRange() {
      this._selected = null;
      this._selectedEnd = null;
      var raw = this.getAttribute("value");
      if (!raw) return;
      var parts = pickers.splitRange(raw);
      var ordered = pickers.orderPair(
        this._parseRangePart(parts[0]),
        this._parseRangePart(parts[1]),
        function (d) { return d.getTime(); }
      );
      this._selected = ordered[0];
      this._selectedEnd = ordered[1];
    }

    /* Parse one side of a range value; returns null for empty/invalid/out-of-range. */
    _parseRangePart(raw) {
      if (raw == null || raw === "") return null;
      var d = parseISO(raw.trim());
      if (!d) { Aura.warn("[aura-datepicker] ignoring invalid range date:", raw); return null; }
      if (!inRange(d, this._min, this._max)) {
        Aura.warn("[aura-datepicker] range date out of [min,max], rejected:", raw);
        return null;
      }
      return d;
    }

    _parseBound(attr) {
      var raw = this.getAttribute(attr);
      if (!raw) return null;
      var d = parseISO(raw);
      if (!d) { Aura.warn("[aura-datepicker] ignoring invalid " + attr + ":", raw); return null; }
      return d;
    }

    /* ---- Open / close -------------------------------------------------- */
    _onTriggerClick() {
      if (this._isDisabled()) return;
      var panel = this._ensurePanel();
      if (Aura.overlay.isOpen(panel)) { Aura.overlay.close(panel); return; }
      this._open(panel);
    }

    _open(panel) {
      /* Initial focus target: the selected day, else today clamped into the
         [min,max] window (clampDate always returns an in-range Date). */
      var seed = this._selected || clampDate(this._today(), this._min, this._max);
      this._focusDate = seed;
      this._viewYear = seed.getFullYear();
      this._viewMonth = seed.getMonth();
      this._renderMonth(this._viewYear, this._viewMonth, this._focusDate);

      var self = this;
      Aura.overlay.open(panel, this._trigger, {
        opener: this._trigger,
        onClose: function () {
          self._trigger.setAttribute("aria-expanded", "false");
          self.removeAttribute("open");
        }
      });
      this.setAttribute("open", "");
      this._trigger.setAttribute("aria-expanded", "true");
      this._focusDayCell(this._focusDate);
    }

    _today() {
      var now = new Date();
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }

    /* ---- Panel construction (lazy, reused) ----------------------------- */
    _ensurePanel() {
      if (this._panel) return this._panel;
      var self = this;

      var panel = document.createElement("div");
      panel.className = "aura-datepicker__panel aura-overlay";
      panel.id = this._id + "-panel";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "false");
      panel.setAttribute("aria-label", this._panelLabel());

      /* Header: prev | month-year title | next */
      var header = document.createElement("div");
      header.className = "aura-datepicker__header";

      var prev = this._navButton("prev", "chevron-left", "Previous month");
      var title = document.createElement("div");
      title.className = "aura-datepicker__title";
      title.setAttribute("aria-hidden", "true"); // the live region carries this for AT
      var next = this._navButton("next", "chevron-right", "Next month");

      header.appendChild(prev);
      header.appendChild(title);
      header.appendChild(next);
      panel.appendChild(header);

      /* Grid */
      var table = document.createElement("table");
      table.className = "aura-datepicker__grid";
      table.setAttribute("role", "grid");
      var thead = document.createElement("thead");
      var headRow = document.createElement("tr");
      headRow.setAttribute("role", "row");
      thead.appendChild(headRow);
      var tbody = document.createElement("tbody");
      table.appendChild(thead);
      table.appendChild(tbody);
      panel.appendChild(table);

      /* Visually-hidden polite announcer for month/year changes. */
      var live = document.createElement("div");
      live.className = "aura-datepicker__live aura-sr-only";
      live.setAttribute("aria-live", "polite");
      panel.appendChild(live);

      /* Keep the panel hidden in the host until the overlay opens it. */
      this.appendChild(panel);

      this._panel = panel;
      this._titleEl = title;
      this._headRow = headRow;
      this._tbody = tbody;
      this._liveEl = live;

      prev.addEventListener("click", function () { self._page(addMonths(self._viewDate(), -1)); });
      next.addEventListener("click", function () { self._page(addMonths(self._viewDate(), 1)); });
      tbody.addEventListener("click", function (e) { self._onGridClick(e); });
      panel.addEventListener("keydown", function (e) { self._onKeyDown(e); });

      return panel;
    }

    _navButton(dir, icon, label) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "aura-datepicker__nav aura-glow";
      b.setAttribute("data-aura-nav", dir);
      b.setAttribute("aria-label", label);
      b.appendChild(Aura.icon(icon));
      return b;
    }

    _panelLabel() { return this._isRange ? "Choose date range" : "Choose date"; }
    _viewDate() { return new Date(this._viewYear, this._viewMonth, 1); }

    /* ---- Rendering ----------------------------------------------------- */
    /* Build the weekday header (once) and the 6×7 day grid for the given month.
       `focusDate` receives the roving tabindex if it falls in the grid window. */
    _renderMonth(year, month, focusDate) {
      this._viewYear = year;
      this._viewMonth = month;
      this._renderWeekdayHeader();

      var firstOfMonth = new Date(year, month, 1);
      var offset = (firstOfMonth.getDay() - this._firstDow + DAYS_PER_WEEK) % DAYS_PER_WEEK;
      var gridStart = addDays(firstOfMonth, -offset);
      var today = this._today();
      var rovingISO = focusDate ? toISO(focusDate) : null;

      Aura.clearChildren(this._tbody);
      var row = null;
      for (var i = 0; i < GRID_CELLS; i++) {
        if (i % DAYS_PER_WEEK === 0) {
          row = document.createElement("tr");
          row.setAttribute("role", "row");
          this._tbody.appendChild(row);
        }
        var date = addDays(gridStart, i);
        row.appendChild(this._dayCell(date, month, today, rovingISO));
      }

      var monthYear = this._fmt.monthYear.format(firstOfMonth);
      this._titleEl.textContent = monthYear;
      this._liveEl.textContent = monthYear;
    }

    _renderWeekdayHeader() {
      if (this._headRow.__auraDow === this._firstDow && this._headRow.childNodes.length) return;
      Aura.clearChildren(this._headRow);
      for (var i = 0; i < DAYS_PER_WEEK; i++) {
        var dow = (this._firstDow + i) % DAYS_PER_WEEK;
        var ref = addDays(REFERENCE_SUNDAY, dow);
        var th = document.createElement("th");
        th.setAttribute("role", "columnheader");
        th.setAttribute("abbr", this._fmt.weekdayLong.format(ref));
        th.textContent = this._fmt.weekdayShort.format(ref);
        this._headRow.appendChild(th);
      }
      this._headRow.__auraDow = this._firstDow;
    }

    _dayCell(date, viewMonth, today, rovingISO) {
      var iso = toISO(date);
      var cell = document.createElement("td");
      cell.setAttribute("role", "gridcell");

      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "aura-datepicker__day";
      btn.setAttribute("data-date", iso);
      btn.textContent = String(date.getDate());
      btn.setAttribute("aria-label", this._fmt.full.format(date));

      if (date.getMonth() !== viewMonth) btn.classList.add("aura-datepicker__day--outside");

      var disabled = !inRange(date, this._min, this._max);
      if (disabled) {
        btn.setAttribute("aria-disabled", "true");
        btn.classList.add("aura-datepicker__day--disabled");
      }
      if (isSameDay(date, today)) {
        btn.setAttribute("aria-current", "date");
        btn.classList.add("aura-datepicker__day--today");
      }
      if (this._isRange) {
        this._markRangeCell(btn, date);
      } else if (this._selected && isSameDay(date, this._selected)) {
        btn.setAttribute("aria-selected", "true");
        btn.classList.add("aura-datepicker__day--selected");
      } else {
        btn.setAttribute("aria-selected", "false");
      }

      /* Roving tabindex: only the focus target is tabbable; never a disabled one. */
      btn.tabIndex = (iso === rovingISO && !disabled) ? 0 : -1;
      cell.appendChild(btn);
      return cell;
    }

    /* Mark a cell's range state: start endpoint, end endpoint, or in-between
       fill. aria-selected flags the two endpoints; the fill is a visual band. */
    _markRangeCell(btn, date) {
      var s = this._selected, e = this._selectedEnd;
      var isStart = s && isSameDay(date, s);
      var isEnd = e && isSameDay(date, e);
      if (isStart || isEnd) {
        btn.setAttribute("aria-selected", "true");
        btn.classList.add("aura-datepicker__day--selected");
        if (isStart) btn.classList.add("aura-datepicker__day--range-start");
        if (isEnd) btn.classList.add("aura-datepicker__day--range-end");
      } else {
        btn.setAttribute("aria-selected", "false");
        if (isBetween(date, s, e)) btn.classList.add("aura-datepicker__day--in-range");
      }
    }

    /* ---- Interaction --------------------------------------------------- */
    _onGridClick(e) {
      var btn = e.target.closest(".aura-datepicker__day");
      if (!btn || btn.getAttribute("aria-disabled") === "true") return;
      this._select(parseISO(btn.getAttribute("data-date")));
    }

    _select(date) {
      if (!date || !inRange(date, this._min, this._max)) return;
      if (this._isRange) { this._selectRange(date); return; }

      var iso = toISO(date);
      this._selected = date;
      this._focusDate = date;

      this.__reflecting = true;
      this.setAttribute("value", iso);
      this.__reflecting = false;

      this._reflectTrigger();
      this.dispatchEvent(new CustomEvent("aura:change", {
        bubbles: true,
        detail: { value: iso, date: new Date(date), label: this._fmt.label.format(date) }
      }));
      Aura.overlay.close(this._panel); // returns focus to the trigger
    }

    /* Two-click range selection. First pick (or after a complete range) starts a
       new range with only the start set; the second pick completes it (swapping
       if it falls before the start). The popup stays open until the range is
       complete, then closes and commits. */
    _selectRange(date) {
      var committing = false;
      if (!this._selected || this._selectedEnd) {
        /* Start a fresh range. */
        this._selected = date;
        this._selectedEnd = null;
      } else {
        /* Complete the range (order the endpoints). */
        if (date < this._selected) {
          this._selectedEnd = this._selected;
          this._selected = date;
        } else {
          this._selectedEnd = date;
        }
        committing = true;
      }
      this._focusDate = date;

      var startISO = this._selected ? toISO(this._selected) : "";
      var endISO = this._selectedEnd ? toISO(this._selectedEnd) : "";
      this.__reflecting = true;
      this.setAttribute("value", startISO + RANGE_SEP + endISO);
      this.__reflecting = false;

      this._reflectTrigger();
      /* Re-render so the in-range band updates live as endpoints are chosen.
         Only when the grid exists (selection normally happens with the popup
         open; guarded so the model is also drivable headlessly). */
      if (this._tbody) {
        this._renderMonth(this._viewYear, this._viewMonth, this._focusDate);
        this._focusDayCell(this._focusDate);
      }

      this.dispatchEvent(new CustomEvent("aura:change", {
        bubbles: true,
        detail: {
          value: startISO + RANGE_SEP + endISO,
          start: this._selected ? new Date(this._selected) : null,
          end: this._selectedEnd ? new Date(this._selectedEnd) : null,
          complete: committing
        }
      }));
      if (committing) Aura.overlay.close(this._panel); // returns focus to the trigger
    }

    _page(date) {
      var clamped = clampDate(date, this._min, this._max);
      this._focusDate = clamped;
      this._renderMonth(clamped.getFullYear(), clamped.getMonth(), clamped);
      this._focusDayCell(clamped);
    }

    _onKeyDown(e) {
      var day = e.target.closest(".aura-datepicker__day");
      if (!day) return; // arrows/paging act only from a day cell

      var f = this._focusDate;
      var target = null;
      switch (e.key) {
        case "ArrowLeft":  target = addDays(f, -1); break;
        case "ArrowRight": target = addDays(f, 1); break;
        case "ArrowUp":    target = addDays(f, -DAYS_PER_WEEK); break;
        case "ArrowDown":  target = addDays(f, DAYS_PER_WEEK); break;
        case "Home":       target = this._startOfWeek(f); break;
        case "End":        target = addDays(this._startOfWeek(f), DAYS_PER_WEEK - 1); break;
        case "PageUp":     target = e.shiftKey ? addYears(f, -1) : addMonths(f, -1); break;
        case "PageDown":   target = e.shiftKey ? addYears(f, 1) : addMonths(f, 1); break;
        case "Enter":
        case " ":
          e.preventDefault();
          this._select(f);
          return;
        default:
          return; // Escape/Tab handled by Aura.overlay; let other keys pass
      }
      e.preventDefault();
      this._moveFocus(target);
    }

    _startOfWeek(date) {
      var offset = (date.getDay() - this._firstDow + DAYS_PER_WEEK) % DAYS_PER_WEEK;
      return addDays(date, -offset);
    }

    _moveFocus(date) {
      var clamped = clampDate(date, this._min, this._max);
      this._focusDate = clamped;
      if (clamped.getFullYear() !== this._viewYear || clamped.getMonth() !== this._viewMonth) {
        this._renderMonth(clamped.getFullYear(), clamped.getMonth(), clamped);
      }
      this._focusDayCell(clamped);
    }

    /* Move the roving tabindex to the cell for `date` and focus it. */
    _focusDayCell(date) {
      var iso = toISO(date);
      var buttons = this._tbody.querySelectorAll(".aura-datepicker__day");
      var target = null;
      for (var i = 0; i < buttons.length; i++) {
        var match = buttons[i].getAttribute("data-date") === iso;
        buttons[i].tabIndex = match ? 0 : -1;
        if (match) target = buttons[i];
      }
      if (target) target.focus({ preventScroll: true });
    }
  };

  /* Form-association layer (#538): submission via the hidden input(s); the
     host owns native reset (restore the authored value) + fieldset-disable. */
  Aura.FormAssociated && Aura.FormAssociated.install(AuraDatepicker, {
    value: function () { return null; }, // submitted via the host-named hidden input(s)
    reset: function () {
      if (this.__formDefaultValue == null) this.removeAttribute("value");
      else this.setAttribute("value", this.__formDefaultValue);
    }
  });

  Aura.define("aura-datepicker", AuraDatepicker);
})();