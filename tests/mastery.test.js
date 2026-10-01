import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY, MINUTE, emptyMastery, recordPuzzleAttempt, masteryStatus, prioritizePuzzles } from '../public/mastery.js';

test('incorrect puzzle returns quickly for review', () => {
  const now = 1_000_000;
  const r = recordPuzzleAttempt(emptyMastery('a'), { correct:false, now });
  assert.equal(r.streak, 0);
  assert.equal(r.nextReviewAt, now + 10 * MINUTE);
  assert.equal(masteryStatus(r, now), 'learning');
  assert.equal(masteryStatus(r, now + 10 * MINUTE), 'due');
});

test('clean correct streak expands intervals', () => {
  let now = 1_000_000;
  let r = emptyMastery('a');
  r = recordPuzzleAttempt(r, { correct:true, firstTry:true, now });
  assert.equal(r.intervalDays, 1);
  now += DAY;
  r = recordPuzzleAttempt(r, { correct:true, firstTry:true, now });
  assert.equal(r.intervalDays, 3);
  now += 3 * DAY;
  r = recordPuzzleAttempt(r, { correct:true, firstTry:true, now });
  assert.equal(r.intervalDays, 7);
  assert.ok(r.mastery > 50);
});

test('assisted solve schedules short reinforcement', () => {
  const r = recordPuzzleAttempt(emptyMastery('a'), { correct:true, firstTry:false, hints:1, now:1_000_000 });
  assert.equal(r.intervalDays, 1);
  assert.equal(r.lastResult, 'correct_assisted');
});

test('due puzzles rank ahead of new and mastered', () => {
  const now = 10 * DAY;
  const items = [{id:'due',cpLoss:120},{id:'new',cpLoss:300},{id:'mastered',cpLoss:400}];
  const records = {
    due:{...emptyMastery('due'),attempts:2,mastery:35,nextReviewAt:now-DAY,streak:0},
    mastered:{...emptyMastery('mastered'),attempts:5,correct:5,mastery:90,nextReviewAt:now+30*DAY,streak:4}
  };
  const out = prioritizePuzzles(items, records, now);
  assert.equal(out[0].id, 'due');
  assert.equal(out[1].id, 'new');
  assert.equal(out[2].id, 'mastered');
});
