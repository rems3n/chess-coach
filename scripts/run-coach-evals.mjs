import fs from 'node:fs/promises';
import { Chess } from 'chess.js';
import { coachResponseDetailed } from '../lib/coach.mjs';

const args = new Set(process.argv.slice(2));
const useJudge = args.has('--judge');
const onlyIdArg = process.argv.find(x => x.startsWith('--case='));
const onlyId = onlyIdArg ? onlyIdArg.split('=')[1] : null;
const maxArg = process.argv.find(x => x.startsWith('--max='));
const maxCases = maxArg ? Number(maxArg.split('=')[1]) : Infinity;

function replayMoves(moves = []) {
  const game = new Chess();
  const records = [];
  for (const san of moves) {
    const fenBefore = game.fen();
    const move = game.move(san);
    if (!move) throw new Error('Illegal eval move: ' + san);
    records.push({
      san: move.san,
      uci: move.from + move.to + (move.promotion || ''),
      fenBefore,
      fenAfter: game.fen()
    });
  }
  return { game, records };
}

function resolveLastDecision(testCase, records) {
  if (!records.length) return null;
  if (testCase.lastDecisionMove) {
    for (let i = records.length - 1; i >= 0; i--) {
      if (records[i].san === testCase.lastDecisionMove) return {
        fenBefore: records[i].fenBefore,
        moveSan: records[i].san,
        moveUci: records[i].uci,
        at: Date.now()
      };
    }
  }
  const lastWhite = [...records].reverse().find(r => {
    const c = new Chess(r.fenBefore);
    return c.turn() === 'w';
  });
  return lastWhite ? {
    fenBefore: lastWhite.fenBefore,
    moveSan: lastWhite.san,
    moveUci: lastWhite.uci,
    at: Date.now()
  } : null;
}

function challengeInfo(testCase, finalFen, lastDecision) {
  if (!testCase.challengeSan) return null;
  const scope = testCase.challengeScope || 'current';
  const fen = scope === 'last_decision' ? lastDecision?.fenBefore : finalFen;
  if (!fen) return null;
  try {
    const game = new Chess(fen);
    const move = game.move(testCase.challengeSan);
    if (!move) return { scope, san:testCase.challengeSan, legal:false, uci:null };
    return { scope, san:move.san, legal:true, uci:move.from + move.to + (move.promotion || '') };
  } catch {
    return { scope, san:testCase.challengeSan, legal:false, uci:null };
  }
}

function hardGrade(testCase, detailed, challenge) {
  const coach = detailed.coach || {};
  const diagnostics = detailed.diagnostics || {};
  const checks = [];
  const add = (name, pass, detail='') => checks.push({ name, pass:!!pass, detail });

  if (testCase.expect?.noPause) add('no_pause', !coach.pause_game, 'pause_game=' + coach.pause_game);
  if (testCase.expect?.mustBeSilent) {
    add('silent_intervention', !coach.intervene, 'intervene=' + coach.intervene);
    add('silent_message', !coach.message, 'message=' + JSON.stringify(coach.message || ''));
  }
  if (testCase.expect?.lastDecisionScope) {
    add('last_decision_packet', !!diagnostics.verifiedPositions?.last_decision?.decision);
  }
  if (testCase.expect?.verifyCandidate && challenge?.legal) {
    const toolVerified = (diagnostics.toolCalls || []).some(call =>
      call.name === 'verify_candidate_move' &&
      call.args?.scope === challenge.scope &&
      call.args?.uci === challenge.uci
    );
    const packet = challenge.scope === 'last_decision'
      ? diagnostics.verifiedPositions?.last_decision?.decision
      : diagnostics.verifiedPositions?.current?.decision;
    const packetCovered = (packet?.topCandidates || []).some(x => x.uci === challenge.uci);
    add('candidate_verified', toolVerified || packetCovered, toolVerified ? 'verified_by_tool' : packetCovered ? 'covered_by_packet' : 'not_verified');
  }
  if (diagnostics.verifiedPositions) {
    add('verified_packet_present', Object.keys(diagnostics.verifiedPositions).length > 0);
  }
  add('latency_recorded', Number.isFinite(diagnostics.latencyMs), 'latency=' + diagnostics.latencyMs);

  return checks;
}

