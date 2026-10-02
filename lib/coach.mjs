import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';
import { analyzeFen, scoreNumber } from './stockfish.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const promptPath = path.join(__dirname, '..', 'coach-system-prompt.md');
let cachedPrompt = null;

function outputText(data) {
  for (const item of data.output || []) {
    if (item.type !== 'message') continue;
    for (const part of item.content || []) if (part.type === 'output_text' && part.text) return part.text;
  }
  return '';
}

function uciToSan(fen, uci) {
  if (!uci || uci === '(none)') return null;
  try {
    const game = new Chess(fen);
    const move = game.move({ from:uci.slice(0,2), to:uci.slice(2,4), promotion:uci[4] || 'q' });
    return move?.san || null;
  } catch { return null; }
}

function pvToSan(fen, pv = [], limit = 10) {
  const game = new Chess(fen);
  const out = [];
  for (const uci of pv.slice(0, limit)) {
    try {
      const move = game.move({ from:uci.slice(0,2), to:uci.slice(2,4), promotion:uci[4] || 'q' });
      if (!move) break;
      out.push(move.san);
    } catch { break; }
  }
  return out;
}

function boardFacts(fen) {
  const game = new Chess(fen);
  const pieces = [];
  for (const row of game.board()) {
    for (const p of row) if (p) pieces.push({ square:p.square, color:p.color === 'w' ? 'white' : 'black', piece:p.type });
  }
  return {
    fen,
    turn:game.turn() === 'w' ? 'white' : 'black',
    inCheck:game.inCheck(),
    pieces,
    legalMoves:game.moves({ verbose:true }).map(m => ({ san:m.san, uci:m.from+m.to+(m.promotion||'') }))
  };
}

async function verifiedPosition(fen, playedUci = null) {
  const facts = boardFacts(fen);
  const top = await analyzeFen(fen, { depth:14, multiPv:8 });
  const topLines = top.lines.map(line => ({
    rank:line.multipv,
    depth:line.depth,
    score:line.score,
    firstMoveUci:line.pv?.[0] || null,
    firstMoveSan:uciToSan(fen,line.pv?.[0]),
    lineUci:(line.pv||[]).slice(0,10),
    lineSan:pvToSan(fen,line.pv||[],10)
  }));
  let played = null;
  if (playedUci && facts.legalMoves.some(m => m.uci === playedUci)) {
    const forced = await analyzeFen(fen, { depth:14, multiPv:1, searchMoves:[playedUci] });
    const line = forced.lines[0];
    const bestScore = scoreNumber(top.lines[0]?.score);
    const playedScore = scoreNumber(line?.score);
    played = {
      uci:playedUci,
      san:uciToSan(fen,playedUci),
      score:line?.score || null,
      cpLoss:Math.max(0,Math.round(bestScore-playedScore)),
      lineUci:(line?.pv||[]).slice(0,10),
      lineSan:pvToSan(fen,line?.pv||[],10)
    };
  }
  return { ...facts, topLines, played };
}

async function verifyMove(fen, uci) {
  const facts = boardFacts(fen);
  const legal = facts.legalMoves.find(m => m.uci === uci);
  if (!legal) return { legal:false, uci, legalMoves:facts.legalMoves };
  const [top, forced] = await Promise.all([
    analyzeFen(fen,{depth:15,multiPv:5}),
    analyzeFen(fen,{depth:15,multiPv:1,searchMoves:[uci]})
  ]);
  const best=top.lines[0], line=forced.lines[0];
  return {
    legal:true,
    uci,
    san:legal.san,
    score:line?.score || null,
    cpLoss:Math.max(0,Math.round(scoreNumber(best?.score)-scoreNumber(line?.score))),
    bestMoveUci:best?.pv?.[0] || null,
    bestMoveSan:uciToSan(fen,best?.pv?.[0]),
    candidateLineUci:(line?.pv||[]).slice(0,12),
    candidateLineSan:pvToSan(fen,line?.pv||[],12),
    bestLineUci:(best?.pv||[]).slice(0,12),
    bestLineSan:pvToSan(fen,best?.pv||[],12)
  };
}

const responseSchema = {
  type:'object', additionalProperties:false,
  properties:{
    intervene:{type:'boolean'},
    pause_game:{type:'boolean'},
    message:{type:'string'},
    observation:{type:'string'},
    skill_tags:{type:'array',items:{type:'string'}},
    confidence:{type:'string',enum:['low','medium','high']},
    profile_updates:{
      type:'array',
      items:{
        type:'object',additionalProperties:false,
        properties:{
          skill:{type:'string'},
          direction:{type:'string',enum:['strength','weakness','neutral']},
          evidence:{type:'string'},
          confidence:{type:'string',enum:['low','medium','high']}
        },
        required:['skill','direction','evidence','confidence']
      }
    }
  },
  required:['intervene','pause_game','message','observation','skill_tags','confidence','profile_updates']
};

