import { Chess } from 'chess.js';
import { scoreNumber } from './stockfish.mjs';

export function uciToSan(fen, uci) {
  if (!uci || uci === '(none)') return null;
  try {
    const game = new Chess(fen);
    return game.move({ from:uci.slice(0,2), to:uci.slice(2,4), promotion:uci[4] || 'q' })?.san || null;
  } catch { return null; }
}

export function pvToSan(fen, pv = [], limit = 10) {
  const game = new Chess(fen), out = [];
  for (const uci of pv.slice(0, limit)) {
    try {
      const move = game.move({ from:uci.slice(0,2), to:uci.slice(2,4), promotion:uci[4] || 'q' });
      if (!move) break;
      out.push(move.san);
    } catch { break; }
  }
  return out;
}

export function classifyLoss(cpLoss) {
  if (cpLoss <= 25) return 'best_or_near_best';
  if (cpLoss <= 60) return 'small_inaccuracy';
  if (cpLoss <= 120) return 'inaccuracy';
  if (cpLoss <= 250) return 'mistake';
  return 'blunder';
}

function forcingSan(san='') {
  return /[x+#]/.test(san);
}

function lineHasForcingMoves(lineSan = [], plies = 4) {
  return lineSan.slice(0, plies).some(forcingSan);
}

function inferReason(best, played, cpLoss) {
  const bestLine = best?.lineSan || [];
  const playedLine = played?.lineSan || [];
  const bestForcing = forcingSan(best?.san) || lineHasForcingMoves(bestLine, 4);
  const playedForcing = lineHasForcingMoves(playedLine, 4);
  if (bestForcing && cpLoss >= 50) return 'tactical';
  if (cpLoss >= 180 && (bestForcing || playedForcing)) return 'tactical';
  if (cpLoss <= 40) return 'none';
  return 'positional_or_practical';
}

function practicalAssessment(cpLoss, classification, candidateRank, rating = 1500) {
  const tolerance = rating < 1400 ? 90 : rating < 1800 ? 70 : 50;
  const reasonable = cpLoss <= tolerance || (candidateRank && candidateRank <= 3 && classification !== 'blunder');
  if (reasonable) return {
    reasonable:true,
    label:'practically_reasonable',
    rationale: candidateRank && candidateRank <= 3
      ? 'The move is among the engine’s top practical candidates for this position.'
      : `The move is within about ${tolerance} centipawns of best, a reasonable practical tolerance for this training level.`
  };
  return {
    reasonable:false,
    label:classification,
    rationale: classification === 'blunder'
      ? 'The move creates a large objective loss and should be treated as a concrete error.'
      : 'The move falls outside the practical candidate band for this training level.'
  };
}

export function buildDecisionPacket({ fen, topLines = [], playedLine = null, playedUci = null, rating = 1500, maxCandidates = 5 }) {
  const normalized = topLines.slice(0, maxCandidates).map((line, index) => ({
    rank:line.multipv || index + 1,
    uci:line.pv?.[0] || null,
    san:uciToSan(fen,line.pv?.[0]),
    score:line.score || null,
    lineUci:(line.pv || []).slice(0,10),
    lineSan:pvToSan(fen,line.pv || [],10),
    depth:line.depth || null
  }));
  const best = normalized[0] || null;
  const bestScore = scoreNumber(topLines[0]?.score);
  const playedScore = scoreNumber(playedLine?.score);
  const cpLoss = playedLine ? Math.max(0, Math.round(bestScore - playedScore)) : null;
  const playedSan = playedUci ? uciToSan(fen,playedUci) : null;
  const rankMatch = playedUci ? normalized.find(x => x.uci === playedUci) : null;
  const played = playedUci ? {
    uci:playedUci,
    san:playedSan,
    score:playedLine?.score || null,
    cpLoss,
    candidateRank:rankMatch?.rank || null,
    lineUci:(playedLine?.pv || []).slice(0,10),
    lineSan:pvToSan(fen,playedLine?.pv || [],10)
  } : null;
  const classification = cpLoss == null ? null : classifyLoss(cpLoss);
  const reasonType = played ? inferReason(best, played, cpLoss) : null;
  const practical = played ? practicalAssessment(cpLoss, classification, played.candidateRank, rating) : null;

  return {
    fen,
    bestMove:best,
    topCandidates:normalized,
    playedMove:played,
    cpLoss,
    classification,
    reasonType,
    practical,
    forcingOpportunity:!!best?.san && forcingSan(best.san),
    comparison:{
      bestContinuation:best?.lineSan || [],
      playedContinuation:played?.lineSan || [],
      explanationGuardrail: reasonType === 'tactical'
        ? 'Any tactical explanation must be supported by the verified continuations above.'
        : 'Do not call this a tactical mistake unless a verified continuation demonstrates a concrete tactic.'
    }
  };
}
