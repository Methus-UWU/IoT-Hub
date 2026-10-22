/**
 * Places parts beside the board they are wired to, in tidy columns.
 *
 * Parts the assistant adds arrive on the server's spawn grid, which knows nothing
 * about wiring. This lays them out the way a person tidies a breadboard diagram:
 *
 * - each part goes on the side of the board its pin sits on;
 * - parts wired straight to the board form the first column on that side, parts
 *   reached through them (GPIO → resistor → LED) the next column out, and so on;
 * - within a column, parts keep the order their pins run down the header and are
 *   stacked top to bottom without overlapping, so no two wires have to cross;
 * - each part is raised or lowered so the pin that is wired sits level with the
 *   pin it goes to, which keeps most wires straight.
 *
 * Parts not in `movableIds` never move, and new ones are kept clear of them.
 * Pure: geometry in, positions out. Persisting them is the caller's job.
 */

import { drawingScaleFor } from '../devices/core/device-metrics';
import { isBoardCategory } from '../device-library.models';
import type { DevicePin, Point, VirtualDevice } from '../models/virtual-device.model';

export interface LayoutPart {
  readonly id: string;
  readonly definition: VirtualDevice;
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
}

export interface LayoutWire {
  readonly from: { readonly componentId: string; readonly pinId: string };
  readonly to: { readonly componentId: string; readonly pinId: string };
}

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

type Side = 'left' | 'right';

/** One part to place: where it hangs from, and which of its pins faces that way. */
interface Slot {
  readonly id: string;
  readonly side: Side;
  readonly depth: number;
  /** The part it hangs off: the board, or a part placed in the column before. */
  readonly parentId: string;
  /** The parent's pin this part is wired to. */
  readonly parentPin: string;
  /** This part's own pin on that wire. */
  readonly ownPin: string;
}

/**
 * Room between the board and the first column, and between columns. Wide enough
 * for a header's worth of wires to fan out without running over the next part.
 */
const COLUMN_GAP = 104;
/** Room between a part and the next one along its chain, e.g. a button and its pull-up. */
const CHAIN_GAP = 56;
/** Space kept between two parts stacked in one column. */
const STACK_GAP = 28;
/** Clearance kept from parts that do not move. */
const CLEARANCE = 16;

export function layoutNewParts(
  parts: readonly LayoutPart[],
  wires: readonly LayoutWire[],
  movableIds: readonly string[],
): Map<string, Point> {
  const placed = new Map<string, Point>();
  const board = parts.find((part) => isBoardCategory(part.definition.catalog.categoryId));
  const movable = new Set(movableIds.filter((id) => id !== board?.id));
  if (!board || !movable.size) return placed;

  const byId = new Map(parts.map((part) => [part.id, part]));
  const boardRect = footprint(board);
  const fixed: Rect[] = parts.filter((part) => !movable.has(part.id)).map(footprint);

  const links = (id: string) =>
    wires.flatMap((wire) => {
      if (wire.from.componentId === id) return [{ own: wire.from.pinId, other: wire.to }];
      if (wire.to.componentId === id) return [{ own: wire.to.pinId, other: wire.from }];
      return [];
    });

  const slots = assignSlots(board, boardRect, movable, links);

  // Where a placed part now is, for its children to line up with.
  const placedPart = (id: string): LayoutPart | undefined => {
    const part = byId.get(id);
    const at = placed.get(id);
    return part && at ? { ...part, x: at.x, y: at.y, rotation: 0 } : part;
  };

  // Everything a new part must not land on: parts that stay, then each placed one.
  const taken: Rect[] = [...fixed];
  const maxDepth = Math.max(0, ...slots.map((slot) => slot.depth));
  for (let depth = 1; depth <= maxDepth; depth++) {
    for (const side of ['left', 'right'] as const) {
      const column = slots.filter((slot) => slot.depth === depth && slot.side === side);
      if (!column.length) continue;
      const edge =
        side === 'left' ? boardRect.x - COLUMN_GAP : boardRect.x + boardRect.width + COLUMN_GAP;

      const entries = column
        .map((slot) => {
          const part = byId.get(slot.id)!;
          const size = footprint({ ...part, x: 0, y: 0, rotation: 0 });
          const parent = placedPart(slot.parentId)!;
          const parentPin = parent.definition.pins.find((pin) => pin.name === slot.parentPin);
          const ownPin = part.definition.pins.find((pin) => pin.name === slot.ownPin);
          const anchorY = parentPin ? pinPoint(parent, parentPin).y : boardRect.y;
          // Offset of the wired pin from the part's top, so that pin sits level.
          const ownOffset = ownPin
            ? pinPoint({ ...part, x: 0, y: 0, rotation: 0 }, ownPin).y
            : size.height / 2;
          return { slot, size, anchorY, desiredY: anchorY - ownOffset };
        })
        // Header order, so neighbouring pins feed neighbouring parts.
        .sort((a, b) => a.anchorY - b.anchorY);

      let cursor = Number.NEGATIVE_INFINITY;
      for (const entry of entries) {
        // The first column lines up beside the board. A part further along a
        // chain sits just past its own parent — a pull-up beside its button — not
        // past the widest part in the column before, which would send its wires
        // across whatever is in between.
        const parentRect = depth === 1 ? null : footprint(placedPart(entry.slot.parentId)!);
        const x =
          side === 'left'
            ? (parentRect ? parentRect.x - CHAIN_GAP : edge) - entry.size.width
            : parentRect
              ? parentRect.x + parentRect.width + CHAIN_GAP
              : edge;
        const y = depth === 1 ? Math.max(entry.desiredY, cursor + STACK_GAP) : entry.desiredY;
        const rect = clearOf({ x, y, width: entry.size.width, height: entry.size.height }, taken);
        placed.set(entry.slot.id, { x: rect.x, y: rect.y });
        taken.push(rect);
        if (depth === 1) cursor = rect.y + rect.height;
      }
    }
  }

  // Anything that reaches the board by no wire at all goes in a row beneath
  // everything else.
  const bottom = Math.max(
    boardRect.y + boardRect.height,
    ...[...placed].map(
      ([id, at]) => at.y + footprint({ ...byId.get(id)!, x: 0, y: 0, rotation: 0 }).height,
    ),
  );
  let rowX = boardRect.x;
  for (const id of movable) {
    const part = byId.get(id);
    if (!part || placed.has(id)) continue;
    const size = footprint({ ...part, x: 0, y: 0, rotation: 0 });
    const rect = clearOf(
      { x: rowX, y: bottom + COLUMN_GAP, width: size.width, height: size.height },
      taken,
    );
    placed.set(id, { x: rect.x, y: rect.y });
    taken.push(rect);
    rowX = rect.x + rect.width + STACK_GAP;
  }

  return placed;
}