async function judgeCase(testCase, detailed, challenge) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY required for --judge');
  const schema = {
    type:'object', additionalProperties:false,
    properties:{
      board_factuality:{type:'integer',minimum:0,maximum:2},
      engine_consistency:{type:'integer',minimum:0,maximum:2},
      practical_judgment:{type:'integer',minimum:0,maximum:2},
      pedagogy:{type:'integer',minimum:0,maximum:2},
      level_appropriateness:{type:'integer',minimum:0,maximum:2},
      intervention_quality:{type:'integer',minimum:0,maximum:2},
      major_error:{type:'boolean'},
      notes:{type:'array',items:{type:'string'}}
    },
    required:['board_factuality','engine_consistency','practical_judgment','pedagogy','level_appropriateness','intervention_quality','major_error','notes']
  };
  const body = {
    model:process.env.OPENAI_EVAL_MODEL || 'gpt-5.6-sol',
    store:false,
    reasoning:{effort:'medium'},
    instructions:`You are grading a chess-coaching response against authoritative structured Stockfish evidence.
Do not solve the chess position from memory. Treat diagnostics.verifiedPositions and tool results as ground truth.
Scores: 2=good, 1=minor issue, 0=material failure.
Board factuality: no nonexistent pieces/captures/illegal move claims.
Engine consistency: concrete claims align with verified lines and candidate verification.
Practical judgment: does not call a practically reasonable human move bad merely because it is not engine #1.
Pedagogy: teaches a transferable idea without overwhelming or prematurely revealing everything.
Level appropriateness: useful to a 1200-1500 player aiming for 1800.
Intervention quality: response/pause behavior fits the requested mode and case.
major_error=true for illegal-move claims, false tactical assertions, contradiction of verified engine data, or materially misleading chess advice.
Use only supplied evidence.`,
    input:[{role:'user',content:[{type:'input_text',text:JSON.stringify({
      case:testCase,
      challenge,
      coach:detailed.coach,
      diagnostics:detailed.diagnostics
    })}]}],
    text:{format:{type:'json_schema',name:'coach_eval_grade',strict:true,schema}}
  };
  const r = await fetch('https://api.openai.com/v1/responses',{
    method:'POST',
    headers:{'content-type':'application/json',authorization:'Bearer '+process.env.OPENAI_API_KEY},
    body:JSON.stringify(body)
  });
  const data = await r.json();
  if(!r.ok) throw new Error(data?.error?.message || 'Eval judge failed');
  for(const item of data.output || []) {
    if(item.type !== 'message') continue;
    for(const part of item.content || []) if(part.type === 'output_text' && part.text) return JSON.parse(part.text);
  }
  throw new Error('Eval judge returned no output');
}

const raw = JSON.parse(await fs.readFile(new URL('../evals/coach-cases.json', import.meta.url),'utf8'));
let cases = raw.cases;
if (onlyId) cases = cases.filter(x => x.id === onlyId);
cases = cases.slice(0,maxCases);
if (!cases.length) throw new Error('No eval cases selected');

