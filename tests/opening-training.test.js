import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpeningItems, openingQueue } from '../public/opening-training.js';
import { DAY, emptyMastery } from '../public/mastery.js';

const start='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const after='rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';

test('opening trainer keeps sound repertoire moves and corrects meaningful mistakes', () => {
  const games=[{id:'g1',analysis:{moves:[
    {phase:'opening',fen:start,color:'white',moveNumber:1,playedUci:'e2e4',playedSan:'e4',bestUci:'e2e4',bestSan:'e4',classification:'best_or_near_best',cpLoss:0},
    {phase:'opening',fen:after,color:'white',moveNumber:2,playedUci:'f2f4',playedSan:'f4',bestUci:'g1f3',bestSan:'Nf3',classification:'mistake',cpLoss:180},
    {phase:'middlegame',fen:'ignored',color:'white',moveNumber:12,playedUci:'a2a3',playedSan:'a3',bestUci:'a2a3',bestSan:'a3',classification:'best_or_near_best',cpLoss:0}
  ]}}];
  const items=buildOpeningItems(games);
  assert.equal(items.length,2);
  const first=items.find(x=>x.fen===start);
  const correction=items.find(x=>x.fen===after);
  assert.equal(first.expectedUci,'e2e4');
  assert.equal(first.corrected,false);
  assert.equal(correction.expectedUci,'g1f3');
  assert.equal(correction.expectedSan,'Nf3');
  assert.equal(correction.corrected,true);
});

test('opening queue prioritizes due positions and respects side filters', () => {
  const games=[{id:'g1',analysis:{moves:[
    {phase:'opening',fen:start,color:'white',moveNumber:1,playedUci:'e2e4',playedSan:'e4',bestUci:'e2e4',bestSan:'e4',classification:'best_or_near_best',cpLoss:0},
    {phase:'opening',fen:after,color:'white',moveNumber:2,playedUci:'g1f3',playedSan:'Nf3',bestUci:'g1f3',bestSan:'Nf3',classification:'best_or_near_best',cpLoss:0}
  ]}}];
  const items=buildOpeningItems(games);
  const now=10*DAY;
  const due=items[1];
  const records={
    [due.id]:{...emptyMastery(due.id),attempts:2,mastery:30,nextReviewAt:now-DAY}
  };
  const queue=openingQueue(items,records,{filter:'for_you',color:'white',limit:10});
  assert.equal(queue[0].id,due.id);
  assert.equal(openingQueue(items,records,{filter:'for_you',color:'black',limit:10}).length,0);
});
