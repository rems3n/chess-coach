import { spawn } from 'node:child_process';
import fs from 'node:fs';

const candidates = [process.env.STOCKFISH_PATH, '/usr/games/stockfish', '/usr/bin/stockfish', 'stockfish'].filter(Boolean);
function enginePath() {
  for (const p of candidates) {
    if (!p.includes('/') || fs.existsSync(p)) return p;
  }
  return 'stockfish';
}

function scoreFromTokens(tokens) {
  const i = tokens.indexOf('score');
  if (i < 0) return null;
  const type = tokens[i + 1];
  const raw = Number(tokens[i + 2]);
  if (!Number.isFinite(raw) || !['cp', 'mate'].includes(type)) return null;
  return { type, value: raw };
}

export function scoreNumber(score) {
  if (!score) return 0;
  if (score.type === 'cp') return score.value;
  return score.value > 0 ? 100000 - Math.min(Math.abs(score.value), 999) * 100 : -100000 + Math.min(Math.abs(score.value), 999) * 100;
}

export class StockfishSession {
  constructor() {
    this.proc = spawn(enginePath(), [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.buffer = '';
    this.waiters = [];
    this.proc.stdout.setEncoding('utf8');
    this.proc.stderr.setEncoding('utf8');
    this.proc.stdout.on('data', chunk => this.#consume(chunk));
    this.proc.on('error', err => this.#rejectAll(err));
    this.proc.on('exit', code => this.#rejectAll(new Error(`Stockfish exited (${code})`)));
  }

  #consume(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() || '';
    for (const line of lines) for (const waiter of [...this.waiters]) waiter(line);
  }
  #rejectAll(err) { for (const w of this.waiters.splice(0)) w.__reject?.(err); }
  send(cmd) { this.proc.stdin.write(cmd + '\n'); }
  waitFor(predicate, timeoutMs = 12000) {
    return new Promise((resolve, reject) => {
      const fn = line => {
        if (predicate(line)) {
          clearTimeout(timer);
          this.waiters = this.waiters.filter(x => x !== fn);
          resolve(line);
        }
      };
      fn.__reject = reject;
      this.waiters.push(fn);
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter(x => x !== fn);
        reject(new Error('Stockfish timed out'));
      }, timeoutMs);
    });
  }
  async init() {
    this.send('uci');
    await this.waitFor(line => line === 'uciok');
    this.send('setoption name Threads value 1');
    this.send('setoption name Hash value 64');
    this.send('isready');
    await this.waitFor(line => line === 'readyok');
    return this;
  }
  async analyze(fen, { depth = 10, multiPv = 3, searchMoves = [] } = {}) {
    const lines = new Map();
    const collect = line => {
      if (!line.startsWith('info ') || !line.includes(' pv ')) return;
      const t = line.trim().split(/\s+/);
      const d = Number(t[t.indexOf('depth') + 1] || 0);
      const m = Number(t[t.indexOf('multipv') + 1] || 1);
      const score = scoreFromTokens(t);
      const pvIndex = t.indexOf('pv');
      if (d && score && pvIndex >= 0) lines.set(m, { multipv: m, depth: d, score, pv: t.slice(pvIndex + 1) });
    };
    this.waiters.push(collect);
    this.send(`setoption name MultiPV value ${Math.max(1, Math.min(multiPv, 8))}`);
    this.send('isready');
    await this.waitFor(line => line === 'readyok');
    this.send(`position fen ${fen}`);
    const moveClause = searchMoves.length ? ` searchmoves ${searchMoves.join(' ')}` : '';
    this.send(`go depth ${Math.max(6, Math.min(depth, 18))}${moveClause}`);
    const bestLine = await this.waitFor(line => line.startsWith('bestmove '), 20000);
    this.waiters = this.waiters.filter(x => x !== collect);
    const bestmove = bestLine.split(/\s+/)[1] || null;
    return { bestmove, lines: [...lines.values()].sort((a, b) => a.multipv - b.multipv) };
  }
  close() {
    try { this.send('quit'); } catch {}
    setTimeout(() => { try { this.proc.kill('SIGKILL'); } catch {} }, 150).unref?.();
  }
}

export async function analyzeFen(fen, options = {}) {
  const engine = await new StockfishSession().init();
  try { return await engine.analyze(fen, options); }
  finally { engine.close(); }
}