const tools = [
  {
    type:'function',
    name:'get_verified_position',
    description:'Get authoritative board occupancy, every legal move, and deep Stockfish MultiPV lines for the position being discussed. You MUST use this before making concrete chess claims.',
    parameters:{
      type:'object',
      properties:{ scope:{type:'string',enum:['current','last_decision'],description:'Use current unless the question is about the student’s previous move or prior coaching line.'} },
      required:['scope'],
      additionalProperties:false
    },
    strict:true
  },
  {
    type:'function',
    name:'verify_candidate_move',
    description:'Deeply verify a specific legal UCI move from the position being discussed. Use this before asserting that a user-suggested or coach-suggested move works or fails unless that move and its continuation are already directly covered by get_verified_position.',
    parameters:{
      type:'object',
      properties:{
        scope:{type:'string',enum:['current','last_decision'],description:'Which position the candidate belongs to.'},
        uci:{type:'string',description:'Move in UCI notation, e.g. d4e5 or e7e8q'}
      },
      required:['scope','uci'],
      additionalProperties:false
    },
    strict:true
  }
];

export async function coachResponse(context) {
  if (!process.env.OPENAI_API_KEY) {
    const err = new Error('OPENAI_API_KEY is not configured');
    err.code = 'MISSING_OPENAI_KEY';
    throw err;
  }
  cachedPrompt ||= await fs.readFile(promptPath, 'utf8');

  const currentFen = context.currentFen || context.fenBefore || null;
  const lastDecisionFen = context.lastDecisionContext?.fenBefore || context.fenBefore || null;
  const defaultScope = ['after_move','retry_move','takeback'].includes(context.event) ? 'last_decision' : 'current';
  const fenForScope = scope => {
    if (scope === 'last_decision') return lastDecisionFen || currentFen;
    return currentFen || lastDecisionFen;
  };
  if (!currentFen && !lastDecisionFen) throw new Error('Coach requires a board position');

  const instructions = `${cachedPrompt}

CHESS ACCURACY CONTRACT:
- Stockfish/tool output is the authority for concrete board facts and tactical claims.
- You MUST call get_verified_position before answering any chess-position question or commenting on a move.
- Use scope='last_decision' when discussing the student’s previous move, a takeback, or a prior coaching claim about that move. Use scope='current' for the board as it stands now.
- Never invent a variation from memory. If you mention a concrete continuation, it must be directly supported by a returned engine line.
- If the student proposes or challenges a specific move and it is not directly covered by the verified top lines, use verify_candidate_move before judging it.
- If you cannot map the student's natural-language move description to one legal move with confidence, ask a clarifying question instead of guessing.
- Check piece locations from the verified board data before saying that a piece can capture, defend, attack, pin, or recapture.
- If the student's correction conflicts with your previous statement, re-verify first, then acknowledge the error plainly if the engine/board facts support the student.
- Do not convert a Stockfish preference into a teaching claim unless you can explain it using a verified line or stable positional principle.
- Keep live coaching concise. Explain one verified idea at a time.
- For after_move/opponent_move you may choose not to intervene.
- Use profile_updates only for durable evidence about the student's ability or decision process.
Return JSON matching the requested schema.`;

  const input = [{ role:'user', content:[{ type:'input_text', text:`Coaching context:\n${JSON.stringify(context)}` }] }];
  const model = process.env.OPENAI_COACH_MODEL || 'gpt-5.6-sol';

  for (let turn=0; turn<4; turn++) {
    const body = {
      model,
      store:false,
      reasoning:{ effort:'medium' },
      instructions,
      input,
      tools,
      tool_choice: turn === 0 ? { type:'function', name:'get_verified_position' } : 'auto',
      text:{ format:{ type:'json_schema', name:'chess_coach_turn', strict:true, schema:responseSchema } }
    };
    const r = await fetch('https://api.openai.com/v1/responses',{
      method:'POST',
      headers:{'content-type':'application/json',authorization:`Bearer ${process.env.OPENAI_API_KEY}`},
      body:JSON.stringify(body)
    });
    const data=await r.json();
    if(!r.ok)throw new Error(data?.error?.message||'OpenAI request failed');

    const calls=(data.output||[]).filter(x=>x.type==='function_call');
    if(!calls.length){
      const text=outputText(data);
      if(!text)throw new Error('Coach returned no response');
      return JSON.parse(text);
    }

    input.push(...(data.output||[]));
    for(const call of calls){
      let result;
      try{
        const args=JSON.parse(call.arguments||'{}');
        if(call.name==='get_verified_position'){
          const scope=args.scope||defaultScope;
          const fen=fenForScope(scope);
          result={scope,...await verifiedPosition(fen,scope==='last_decision'?(context.lastDecisionContext?.moveUci||context.lastMoveUci||null):null)};
        }else if(call.name==='verify_candidate_move'){
          const scope=args.scope||defaultScope;
          const fen=fenForScope(scope);
          result={scope,...await verifyMove(fen,args.uci)};
        }else result={error:'Unknown tool'};
      }catch(err){result={error:err.message||'Tool failed'}}
      input.push({
        type:'function_call_output',
        call_id:call.call_id,
        output:JSON.stringify(result)
      });
    }
  }
  throw new Error('Coach verification loop exceeded limit');
}
