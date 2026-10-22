import type { FirmwareMachine } from './firmware-machine';

/**
 * Registry that hands a running sketch to the board part that must execute it.
 *
 * Behaviours are created by the catalog, which is plain data with no access to
 * Angular or to the page's state, while a sketch is loaded by the page from the
 * project's files. This module is the seam between the two: the page registers a
 * compiled machine against the placed board's instance id, and that board's
 * behaviour looks it up on each tick.
 *
 * Keyed by instance id rather than by device id because a diagram may hold two
 * boards, each running its own sketch.
 */
const machines = new Map<string, FirmwareMachine>();

export function attachFirmware(instanceId: string, machine: FirmwareMachine): void {
  machines.set(instanceId, machine);
}

export function detachFirmware(instanceId: string): void {
  machines.delete(instanceId);
}

export function firmwareFor(instanceId: string): FirmwareMachine | null {
  return machines.get(instanceId) ?? null;
}

/** Drops every sketch. Called when the workspace stops or the project changes. */
export function clearFirmware(): void {
  machines.clear();
}
