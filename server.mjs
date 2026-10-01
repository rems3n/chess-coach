import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

server.listen(port, '0.0.0.0', () => console.log(`Chess Coach listening on ${port}`));
