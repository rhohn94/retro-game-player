#!/usr/bin/env python3
"""Aura token code-generator for downstream consumers.

Reads the resolved-values snapshot (`tokens.resolved.json`, the golden output of
the build) and emits platform-specific token files so a consumer never has to
parse the layered token source by hand:

    python3 tools/aura_tokens.py --format css    > aura-tokens.css
    python3 tools/aura_tokens.py --format js     > aura-tokens.js
    python3 tools/aura_tokens.py --format ts     > aura-tokens.ts
    python3 tools/aura_tokens.py --format dts    > aura-tokens.d.ts
    python3 tools/aura_tokens.py --format json          > aura-tokens.json
    python3 tools/aura_tokens.py --format json-extended > aura-tokens-meta.json
    python3 tools/aura_tokens.py --format swift          > AuraTokens.swift
    python3 tools/aura_tokens.py --format kotlin > AuraTokens.kt
    python3 tools/aura_tokens.py --format rust   > aura_tokens.rs

Each token's *concrete* value is emitted: the browser-resolved `computed` value
for colors (the golden value a reimplementation must match) and the `raw` value
otherwise. The CSS emitter produces flat custom properties with no var() chains,
so the file stands alone.

Dependency-free (Python stdlib only). See docs/design/consumer-tooling-design.md.
"""
import argparse
import json
import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SNAPSHOT = ROOT / "tokens.resolved.json"

#: CSS root font-size assumed when converting rem -> device-independent points.
#: egui works in logical points that map 1:1 to CSS px at the default
#: pixels_per_point, and 1rem == 16px in Aura (the browser default, never
#: overridden). So 1rem -> 16.0 points, 1px -> 1.0 point. See
#: docs/design/egui-translation.md §Units.
REM_TO_POINTS = 16.0


def load_tokens(snapshot_path):
    """Load the resolved snapshot and return an ordered list of (name, value)
    pairs using the concrete value (computed for colors, raw otherwise)."""
    data = json.loads(Path(snapshot_path).read_text())
    if "tokens" not in data:
        raise ValueError("snapshot has no 'tokens' object: %s" % snapshot_path)
    pairs = []
    for name, spec in data["tokens"].items():
        value = spec.get("computed") if spec.get("kind") == "color" else None
        if value is None:
            value = spec.get("raw", "")
        pairs.append((name, value))
    return pairs


def to_camel(name):
    """`surface-stroke-strong` -> `surfaceStrokeStrong`."""
    head, *tail = name.split("-")
    return head + "".join(p[:1].upper() + p[1:] for p in tail)


def to_upper_snake(name):
    """`surface-stroke-strong` -> `SURFACE_STROKE_STRONG`."""
    return re.sub(r"[^0-9A-Za-z]+", "_", name).upper()


# ---------------------------------------------------------------------------
# Retained-mode (egui) classification.
#
# A token's resolved value carries enough information to bucket it into a
# toolkit-agnostic semantic category; the egui emitter then renders each
# category as the corresponding egui type. Categories that have no faithful
# retained-mode equivalent (multi-layer shadows, backdrop blur/glass, the
# cursor-reactive glow, env()/clamp() layout maths) are reported as `css-expr`
# so the emitter can list them as approximate-per-doc rather than inventing a
# wrong literal. See docs/design/egui-translation.md.
# ---------------------------------------------------------------------------

_LEN_RE = re.compile(r"^(-?\d*\.?\d+)(rem|px)$")
_DUR_RE = re.compile(r"^(\d*\.?\d+)(ms|s)$")
_RATIO_RE = re.compile(r"^(\d*\.?\d+)\s*/\s*(\d*\.?\d+)$")
_NUM_RE = re.compile(r"^-?\d*\.?\d+$")
_INT_RE = re.compile(r"^\d+$")
_OKLCH_RE = re.compile(
    r"^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)\s*(?:/\s*([\d.]+%?)\s*)?\)$", re.I)
# Bare HSL triplet: `H S% L%` or `H S% L% / A` — no `hsl()` wrapper.
# Used by --aura-shadow-color so it can compose into hsl(var(--aura-shadow-color) / alpha).
_HSL_BARE_RE = re.compile(
    r"^(\d*\.?\d+)\s+(\d*\.?\d+)%\s+(\d*\.?\d+)%\s*(?:/\s*([\d.]+%?)\s*)?$"
)


def _srgb_gamma(c):
    """Linear-sRGB channel -> gamma-encoded sRGB (CSS Color 4 transfer)."""
    c = max(0.0, min(1.0, c))
    return 12.92 * c if c <= 0.0031308 else 1.055 * (c ** (1 / 2.4)) - 0.055


def hsl_bare_to_rgb255(text):
    """Convert a bare `H S% L%` HSL triplet (no `hsl()` wrapper) to (r,g,b 0-255, a 0-1).

    Aura's `--aura-shadow-color` is authored as a bare component string so it can
    be composed into `hsl(var(--aura-shadow-color) / alpha)`. The browser leaves it
    unresolved (no `computed` field in the snapshot). This parser extracts the sRGB
    value so the egui emitter can emit a typed Color32 instead of a comment.
    Returns None if the text is not a bare HSL triplet."""
    m = _HSL_BARE_RE.match(text.strip())
    if not m:
        return None
    H = float(m.group(1)) % 360
    S = float(m.group(2)) / 100.0
    L = float(m.group(3)) / 100.0
    a_str = m.group(4)
    alpha = (float(a_str[:-1]) / 100 if a_str and a_str.endswith("%")
             else float(a_str) if a_str else 1.0)
    C = (1.0 - abs(2 * L - 1.0)) * S
    X = C * (1.0 - abs((H / 60.0) % 2 - 1.0))
    m_ = L - C / 2.0
    if H < 60:
        r, g, b = C + m_, X + m_, m_
    elif H < 120:
        r, g, b = X + m_, C + m_, m_
    elif H < 180:
        r, g, b = m_, C + m_, X + m_
    elif H < 240:
        r, g, b = m_, X + m_, C + m_
    elif H < 300:
        r, g, b = X + m_, m_, C + m_
    else:
        r, g, b = C + m_, m_, X + m_
    return (int(round(r * 255)), int(round(g * 255)), int(round(b * 255)), alpha)


