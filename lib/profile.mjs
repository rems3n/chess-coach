function outputText(data) {
  for (const item of data.output || []) {
    if (item.type !== 'message') continue;
    for (const part of item.content || []) if (part.type === 'output_text' && part.text) return part.text;
  }
  return '';
}

export async function generateProfilePlan(input) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');
  const schema = {
    type:'object',
    additionalProperties:false,
    properties:{
      summary:{type:'string'},
      current_level:{type:'string'},
      strengths:{type:'array',items:{type:'string'}},
      priorities:{
        type:'array',
        items:{
          type:'object',additionalProperties:false,
          properties:{
            skill:{type:'string'},
            why:{type:'string'},
            evidence:{type:'string'},
            importance:{type:'string',enum:['high','medium','low']}
          },
          required:['skill','why','evidence','importance']
        }
      },
      skills:{
        type:'array',
        items:{
          type:'object',additionalProperties:false,
          properties:{
            skill:{type:'string'},
            level:{type:'string',enum:['priority','developing','solid','strong']},
            confidence:{type:'string',enum:['low','medium','high']},
            evidence:{type:'string'}
          },
          required:['skill','level','confidence','evidence']
        }
      },
      weekly_plan:{
        type:'array',
        items:{
          type:'object',additionalProperties:false,
          properties:{
            activity:{type:'string'},
            minutes:{type:'integer'},
            focus:{type:'string'},
            reason:{type:'string'},
            destination:{type:'string',enum:['play','puzzles','learn','openings','analyze']}
          },
          required:['activity','minutes','focus','reason','destination']
        }
      },
      next_reassessment:{type:'string'}
    },
    required:['summary','current_level','strengths','priorities','skills','weekly_plan','next_reassessment']
  };
  const instructions = `You are designing an adaptive chess-development plan for a player roughly 1200–1500 online whose next goal is 1800 and long-term goal is 2000.
Use the supplied engine evidence and coaching observations. Do not invent weaknesses unsupported by evidence. If evidence is limited, say so and lower confidence.
The plan is advisory, not mandatory: recommend a small number of high-value activities while assuming the user can freely choose puzzles, openings, lessons, analysis, or games.
Prioritize transferable decision-making, recurring errors, calculation quality, tactical awareness, endgames, positional understanding, practical play, and opening understanding as appropriate.
Do not over-index on centipawn loss alone. Distinguish engine evidence from coaching inferences.
Return concise structured JSON only.`;
  const body = {
    model: process.env.OPENAI_MODEL || 'gpt-5.6-terra',
    store:false,
    reasoning:{effort:'low'},
    instructions,
    input:[{role:'user',content:[{type:'input_text',text:JSON.stringify(input)}]}],
    text:{format:{type:'json_schema',name:'chess_player_profile',strict:true,schema}}
  };
  const r = await fetch('https://api.openai.com/v1/responses',{
    method:'POST',
    headers:{'content-type':'application/json',authorization:`Bearer ${process.env.OPENAI_API_KEY}`},
    body:JSON.stringify(body)
  });
  const data = await r.json();
  if(!r.ok) throw new Error(data?.error?.message || 'Profile generation failed');
  const text = outputText(data);
  if(!text) throw new Error('Profile generator returned no response');
  return JSON.parse(text);
}
