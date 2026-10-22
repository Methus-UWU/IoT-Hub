import { expect, test, type Page } from '@playwright/test';

const markdown = [
  '**Wiring guide** with `GPIO23` and [reference](https://example.com/reference).',
  '',
  '| Pin | Device |',
  '| --- | --- |',
  '| GPIO23 | Buzzer |',
  '',
  '```cpp',
  'tone(23, 440);',
  '```',
  '',
  '- Connect ground',
  '- Check voltage',
  '',
  '<img src="/missing-preview-image" onerror="window.markdownExecuted = true">',
  '<script>window.markdownExecuted = true</script>',
  '',
  '[unsafe](javascript:alert(1))',
].join('\n');

const post = {
  id: 'post-1', kind: 'question', title: 'Markdown wiring guide', slug: 'markdown-wiring-guide',
  excerpt: 'Plain-text fallback', markdownPreview: markdown,
  score: 1, commentCount: 0, viewCount: 4, hasAcceptedAnswer: false,
  createdAt: '2026-09-27T00:00:00.000Z', lastActivityAt: '2026-09-27T00:00:00.000Z',
  author: { id: 'author-1', username: 'maker' }, tags: [],
  viewerVote: 0, viewerIsAuthor: false,
};

function gate() {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  return { ready, release };
}

async function mockCommunity(page: Page, wait: () => Promise<void>) {
  await page.route('**/api/community/**', async (route) => {
    const url = new URL(route.request().url());
    await wait();
    if (url.pathname.endsWith('/tags')) {
      return route.fulfill({ json: { data: [{ slug: 'esp32', name: 'ESP32', postCount: 1, description: '' }] } });
    }
    if (url.pathname.endsWith('/comments')) {
      return route.fulfill({ json: { data: [] } });
    }
    if (url.pathname.endsWith('/posts')) {
      const more = url.searchParams.has('cursor');
      return route.fulfill({ json: {
        data: [{ ...post, id: more ? 'post-2' : post.id }],
        meta: { nextCursor: more ? null : 'next' },
      } });
    }
    return route.fulfill({ json: { data: { ...post, body: markdown, acceptedCommentId: null, updatedAt: post.createdAt } } });
  });
}

test('community shows post-shaped skeletons for initial load, filters, paging, and threads', async ({ page }) => {
  let pending = gate();
  await mockCommunity(page, () => pending.ready);
  await page.goto('/community');
  await expect(page.locator('.feed-list[aria-busy="true"] app-community-post-skeleton')).toHaveCount(5);
  await expect(page.locator('.side-tags [aria-busy="true"]')).toBeVisible();
  await expect(page.locator('.composer-skeleton')).toBeVisible();
  await expect(page.locator('.sort-skeleton')).toBeVisible();
  await expect(page.locator('.about-skeleton')).toBeVisible();
  pending.release();
  await expect(page.locator('.post-card')).toHaveCount(1);
  await expect(page.locator('.side-tags button')).toContainText('ESP32');

  pending = gate();
  await page.getByRole('tab').nth(2).click();
  await expect(page.locator('.feed-list[aria-busy="true"] app-community-post-skeleton')).toHaveCount(5);
  pending.release();
  await expect(page.locator('.post-card')).toHaveCount(1);

  pending = gate();
  await page.locator('.load-more').click();
  await expect(page.locator('.post-card')).toHaveCount(1);
  await expect(page.locator('.feed-list[aria-busy="true"] app-community-post-skeleton')).toHaveCount(2);
  pending.release();
  await expect(page.locator('.post-card')).toHaveCount(2);
  await expect(page.locator('.load-more')).toHaveCount(0);

  pending = gate();
  await page.locator('.post-title a').first().click();
  await expect(page.locator('.thread-skeleton app-community-post-skeleton')).toHaveCount(2);
  pending.release();
  await expect(page.locator('.thread-body .markdown-body table')).toBeVisible();
});

