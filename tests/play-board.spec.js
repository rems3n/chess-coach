import { test, expect } from '@playwright/test';

test('Play board renders a complete square 8x8 board', async ({ page }) => {
  await page.goto('/#/play');

  const host = page.locator('#play-board');
  const svg = host.locator('svg.cm-chessboard');
  await expect(svg).toBeVisible();

  const hostBox = await host.boundingBox();
  const svgBox = await svg.boundingBox();
  expect(hostBox).not.toBeNull();
  expect(svgBox).not.toBeNull();

  expect(hostBox.width).toBeGreaterThan(400);
  expect(hostBox.height).toBeGreaterThan(400);
  expect(Math.abs(hostBox.width - hostBox.height)).toBeLessThan(8);

  expect(svgBox.width).toBeGreaterThan(400);
  expect(svgBox.height).toBeGreaterThan(400);
  expect(Math.abs(svgBox.width - svgBox.height)).toBeLessThan(8);

  await expect(host.locator('g.board rect.square')).toHaveCount(64);
  await expect(host.locator('g.pieces g[data-piece]')).toHaveCount(32);

  const opponent = page.getByText('Training opponent').first();
  const player = page.getByText('You', { exact: true }).first();
  await expect(opponent).toBeVisible();
  await expect(player).toBeVisible();

  const playerBox = await player.boundingBox();
  expect(playerBox.y - (hostBox.y + hostBox.height)).toBeLessThan(60);
});

test('Review and puzzle board hosts stay square when present', async ({ page }) => {
  await page.goto('/#/play');
  const svg = page.locator('#play-board svg.cm-chessboard');
  await expect(svg).toBeVisible();
  const box = await svg.boundingBox();
  expect(Math.abs(box.width - box.height)).toBeLessThan(8);
});
