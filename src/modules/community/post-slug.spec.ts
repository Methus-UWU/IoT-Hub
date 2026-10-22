import { buildPostSlug } from './post-slug';

const SUFFIX = /-[0-9a-f]{8}$/;

describe('buildPostSlug', () => {
  it('keeps Thai letters instead of dropping them', () => {
    const slug = buildPostSlug('ต่อ DHT22 แล้วอ่านค่าไม่ได้');

    expect(slug).toMatch(SUFFIX);
    expect(slug.startsWith('ต่อ-dht22-แล้วอ่านค่าไม่ได้')).toBe(true);
  });

  it('falls back when the title has no letters or digits', () => {
    expect(buildPostSlug('??? !!! ***')).toMatch(/^post-[0-9a-f]{8}$/);
  });

  it('does not end the readable part with a separator', () => {
    expect(buildPostSlug('ESP32 reboot loop???')).toMatch(
      /^esp32-reboot-loop-[0-9a-f]{8}$/,
    );
  });

  it('gives two identical titles different slugs', () => {
    const title = 'ESP32 keeps rebooting after deep sleep';

    expect(buildPostSlug(title)).not.toBe(buildPostSlug(title));
  });
});
