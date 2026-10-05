import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Chess } from 'chess.js';

const raw = JSON.parse(fs.readFileSync(new URL('../evals/coach-cases.json', import.meta.url),'utf8'));

test('all coach eval move sequences are legal and IDs are unique', () => {
  const ids = new Set();
  for (const c of raw.cases) {
    assert.ok(c.id, 'case missing id');
    assert.equal(ids.has(c.id), false, 'duplicate case id: ' + c.id);
    ids.add(c.id);
    const game = new Chess();
    const records = [];
    for (const san of c.moves || []) {
      const fenBefore = game.fen();
      const move = game.move(san);
      assert.ok(move, c.id + ': illegal move ' + san);
      records.push({san:move.san,fenBefore,uci:move.from+move.to+(move.promotion||'')});
    }
    if (c.lastDecisionMove) {
      assert.ok(records.some(r=>r.san===c.lastDecisionMove), c.id + ': lastDecisionMove not found');
    }
  }
});

test('candidate-challenge evals identify a legal candidate in their requested scope', () => {
  for (const c of raw.cases.filter(x=>x.challengeSan)) {
    const game = new Chess();
    const records = [];
    for (const san of c.moves || []) {
      const fenBefore = game.fen();
      const move = game.move(san);
      records.push({san:move.san,fenBefore,uci:move.from+move.to+(move.promotion||'')});
    }
    let fen = game.fen();
    if ((c.challengeScope || 'current') === 'last_decision') {
      const decision = [...records].reverse().find(r=>r.san===c.lastDecisionMove);
      assert.ok(decision, c.id + ': no last decision for challenge');
      fen = decision.fenBefore;
    }
    const position = new Chess(fen);
    const move = position.move(c.challengeSan);
    assert.ok(move, c.id + ': challenge move is not legal in scope: ' + c.challengeSan);
  }
});
