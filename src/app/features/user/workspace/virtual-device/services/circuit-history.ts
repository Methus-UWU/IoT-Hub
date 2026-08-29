/**
 * Undo/redo for the circuit editor.
 *
 * Snapshot-based rather than command-based: the editable state is a handful of
 * plain records, so capturing them is cheap and every operation gets undo for
 * free instead of each one having to author an inverse. Inverses are where
 * command histories quietly go wrong — a half-written one silently corrupts the
 * document.
 *
 * The important behaviour is grouping. A drag emits a position every frame; if
 * each became an entry, one gesture would cost hundreds of undos and Ctrl+Z
 * would feel broken. Callers open a transaction before a gesture and commit it
 * after, producing exactly one entry for the whole movement.
 */

export interface CircuitSnapshot<TPlacement, TConnection, TState> {
  readonly placements: Readonly<Record<string, TPlacement>>;
  readonly connections: readonly TConnection[];
  readonly deviceStates: Readonly<Record<string, TState>>;
}

/** Entries beyond this are dropped from the oldest end. */
const MAX_ENTRIES = 60;

export class CircuitHistory<TPlacement, TConnection, TState> {
  private past: CircuitSnapshot<TPlacement, TConnection, TState>[] = [];
  private future: CircuitSnapshot<TPlacement, TConnection, TState>[] = [];

  /** Snapshot taken when a gesture began, held until it commits. */
  private pending: CircuitSnapshot<TPlacement, TConnection, TState> | null = null;
  private depth = 0;

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /**
   * Records a single, already-complete change.
   *
   * Takes the state as it was *before* the change, which the caller still holds
   * at that moment. Ignored inside a transaction, so a gesture that also calls
   * this internally does not split into several entries.
   */
  record(before: CircuitSnapshot<TPlacement, TConnection, TState>): void {
    if (this.depth > 0) return;
    this.push(before);
  }

  /**
   * Opens a transaction around a gesture.
   *
   * Nesting is counted rather than rejected: a drag that internally triggers
   * another recorded operation must still produce one entry.
   */
  begin(before: CircuitSnapshot<TPlacement, TConnection, TState>): void {
    if (this.depth === 0) this.pending = before;
    this.depth++;
  }

  /**
   * Closes the transaction, keeping one entry if anything actually changed.
   *
   * A click that begins a drag but moves nothing should not leave an undo step
   * behind, so the snapshots are compared before committing.
   */
  commit(after: CircuitSnapshot<TPlacement, TConnection, TState>): void {
    if (this.depth === 0) return;
    this.depth--;
    if (this.depth > 0) return;

    const before = this.pending;
    this.pending = null;
    if (!before) return;
    if (equalSnapshots(before, after)) return;

    this.push(before);
  }

  /** Abandons the transaction without recording anything. */
  cancel(): void {
    if (this.depth === 0) return;
    this.depth--;
    if (this.depth === 0) this.pending = null;
  }

  /** Returns the state to restore, or null when there is nothing to undo. */
  undo(
    current: CircuitSnapshot<TPlacement, TConnection, TState>,
  ): CircuitSnapshot<TPlacement, TConnection, TState> | null {
    const previous = this.past.pop();
    if (!previous) return null;

    this.future.push(current);
    return previous;
  }

  redo(
    current: CircuitSnapshot<TPlacement, TConnection, TState>,
  ): CircuitSnapshot<TPlacement, TConnection, TState> | null {
    const next = this.future.pop();
    if (!next) return null;

    this.past.push(current);
    return next;
  }

  clear(): void {
    this.past = [];
    this.future = [];
    this.pending = null;
    this.depth = 0;
  }

  private push(snapshot: CircuitSnapshot<TPlacement, TConnection, TState>): void {
    this.past.push(snapshot);
    // A new branch invalidates anything that was undone.
    this.future = [];
    if (this.past.length > MAX_ENTRIES) this.past.shift();
  }
}

/**
 * Structural comparison, used only to discard no-op gestures.
 *
 * JSON is adequate here: these records hold numbers, strings, and small arrays
 * in a stable key order, and the comparison runs once per gesture rather than
 * per frame.
 */
function equalSnapshots<TPlacement, TConnection, TState>(
  a: CircuitSnapshot<TPlacement, TConnection, TState>,
  b: CircuitSnapshot<TPlacement, TConnection, TState>,
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
