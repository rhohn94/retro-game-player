// ExclusiveClaimStack — layered ownership of the controller's exclusive slot
// (v0.27 W275, tv-mode-design.md §v0.27 → W275 audit). The slot used to be a
// single nullable ref (`setExclusiveHandler(h | null)`), which made ownership
// handoffs racy: a releasing owner reset the slot to null even when a lower
// surface still wanted it, so every "player unmounts / swaps / isn't ready
// yet" moment opened a NO-OWNER window in which semantic actions leaked to the
// base spatial engine — over the TV home this re-created the exact W272 defect
// (confirm launching a different game) on the degraded play paths.
//
// A claim STACK fixes this structurally: each owner pushes a claim and gets
// back an identity-based release; the TOP claim receives every action, and a
// release simply uncovers whatever sits beneath it — the TV home at the
// bottom, the takeover surface's swallow-all fallback above it, the mounted
// player on top. No orchestration of "who re-installs when" is needed and no
// ordering of effect cleanups can open a gap.
//
// Claims carry a KIND so app-level affordances can distinguish gameplay input
// capture from UI ownership: the `menu` long-press TV-mode toggle must stay
// live while a UI surface (the TV home) owns the slot, but must NOT fire while
// a player owns the gamepad ("outside gameplay", tv-mode-design.md
// §Controller).
//
// Pure and framework-free (generic over the handler type) so the push/release/
// top semantics are unit-testable without React or hardware.

/** Who is claiming: a UI surface (screen-level routing — the TV home, the
 * takeover surface's fallback) or a gameplay owner (a mounted player whose
 * gamepad belongs to the game). */
export type ExclusiveOwnerKind = "ui" | "gameplay";

/** One pushed claim: the handler plus its owner kind. */
interface ExclusiveClaim<H> {
  handler: H;
  kind: ExclusiveOwnerKind;
}

/**
 * A last-in-wins stack of exclusive-handler claims. `claim` pushes and returns
 * an idempotent releaser that removes THAT claim by identity (wherever it sits
 * in the stack — a mid-stack owner releasing out of order never disturbs the
 * top). `top()` is the handler that should receive actions, or null when no
 * one holds the slot.
 */
export class ExclusiveClaimStack<H> {
  private claims: ExclusiveClaim<H>[] = [];

  /** Push a claim; returns its release function (safe to call more than once). */
  claim(handler: H, kind: ExclusiveOwnerKind): () => void {
    const entry: ExclusiveClaim<H> = { handler, kind };
    this.claims.push(entry);
    return () => {
      const index = this.claims.indexOf(entry);
      if (index !== -1) this.claims.splice(index, 1);
    };
  }

  /** The handler currently owning the slot (top of the stack), or null. */
  top(): H | null {
    const last = this.claims[this.claims.length - 1];
    return last ? last.handler : null;
  }

  /** Whether ANY live claim is a gameplay owner — gates affordances that must
   * stay quiet during gameplay (e.g. the `menu` long-press TV-mode toggle). */
  hasGameplayClaim(): boolean {
    return this.claims.some((c) => c.kind === "gameplay");
  }

  /** Number of live claims (diagnostics/tests). */
  get size(): number {
    return this.claims.length;
  }
}
