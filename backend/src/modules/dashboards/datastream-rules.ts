import type {
  DatastreamDataType,
  DatastreamTemplate,
} from './dashboard.repository';

/** Mirrors the CHECK constraints on `project_datastreams`; the two change together. */
export const DATASTREAM_KEY = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
export const DATASTREAM_DATA_TYPES: readonly DatastreamDataType[] = [
  'number',
  'boolean',
  'string',
];

/**
 * Datastreams as a template stores them, rebuilt from JSON. Entries that break a rule
 * are dropped rather than trusted: a template row could predate a rule.
 */
export function parseDatastreamTemplates(value: unknown): DatastreamTemplate[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: DatastreamTemplate[] = [];
  for (const raw of value.slice(0, 64)) {
    if (raw === null || typeof raw !== 'object') continue;
    const record = raw as Record<string, unknown>;
    const key = typeof record['key'] === 'string' ? record['key'] : '';
    const dataType = record['dataType'] as DatastreamDataType;
    const name =
      typeof record['name'] === 'string'
        ? record['name'].trim().slice(0, 80)
        : '';
    if (!DATASTREAM_KEY.test(key) || seen.has(key) || !name) continue;
    if (!DATASTREAM_DATA_TYPES.includes(dataType)) continue;
    const min = finiteOrNull(record['min']);
    const max = finiteOrNull(record['max']);
    seen.add(key);
    result.push({
      key,
      name,
      dataType,
      unit:
        typeof record['unit'] === 'string' ? record['unit'].slice(0, 16) : '',
      min: min !== null && max !== null && min >= max ? null : min,
      max: min !== null && max !== null && min >= max ? null : max,
      source:
        typeof record['source'] === 'string'
          ? record['source'].slice(0, 64)
          : '',
    });
  }
  return result;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
