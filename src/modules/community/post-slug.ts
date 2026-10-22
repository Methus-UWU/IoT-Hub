import { randomBytes } from 'node:crypto';

/** Keeps a URL readable without letting one title fill the path. */
const MAX_BASE_LENGTH = 60;

/** Used when a title is punctuation or emoji only and leaves nothing behind. */
const FALLBACK_BASE = 'post';

/**
 * Builds a URL slug from a post title.
 *
 * Letters, combining marks, and digits of any script survive, so a Thai title
 * keeps its own words instead of collapsing to the fallback — the readable half
 * of the URL is the only reason to have a slug at all. Marks have to be kept
 * explicitly: Thai vowel signs and tone marks are Unicode marks, not letters, so
 * dropping them would turn ต่อ into ตอ. The random suffix, not the title, is
 * what makes a slug unique: two posts may legitimately ask the same question,
 * and a collision loop appending -2, -3 … would leak how many exist.
 */
export function buildPostSlug(title: string): string {
  const base = title
    .normalize('NFC')
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Mark}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_BASE_LENGTH)
    .replace(/-+$/g, '');

  return `${base || FALLBACK_BASE}-${randomBytes(4).toString('hex')}`;
}
