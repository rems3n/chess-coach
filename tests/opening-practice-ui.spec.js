import { test, expect } from '@playwright/test';

function hashText(text=''){
  let h=2166136261;
  for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)}
  return (h>>>0).toString(36);
}

test('Opening Lab surfaces due repertoire reviews and opens practice board', async ({ page }) => {
  const fen='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const id='opening:'+hashText(fen);
  await page.addInitScript(({fen,id}) => {
    const pgn='[Event "Training"]\n[White "Me"]\n[Black "Opponent"]\n[Result "*"]\n[Opening "King Pawn Game"]\n\n1. e4 e5 *';
    const games=[{
      id:'g1',
      pgn,
      color:'white',
      opponent:'Opponent',
      result:'win',
      timeClass:'rapid',
      analysis:{moves:[{
        phase:'opening',
        fen,
        color:'white',
        moveNumber:1,
        playedUci:'e2e4',
        playedSan:'e4',
        bestUci:'e2e4',
        bestSan:'e4',
        classification:'best_or_near_best',
        cpLoss:0
      }]}
    }];
    const mastery={
      [id]:{
        id,attempts:2,correct:1,incorrect:1,streak:0,mastery:35,
        intervalDays:0,nextReviewAt:1,lastReviewedAt:1,lastResult:'incorrect',
        firstSeenAt:1,totalResponseMs:8000,hintsUsed:0
      }
    };
    localStorage.setItem('cc_games',JSON.stringify(games));
    localStorage.setItem('cc_opening_mastery',JSON.stringify(mastery));
  },{fen,id});

  await page.goto('/#/openings');
  await expect(page.getByRole('heading',{name:'Opening Lab'})).toBeVisible();
  await expect(page.getByText('Due for review')).toBeVisible();
  await expect(page.getByRole('button',{name:'Review 1 due'})).toBeVisible();

  await page.getByRole('button',{name:'Review 1 due'}).click();
  await expect(page.getByRole('heading',{name:'Opening Practice'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Due (1)'})).toBeVisible();
  await expect(page.locator('.masteryChip').getByText('35% mastery',{exact:true})).toBeVisible();

  const board=page.locator('#opening-board cg-board');
  await expect(board).toBeVisible();
  await expect(page.locator('#opening-board piece')).toHaveCount(32);
});