test('feed renders compact, sanitized Markdown at desktop and mobile sizes', async ({ page }, testInfo) => {
  await mockCommunity(page, async () => {});
  await page.goto('/community');
  const preview = page.locator('.post-excerpt');
  await expect(preview).toHaveCSS('overflow', 'clip');
  await page.locator('.post-expand').click();
  await expect(page.locator('.post-expand')).toHaveAttribute('aria-expanded', 'true');
  await expect(preview.locator('strong')).toHaveText('Wiring guide');
  await expect(preview.locator('table th')).toHaveText(['Pin', 'Device']);
  await expect(preview.locator('pre code')).toHaveText('tone(23, 440);\n');
  await expect(preview.locator('ul li')).toHaveText(['Connect ground', 'Check voltage']);
  await expect(preview.locator('script, [onerror]')).toHaveCount(0);
  expect(await preview.getByRole('link', { name: 'unsafe', exact: true }).getAttribute('href')).not.toMatch(/^javascript:/i);
  expect(await page.evaluate(() => Reflect.get(window, 'markdownExecuted'))).toBeUndefined();
  await expect(page.locator('.post-title')).toHaveCSS('font-size', '15px');
  await expect(preview).toHaveCSS('font-size', '13px');
  await page.screenshot({ path: testInfo.outputPath('community-desktop.png'), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(preview.locator('table')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator('.post-expand').focus();
  await expect(page.locator('.post-expand')).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('community-mobile.png'), fullPage: true });
});

test('more loads the full body with a skeleton, retries failures, and expands without inner scrolling', async ({ page }) => {
  await mockCommunity(page, async () => {});
  const pending = gate();
  let attempts = 0;
  const fullBody = markdown + '\n\n' + 'Full body paragraph.\n\n'.repeat(100) + 'END OF FULL POST';
  await page.route('**/api/community/posts/markdown-wiring-guide', async (route) => {
    attempts++;
    if (attempts === 1) return route.fulfill({ status: 503, json: {} });
    await pending.ready;
    return route.fulfill({ json: { data: { ...post, body: fullBody } } });
  });
  await page.goto('/community');
  const button = page.locator('.post-expand');
  await button.click();
  await expect(page.locator('.post-main [role="alert"]')).toBeVisible();
  await button.click();
  await expect(page.locator('.body-skeleton')).toBeVisible();
  await expect(button).toBeDisabled();
  pending.release();
  await expect(page.locator('.post-excerpt')).toContainText('END OF FULL POST');
  await expect(button).toHaveText('แสดงน้อยลง');
  await expect(page.locator('.post-excerpt')).toHaveCSS('max-height', 'none');
  await expect(page.locator('.post-excerpt')).toHaveCSS('overflow', 'visible');
  await expect(page.locator('.post-excerpt pre')).toHaveCSS('white-space', 'pre-wrap');
  await expect(page.locator('.post-excerpt table')).toHaveCSS('overflow', 'visible');
  await button.click();
  await expect(button).toHaveText('เพิ่มเติม');
  await expect(page.locator('.post-excerpt')).toHaveCSS('overflow', 'clip');
  await button.press('Enter');
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  expect(attempts).toBe(2);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('a complete short post has no more button but a truncated short preview does', async ({ page }) => {
  await mockCommunity(page, async () => {});
  await page.route('**/api/community/posts?*', (route) => route.fulfill({ json: {
    data: [
      { ...post, markdownPreview: 'Short post.', markdownPreviewTruncated: false },
      { ...post, id: 'post-2', markdownPreview: 'Cut short.', markdownPreviewTruncated: true },
    ], meta: { nextCursor: null },
  } }));
  await page.goto('/community');
  await expect(page.locator('.post-card')).toHaveCount(2);
  await expect(page.locator('.post-card').first().locator('.post-expand')).toHaveCount(0);
  await expect(page.locator('.post-card').last().locator('.post-expand')).toBeVisible();
});
