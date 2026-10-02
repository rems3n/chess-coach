import { masteryStatus, prioritizeItems } from './mastery.js';

function hashText(text='') {
  let h=2166136261;
  for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)}
  return (h>>>0).toString(36);
}

const SOUND = new Set(['best_or_near_best','small_inaccuracy']);

export function buildOpeningItems(games = []) {
  const byPosition=new Map();
  for(const game of games){
    for(const move of game.analysis?.moves||[]){
      if(move.phase!=='opening'||!move.fen||!move.playedUci||!move.bestUci)continue;
      const expectedUci=SOUND.has(move.classification)?move.playedUci:move.bestUci;
      const expectedSan=SOUND.has(move.classification)?move.playedSan:move.bestSan;
      const corrected=!SOUND.has(move.classification);
      const key=move.fen;
      if(!byPosition.has(key)){
        byPosition.set(key,{
          id:'opening:'+hashText(move.fen),
          fen:move.fen,
          color:move.color,
          moveNumber:move.moveNumber,
          expectedUci,
          expectedSan,
          corrected,
          sourceMove:move.playedSan,
          classification:move.classification,
          cpLoss:move.cpLoss||0,
          examples:0,
          games:new Set(),
          alternatives:new Map()
        });
      }
      const item=byPosition.get(key);
      item.examples+=1;
      if(game.id)item.games.add(game.id);
      const altKey=expectedUci+'|'+(expectedSan||expectedUci)+'|'+(corrected?'1':'0');
      item.alternatives.set(altKey,(item.alternatives.get(altKey)||0)+1);
    }
  }
  return [...byPosition.values()].map(item=>{
    const preferred=[...item.alternatives.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0];
    if(preferred){
      const [uci,san,corrected]=preferred.split('|');
      item.expectedUci=uci;
      item.expectedSan=san;
      item.corrected=corrected==='1';
    }
    return {...item,games:[...item.games],alternatives:undefined};
  }).sort((a,b)=>a.moveNumber-b.moveNumber||b.examples-a.examples);
}

export function openingQueue(items, records={}, {filter='for_you',color='all',limit=10}={}) {
  let out=color==='all'?items:items.filter(x=>x.color===color);
  if(filter==='due')out=out.filter(x=>masteryStatus(records[x.id])==='due');
  else if(filter==='new')out=out.filter(x=>masteryStatus(records[x.id])==='new');
  else if(filter==='mastered')out=out.filter(x=>masteryStatus(records[x.id])==='mastered');
  if(filter==='for_you'||filter==='due')out=prioritizeItems(out,records);
  else if(filter==='new')out=[...out].sort((a,b)=>a.moveNumber-b.moveNumber||b.examples-a.examples);
  else if(filter==='mastered')out=[...out].sort((a,b)=>(records[b.id]?.mastery||0)-(records[a.id]?.mastery||0));
  else out=[...out].sort((a,b)=>a.moveNumber-b.moveNumber||b.examples-a.examples);
  return limit==='all'?out:out.slice(0,Number(limit)||10);
}