/**
 * Which column each movable part belongs in, breadth-first from the board.
 *
 * Signal wires decide first: an LED whose cathode also runs to GND belongs at the
 * end of its GPIO → resistor chain, not beside the ground pin. Parts that reach
 * the board only through a supply or ground pin are placed after.
 */
function assignSlots(
  board: LayoutPart,
  boardRect: Rect,
  movable: ReadonlySet<string>,
  links: (id: string) => { own: string; other: { componentId: string; pinId: string } }[],
): Slot[] {
  const slots: Slot[] = [];
  const assigned = new Set<string>();

  const seed = (
    pick: (pins: { own: string; pin: DevicePin }[]) => { own: string; pin: DevicePin } | undefined,
  ) => {
    const queue: Slot[] = [];
    for (const id of movable) {
      if (assigned.has(id)) continue;
      const toBoard = links(id)
        .filter((link) => link.other.componentId === board.id)
        .flatMap((link) => {
          const pin = board.definition.pins.find(
            (candidate) => candidate.name === link.other.pinId,
          );
          return pin ? [{ own: link.own, pin }] : [];
        });
      const chosen = pick(toBoard);
      if (!chosen) continue;
      const point = pinPoint(board, chosen.pin);
      queue.push({
        id,
        side: point.x < boardRect.x + boardRect.width / 2 ? 'left' : 'right',
        depth: 1,
        parentId: board.id,
        parentPin: chosen.pin.name,
        ownPin: chosen.own,
      });
      assigned.add(id);
    }

    while (queue.length) {
      const slot = queue.shift()!;
      slots.push(slot);
      for (const link of links(slot.id)) {
        const child = link.other.componentId;
        if (!movable.has(child) || assigned.has(child)) continue;
        assigned.add(child);
        queue.push({
          id: child,
          side: slot.side,
          depth: slot.depth + 1,
          parentId: slot.id,
          parentPin: link.own,
          ownPin: link.other.pinId,
        });
      }
    }
  };

  seed((pins) => pins.find((entry) => entry.pin.kind === 'signal'));
  seed((pins) => pins[0]);
  return slots;
}

/** A pin in canvas coordinates. Mirrors the canvas transform: rotate, scale, translate. */
function pinPoint(part: LayoutPart, pin: Point): Point {
  const { definition, rotation } = part;
  const scale = drawingScaleFor(definition);
  const center = { x: definition.width / 2, y: definition.height / 2 };
  const radians = (rotation * Math.PI) / 180;
  const dx = pin.x - center.x;
  const dy = pin.y - center.y;
  return {
    x: part.x + scale * (center.x + dx * Math.cos(radians) - dy * Math.sin(radians)),
    y: part.y + scale * (center.y + dx * Math.sin(radians) + dy * Math.cos(radians)),
  };
}

/** The part's box on the canvas; a quarter turn swaps its sides about the centre. */
function footprint(part: LayoutPart): Rect {
  const scale = drawingScaleFor(part.definition);
  const width = part.definition.width * scale;
  const height = part.definition.height * scale;
  const centerX = part.x + width / 2;
  const centerY = part.y + height / 2;
  const turned = part.rotation % 180 !== 0;
  const w = turned ? height : width;
  const h = turned ? width : height;
  return { x: centerX - w / 2, y: centerY - h / 2, width: w, height: h };
}

/** Moves a box down past any fixed part it would overlap. */
function clearOf(rect: Rect, fixed: readonly Rect[]): Rect {
  let current = rect;
  for (let guard = 0; guard < fixed.length + 1; guard++) {
    const hit = fixed.find((other) => overlaps(current, other));
    if (!hit) return current;
    current = { ...current, y: hit.y + hit.height + CLEARANCE };
  }
  return current;
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width + CLEARANCE &&
    b.x < a.x + a.width + CLEARANCE &&
    a.y < b.y + b.height + CLEARANCE &&
    b.y < a.y + a.height + CLEARANCE
  );
}
