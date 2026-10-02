import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeFen } from './lib/stockfish.mjs';
import { Chess } from 'chess.js';
import { analyzeGame } from './lib/game-analysis.mjs';
import { coachResponse } from './lib/coach.mjs';
import { generateProfilePlan } from './lib/profile.mjs';
import { generateLesson } from './lib/lesson.mjs';
import { initDb } from './lib/db.mjs';
import { register, login, logout, currentUser, requireUser, getState, putState, updateProfile, clearSessionCookie } from './lib/auth.mjs';

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
    if (url.pathname === '/api/auth/me' && req.method === 'GET') {
      try {
        const user = await currentUser(req);
        return json(res, 200, { user });
      } catch (err) { return json(res, 500, { error: err.message || 'Account lookup failed' }); }
    }
    if (url.pathname === '/api/auth/register' && req.method === 'POST') {
      try {
        const body = await readJson(req, 100_000);
        const result = await register(req, {
          email: body.email,
          password: body.password,
          displayName: body.displayName
        });
        res.setHeader('Set-Cookie', result.cookie);
        return json(res, 201, { user: result.user });
      } catch (err) { return json(res, 400, { error: err.message || 'Registration failed' }); }
    }
    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      try {
        const body = await readJson(req, 100_000);
        const result = await login(req, { email: body.email, password: body.password });
        res.setHeader('Set-Cookie', result.cookie);
        return json(res, 200, { user: result.user });
      } catch (err) { return json(res, 401, { error: err.message || 'Login failed' }); }
    }
    if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
      try { await logout(req); } catch {}
      res.setHeader('Set-Cookie', clearSessionCookie(req));
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/account/state' && req.method === 'GET') {
      try {
        const user = await requireUser(req);
        const row = await getState(user.id);
        return json(res, 200, { state: row.state || {}, updated_at: row.updated_at || null });
      } catch (err) { return json(res, err.statusCode || 500, { error: err.message || 'State lookup failed' }); }
    }
    if (url.pathname === '/api/account/state' && req.method === 'PUT') {
      try {
        const user = await requireUser(req);
        const body = await readJson(req, 8_000_000);
        const row = await putState(user.id, body.state || {});
        return json(res, 200, { ok: true, updated_at: row.updated_at });
      } catch (err) { return json(res, err.statusCode || 500, { error: err.message || 'State save failed' }); }
    }
    if (url.pathname === '/api/account/profile' && req.method === 'PATCH') {
      try {
        const user = await requireUser(req);
        const body = await readJson(req, 100_000);
        const updated = await updateProfile(user.id, {
          displayName: body.displayName,
          goals: body.goals,
          chesscomUsername: body.chesscomUsername
        });
        return json(res, 200, { user: updated });
      } catch (err) { return json(res, err.statusCode || 400, { error: err.message || 'Profile update failed' }); }
    }
    if (url.pathname === '/api/account/chesscom' && req.method === 'POST') {
      try {
        const user = await requireUser(req);
        const body = await readJson(req, 100_000);
        const username = String(body.username || user.chesscom_username || '').trim();
        if (!username) throw new Error('Enter a Chess.com username');
        const imported = await chessComImport(username);
        const updated = await updateProfile(user.id, { chesscomUsername: username });
        return json(res, 200, { user: updated, ...imported });
      } catch (err) { return json(res, err.statusCode || 400, { error: err.message || 'Chess.com connection failed' }); }
    }
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
    if (url.pathname === '/api/realtime-session' && req.method === 'POST') {
      try {
        if (!process.env.OPENAI_API_KEY) return json(res, 503, { error:'OPENAI_API_KEY is not configured', missingKey:true });
        const body = await readJson(req, 1_000_000);
        if (!body.sdp || typeof body.sdp !== 'string') throw new Error('SDP offer is required');
        const coachingPrompt = await fs.readFile(path.join(__dirname, 'coach-system-prompt.md'), 'utf8');
        const context = body.context || {};
        const sessionConfig = JSON.stringify({
          type:'realtime',
          model:process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-2.1-mini',
          instructions:`${coachingPrompt}

VOICE MODE:
- Speak naturally and concisely.
- The student may think aloud while playing. Listen to the reasoning, not just the final move.
- Do not narrate every move or centipawn change.
- Ask one useful question at a time when discovery will help.
- If the student asks a direct question, answer it directly.
- Current app context at session start:
${JSON.stringify(context)}
- The app may send later text-only context update items containing newer board/profile state. Treat those as private coaching context; do not answer the context-update item itself unless the student then asks about it.
`,
          output_modalities:['audio'],
          audio:{input:{turn_detection:{type:'semantic_vad'}},output:{voice:process.env.OPENAI_VOICE || 'marin'}}
        });
        const fd = new FormData();
        fd.set('sdp', body.sdp);
        fd.set('session', sessionConfig);
        const r = await fetch('https://api.openai.com/v1/realtime/calls',{
          method:'POST',
          headers:{
            Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,
            'OpenAI-Safety-Identifier':'chess-coach-personal-user'
          },
          body:fd
        });
        const answer = await r.text();
        if(!r.ok) return json(res,r.status,{error:answer||'Realtime session creation failed'});
        return json(res,201,{sdp:answer,model:process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-2.1-mini',voice:process.env.OPENAI_VOICE || 'marin'});
      } catch(err){ return json(res,400,{error:err.message||'Realtime session failed'}); }
    }
    if (url.pathname === '/api/lesson' && req.method === 'POST') {
      try {
        const body = await readJson(req);
        if (!body.topic) throw new Error('Lesson topic is required');
        const result = await generateLesson({
          topic: String(body.topic),
          profile: body.profile || null,
          coachingEvidence: Array.isArray(body.coachingEvidence) ? body.coachingEvidence : []
        });
        return json(res, 200, result);
      } catch (err) { return json(res, 400, { error: err.message || 'Lesson generation failed' }); }
    }
    if (url.pathname === '/api/profile-plan' && req.method === 'POST') {
      try {
        const body = await readJson(req);
        const result = await generateProfilePlan({
          goals: body.goals || { next:1800, longTerm:2000 },
          analyzedGames: Array.isArray(body.analyzedGames) ? body.analyzedGames.slice(0,40) : [],
          coachingEvidence: Array.isArray(body.coachingEvidence) ? body.coachingEvidence.slice(-100) : [],
          currentProfile: body.currentProfile || null
        });
        return json(res, 200, result);
      } catch (err) { return json(res, 400, { error: err.message || 'Profile generation failed' }); }
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
    if (url.pathname === '/api/coach-gate' && req.method === 'POST') {
      try {
        const body = await readJson(req);
        if (!body.fenBefore || !body.lastMoveUci) throw new Error('Move context is required');
        const mode = body.mode || 'normal';
        if (mode === 'assessment' || mode === 'ask_only') {
          return json(res, 200, { shouldIntervene:false, pauseRecommended:false, reason:'mode_silent' });
        }
        const [top, played] = await Promise.all([
          analyzeFen(body.fenBefore, { depth:11, multiPv:3 }),
          analyzeFen(body.fenBefore, { depth:11, multiPv:1, searchMoves:[body.lastMoveUci] })
        ]);
        const best = top.lines[0];
        const playedLine = played.lines[0];
        const scoreNumberLocal = score => {
          if (!score) return 0;
          if (score.type === 'cp') return score.value;
          return score.value > 0 ? 100000 - Math.min(Math.abs(score.value),999)*100 : -100000 + Math.min(Math.abs(score.value),999)*100;
        };
        const cpLoss = Math.max(0, Math.round(scoreNumberLocal(best?.score) - scoreNumberLocal(playedLine?.score)));
        const threshold = mode === 'guided' ? 60 : mode === 'minimal' ? 220 : 120;
        const shouldIntervene = !!body.retryContext || cpLoss >= threshold;
        const bestUci = best?.pv?.[0] || null;
        const bestSan = bestUci ? (() => {
          try {
            const game = new Chess(body.fenBefore);
            return game.move({from:bestUci.slice(0,2),to:bestUci.slice(2,4),promotion:bestUci[4]||'q'})?.san || null;
          } catch { return null; }
        })() : null;
        const forcing = !!bestSan && /[x+#]/.test(bestSan);
        const classification = cpLoss >= 250 ? 'blunder' : cpLoss >= 120 ? 'mistake' : cpLoss >= 60 ? 'inaccuracy' : 'near_best';
        let prompt = '';
        if (shouldIntervene) {
          if (body.retryContext) prompt = `Retry recorded for ${body.lastMoveSan || 'your move'}. I’ll compare it with the original decision.`;
          else if (classification === 'blunder') prompt = `I flagged ${body.lastMoveSan || 'that move'} as a major error. Keep playing; I’ll save the position for review.`;
          else if (forcing) prompt = `I flagged ${body.lastMoveSan || 'that move'}: there was a forcing resource in the position. Keep playing; we’ll review it.`;
          else prompt = `I flagged ${body.lastMoveSan || 'that move'} as an instructive decision. Keep playing; we’ll review it.`;
        }
        return json(res, 200, {
          shouldIntervene,
          pauseRecommended: mode === 'guided' && shouldIntervene,
          cpLoss,
          classification,
          forcing,
          bestMoveSan: bestSan,
          prompt,
          engineDepth: best?.depth || 11
        });
      } catch (err) { return json(res, 400, { error: err.message || 'Coach gate failed' }); }
    }
    if (url.pathname === '/api/coach' && req.method === 'POST') {
      try {
        const body = await readJson(req);
        if (!process.env.OPENAI_API_KEY) return json(res, 503, { error: 'OPENAI_API_KEY is not configured', missingKey: true });
        const context = {
          event: body.event || 'user_question',
          mode: body.mode || 'normal',
          currentFen: body.currentFen || body.fen || null,
          fenBefore: body.fenBefore || null,
          lastMoveSan: body.lastMoveSan || null,
          lastMoveUci: body.lastMoveUci || null,
          recentMoves: Array.isArray(body.recentMoves) ? body.recentMoves.slice(-20) : [],
          conversation: Array.isArray(body.messages) ? body.messages.slice(-12) : [],
          reviewContext: body.reviewContext || null,
          retryContext: body.retryContext || null,
          studentProfile: body.studentProfile || {
            approximateRating: '1200-1500 online',
            nextGoal: 1800,
            longTermGoal: 2000,
            currentPriorities: ['candidate generation','defensive awareness','calculation discipline']
          }
        };
        try {
          const coach = await coachResponse(context);
          return json(res, 200, { coach, model: process.env.OPENAI_COACH_MODEL || 'gpt-5.6-sol' });
        } catch (err) {
          if (err.code === 'MISSING_OPENAI_KEY') return json(res, 503, { error: err.message, missingKey: true });
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

async function startServer() {
  if (process.env.DATABASE_URL) {
    await initDb();
    console.log('Account database ready');
  } else {
    console.warn('DATABASE_URL not configured; account features disabled');
  }

  server.listen(port, '0.0.0.0', () => {
    console.log(`Chess Coach listening on ${port}`);
    analyzeFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', { depth: 6, multiPv: 1 })
      .then(r => console.log(`Stockfish self-test OK: ${r.bestmove || 'analysis returned'}`))
      .catch(err => console.error('Stockfish self-test failed:', err.message));
    if (process.env.OPENAI_API_KEY) {
      fetch('https://api.openai.com/v1/responses',{
        method:'POST',
        headers:{'content-type':'application/json',authorization:`Bearer ${process.env.OPENAI_API_KEY}`},
        body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-5.6-terra',input:'Reply with OK.',max_output_tokens:16,store:false})
      }).then(async r=>{
        if(r.ok) console.log('OpenAI API self-test OK');
        else console.error('OpenAI API self-test failed:',r.status,(await r.text()).slice(0,300));
      }).catch(err=>console.error('OpenAI API self-test failed:',err.message));
    } else console.warn('OpenAI API key not configured');
  });
}

startServer().catch(err => {
  console.error('Server startup failed:', err);
  process.exit(1);
});