const results = [];
for (const testCase of cases) {
  const { game, records } = replayMoves(testCase.moves || []);
  const lastDecision = resolveLastDecision(testCase, records);
  const challenge = challengeInfo(testCase, game.fen(), lastDecision);
  const event = testCase.event || 'user_question';
  const context = {
    event,
    mode:testCase.mode || 'normal',
    currentFen:game.fen(),
    fenBefore:event === 'after_move' ? lastDecision?.fenBefore : null,
    lastMoveSan:event === 'after_move' ? lastDecision?.moveSan : null,
    lastMoveUci:event === 'after_move' ? lastDecision?.moveUci : null,
    recentMoves:records.map(x => x.san).slice(-20),
    conversation:testCase.question ? [{role:'user',text:testCase.question}] : [],
    lastDecisionContext:lastDecision,
    retryContext:testCase.retryContext || null,
    studentProfile:{
      approximateRating:1500,
      currentRating:1500,
      nextGoal:1800,
      longTermGoal:2000,
      currentPriorities:['candidate generation','defensive awareness','calculation discipline']
    }
  };

  const started = Date.now();
  try {
    const detailed = await coachResponseDetailed(context);
    const hardChecks = hardGrade(testCase,detailed,challenge);
    const judge = useJudge ? await judgeCase(testCase,detailed,challenge) : null;
    results.push({
      id:testCase.id,
      category:testCase.category,
      ok:hardChecks.every(x => x.pass) && (!judge || !judge.major_error),
      elapsedMs:Date.now()-started,
      hardChecks,
      judge,
      coach:detailed.coach,
      diagnostics:detailed.diagnostics
    });
    process.stdout.write((results.at(-1).ok ? '✓ ' : '✗ ') + testCase.id + ' ' + (Date.now()-started) + 'ms\n');
  } catch (error) {
    results.push({id:testCase.id,category:testCase.category,ok:false,elapsedMs:Date.now()-started,error:error.message});
    process.stdout.write('✗ ' + testCase.id + ' ERROR ' + error.message + '\n');
  }
}

const hardFailures = results.filter(r => !r.ok);
const latencies = results.filter(r=>r.diagnostics?.latencyMs).map(r=>r.diagnostics.latencyMs).sort((a,b)=>a-b);
const avg = latencies.length ? Math.round(latencies.reduce((a,b)=>a+b,0)/latencies.length) : null;
const p95 = latencies.length ? latencies[Math.min(latencies.length-1,Math.floor(latencies.length*.95))] : null;
const judgeRows = results.filter(r=>r.judge);
const scoreKeys = ['board_factuality','engine_consistency','practical_judgment','pedagogy','level_appropriateness','intervention_quality'];
const judgeAverages = Object.fromEntries(scoreKeys.map(k=>[
  k,
  judgeRows.length ? Number((judgeRows.reduce((n,r)=>n+(r.judge[k]||0),0)/judgeRows.length).toFixed(2)) : null
]));

const summary = {
  generatedAt:new Date().toISOString(),
  version:raw.version,
  judgeEnabled:useJudge,
  total:results.length,
  passed:results.length-hardFailures.length,
  failed:hardFailures.length,
  majorErrors:judgeRows.filter(r=>r.judge.major_error).length,
  latency:{avgMs:avg,p95Ms:p95},
  judgeAverages
};

await fs.mkdir(new URL('../evals/results/',import.meta.url),{recursive:true});
await fs.writeFile(new URL('../evals/results/latest.json',import.meta.url),JSON.stringify({summary,results},null,2));
const md = [
  '# Chess Coach Eval',
  '',
  '- Generated: '+summary.generatedAt,
  '- Cases: '+summary.total,
  '- Passed: '+summary.passed,
  '- Failed: '+summary.failed,
  '- Major chess errors: '+summary.majorErrors,
  '- Avg coach latency: '+(avg ?? 'n/a')+' ms',
  '- P95 coach latency: '+(p95 ?? 'n/a')+' ms',
  '',
  '## Judge averages',
  '',
  ...scoreKeys.map(k=>'- '+k+': '+(judgeAverages[k] ?? 'n/a')+' / 2'),
  '',
  '## Cases',
  '',
  ...results.map(r=>' - '+(r.ok?'PASS':'FAIL')+' — '+r.id+(r.error?' — '+r.error:''))
].join('\n');
await fs.writeFile(new URL('../evals/results/latest.md',import.meta.url),md+'\n');

console.log('\n'+JSON.stringify(summary,null,2));
if (hardFailures.length) process.exitCode = 1;