def oklch_to_rgb255(text):
    """Convert a CSS `oklch(L C H / a)` string to an sRGB (r,g,b 0-255, a 0-1)
    tuple, or None if not an oklch literal.

    Uses Björn Ottosson's OKLab->linear-sRGB matrix, then the sRGB transfer
    function, with a per-channel clamp into gamut. Brand-ramp colours are
    in-gamut, so the clamp is a no-op for them; out-of-gamut edge cases land at
    the nearest face (a reasonable approximation of the browser's gamut map).
    The browser canonicalises Aura's `color-mix(in oklch, …)` steps to oklch(),
    which is why this path exists alongside the rgb()/color(srgb)/hex parser."""
    m = _OKLCH_RE.match(text.strip())
    if not m:
        return None
    L = float(m.group(1)[:-1]) / 100 if m.group(1).endswith("%") else float(m.group(1))
    C = float(m.group(2))
    H = math.radians(float(m.group(3)))
    a = m.group(4)
    alpha = (float(a[:-1]) / 100 if a and a.endswith("%")
             else float(a) if a else 1.0)
    oa, ob = C * math.cos(H), C * math.sin(H)
    l_ = (L + 0.3963377774 * oa + 0.2158037573 * ob) ** 3
    m_ = (L - 0.1055613458 * oa - 0.0638541728 * ob) ** 3
    s_ = (L - 0.0894841775 * oa - 1.2914855480 * ob) ** 3
    r = _srgb_gamma(+4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_)
    g = _srgb_gamma(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_)
    b = _srgb_gamma(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_)
    return (int(round(r * 255)), int(round(g * 255)), int(round(b * 255)), alpha)


def parse_color255(value):
    """Resolve any Aura colour string to (r, g, b, a) — rgb()/color(srgb)/hex via
    the shared parser, plus oklch() (the canonical form of the brand ramp), plus
    bare HSL triplets `H S% L%` (used by --aura-shadow-color).

    The aura_conformance import is lazy: that module imports this one at load
    time, so a top-level import here would be circular."""
    import aura_conformance as _cf  # lazy — breaks the import cycle
    c = _cf.Color.parse(value)
    if c is not None:
        return (c.r, c.g, c.b, c.a)
    result = oklch_to_rgb255(value)
    if result is not None:
        return result
    return hsl_bare_to_rgb255(value)


def length_to_points(value):
    """`1rem`/`16px`/`0` -> float points, or None if not a plain length."""
    s = value.strip()
    if s == "0":
        return 0.0
    m = _LEN_RE.match(s)
    if not m:
        return None
    n = float(m.group(1))
    return n * REM_TO_POINTS if m.group(2) == "rem" else n


def duration_to_seconds(value):
    """`200ms`/`1.6s` -> float seconds, or None if not a plain duration."""
    m = _DUR_RE.match(value.strip())
    if not m:
        return None
    n = float(m.group(1))
    return n / 1000.0 if m.group(2) == "ms" else n


