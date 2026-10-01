export const MINUTE = 60_000;
export const DAY = 24 * 60 * MINUTE;

export function emptyMastery(id) {
  return {
    id,
    attempts: 0,
    correct: 0,
    incorrect: 0,
    streak: 0,
    mastery: 0,
    intervalDays: 0,
    nextReviewAt: 0,
    lastReviewedAt: null,
    lastResult: null,
    firstSeenAt: null,
    totalResponseMs: 0,
    hintsUsed: 0
  };
}

export function normalizeMastery(record, id) {
  return { ...emptyMastery(id), ...(record || {}), id };
}

export function recordPuzzleAttempt(record, {
  correct,
  firstTry = true,
  hints = 0,
  responseMs = 0,
  now = Date.now()
}) {
  const r = normalizeMastery(record, record?.id || '');
  r.attempts += 1;
  r.firstSeenAt ||= now;
  r.lastReviewedAt = now;
  r.totalResponseMs += Math.max(0, Number(responseMs) || 0);
  r.hintsUsed += Math.max(0, Number(hints) || 0);

  if (!correct) {
    r.incorrect += 1;
    r.streak = 0;
    r.intervalDays = 0;
    r.nextReviewAt = now + 10 * MINUTE;
    r.lastResult = 'incorrect';
    r.mastery = Math.max(0, Math.round((r.mastery || 0) - 12));
    return r;
  }

  r.correct += 1;
  const assisted = !firstTry || hints > 0;
  r.streak = assisted ? Math.max(1, r.streak) : r.streak + 1;

  if (assisted) {
    r.intervalDays = 1;
  } else {
    const intervals = [1, 3, 7, 14, 30, 60, 90];
    r.intervalDays = intervals[Math.min(Math.max(r.streak - 1, 0), intervals.length - 1)];
  }
  r.nextReviewAt = now + r.intervalDays * DAY;
  r.lastResult = assisted ? 'correct_assisted' : 'correct';

  const accuracy = r.attempts ? r.correct / r.attempts : 0;
  const streakComponent = Math.min(42, r.streak * 14);
  const accuracyComponent = Math.round(accuracy * 38);
  const exposureComponent = Math.min(20, r.attempts * 4);
  r.mastery = Math.min(100, Math.round(streakComponent + accuracyComponent + exposureComponent));
  return r;
}

export function masteryStatus(record, now = Date.now()) {
  if (!record || !record.attempts) return 'new';
  if ((record.nextReviewAt || 0) <= now) return 'due';
  if ((record.mastery || 0) >= 80 && (record.streak || 0) >= 3) return 'mastered';
  return 'learning';
}

export function puzzlePriority(item, record, now = Date.now()) {
  const r = normalizeMastery(record, item.id);
  const status = masteryStatus(r, now);
  const severity = Math.min(500, Number(item.cpLoss) || 0);
  if (status === 'due') {
    const overdueHours = Math.max(0, now - (r.nextReviewAt || 0)) / (60 * MINUTE);
    return 10_000 + Math.min(2_000, overdueHours * 8) + (100 - r.mastery) * 10 + severity;
  }
  if (status === 'new') return 7_000 + severity;
  if (status === 'learning') return 3_000 + (100 - r.mastery) * 8 + severity / 2;
  return 500 + (100 - r.mastery) + severity / 10;
}

export function prioritizePuzzles(items, records = {}, now = Date.now()) {
  return [...items].sort((a, b) =>
    puzzlePriority(b, records[b.id], now) - puzzlePriority(a, records[a.id], now)
  );
}

export function masterySummary(items, records = {}, now = Date.now()) {
  const summary = { total: items.length, new: 0, due: 0, learning: 0, mastered: 0 };
  for (const item of items) summary[masteryStatus(records[item.id], now)] += 1;
  return summary;
}
