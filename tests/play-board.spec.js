import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/coach', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      coach: { intervene: false, pause_game: false, message: '', observation: '', skill_tags: [], confidence: 'low', profile_updates: [] },
      engine: null,
      model: 'test'
    })
  }));
  await page.route('**/api/opponent-move', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ move: 'e7e5', analysis: null, elo: 1450 })
  }));
});

test('Play board renders as one complete square Chessground board', async ({ page }) => {
  await page.goto('/#/play');

  const host = page.locator('#play-board');
  const board = host.locator('cg-board');
  await expect(board).toBeVisible();

  const hostBox = await host.boundingBox();
  const boardBox = await board.boundingBox();
  expect(hostBox).not.toBeNull();
  expect(boardBox).not.toBeNull();

  expect(hostBox.width).toBeGreaterThan(400);
  expect(hostBox.height).toBeGreaterThan(400);
  expect(Math.abs(hostBox.width - hostBox.height)).toBeLessThan(8);

  expect(boardBox.width).toBeGreaterThan(400);
  expect(boardBox.height).toBeGreaterThan(400);
  expect(Math.abs(boardBox.width - boardBox.height)).toBeLessThan(8);

  await expect(page.locator('#play-board cg-board')).toHaveCount(1);
  await expect(page.locator('#play-board piece:not(.ghost)')).toHaveCount(32);

  const playerRows = page.locator('.boardCard .player');
  await expect(playerRows).toHaveCount(2);
  await expect(playerRows.nth(0)).toContainText('Training opponent');
  await expect(playerRows.nth(1)).toContainText('You');
});

test('Play board stays single after a player move and opponent reply', async ({ page }) => {
  await page.goto('/#/play');
  await expect(page.locator('#play-board cg-board')).toHaveCount(1);

  await page.locator('#play-board').evaluate(el => {
    el.__ground.selectSquare('e2');
    el.__ground.selectSquare('e4');
  });

  const expectedFen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
  await expect(page.locator('#play-board')).toHaveAttribute('data-fen', expectedFen, { timeout: 10000 });

  await expect(page.locator('#play-board')).toHaveCount(1);
  await expect(page.locator('#play-board cg-board')).toHaveCount(1);
  await expect(page.locator('#play-board piece:not(.ghost)')).toHaveCount(32);

  const boardBox = await page.locator('#play-board cg-board').boundingBox();
  expect(boardBox).not.toBeNull();
  expect(Math.abs(boardBox.width - boardBox.height)).toBeLessThan(8);
});

test('Repeated rerenders never duplicate the Play board', async ({ page }) => {
  await page.goto('/#/play');
  for (let i = 0; i < 4; i++) {
    await page.getByRole('button', { name: 'Flip' }).click();
    await expect(page.locator('#play-board cg-board')).toHaveCount(1);
  }
});