def classify_egui(name, value):
    """Bucket a resolved token into a retained-mode category.

    Returns one of: 'color', 'length', 'duration', 'ratio', 'zindex', 'weight',
    'number', 'font-family', 'css-expr'. Name-based buckets (font family, font
    weight, z-index, letter-spacing, and CSS-only effects) are decided first so
    a bare integer like `700` is read as a font weight, not a stacking order;
    then colour (incl. oklch), then unit-bearing scalars, then the bare-number
    fallback; anything left is a CSS-specific expression with no faithful egui
    literal.
    """
    if name in ("font-sans", "font-mono"):
        return "font-family"
    if name.startswith("weight-"):
        return "weight"
    if name.startswith("z-"):
        return "css-expr"  # CSS z-index integers; egui uses egui::layers::Order (enum), not stacking integers
    if name.startswith("tracking-"):
        return "css-expr"  # letter-spacing (em/0) — no egui text-layout knob
    # CSS-only effects: backdrop-filter blur has no egui primitive.
    if name.startswith("blur-") or name.endswith("-blur"):
        return "css-expr"
    # CSS proximity-glow radii and intensity.
    if name.startswith("glow-radius") or name == "glow-intensity":
        return "css-expr"
    # CSS animation offsets, scroll-driven params, and hover transform.
    if name.startswith("magnet-") or name in (
            "scroll-progress", "entrance-rise", "hover-lift"):
        return "css-expr"
    # CSS gradient/filter effect params.
    if name == "glass-tint-strength" or name.endswith("-tint-intensity"):
        return "css-expr"
    # CSS gradient positions and lighting vectors.
    if name in ("edge-rim-spot", "edge-shine-spot", "bevel-base", "light-x", "light-y"):
        return "css-expr"
    # CSS box-shadow construction helpers (not physical layout lengths).
    if name.startswith("dir-shadow-"):
        return "css-expr"
    # CSS scroll-behaviour parameters driven by JavaScript scroll observers —
    # not physical layout dimensions; no egui equivalent.
    if name in ("nav-header-direction-threshold", "nav-header-hover-retain-offset",
                "nav-header-peek", "nav-header-shrink-threshold",
                "nav-header-stash-threshold", "nav-header-hotzone",
                "nav-header-height-current", "footer-reveal-offset"):
        return "css-expr"
    # CSS @media print colours — target paper output, not egui screen rendering.
    if name.startswith("print-"):
        return "css-expr"
    # CSS filter:saturate() params — backdrop-filter saturation, no egui primitive.
    if name.endswith("-saturate"):
        return "css-expr"
    # aura-footer HTML element tokens — web page layout, no egui footer concept.
    if name.startswith("footer-"):
        return "css-expr"
    # Catalog / demo-page grid tokens — web layout only, no egui equivalent.
    if name.startswith("catalog-"):
        return "css-expr"
    # CSS glass overlay tint anchors and glow-at-rest colors (transparent by default).
    if name in ("btn-glow", "frame-face", "frame-highlight", "frame-shadow",
                "glass-tint", "glass-tint-wash"):
        return "css-expr"
    # CSS visual-effect intensity scalars: bevel/depth/shadow multipliers, edge opacity caps.
    if name in ("bevel-strength", "depth", "shadow-boost",
                "edge-rim-max", "edge-shine-max", "edge-shine-strength",
                "nav-header-bloom-strength", "nav-header-glow-strength"):
        return "css-expr"
    # CSS animation-only scalars: entrance/overlay scale-from, FMB expand pixels, ambient pulse.
    if (name in ("entrance-scale-from", "overlay-enter-scale",
                 "entrance-step", "dur-ambient")
            or name.endswith("-fmb-expand-px")):
        return "css-expr"
    # nav-header CSS animation timings: scroll-reveal, bloom, stagger — web JS-driven.
    if name in ("nav-header-bloom-duration", "nav-header-duration",
                "nav-header-menu-duration", "nav-header-menu-duration-fast",
                "nav-header-reveal-duration", "nav-header-stagger-step",
                "nav-header-stagger-step-fine"):
        return "css-expr"
    # CSS edge-effect system: rim/shine gradients and glow — no egui border primitive.
    if name.startswith("edge-"):
        return "css-expr"
    # CSS nav-header decorative rail gradient hue stops — not brand colours.
    if name.startswith("nav-header-rail-"):
        return "css-expr"
    # CSS <video> element overlay tokens — web media player only.
    if name.startswith("video-"):
        return "css-expr"
    # CSS component micro-tokens with no egui equivalent.
    if name in ("btn-tint", "cp-thumb-ring", "cp-thumb-ring-width",
                "glow-color", "bevel-light", "bevel-shadow",
                "frame-border-width", "sidebar-fmb-size"):
        return "css-expr"
    # CSS glass opaque-fallback aliases — identical to SURFACE_SOLID in every theme;
    # exist only because backdrop-filter blur needs a CSS color-mix fallback.
    # lightbox-scrim-solid is the same pattern: opaque fallback for the modal scrim.
    # In egui use LIGHTBOX_SCRIM (translucent) directly — no backdrop-filter needed.
    if name.endswith("-surface-solid") or name == "lightbox-scrim-solid":
        return "css-expr"
    # CSS component text-colour aliases that duplicate TEXT (named for their CSS context).
    # CSS outline-offset param — egui renders its own focus indicator.
    if name in ("text-on-glass", "tooltip-fg", "focus-ring-offset"):
        return "css-expr"
    # [v3.455] CSS scroll-behavior/grid-layout tokens with no egui equivalent.
    # nav-header-height-shrunk: height when CSS scroll shrinks the header (= CONTROL_HEIGHT_LG).
    # menu-icon-col: CSS grid-template-columns icon slot; egui allocates icon space per-item.
    if name in ("nav-header-height-shrunk", "menu-icon-col"):
        return "css-expr"
    if parse_color255(value) is not None:
        return "color"
    if duration_to_seconds(value) is not None:
        return "duration"
    if length_to_points(value) is not None:
        return "length"
    if _RATIO_RE.match(value.strip()):
        return "ratio"
    if _NUM_RE.match(value.strip()):
        return "number"
    return "css-expr"


# ---------------------------------------------------------------------------
# Category grouping for JS / TS / DTS output.
#
# Semantic grouping makes the generated files scannable and improves IDE
# autocomplete experience (consumers can jump to a section rather than
# scrolling through 350+ alphabetical entries).
#
# Order here is the output order. Each entry: (label, frozenset-of-kebab-names).
# The last entry's frozenset is None — it is the catch-all for component-specific
# internal tokens (btn-*, nav-*, footer-*, sidebar-*, etc.).
# ---------------------------------------------------------------------------

