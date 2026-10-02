import { test, expect } from '@playwright/test';

test('Guest Profile offers real account sign-in and registration', async ({ page }) => {
  await page.goto('/#/profile');
  await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeVisible();
  await expect(page.locator('#authEmail')).toBeVisible();
  await expect(page.locator('#authPassword')).toBeVisible();
  await expect(page.locator('section.accountPage').getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.locator('section.accountPage').getByRole('button', { name: 'Create account', exact: true })).toBeVisible();
});

test('Logged-in profile owns Chess.com connection and Analyze reuses it', async ({ page }) => {
  await page.route('**/api/auth/me', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      user: {
        id: '11111111-1111-1111-1111-111111111111',
        email: 'chris@example.com',
        display_name: 'Chris',
        chesscom_username: 'cgtest',
        goals: { next: 1800, longTerm: 2000 }
      }
    })
  }));
  await page.route('**/api/account/state', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          state: {
            games: [],
            profilePlan: null,
            coachingEvidence: [],
            puzzleMastery: {},
            openingMastery: {},
            lessonCache: {},
            chessProfile: { username: 'cgtest' },
            chessStats: { chess_rapid: { last: { rating: 1512 } } },
            settings: { opponentElo: 1450, coachMode: 'normal' }
          }
        })
      });
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    }
  });

  await page.goto('/#/profile');
  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
  await expect(page.locator('#profileChessUser')).toHaveValue('cgtest');
  await expect(page.getByText('1512', { exact: true })).toBeVisible();

  await page.goto('/#/analyze');
  await expect(page.locator('#chessUser')).toHaveCount(0);
  await expect(page.getByText('Chess.com connected')).toBeVisible();
  await expect(page.getByText('cgtest', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sync latest games' })).toBeVisible();

  await page.goto('/#/home');
  await expect(page.getByText('1,512', { exact: true })).toBeVisible();
  await expect(page.getByText('1,800', { exact: true })).toBeVisible();
});
