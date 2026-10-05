import { Chess } from 'chess.js';
import { StockfishSession } from './stockfish.mjs';
import { buildDecisionPacket } from './decision-packet.mjs';

function uci(move) { return move.from + move.to + (move.promotion || ''); }
function phase(c) {
  const pieces = c.board().flat().filter(Boolean);
  const queens = pieces.filter(p => p.type === 'q').length;
  const material = pieces.reduce((n,p)=>n+({p:1,n:3,b:3,r:5,q:9,k:0}[p.type]||0),0);
  const fullmove = Number(c.fen().split(' ')[5] || 1);
  if (fullmove <= 10) return 'opening';
  if (queens === 0 || material <= 24) return 'endgame';
  return 'middlegame';
}

export async function analyzeGame({ pgn, color, username, depth = 9, maxPlayerMoves = 18 }) {
  if (!pgn || typeof pgn !== 'string') throw new Error('PGN is required');
  const parsed = new Chess();
  parsed.loadPgn(pgn, { strict: false });
  const header = parsed.header();
  const history = parsed.history({ verbose: true });
  let playerColor = color === 'black' ? 'b' : color === 'white' ? 'w' : null;
  if (!playerColor && username) {
    const u = username.toLowerCase();
    if ((header.White || '').toLowerCase() === u) playerColor = 'w';
    if ((header.Black || '').toLowerCase() === u) playerColor = 'b';
  }
  playerColor ||= 'w';
  const replay = header.FEN ? new Chess(header.FEN) : new Chess();
  const engine = await new StockfishSession().init();
  const moves = [];
  let analyzed = 0;
  try {
    for (let ply = 0; ply < history.length; ply++) {
      const move = history[ply];
      if (replay.turn() === playerColor && analyzed < maxPlayerMoves) {
        const fen = replay.fen();
        const moveUci = uci(move);
        const best = await engine.analyze(fen, { depth, multiPv: 3 });
        let playedLine = best.lines.find(x => x.pv?.[0] === moveUci);
        if (!playedLine) {
          const forced = await engine.analyze(fen, { depth, multiPv: 1, searchMoves: [moveUci] });
          playedLine = forced.lines[0];
        }
        const rating = Number((playerColor === 'w' ? header.WhiteElo : header.BlackElo) || 1500) || 1500;
        const decision = buildDecisionPacket({
          fen,
          topLines: best.lines,
          playedLine,
          playedUci: moveUci,
          rating,
          maxCandidates: 3
        });
        moves.push({
          ply: ply + 1,
          moveNumber: Math.floor(ply / 2) + 1,
          color: playerColor === 'w' ? 'white' : 'black',
          fen,
          playedSan: move.san,
          playedUci: moveUci,
          bestSan: decision.bestMove?.san || null,
          bestUci: decision.bestMove?.uci || null,
          cpLoss: decision.cpLoss,
          classification: decision.classification,
          phase: phase(replay),
          bestScore: decision.bestMove?.score || null,
          playedScore: decision.playedMove?.score || null,
          bestLineSan: decision.comparison.bestContinuation.slice(0,6),
          bestLineUci: decision.bestMove?.lineUci?.slice(0,6) || [],
          forcingOpportunity: decision.forcingOpportunity,
          reasonType: decision.reasonType,
          practical: decision.practical,
          decision
        });
        analyzed++;
      }
      replay.move(move.san);
    }
  } finally { engine.close(); }
  const relevant = moves.filter(m => ['inaccuracy','mistake','blunder'].includes(m.classification));
  const counts = moves.reduce((a,m)=>(a[m.classification]=(a[m.classification]||0)+1,a),{});
  const phaseLoss = ['opening','middlegame','endgame'].map(p => {
    const xs = moves.filter(m=>m.phase===p);
    return { phase:p, moves:xs.length, avgCpLoss:xs.length?Math.round(xs.reduce((n,m)=>n+m.cpLoss,0)/xs.length):null };
  });
  return {
    engine: { name:'Stockfish', depth, maxPlayerMoves },
    playerColor: playerColor === 'w' ? 'white' : 'black',
    analyzedMoves: moves.length,
    counts,
    phaseLoss,
    missedForcing: relevant.filter(m => m.forcingOpportunity).length,
    averageCpLoss: moves.length ? Math.round(moves.reduce((n,m)=>n+m.cpLoss,0)/moves.length) : 0,
    criticalPositions: relevant.sort((a,b)=>b.cpLoss-a.cpLoss).slice(0,8),
    moves
  };
}
