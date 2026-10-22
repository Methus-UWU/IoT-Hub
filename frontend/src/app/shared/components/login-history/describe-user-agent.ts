/**
 * A short, human reading of a User-Agent header: "Chrome บน Windows".
 *
 * Deliberately coarse. The raw header stays available as a tooltip; this only
 * has to let a person recognise their own devices at a glance. Order matters:
 * Edge and Opera also claim to be Chrome, and Chrome claims to be Safari.
 */
const BROWSERS: readonly [RegExp, string][] = [
  [/Edg\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

const SYSTEMS: readonly [RegExp, string][] = [
  [/Windows/, 'Windows'],
  [/Android/, 'Android'],
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
];

export function describeUserAgent(userAgent: string): string {
  if (!userAgent.trim()) return 'ไม่ทราบอุปกรณ์';
  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1];
  const system = SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1];
  if (browser && system) return `${browser} บน ${system}`;
  return browser ?? system ?? 'อุปกรณ์อื่น';
}
