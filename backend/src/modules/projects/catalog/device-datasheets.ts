/**
 * Read access to the device datasheets.
 *
 * The catalog says which pins a part has. The datasheet says the things a pin list cannot:
 * that a bare DHT needs a 4.7 kΩ pull-up between DATA and VCC or it reads nothing, that
 * most relay boards close on a LOW, that the third leg of a four-pin DHT is not connected
 * at all. The assistant needs that to propose a circuit that works rather than one that
 * merely type-checks against the pinout, and it is the one class of fact it would
 * otherwise have to invent.
 *
 * The documents are generated (`device-datasheets.generated.ts`) from the Markdown the
 * documentation page renders, so the text the model reads is the text the user can open.
 * Several parts share a document; the index resolves an id to it rather than storing it
 * twice.
 */

import { GENERATED_DEVICE_DATASHEETS } from './device-datasheets.generated';

const BY_ID = new Map<string, string>(
  GENERATED_DEVICE_DATASHEETS.flatMap((entry) =>
    entry.ids.map((id) => [id, entry.markdown] as const),
  ),
);

/** The datasheet for one catalog id, or undefined when none is written yet. */
export function datasheetOf(definitionId: string): string | undefined {
  return BY_ID.get(definitionId);
}

/** Whether a part has a datasheet, for a listing that says so without carrying it. */
export function hasDatasheet(definitionId: string): boolean {
  return BY_ID.has(definitionId);
}
