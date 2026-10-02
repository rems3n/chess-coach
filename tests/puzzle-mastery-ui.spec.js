import { test, expect } from '@playwright/test';

function hashText(text=''){
  let h=2166136261;
  for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)}
  return (h>>>0).toString(36);
}

test('personal puzzle mastery dashboard restores due review state', async ({ page }) => {
  const fen='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const id='g1:1:'+hashText(fen);
  await page.addInitScript(({fen,id}) => {
    const games=[{
      id:'g1',
      opponent:'TrainingTest',
      timeClass:'rapid',
      analysis:{
        criticalPositions:[{
          ply:1,
          moveNumber:1,
          fen,
          playedSan:'d4',
          bestSan:'e4',
          bestUci:'e2e4',
          cpLoss:300,
          classification:'blunder',
          phase:'opening'
        }]
      }
    }];
    const mastery={
      [id]:{
        id,attempts:2,correct:1,incorrect:1,streak:0,mastery:35,
        intervalDays:0,nextReviewAt:1,lastReviewedAt:1,lastResult:'incorrect',
        firstSeenAt:1,totalResponseMs:10000,hintsUsed:0
      }
    };
    localStorage.setItem('cc_games',JSON.stringify(games));
    localStorage.setItem('cc_puzzle_mastery',JSON.stringify(mastery));
  },{fen,id});

  await page.goto('/#/puzzles');

  await expect(page.getByRole('heading',{name:'Puzzles'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Due (1)'})).toBeVisible();
  await expect(page.getByText('35% mastery')).toBeVisible();

  const board=page.locator('#puzzle-board cg-board');
  await expect(board).toBeVisible();
  await expect(page.locator('#puzzle-board piece:not(.ghost)')).toHaveCount(32);

  await page.goto('/#/home');
  await expect(page.getByText('Reviews due')).toBeVisible();
  await expect(page.getByText('1 due for review')).toBeVisible();
});
