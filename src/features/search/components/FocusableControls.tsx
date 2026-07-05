/** Generic controller-navigable wrappers shared across the Search page's
 *  subcomponents (W268, controller-input-design.md §compat matrix; extracted
 *  from SearchPage at W362). Mirrors the GameTile / FocusableNavItem pattern
 *  (App.tsx, library/GameTile.tsx): register the element with `useFocusable`,
 *  mirror controller focus onto native DOM focus so the ring + scroll-into-view
 *  work, and draw the shared `FocusRing`. */
import { useEffect } from "react";
import { FocusRing, useFocusable } from "../../controller";

/** A focusable text/search `<input>` wrapped in the shared `FocusRing`.
 *  `confirm` on a text field just moves native DOM focus into it (so the user
 *  can then type) rather than triggering a click. */
export function FocusableSearchField({
  focusId,
  inputRef,
  ...inputProps
}: {
  focusId: string;
  inputRef?: React.Ref<HTMLInputElement>;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const { ref, isFocused } = useFocusable<HTMLInputElement>(focusId);
  useEffect(() => {
    if (isFocused) ref.current?.focus();
  }, [isFocused, ref]);
  return (
    <FocusRing focused={isFocused}>
      <input
        {...inputProps}
        ref={(el) => {
          ref.current = el;
          if (typeof inputRef === "function") inputRef(el);
          else if (inputRef) (inputRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
        }}
      />
    </FocusRing>
  );
}

/** A focusable action control wrapped in the shared `FocusRing`. Generic over
 *  `HTMLElement` (rather than `HTMLButtonElement`) so it works uniformly for
 *  AuraButton (whose forwarded ref types as `HTMLElement`, design-language.md
 *  §7.2), plain `<button>`, and native-checkbox `<label>` toolbar controls.
 *
 *  `onActivate` fires exactly once per confirm-press OR native click/change —
 *  never both — so a checkbox's own onChange stays the single source of truth
 *  for its state and `render`'s `onClick` is JUST the focus-claim (no
 *  redundant onActivate call), avoiding a double-toggle. */
export function FocusableAction({
  focusId,
  onActivate,
  disabled,
  children,
  render,
}: {
  focusId: string;
  onActivate: () => void;
  disabled?: boolean;
  children?: React.ReactNode;
  /** Custom render for the inner control (e.g. AuraButton, or a checkbox
   *  `<label>`); receives the ref + a focus-claim-only `onClick` (does NOT
   *  call `onActivate` — the control's own native handler owns that). Defaults
   *  to a plain `<button>` whose click both claims focus and activates. */
  render?: (props: {
    ref: React.Ref<HTMLElement>;
    onClick: () => void;
    disabled?: boolean;
  }) => React.ReactNode;
}) {
  const { ref, isFocused, focus } = useFocusable<HTMLElement>(focusId, disabled ? undefined : onActivate);
  useEffect(() => {
    if (isFocused) ref.current?.focus();
  }, [isFocused, ref]);
  return (
    <FocusRing focused={isFocused}>
      {render ? (
        render({ ref, onClick: focus, disabled })
      ) : (
        <button
          ref={ref as React.Ref<HTMLButtonElement>}
          type="button"
          onClick={() => {
            focus();
            onActivate();
          }}
          disabled={disabled}
        >
          {children}
        </button>
      )}
    </FocusRing>
  );
}