_CATEGORY_GROUPS = [
    ("Brand palette", frozenset([
        "accent", "on-primary",
        "primary", "primary-50", "primary-100", "primary-200", "primary-300",
        "primary-400", "primary-500", "primary-600", "primary-700", "primary-800",
        "primary-900", "primary-a10", "primary-a15", "primary-a25", "primary-a40",
        "primary-a60",
        "secondary", "secondary-50", "secondary-100", "secondary-200", "secondary-300",
        "secondary-400", "secondary-500", "secondary-600", "secondary-700", "secondary-800",
        "secondary-900", "secondary-a10", "secondary-a15", "secondary-a25",
        "secondary-a40", "secondary-a60",
    ])),
    ("Status colors", frozenset([
        "danger", "danger-a15", "danger-a25",
        "success", "success-a15",
        "warning", "warning-a15",
        "info", "info-a15",
    ])),
    ("Background & surface", frozenset([
        "bg", "bg-2",
        "surface-1", "surface-2", "surface-3", "surface-4", "surface-5",
        "surface-solid", "surface-stroke", "surface-stroke-strong", "surface-pattern",
    ])),
    ("Text colors", frozenset([
        "text", "text-muted", "text-subtle", "text-on-glass",
    ])),
    ("Typography", frozenset([
        "font-sans", "font-mono",
        "text-xs", "text-sm", "text-md", "text-lg", "text-xl", "text-2xl", "text-3xl",
        "weight-regular", "weight-medium", "weight-semibold", "weight-bold",
        "leading-normal", "leading-relaxed", "leading-tight",
        "tracking-normal", "tracking-tight", "tracking-wide",
    ])),
    ("Spacing", frozenset([
        "space-0", "space-1", "space-2", "space-3", "space-4",
        "space-5", "space-6", "space-7", "space-8", "space-9",
    ])),
    ("Layout & sizing", frozenset([
        "size-2xl", "size-2xs", "size-lg", "size-md", "size-sm", "size-xl", "size-xs",
        "region-max", "region-min", "region-pref",
        "measure", "measure-lead",
        "bp-medium", "bp-mobile", "bp-narrow", "bp-wide",
        "control-height-lg", "control-height-md", "control-height-sm",
        "tap-min", "input-height", "intrinsic-size",
    ])),
    ("Radius", frozenset([
        "radius-xs", "radius-sm", "radius-md", "radius-lg",
        "radius-xl", "radius-2xl", "radius-full",
    ])),
    ("Shadow & elevation", frozenset([
        "shadow-1", "shadow-2", "shadow-3", "shadow-4", "shadow-5", "shadow-6",
        "shadow-boost", "shadow-color", "shadow-strength",
        "depth",
        "dir-shadow-alpha", "dir-shadow-blur-step", "dir-shadow-offset-step",
    ])),
    ("Motion", frozenset([
        "dur-ambient", "dur-base", "dur-fast", "dur-slow",
        "ease-accelerate", "ease-out", "ease-spring", "ease-standard",
        "entrance-dur", "entrance-rise", "entrance-scale-from", "entrance-step",
    ])),
    ("Z-index", frozenset([
        "z-base", "z-menu", "z-modal", "z-overlay",
        "z-raised", "z-sticky", "z-toast", "z-tooltip",
    ])),
    ("Focus & interaction", frozenset([
        "focus-ring", "focus-ring-offset",
        "ring", "ring-offset",
        "hover-lift", "disabled-opacity", "divider",
        "border-style", "border-width",
        "overlay-enter-scale", "scroll-progress",
    ])),
    ("Aspect ratios", frozenset([
        "ratio-classic", "ratio-golden", "ratio-photo", "ratio-portrait",
        "ratio-square", "ratio-ultrawide", "ratio-video",
    ])),
    ("Glass & blur", frozenset([
        "glass-saturate", "glass-tint", "glass-tint-layer",
        "glass-tint-strength", "glass-tint-wash",
        "blur-1", "blur-2", "blur-3", "blur-4", "blur-5", "blur-6",
    ])),
    ("Glow & edge effects", frozenset([
        "glow-color", "glow-intensity", "glow-radius",
        "glow-radius-comfortable", "glow-radius-compact", "glow-radius-cozy",
        "glow-x", "glow-y",
        "edge-color", "edge-light",
        "edge-rim-color", "edge-rim-max", "edge-rim-spot", "edge-rim-width",
        "edge-shine-flood", "edge-shine-max", "edge-shine-spot",
        "edge-shine-strength", "edge-shine-width", "edge-shine-width-compact",
        "bevel-base", "bevel-light", "bevel-shadow", "bevel-size", "bevel-strength",
        "light-x", "light-y",
    ])),
    ("Print & safe area", frozenset([
        "print-body-ink", "print-hairline", "print-ink", "print-paper",
        "safe-bottom", "safe-left", "safe-right", "safe-top",
    ])),
    # Catch-all: component-specific internal tokens (btn-*, nav-*, footer-*, etc.)
    ("Component-specific tokens", None),
]

# Reverse lookup: kebab token name -> category index (for fast assignment).
_CAT_LOOKUP = {}
_CAT_CATCHALL = len(_CATEGORY_GROUPS) - 1
for _i, (_lbl, _names) in enumerate(_CATEGORY_GROUPS):
    if _names is not None:
        for _n in _names:
            _CAT_LOOKUP[_n] = _i


def _grouped_pairs(pairs):
    """Sort pairs into category order and return an annotated list.

    Returns a list of tuples; each tuple is either:
      ('sep', label)               — a category separator comment
      ('tok', name, value)         — a token line
    """
    tagged = [((_CAT_LOOKUP.get(n, _CAT_CATCHALL)), n, v) for n, v in pairs]
    tagged.sort(key=lambda t: (t[0], t[1]))
    result = []
    current = -1
    for cat_idx, name, value in tagged:
        if cat_idx != current:
            current = cat_idx
            result.append(("sep", _CATEGORY_GROUPS[cat_idx][0]))
        result.append(("tok", name, value))
    return result


def _cat_sep(label, prefix="  // "):
    """Format a category separator comment line."""
    dashes = "─" * max(0, 64 - len(label) - len(prefix))
    return "%s── %s %s" % (prefix, label, dashes)


class Emitter:
    """Base class for a token-file emitter.

    A line-oriented emitter overrides `header`/`line`/`footer`; the default
    `render` stitches them around the token list. An emitter whose output is
    not line-oriented (e.g. JSON) overrides `render` wholesale and never
    touches `line`. New formats subclass this and register in FORMATS — no
    change to the CLI plumbing."""

    #: human label used in the generated banner
    label = "tokens"

    def header(self):
        return ""

    def footer(self):
        return ""

    def line(self, name, value):
        raise NotImplementedError

    def render(self, pairs):
        out = []
        head = self.header()
        if head:
            out.append(head)
        for name, value in pairs:
            out.append(self.line(name, value))
        foot = self.footer()
        if foot:
            out.append(foot)
        return "\n".join(out) + "\n"


def _cat_sep_css(label):
    """Format a CSS block-comment category separator inside :root {}."""
    dashes = "─" * max(0, 62 - len(label))
    return "  /* ── %s %s */" % (label, dashes)


