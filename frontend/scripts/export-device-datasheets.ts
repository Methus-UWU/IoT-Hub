/**
 * Exports the device datasheets to the NestJS API, for the project assistant to read.
 *
 * The datasheets are authored once, as Markdown under
 * `src/app/features/user/documents/device/`, and that stays true: this script derives a
 * backend copy the same way `export-device-catalog.ts` does, for the same reason. The
 * catalog tells the API which pins a part has; the datasheet tells it the things no pin
 * list can — that a bare DHT needs a 4.7 kΩ pull-up on DATA or it reads nothing, that most
 * relay boards switch on a LOW, that the third leg of a four-pin DHT is not connected.
 * That is knowledge a model otherwise has to guess at, and guessing it is how a proposal
 * ends up wired plausibly and broken.
 *
 * Only the text crosses. Nothing here is parsed, summarised, or restated: the file the
 * reader in `/user/documents` shows is byte for byte the text the assistant gets, so the
 * two can never disagree about how a part should be wired.
 *
 * Run it from `frontend/`. The `.md` loader is required — the mapping imports Markdown
 * as text, exactly as the Angular build does:
 *
 *   node_modules/.bin/esbuild scripts/export-device-datasheets.ts \
 *     --bundle --platform=node --format=cjs --loader:.md=text \
 *     --outfile=.tmp/export-datasheets.cjs \
 *     && node .tmp/export-datasheets.cjs
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DEVICE_DATASHEETS } from '../src/app/features/user/documents/device-datasheets';

const OUTPUT = resolve(
  __dirname,
  '../../backend/src/modules/projects/catalog/device-datasheets.generated.ts',
);

/**
 * One entry per document, with the ids that share it.
 *
 * Several parts share a datasheet — a relay board is the same part four times over — so
 * emitting the text once per id would multiply a 6 kB document by four. The API resolves
 * an id through the list rather than holding four copies of the same Thai prose.
 */
interface ExportedDatasheet {
  readonly ids: readonly string[];
  readonly markdown: string;
}

const byText = new Map<string, string[]>();
for (const [id, markdown] of Object.entries(DEVICE_DATASHEETS)) {
  const ids = byText.get(markdown);
  if (ids) ids.push(id);
  else byText.set(markdown, [id]);
}

const exported: ExportedDatasheet[] = [...byText]
  .map(([markdown, ids]) => ({ ids: [...ids].sort(), markdown }))
  .sort((a, b) => a.ids[0].localeCompare(b.ids[0]));

const idCount = exported.reduce((total, entry) => total + entry.ids.length, 0);
const charCount = exported.reduce((total, entry) => total + entry.markdown.length, 0);

function serialize(entries: readonly ExportedDatasheet[]): string {
  const blocks = entries.map((entry) =>
    [
      '  {',
      `    "ids": ${JSON.stringify(entry.ids)},`,
      `    "markdown": ${JSON.stringify(entry.markdown)},`,
      '  },',
    ].join('\n'),
  );
  return ['[', ...blocks, ']'].join('\n');
}

const banner = `/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Produced by \`frontend/scripts/export-device-datasheets.ts\` from the Markdown under
 * \`src/app/features/user/documents/device/\`, which remains the single place a datasheet is
 * written. Re-run the exporter after editing one; editing this file by hand recreates the
 * drift the generator exists to prevent.
 *
 * Carries the text a reader sees, unmodified, so the assistant and the documentation page
 * cannot disagree about how a part should be wired. Ids that share a document share one
 * entry.
 *
 * ${exported.length} documents covering ${idCount} device ids, ${charCount.toLocaleString('en-US')} characters.
 */

export interface GeneratedDatasheet {
  readonly ids: readonly string[];
  readonly markdown: string;
}

export const GENERATED_DEVICE_DATASHEETS: readonly GeneratedDatasheet[] = `;

writeFileSync(OUTPUT, `${banner}${serialize(exported)} as const;\n`, 'utf8');

console.log(
  `Wrote ${exported.length} datasheets (${idCount} ids, ${charCount} characters) to ${OUTPUT.replace(
    /\\/g,
    '/',
  )}`,
);
