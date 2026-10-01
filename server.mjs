import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeFen } from './lib/stockfish.mjs';
import { analyzeGame } from './lib/game-analysis.mjs';
import { coachResponse } from './lib/coach.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const port = Number(process.env.PORT || 3000);

const json = (res, status, body) => {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*'
  });
  res.end(JSON.stringify(body));
};

async function readJson(req, maxBytes = 3_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('Request too large');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

async function chessComImport(username) {
  const clean = username.trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,50}$/i.test(clean)) throw new Error('Invalid Chess.com username');
  const headers = { 'User-Agent': 'ChessCoachMVP/0.1 (personal training app)' };
  const [profileRes, statsRes, archivesRes] = await Promise.all([
    fetch(`https://api.chess.com/pub/player/${encodeURIComponent(clean)}`, { headers }),
    fetch(`https://api.chess.com/pub/player/${encodeURIComponent(clean)}/stats`, { headers }),
    fetch(`https://api.chess.com/pub/player/${encodeURIComponent(clean)}/games/archives`, { headers })
  ]);
  if (profileRes.status === 404) throw new Error('Chess.com user not found');
  if (!profileRes.ok || !statsRes.ok || !archivesRes.ok) throw new Error('Chess.com API request failed');
  const [profile, stats, archivesJson] = await Promise.all([profileRes.json(), statsRes.json(), archivesRes.json()]);
  const archives = archivesJson.archives || [];
  const selected = archives.slice(-3).reverse();
  const games = [];
  for (const archive of selected) {
    const r = await fetch(archive, { headers });
    if (!r.ok) continue;
    const data = await r.json();
    for (const g of (data.games || []).slice().reverse()) {
      if (games.length >= 60) break;
      const isWhite = (g.white?.username || '').toLowerCase() === clean;
      const me = isWhite ? g.white : g.black;
      const opp = isWhite ? g.black : g.white;
      games.push({
        id: g.uuid || `${g.end_time}-${games.length}`,
        url: g.url,
        pgn: g.pgn,
        timeClass: g.time_class,
        timeControl: g.time_control,
        endTime: g.end_time,
        color: isWhite ? 'white' : 'black',
        rating: me?.rating ?? null,
        opponent: opp?.username || 'Unknown',
        opponentRating: opp?.rating ?? null,
        result: me?.result || '',
        rated: !!g.rated
      });
    }
    if (games.length >= 60) break;
  }
  return { profile, stats, games };
}

const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/health') return json(res, 200, { ok: true, service: 'chess-coach-mvp' });
    if (url.pathname === '/api/chesscom') {
      const username = url.searchParams.get('username') || '';
      try { return json(res, 200, await chessComImport(username)); }
      catch (err) { return json(res, 400, { error: err.message || 'Import failed' }); }
    }
    if (url.pathname === '/api/analyze-position' && req.method === 'POST') {
      try {
        const body = await readJson(req);
        if (!body.fen) throw new Error('FEN is required');
        const result = await analyzeFen(body.fen, {
          depth: Number(body.depth || 10),
          multiPv: Number(body.multiPv || 3)
        });
        return json(res, 200, result);
      } catch (err) { return json(res, 400, { error: err.message || 'Position analysis failed' }); }
    }
    if (url.pathname === '/api/analyze-game' && req.method === 'POST') {
      try {
        const body = await readJson(req);
        const result = await analyzeGame({
          pgn: body.pgn,
          color: body.color,
          username: body.username,
          depth: Number(body.depth || 9),
          maxPlayerMoves: Number(body.maxPlayerMoves || 18)
        });
        return json(res, 200, result);
      } catch (err) { return json(res, 400, { error: err.message || 'Game analysis failed' }); }
    }
    if (url.pathname === '/api/opponent-move' && req.method === 'POST') {
      try {
        const body = await readJson(req);
        if (!body.fen) throw new Error('FEN is required');
        const result = await analyzeFen(body.fen, {
          multiPv: 1,
          elo: Number(body.elo || 1450),
          movetime: Number(body.movetime || 180)
        });
        return json(res, 200, { move: result.bestmove, analysis: result.lines[0] || null, elo: Number(body.elo || 1450) });
      } catch (err) { return json(res, 400, { error: err.message || 'Opponent move failed' }); }
    }
    if (url.pathname === '/api/coach' && req.method === 'POST') {
      try {
        const body = await readJson(req);
        const engineFen = body.fenBefore || body.fen || body.currentFen;
        let engine = null;
        let played = null;
        if (engineFen) {
          engine = await analyzeFen(engineFen, { depth: Number(body.depth || 9), multiPv: 3 });
          if (body.lastMoveUci && body.fenBefore) {
            played = await analyzeFen(body.fenBefore, {
              depth: Number(body.depth || 9),
              multiPv: 1,
              searchMoves: [body.lastMoveUci]
            });
          }
        }
        const context = {
          event: body.event || 'user_question',
          mode: body.mode || 'normal',
          currentFen: body.currentFen || body.fen || null,
          fenBefore: body.fenBefore || null,
          lastMoveSan: body.lastMoveSan || null,
          lastMoveUci: body.lastMoveUci || null,
          recentMoves: Array.isArray(body.recentMoves) ? body.recentMoves.slice(-20) : [],
          conversation: Array.isArray(body.messages) ? body.messages.slice(-12) : [],
          studentProfile: body.studentProfile || {
            approximateRating: '1200-1500 online',
            nextGoal: 1800,
            longTermGoal: 2000,
            currentPriorities: ['candidate generation','defensive awareness','calculation discipline']
          },
          engine: engine ? { bestmove: engine.bestmove, lines: engine.lines.slice(0,3), played: played?.lines?.[0] || null } : null
        };
        try {
          const coach = await coachResponse(context);
          return json(res, 200, { coach, engine: context.engine, model: process.env.OPENAI_MODEL || 'gpt-5.6-terra' });
        } catch (err) {
          if (err.code === 'MISSING_OPENAI_KEY') return json(res, 503, { error: err.message, missingKey: true, engine: context.engine });
          throw err;
        }
      } catch (err) { return json(res, 400, { error: err.message || 'Coach request failed' }); }
    }
    let filePath = url.pathname === '/' ? path.join(publicDir, 'index.html') : path.join(publicDir, url.pathname);
    if (!filePath.startsWith(publicDir)) return json(res, 403, { error: 'Forbidden' });
    try {
      const body = await fs.readFile(filePath);
      res.writeHead(200, { 'content-type': mime[path.extname(filePath)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      const body = await fs.readFile(path.join(publicDir, 'index.html'));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(body);
    }
  } catch (err) {
    json(res, 500, { error: err.message || 'Server error' });
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Chess Coach listening on ${port}`);
  analyzeFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', { depth: 6, multiPv: 1 })
    .then(r => console.log(`Stockfish self-test OK: ${r.bestmove || 'analysis returned'}`))
    .catch(err => console.error('Stockfish self-test failed:', err.message));
});