class CssEmitter(Emitter):
    """Flat CSS custom properties on :root — resolved, no var() chains.

    Tokens are grouped by semantic category with block-comment separators."""

    label = "CSS custom properties"

    def header(self):
        return "/* Aura tokens — generated by tools/aura_tokens.py. Do not edit. */\n:root {"

    def footer(self):
        return "}"

    def line(self, name, value):
        return "  --aura-%s: %s;" % (name, value)

    def render(self, pairs):
        grouped = _grouped_pairs(pairs)
        out = [self.header()]
        for item in grouped:
            if item[0] == "sep":
                out.append(_cat_sep_css(item[1]))
            else:
                out.append(self.line(item[1], item[2]))
        out.append(self.footer())
        return "\n".join(out) + "\n"


class JsEmitter(Emitter):
    """ES module exporting a frozen object of camelCase token names.

    Also emits `auraTokenVars` — a companion frozen object whose values are
    `var(--aura-<kebab-name>)` references so consumers can wire resolved
    tokens into inline styles without hard-coding the CSS custom property
    names, and so the values stay live when a named theme is applied."""

    label = "JS constants (ESM)"

    def header(self):
        return "// Aura tokens — generated by tools/aura_tokens.py. Do not edit.\nexport const auraTokens = Object.freeze({"

    def footer(self):
        return "});"

    def line(self, name, value):
        return '  %s: %s,' % (json.dumps(to_camel(name)), json.dumps(value))

    def render(self, pairs):
        # Both auraTokens and auraTokenVars use the same category ordering.
        grouped = _grouped_pairs(pairs)
        out = [self.header()]
        for item in grouped:
            if item[0] == "sep":
                out.append(_cat_sep(item[1]))
            else:
                out.append(self.line(item[1], item[2]))
        out.append(self.footer())
        # auraTokenVars companion block — same category structure.
        out.append("\nexport const auraTokenVars = Object.freeze({")
        for item in grouped:
            if item[0] == "sep":
                out.append(_cat_sep(item[1]))
            else:
                name = item[1]
                out.append('  %s: "var(--aura-%s)",' % (json.dumps(to_camel(name)), name))
        out.append("});\n")
        return "\n".join(out) + "\n"


class TsEmitter(JsEmitter):
    """TypeScript: same object plus `as const`, key/value union types, and a typed helper."""

    label = "TypeScript constants"

    def header(self):
        return "// Aura tokens — generated by tools/aura_tokens.py. Do not edit.\nexport const auraTokens = {"

    def footer(self):
        return (
            "} as const;\n"
            "\n"
            "/** Union of every Aura token name (camelCase). */\n"
            "export type AuraTokenName = keyof typeof auraTokens;\n"
            "\n"
            "/** Union of every concrete Aura token value string. */\n"
            "export type AuraTokenValue = (typeof auraTokens)[AuraTokenName];\n"
            "\n"
            "/**\n"
            " * Type-safe token lookup with autocomplete.\n"
            " *\n"
            " * @example\n"
            " * ```ts\n"
            " * const color = getAuraToken('primary'); // string\n"
            " * ```\n"
            " */\n"
            "export function getAuraToken<K extends AuraTokenName>(name: K): (typeof auraTokens)[K] {\n"
            "  return auraTokens[name];\n"
            "}\n"
        )


class DtsEmitter(Emitter):
    """TypeScript declaration file (.d.ts) for the JsEmitter's ESM output.

    Declaration-only: literal key/value types for `auraTokens` plus the name /
    value union types, with no implementation code (a .d.ts may not contain
    function bodies, so this is NOT the TsEmitter's output). Pairs with
    dist/aura-tokens.js so TypeScript consumers get autocomplete on the
    build-emitted token module (#415)."""

    label = "TypeScript declarations (.d.ts)"

    def header(self):
        return ("// Aura tokens — generated by tools/aura_tokens.py. Do not edit.\n"
                "export declare const auraTokens: Readonly<{")

    def footer(self):
        return (
            "}>;\n"
            "\n"
            "/** Union of every Aura token name (camelCase). */\n"
            "export type AuraTokenName = keyof typeof auraTokens;\n"
            "\n"
            "/** Union of every concrete Aura token value string. */\n"
            "export type AuraTokenValue = (typeof auraTokens)[AuraTokenName];\n"
            "\n"
            "/**\n"
            " * Companion to `auraTokens`: same keys, values are `var(--aura-*)` references.\n"
            " * Use these in inline styles so the value stays live when a named theme is active.\n"
            " *\n"
            " * @example\n"
            " * ```tsx\n"
            " * import { auraTokenVars } from \"@aura-design/core/tokens\";\n"
            " *\n"
            " * // value stays current when the user switches to \"warm-dusk\" or any named theme:\n"
            " * <div style={{ background: auraTokenVars.bg2, color: auraTokenVars.text }} />\n"
            " * ```\n"
            " */\n"
            "export declare const auraTokenVars: Readonly<Record<AuraTokenName, string>>;"
        )

    def line(self, name, value):
        return "  %s: %s;" % (json.dumps(to_camel(name)), json.dumps(value))

    def render(self, pairs):
        grouped = _grouped_pairs(pairs)
        out = [self.header()]
        for item in grouped:
            if item[0] == "sep":
                out.append(_cat_sep(item[1]))
            else:
                out.append(self.line(item[1], item[2]))
        out.append(self.footer())
        return "\n".join(out) + "\n"


class JsonEmitter(Emitter):
    """Flat JSON map of token-name -> concrete value."""

    label = "flat JSON"

    def render(self, pairs):
        return json.dumps({name: value for name, value in pairs}, indent=2) + "\n"


