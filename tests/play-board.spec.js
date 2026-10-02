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


test('Coach messages stay compact and do not inherit panel height', async ({ page }) => {
  await page.goto('/#/play');
  const panel = page.locator('.card.coach');
  const message = page.locator('.msg.coach').first();

  await expect(panel).toBeVisible();
  await expect(message).toBeVisible();

  const panelBox = await panel.boundingBox();
  const messageBox = await message.boundingBox();
  expect(panelBox).not.toBeNull();
  expect(messageBox).not.toBeNull();

  expect(panelBox.height).toBeGreaterThan(400);
  expect(messageBox.height).toBeLessThan(140);
});


test('Takeback rewinds the student decision and the retry is sent to the coach', async ({ page }) => {
  const coachEvents = [];
  await page.unroute('**/api/coach');
  await page.route('**/api/coach', async route => {
    const body = route.request().postDataJSON();
    coachEvents.push(body);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        coach: {
          intervene: body.event === 'takeback',
          pause_game: false,
          message: body.event === 'takeback' ? 'Try the position again.' : '',
          observation: '',
          skill_tags: [],
          confidence: 'medium',
          profile_updates: []
        },
        engine: null,
        model: 'test'
      })
    });
  });

  await page.goto('/#/play');

  // First attempt: 1.e4 ...e5
  await page.locator('#play-board').evaluate(el => {
    el.__ground.selectSquare('e2');
    el.__ground.selectSquare('e4');
  });
  await expect(page.locator('#play-board')).toHaveAttribute(
    'data-fen',
    'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
    { timeout: 10000 }
  );

  await page.getByRole('button', { name: 'Undo / Try again' }).click();

  // Both the engine reply and the student's move are rewound.
  await expect(page.locator('#play-board')).toHaveAttribute(
    'data-fen',
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
  );
  await expect(page.getByText(/Takeback: e4 was rewound/)).toBeVisible();
  await expect(page.locator('#play-board cg-board')).toHaveCount(1);

  // Retry with 1.d4.
  await page.locator('#play-board').evaluate(el => {
    el.__ground.selectSquare('d2');
    el.__ground.selectSquare('d4');
  });
  await expect(page.locator('#play-board')).toHaveAttribute(
    'data-fen',
    'rnbqkbnr/pppp1ppp/8/4p3/3P4/8/PPP1PPPP/RNBQKBNR w KQkq - 0 2',
    { timeout: 10000 }
  );

  await expect.poll(() => coachEvents.map(x => x.event)).toContain('takeback');
  await expect.poll(() => coachEvents.map(x => x.event)).toContain('retry_move');

  const takeback = coachEvents.find(x => x.event === 'takeback');
  const retry = coachEvents.find(x => x.event === 'retry_move');
  expect(takeback.retryContext.originalMoveSan).toBe('e4');
  expect(retry.retryContext.originalMoveSan).toBe('e4');
  expect(retry.lastMoveSan).toBe('d4');

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('cc_retry_history') || '[]'));
  expect(stored).toHaveLength(1);
  expect(stored[0].changedMove).toBe(true);
  expect(stored[0].originalMoveSan).toBe('e4');
  expect(stored[0].retryMoveSan).toBe('d4');
});

test('Takebacks can be disabled from Play', async ({ page }) => {
  await page.goto('/#/play');
  const toggle = page.locator('#takebackToggle');
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(toggle).not.toBeChecked();

  await page.locator('#play-board').evaluate(el => {
    el.__ground.selectSquare('e2');
    el.__ground.selectSquare('e4');
  });
  await expect(page.getByRole('button', { name: 'Undo / Try again' })).toBeDisabled();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cc_allow_takebacks')))).toBe(false);
});


test('Live coach keeps newest messages in view inside a fixed-height panel', async ({ page }) => {
  await page.unroute('**/api/coach');
  let n = 0;
  await page.route('**/api/coach', route => {
    n += 1;
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        coach: {
          intervene: true,
          pause_game: false,
          message: 'Coach reply ' + n + ' — verified training feedback that is long enough to create a scrolling conversation.',
          observation: '',
          skill_tags: [],
          confidence: 'high',
          profile_updates: []
        },
        model: 'test'
      })
    });
  });

  await page.goto('/#/play');

  for (let i = 0; i < 10; i++) {
    const input = page.locator('#coachInput');
    await input.fill('Question ' + i);
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText('Coach reply ' + (i + 1), { exact: false })).toBeVisible();
  }

  const metrics = await page.locator('.workspace .card.coach .feed').evaluate(el => ({
    scrollTop: el.scrollTop,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    distanceFromBottom: el.scrollHeight - el.clientHeight - el.scrollTop
  }));

  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
  expect(metrics.scrollTop).toBeGreaterThan(0);
  expect(metrics.distanceFromBottom).toBeLessThan(8);

  const panel = await page.locator('.workspace .card.coach').boundingBox();
  expect(panel).not.toBeNull();
  expect(panel.height).toBeLessThanOrEqual(765);
});
