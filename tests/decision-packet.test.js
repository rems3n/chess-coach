import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDecisionPacket, classifyLoss } from '../lib/decision-packet.mjs';

const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

test('decision packet preserves reasonable alternatives instead of calling every non-best move bad', () => {
  const packet = buildDecisionPacket({
    fen:start,
    topLines:[
      { multipv:1, depth:16, score:{type:'cp',value:32}, pv:['e2e4','e7e5','g1f3'] },
      { multipv:2, depth:16, score:{type:'cp',value:25}, pv:['d2d4','d7d5','g1f3'] },
      { multipv:3, depth:16, score:{type:'cp',value:18}, pv:['g1f3','d7d5','d2d4'] }
    ],
    playedLine:{ multipv:1, depth:16, score:{type:'cp',value:25}, pv:['d2d4','d7d5','g1f3'] },
    playedUci:'d2d4',
    rating:1500
  });

  assert.equal(packet.bestMove.san, 'e4');
  assert.equal(packet.playedMove.san, 'd4');
  assert.equal(packet.playedMove.candidateRank, 2);
  assert.equal(packet.cpLoss, 7);
  assert.equal(packet.classification, 'best_or_near_best');
  assert.equal(packet.practical.reasonable, true);
  assert.equal(packet.reasonType, 'none');
  assert.deepEqual(packet.comparison.bestContinuation.slice(0,3), ['e4','e5','Nf3']);
  assert.deepEqual(packet.comparison.playedContinuation.slice(0,3), ['d4','d5','Nf3']);
});

test('decision packet marks forcing tactical misses separately from positional errors', () => {
  const fen = '6k1/5ppp/8/8/8/8/5PPP/6K1 w - - 0 1';
  const packet = buildDecisionPacket({
    fen,
    topLines:[
      { multipv:1, depth:16, score:{type:'cp',value:250}, pv:['g2g4','g7g6','g4g5'] },
      { multipv:2, depth:16, score:{type:'cp',value:80}, pv:['f2f4','g7g6','g1f2'] }
    ],
    playedLine:{ multipv:1, depth:16, score:{type:'cp',value:80}, pv:['f2f4','g7g6','g1f2'] },
    playedUci:'f2f4',
    rating:1500
  });

  assert.equal(classifyLoss(packet.cpLoss), 'mistake');
  assert.equal(packet.practical.reasonable, true);
  assert.ok(['positional_or_practical','tactical'].includes(packet.reasonType));
});

test('decision packet includes the fields required by coaching workflow', () => {
  const packet = buildDecisionPacket({
    fen:start,
    topLines:[{ multipv:1, depth:16, score:{type:'cp',value:30}, pv:['e2e4','e7e5'] }],
    playedLine:{ multipv:1, depth:16, score:{type:'cp',value:-260}, pv:['f2f3','e7e5'] },
    playedUci:'f2f3',
    rating:1500
  });

  assert.ok(packet.bestMove);
  assert.ok(Array.isArray(packet.topCandidates));
  assert.ok(packet.playedMove);
  assert.equal(typeof packet.cpLoss, 'number');
  assert.ok(packet.classification);
  assert.ok(packet.reasonType);
  assert.equal(typeof packet.practical.reasonable, 'boolean');
  assert.ok(Array.isArray(packet.comparison.bestContinuation));
  assert.ok(Array.isArray(packet.comparison.playedContinuation));
  assert.ok(packet.comparison.explanationGuardrail);
});