class SwiftEmitter(Emitter):
    """Swift enum of string constants (camelCase), grouped by semantic category.

    Category separators use the // MARK: - convention recognised by Xcode's
    minimap and jump bar, making it easy to jump to e.g. "Brand palette"."""

    label = "Swift constants"

    def header(self):
        return "// Aura tokens — generated by tools/aura_tokens.py. Do not edit.\npublic enum AuraTokens {"

    def footer(self):
        return "}"

    def line(self, name, value):
        return '    public static let %s = %s' % (to_camel(name), json.dumps(value))

    def render(self, pairs):
        grouped = _grouped_pairs(pairs)
        out = [self.header()]
        for item in grouped:
            if item[0] == "sep":
                out.append("\n    // MARK: - %s" % item[1])
            else:
                out.append(self.line(item[1], item[2]))
        out.append(self.footer())
        return "\n".join(out) + "\n"


class KotlinEmitter(Emitter):
    """Kotlin object of string constants (UPPER_SNAKE), grouped by semantic category."""

    label = "Kotlin constants"

    def header(self):
        return "// Aura tokens — generated by tools/aura_tokens.py. Do not edit.\nobject AuraTokens {"

    def footer(self):
        return "}"

    def line(self, name, value):
        return '    const val %s = %s' % (to_upper_snake(name), json.dumps(value))

    def render(self, pairs):
        grouped = _grouped_pairs(pairs)
        out = [self.header()]
        for item in grouped:
            if item[0] == "sep":
                out.append(_cat_sep(item[1], prefix="    // "))
            else:
                out.append(self.line(item[1], item[2]))
        out.append(self.footer())
        return "\n".join(out) + "\n"


# ---------------------------------------------------------------------------
# Semantic sub-group definitions for the Rust emitter's colour and length
# sections.  Each entry maps a _CATEGORY_GROUPS label to the sub-section
# header shown in the generated output.  Tokens whose category is not listed
# fall into the catch-all sub-section (the last entry in each list).
# ---------------------------------------------------------------------------

_EGUI_COLOR_SUBS = [
    ("Brand palette",        "Brand palette"),
    ("Status colors",        "Status colours"),
    ("Background & surface", "Backgrounds & surfaces"),
    ("Text colors",          "Text"),
    # catch-all → "Component-specific"
]
_EGUI_COLOR_SUB_MAP = {cat: sub for cat, sub in _EGUI_COLOR_SUBS}

_EGUI_LENGTH_SUBS = [
    ("Spacing",         "Spacing scale"),
    ("Radius",          "Border radii — use CornerRadius::same(R)  [Rounding::same(R) pre-0.28]"),
    ("Typography",      "Typography sizes — use FontId::new(SIZE, FontFamily::Proportional)"),
    ("Layout & sizing", "Layout constraints"),
    # catch-all → "Component geometry"
]
_EGUI_LENGTH_SUB_MAP = {cat: sub for cat, sub in _EGUI_LENGTH_SUBS}


def _egui_sub(name, sub_map, default):
    """Return the Rust-emitter sub-section label for a token."""
    idx = _CAT_LOOKUP.get(name, _CAT_CATCHALL)
    return sub_map.get(_CATEGORY_GROUPS[idx][0], default)


