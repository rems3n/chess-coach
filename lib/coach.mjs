import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

export async function coachResponse(context) {
  if (!process.env.OPENAI_API_KEY) {
    const err = new Error('OPENAI_API_KEY is not configured');
    err.code = 'MISSING_OPENAI_KEY';
    throw err;
  }
  cachedPrompt ||= await fs.readFile(promptPath, 'utf8');
  const schema = {
    type:'object', additionalProperties:false,
    properties:{
      intervene:{type:'boolean'},
      pause_game:{type:'boolean'},
      message:{type:'string'},
      observation:{type:'string'},
      skill_tags:{type:'array',items:{type:'string'}},
      confidence:{type:'string',enum:['low','medium','high']}
    },
    required:['intervene','pause_game','message','observation','skill_tags','confidence']
  };
  const body = {
    model: process.env.OPENAI_MODEL || 'gpt-5.6-terra',
    store: false,
    reasoning: { effort: 'low' },
    instructions: `${cachedPrompt}\n\nFor an after_move or opponent_move event, you may choose not to intervene. If no coaching interaction is useful, set intervene=false and message="". Set pause_game=true only when the student should stop and engage before continuing; most ordinary comments should not pause play. Never reveal an engine move merely because it is best. Keep live-game coaching concise unless the student asks for detail. Return JSON matching the requested schema.`,
    input: [{ role:'user', content:[{ type:'input_text', text:`Coaching context:\n${JSON.stringify(context)}` }] }],
    text: { format: { type:'json_schema', name:'chess_coach_turn', strict:true, schema } }
  };
  const r = await fetch('https://api.openai.com/v1/responses', {
    method:'POST',
    headers:{ 'content-type':'application/json', authorization:`Bearer ${process.env.OPENAI_API_KEY}` },
    body:JSON.stringify(body)
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || 'OpenAI request failed');
  const text = outputText(data);
  if (!text) throw new Error('Coach returned no response');
  return JSON.parse(text);
}
