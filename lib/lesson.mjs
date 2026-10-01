function outputText(data) {
  for (const item of data.output || []) {
    if (item.type !== 'message') continue;
    for (const part of item.content || []) if (part.type === 'output_text' && part.text) return part.text;
  }
  return '';
}

export async function generateLesson({topic, profile, coachingEvidence}) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');
  const schema={
    type:'object',additionalProperties:false,
    properties:{
      title:{type:'string'},
      objective:{type:'string'},
      why_it_matters:{type:'string'},
      concepts:{type:'array',items:{type:'object',additionalProperties:false,properties:{name:{type:'string'},explanation:{type:'string'},question:{type:'string'}},required:['name','explanation','question']}},
      decision_rules:{type:'array',items:{type:'string'}},
      common_errors:{type:'array',items:{type:'string'}},
      practice_assignment:{type:'object',additionalProperties:false,properties:{activity:{type:'string'},instructions:{type:'string'},success_criteria:{type:'string'}},required:['activity','instructions','success_criteria']},
      reflection_questions:{type:'array',items:{type:'string'}}
    },
    required:['title','objective','why_it_matters','concepts','decision_rules','common_errors','practice_assignment','reflection_questions']
  };
  const body={
    model:process.env.OPENAI_MODEL||'gpt-5.6-terra',
    store:false,
    reasoning:{effort:'low'},
    instructions:'Create a practical chess lesson for an online player around 1200-1500 aiming for 1800, later 2000. The lesson topic is supplied by the user. Tailor emphasis using the player profile and coaching evidence when available, but never invent evidence. Teach transferable decision-making, not memorized engine moves. Keep language direct and specific. Do not invent exact game variations, FEN positions, or historical examples. This lesson is conceptual and should point the student toward active practice. Return structured JSON only.',
    input:[{role:'user',content:[{type:'input_text',text:JSON.stringify({topic,profile,coachingEvidence:(coachingEvidence||[]).slice(-40)})}]}],
    text:{format:{type:'json_schema',name:'chess_lesson',strict:true,schema}}
  };
  const r=await fetch('https://api.openai.com/v1/responses',{
    method:'POST',
    headers:{'content-type':'application/json',authorization:'Bearer '+process.env.OPENAI_API_KEY},
    body:JSON.stringify(body)
  });
  const data=await r.json();
  if(!r.ok)throw new Error(data?.error?.message||'Lesson generation failed');
  const text=outputText(data);
  if(!text)throw new Error('Lesson generator returned no response');
  return JSON.parse(text);
}