class EguiRustEmitter(Emitter):
    """Typed Rust constants for the egui immediate-mode toolkit.

    Unlike the string-passthrough emitters, this one classifies each resolved
    token and renders it as the matching egui type: colours as `Color32`,
    lengths as `f32` points, durations as `f32` seconds, ratios/scalars as
    `f32`. CSS-specific tokens (multi-layer shadows, glass / backdrop blur,
    proximity glow, z-index stacking order, env()/clamp() layout maths) cannot
    be a single faithful literal, so they are listed in a trailing doc block
    that points at docs/design/egui-translation.md for the approximation recipe.

    Z-index tokens (`z-*`) are css-expr: egui uses `egui::layers::Order`
    (Background/Main/Foreground/Tooltip), not integer CSS z-index values.

    The output is a dependency-light module: only `egui::Color32` is referenced,
    behind a path so the file compiles whether or not the caller re-exports it.
    """

    label = "Rust constants for egui"

    def render(self, pairs):
        buckets = {k: [] for k in
                   ("color", "length", "duration", "ratio", "weight",
                    "number", "font-family", "css-expr")}
        for name, value in pairs:
            buckets[classify_egui(name, value)].append((name, value))

        out = [
            "// Aura tokens for egui — generated by tools/aura_tokens.py "
            "(--format rust). Do not edit.",
            "//",
            "// Values are the default (dark) theme's resolved tokens. Lengths are in",
            "// egui points (1rem = %g px = %g points); durations in seconds. See"
            % (REM_TO_POINTS, REM_TO_POINTS),
            "// docs/design/egui-translation.md for the full mapping and the",
            "// approximation recipes for the CSS-only tokens listed at the end.",
            "",
            "use egui::Color32;",
            "",
            "pub mod aura {",
            "    use super::Color32;",
        ]

        def section(title, rows):
            if not rows:
                return
            out.append("")
            out.append("    // ---- %s ----" % title)
            out.extend(rows)

        # Colours -> Color32::from_rgba_unmultiplied(r, g, b, a)
        # Sub-grouped by semantic category so consumers can scan by purpose.
        _color_subs = [sub for _, sub in _EGUI_COLOR_SUBS] + ["Component-specific"]
        _color_tagged = []
        for name, value in buckets["color"]:
            r, g, b, alpha = parse_color255(value)
            a = int(round(alpha * 255))
            line = ("    pub const %s: Color32 = "
                    "Color32::from_rgba_unmultiplied(%d, %d, %d, %d); // %s"
                    % (to_upper_snake(name), r, g, b, a, value))
            sub = _egui_sub(name, _EGUI_COLOR_SUB_MAP, "Component-specific")
            _color_tagged.append((_color_subs.index(sub), name, sub, line))
        _color_tagged.sort(key=lambda e: (e[0], e[1]))
        if _color_tagged:
            out.append("")
            out.append("    // ---- Colours (sRGB) ----")
            prev_sub = None
            for _ci, _cn, sub, line in _color_tagged:
                if sub != prev_sub:
                    if prev_sub is not None:
                        out.append("")
                    out.append("    //   %s" % sub)
                    prev_sub = sub
                out.append(line)

        # Lengths -> f32 points, sub-grouped by semantic category.
        _len_subs = [sub for _, sub in _EGUI_LENGTH_SUBS] + ["Component geometry"]
        _len_tagged = []
        for name, value in buckets["length"]:
            line = ("    pub const %s: f32 = %s; // %s"
                    % (to_upper_snake(name), _f32(length_to_points(value)), value))
            sub = _egui_sub(name, _EGUI_LENGTH_SUB_MAP, "Component geometry")
            _len_tagged.append((_len_subs.index(sub), name, sub, line))
        _len_tagged.sort(key=lambda e: (e[0], e[1]))
        if _len_tagged:
            out.append("")
            out.append("    // ---- Lengths (points) ----")
            prev_sub = None
            for _li, _ln, sub, line in _len_tagged:
                if sub != prev_sub:
                    if prev_sub is not None:
                        out.append("")
                    out.append("    //   %s" % sub)
                    prev_sub = sub
                out.append(line)

        # Durations -> f32 seconds
        dur_rows = []
        for name, value in buckets["duration"]:
            dur_rows.append("    pub const %s: f32 = %s; // %s"
                            % (to_upper_snake(name),
                               _f32(duration_to_seconds(value)), value))
        section("Durations (seconds)", dur_rows)

        # Aspect ratios -> f32 (width / height)
        ratio_rows = []
        for name, value in buckets["ratio"]:
            m = _RATIO_RE.match(value.strip())
            w, h = float(m.group(1)), float(m.group(2))
            ratio_rows.append("    pub const %s: f32 = %s; // %s"
                              % (to_upper_snake(name), _f32(w / h), value))
        section("Aspect ratios (w / h)", ratio_rows)

        # Scalars -> f32, sub-grouped by semantic role so leading hints are clear.
        def _scalar_sub(name):
            if "opacity" in name:
                return (0, "Opacity")
            if name.startswith("leading-"):
                return (1, "Line height — multiply by font size for TextFormat::line_height")
            return (2, "Stroke width")
        num_tagged = []
        for name, value in buckets["number"]:
            g_idx, g_label = _scalar_sub(name)
            line = ("    pub const %s: f32 = %s; // %s"
                    % (to_upper_snake(name), _f32(float(value)), value))
            num_tagged.append((g_idx, name, g_label, line))
        num_tagged.sort(key=lambda e: (e[0], e[1]))
        if num_tagged:
            out.append("")
            out.append("    // ---- Scalars ----")
            prev_g = None
            for _gi, _gn, g_label, line in num_tagged:
                if g_label != prev_g:
                    if prev_g is not None:
                        out.append("")
                    out.append("    //   %s" % g_label)
                    prev_g = g_label
                out.append(line)

        # Font weights -> note (egui selects a FontFamily/font file, not a
        # numeric weight; bundle a bold face and switch family to go bold).
        if buckets["weight"]:
            out.append("")
            out.append("    // ---- Font weights ----")
            for name, value in buckets["weight"]:
                out.append("    // %s = %s (egui: register a font file for this "
                           "weight; there is no numeric weight on FontId)"
                           % (to_upper_snake(name), value))

        # Font families -> note (egui picks a FontFamily, not a CSS stack)
        if buckets["font-family"]:
            out.append("")
            out.append("    // ---- Font families ----")
            for name, value in buckets["font-family"]:
                fam = ("FontFamily::Monospace" if name == "font-mono"
                       else "FontFamily::Proportional")
                out.append("    // %s -> egui::FontFamily::%s (first available of: %s)"
                           % (to_upper_snake(name), fam.split("::")[1], value))

        out.append("}")

        # CSS-specific tokens: no faithful single literal — list sub-grouped
        # by semantic category so consumers can find the doc recipe quickly.
        if buckets["css-expr"]:
            out.append("")
            out.append("// ---- CSS-specific tokens (approximate per "
                       "docs/design/egui-translation.md) ----")
            out.append("// These have no faithful single egui literal. "
                       "Reimplement from the doc recipes.")
            out.append("// Shadow recipe: collapse the two CSS layers to the dominant one —")
            out.append("//   epaint::Shadow { offset: [0, 12].into(), blur: 28, spread: 0,")
            out.append("//                    color: aura::SHADOW_COLOR.linear_multiply(0.40) }")
            out.append("//   (0.40 is shadow-3's ambient alpha; see egui-translation.md §6)")
            css_tagged = [(_CAT_LOOKUP.get(n, _CAT_CATCHALL), n, v)
                          for n, v in buckets["css-expr"]]
            css_tagged.sort(key=lambda e: (e[0], e[1]))
            prev_cat = None
            for cat_idx, name, value in css_tagged:
                if cat_idx != prev_cat:
                    out.append("//   -- %s --"
                               % _CATEGORY_GROUPS[cat_idx][0])
                    prev_cat = cat_idx
                out.append("//   %-26s = %s" % (name, value))

        # Starter recipe: seed egui::Visuals with Aura colours.
        # Consumers copy this function into their crate and call:
        #   ctx.set_visuals(aura_visuals());
        out.extend([
            "",
            "// ---- Quick-start: wire Aura colours into egui::Visuals ----",
            "// Copy into your crate, then call `ctx.set_visuals(aura_visuals())`.",
            "//",
            "// fn aura_visuals() -> egui::Visuals {",
            "//     use aura::*;",
            "//     let mut v = egui::Visuals::dark();",
            "//     v.override_text_color            = Some(TEXT);",
            "//     v.window_fill                    = SURFACE_SOLID;",
            "//     v.panel_fill                     = BG;",
            "//     v.widgets.noninteractive.bg_fill = SURFACE_1;",
            "//     v.widgets.inactive.bg_fill       = SURFACE_2;",
            "//     v.widgets.hovered.bg_fill        = SURFACE_3;",
            "//     v.widgets.active.bg_fill         = SURFACE_4;",
            "//     v.widgets.inactive.bg_stroke     ="
            " egui::Stroke::new(BORDER_WIDTH, SURFACE_STROKE);",
            "//     v.selection.bg_fill              = PRIMARY_A25;",
            "//     v.selection.stroke               ="
            " egui::Stroke::new(BORDER_WIDTH, PRIMARY_300);",
            "//     v.hyperlink_color                = PRIMARY_300;",
            "//     v.error_fg_color                 = DANGER;",
            "//     v.warn_fg_color                  = WARNING;",
            "//     v",
            "// }",
        ])

        return "\n".join(out) + "\n"


def _f32(x):
    """Render a float as a compact Rust f32 literal (always has a decimal)."""
    s = ("%.4f" % x).rstrip("0")
    return s + "0" if s.endswith(".") else s


class JsonExtendedEmitter(Emitter):
    """Enriched JSON — each token is an object with value, kind, category, cssVar.

    Useful for design tool integrations (Figma plugins, Style Dictionary, etc.)
    that need semantic metadata alongside the resolved values.

    Output is sorted by (category, token name) within each category group.

    Example entry::

        "primary": {
          "value": "rgb(118, 84, 245)",
          "kind": "color",
          "category": "Brand palette",
          "cssVar": "--aura-primary"
        }
    """

    label = "extended JSON with metadata"

    def render(self, pairs):
        # Load the raw snapshot so we can access the `kind` field per token.
        raw = json.loads(Path(getattr(self, "_snapshot_path", str(DEFAULT_SNAPSHOT))).read_text())
        kinds = {n: spec.get("kind", "value")
                 for n, spec in raw.get("tokens", {}).items()}
        catch_all_label = _CATEGORY_GROUPS[_CAT_CATCHALL][0]
        cat_labels = {n: lbl
                      for lbl, names in ((g[0], g[1]) for g in _CATEGORY_GROUPS if g[1])
                      for n in names}
        result = {}
        # Sort by (category_index, name) — same order as _grouped_pairs.
        for cat_idx, name, value in sorted(
            [(_CAT_LOOKUP.get(n, _CAT_CATCHALL), n, v) for n, v in pairs],
            key=lambda t: (t[0], t[1]),
        ):
            result[name] = {
                "value": value,
                "kind": kinds.get(name, "value"),
                "category": cat_labels.get(name, catch_all_label),
                "cssVar": "--aura-%s" % name,
            }
        return json.dumps(result, indent=2) + "\n"


FORMATS = {
    "css": CssEmitter,
    "js": JsEmitter,
    "ts": TsEmitter,
    "dts": DtsEmitter,
    "json": JsonEmitter,
    "json-extended": JsonExtendedEmitter,
    "swift": SwiftEmitter,
    "kotlin": KotlinEmitter,
    "rust": EguiRustEmitter,
}


def generate(fmt, snapshot_path=DEFAULT_SNAPSHOT):
    """Return the generated source string for `fmt`."""
    if fmt not in FORMATS:
        raise ValueError("unknown format %r (choices: %s)" % (fmt, ", ".join(sorted(FORMATS))))
    pairs = load_tokens(snapshot_path)
    emitter = FORMATS[fmt]()
    # Thread the snapshot path through for emitters that need raw metadata.
    emitter._snapshot_path = str(snapshot_path)
    return emitter.render(pairs)


_FORMAT_HELP = """\

Formats:
  css           :root CSS custom properties, grouped by category (/* ── … */)
  js            ESM auraTokens (resolved values) + auraTokenVars (var() refs)
  ts            Same as js, as const + AuraTokenName union type
  dts           TypeScript .d.ts declaration — types only, no runtime code
  json          Flat { "name": "value" } map
  json-extended { name: {value, kind, category, cssVar} } — design-tool metadata
  swift         Swift enum with // MARK: - Category separators (Xcode jump bar)
  kotlin        Kotlin object with // ── Category separator comments
  rust          Typed egui constants (Color32/f32/i32); CSS effects listed only

Use --categories (-C) to list the 17 semantic groups and their token counts.
"""


def list_categories(snapshot_path=DEFAULT_SNAPSHOT):
    """Print the 17 semantic category names with token counts and return 0."""
    pairs = load_tokens(snapshot_path)
    counts = {}
    for n, _v in pairs:
        idx = _CAT_LOOKUP.get(n, _CAT_CATCHALL)
        label = _CATEGORY_GROUPS[idx][0]
        counts[label] = counts.get(label, 0) + 1
    for label, _names in _CATEGORY_GROUPS:
        print("%-38s (%3d tokens)" % (label, counts.get(label, 0)))
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Generate platform token files from Aura's resolved snapshot.",
        epilog=_FORMAT_HELP,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--format", "-f", choices=sorted(FORMATS),
                        help="output format (see epilog for descriptions)")
    parser.add_argument("--snapshot", "-s", default=str(DEFAULT_SNAPSHOT),
                        help="path to tokens.resolved.json (default: repo root)")
    parser.add_argument("--out", "-o", default=None,
                        help="write to a file instead of stdout")
    parser.add_argument("--categories", "-C", action="store_true",
                        help="list the 17 semantic categories with token counts and exit")
    args = parser.parse_args(argv)
    if args.categories:
        return list_categories(args.snapshot)
    if not args.format:
        parser.error("--format/-f is required (or use --categories/-C)")
    try:
        text = generate(args.format, args.snapshot)
    except (OSError, ValueError) as exc:
        print("aura_tokens: error: %s" % exc, file=sys.stderr)
        return 2
    if args.out:
        Path(args.out).write_text(text)
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
