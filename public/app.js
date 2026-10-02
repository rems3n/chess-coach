import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.4.0/+esm';
import { Chessboard as CmChessboard, COLOR, INPUT_EVENT_TYPE } from 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/src/Chessboard.js';
import { emptyMastery, recordPuzzleAttempt, recordMasteryAttempt, masteryStatus, prioritizePuzzles, masterySummary } from './mastery.js';
import { buildOpeningItems, openingQueue } from './opening-training.js';

const P={wp:'♙',wn:'♘',wb:'♗',wr:'♖',wq:'♕',wk:'♔',bp:'♟',bn:'♞',bb:'♝',br:'♜',bq:'♛',bk:'♚'};
const NAV=[['home','⌂','Home'],['play','♞','Play'],['puzzles','✣','Puzzles'],['learn','▤','Learn'],['openings','♙','Openings'],['analyze','⌕','Analyze'],['progress','▥','Progress']];
const s={route:location.hash.replace('#/','')||'home',game:new Chess(),sel:null,legal:[],orient:'white',games:JSON.parse(localStorage.getItem('cc_games')||'[]'),user:localStorage.getItem('cc_chess_user')||'',review:null,rgame:null,ply:0,toast:null,coachBusy:false,analysisBusy:false,missingKey:false,opponentBusy:false,paused:false,opponentElo:1450,coachMode:'normal',reviewCoachBusy:false,reviewMessages:[],profilePlan:JSON.parse(localStorage.getItem('cc_profile_plan')||'null'),coachingEvidence:JSON.parse(localStorage.getItem('cc_coaching_evidence')||'[]'),profileBusy:false,batchBusy:false,voiceStatus:'off',voiceError:null,puzzleIndex:0,puzzleResult:null,puzzleAttempt:null,puzzleCoachBusy:false,puzzleMessages:[],puzzleMastery:JSON.parse(localStorage.getItem('cc_puzzle_mastery')||'{}'),puzzleFilter:'for_you',puzzleSessionSize:10,puzzleHints:0,puzzleWrongThisRound:false,puzzleStartedAt:null,puzzleLine:null,puzzleLineLoading:false,puzzleLineIndex:0,puzzleFen:null,puzzleBaseId:null,puzzleStep:0,openingMastery:JSON.parse(localStorage.getItem('cc_opening_mastery')||'{}'),openingFilter:'for_you',openingColor:'all',openingSessionSize:10,openingIndex:0,openingResult:null,openingAttempt:null,openingHints:0,openingWrongThisRound:false,openingStartedAt:null,openingBaseId:null,openingScope:'all',openingCoachBusy:false,openingCoachMessages:[],lessonTopic:null,lessonBusy:false,lessonCache:JSON.parse(localStorage.getItem('cc_lessons')||'{}'),messages:[{role:'coach',text:'Play naturally. I’ll focus on your reasoning, not narrate every engine change.'}]};
const app=document.querySelector('#app');
let voicePeer=null,voiceChannel=null,voiceMedia=null,voiceAudio=null;
let mountedBoards=[];
let pendingBoardMove=null;
const CM_ASSETS='https://cdn.jsdelivr.net/npm/cm-chessboard@8/assets/';
function voiceContext(){
  const inReview=s.route==='review'&&s.review&&s.rgame;
  return {
    surface:inReview?'game_review':'training_game',
    fen:inReview?s.rgame.fen():s.game.fen(),
    recentMoves:inReview?s.review.h.slice(0,s.ply).map(x=>x.san).slice(-20):recentMoves(),
    coachMode:s.coachMode,
    playerProfile:s.profilePlan,
    review:inReview?{
      opponent:s.review.opponent,result:s.review.result,color:s.review.color,currentPly:s.ply,
      engineEvidence:s.review.analysis?.moves?.find(x=>x.ply===s.ply+1)||s.review.analysis?.moves?.find(x=>x.ply===s.ply)||null
    }:null
  };
}
function pushVoiceContext(){
  if(!voiceChannel||voiceChannel.readyState!=='open')return;
  const payload={type:'conversation.item.create',item:{type:'message',role:'user',content:[{type:'input_text',text:`[Private coaching context update. Do not answer this item by itself.] ${JSON.stringify(voiceContext())}`}]}};
  voiceChannel.send(JSON.stringify(payload));
}
function cleanupVoice(){
  try{voiceMedia?.getTracks().forEach(t=>t.stop())}catch{}
  try{voiceChannel?.close()}catch{}
  try{voicePeer?.close()}catch{}
  if(voiceAudio)voiceAudio.srcObject=null;
  voicePeer=null;voiceChannel=null;voiceMedia=null;voiceAudio=null;
  s.voiceStatus='off';render();
}
async function startVoice(){
  if(s.voiceStatus!=='off')return;
  s.voiceError=null;s.voiceStatus='connecting';render();
  try{
    const pc=new RTCPeerConnection();voicePeer=pc;
    const audio=new Audio();audio.autoplay=true;voiceAudio=audio;
    pc.addEventListener('track',e=>{audio.srcObject=e.streams[0];audio.play().catch(()=>{})});
    const media=await navigator.mediaDevices.getUserMedia({audio:true});voiceMedia=media;
    for(const track of media.getAudioTracks())pc.addTrack(track,media);
    const dc=pc.createDataChannel('oai-events');voiceChannel=dc;
    dc.addEventListener('open',()=>{s.voiceStatus='on';pushVoiceContext();render()});
    dc.addEventListener('message',({data})=>{
      try{
        const event=JSON.parse(data);
        if(event.type==='session.closed'){cleanupVoice();return}
        if(event.type==='error'){s.voiceError=event.error?.message||'Voice session error';render()}
      }catch{}
    });
    dc.addEventListener('close',()=>{if(s.voiceStatus!=='off')cleanupVoice()});
    const offer=await pc.createOffer();await pc.setLocalDescription(offer);
    if(pc.iceGatheringState!=='complete'){
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{pc.removeEventListener('icegatheringstatechange',done);reject(new Error('Voice connection timed out'))},10000);
        function done(){if(pc.iceGatheringState==='complete'){clearTimeout(timer);pc.removeEventListener('icegatheringstatechange',done);resolve()}}
        pc.addEventListener('icegatheringstatechange',done);done();
      });
    }
    const r=await fetch('/api/realtime-session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sdp:pc.localDescription?.sdp,context:voiceContext()})});
    const d=await r.json();if(!r.ok)throw new Error(d.error||'Voice session failed');
    await pc.setRemoteDescription({type:'answer',sdp:d.sdp});
  }catch(e){s.voiceError=e.message;cleanupVoice();pop(`Voice: ${e.message}`)}
}
function stopVoice(){
  if(voiceChannel?.readyState==='open'){try{voiceChannel.send(JSON.stringify({type:'session.close'}))}catch{}}
  setTimeout(cleanupVoice,250);
}

const esc=(x='')=>String(x).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]));
const save=()=>localStorage.setItem('cc_games',JSON.stringify(s.games.slice(0,250)));
const saveEvidence=()=>localStorage.setItem('cc_coaching_evidence',JSON.stringify(s.coachingEvidence.slice(-200)));
const saveProfile=()=>localStorage.setItem('cc_profile_plan',JSON.stringify(s.profilePlan));
const saveLessons=()=>localStorage.setItem('cc_lessons',JSON.stringify(s.lessonCache));
const savePuzzleMastery=()=>localStorage.setItem('cc_puzzle_mastery',JSON.stringify(s.puzzleMastery));
const saveOpeningMastery=()=>localStorage.setItem('cc_opening_mastery',JSON.stringify(s.openingMastery));
function captureEvidence(items=[]){if(!items.length)return;s.coachingEvidence.push(...items.map(x=>({...x,at:Date.now()})));saveEvidence()}
async function post(url,body){const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok){const e=new Error(d.error||'Request failed');e.data=d;throw e}return d}
function recentMoves(game=s.game){return game.history().slice(-20)}
async function coachEvent(event,fenBefore,move){
  if(s.coachBusy)return false;
  s.coachBusy=true;render();
  try{
    const d=await post('/api/coach',{event,mode:s.coachMode,fenBefore,currentFen:s.game.fen(),lastMoveSan:move?.san||null,lastMoveUci:move?(move.from+move.to+(move.promotion||'')):null,recentMoves:recentMoves(),messages:s.messages});
    s.missingKey=false;
    if(d.coach?.intervene&&d.coach.message)s.messages.push({role:'coach',text:d.coach.message});
    captureEvidence(d.coach?.profile_updates||[]);
    if(d.coach?.pause_game){s.paused=true;return true}
  }catch(e){if(e.data?.missingKey)s.missingKey=true;else pop(e.message)}
  finally{s.coachBusy=false;render()}
  return false;
}
async function coachAfterMove(fenBefore,move){
  if(s.missingKey){if(!s.game.isGameOver()&&s.game.turn()==='b')makeOpponentMove();return}
  const paused=await coachEvent('after_move',fenBefore,move);
  if(!paused&&!s.game.isGameOver()&&s.game.turn()==='b')makeOpponentMove();
}
async function coachAfterOpponent(fenBefore,move){if(s.missingKey)return;await coachEvent('opponent_move',fenBefore,move)}
async function makeOpponentMove(){
  if(s.opponentBusy||s.paused||s.game.isGameOver()||s.game.turn()!=='b')return;
  s.opponentBusy=true;render();
  try{
    const fenBefore=s.game.fen();
    const d=await post('/api/opponent-move',{fen:fenBefore,elo:s.opponentElo,movetime:220});
    const u=d.move;
    if(!u||u==='(none)')return;
    const move=s.game.move({from:u.slice(0,2),to:u.slice(2,4),promotion:u[4]||'q'});
    pushVoiceContext();render();
    await coachAfterOpponent(fenBefore,move);
  }catch(e){pop(`Opponent error: ${e.message}`)}
  finally{s.opponentBusy=false;render()}
}
async function askCoach(text){
  if(!text||s.coachBusy)return;
  s.messages.push({role:'user',text});s.coachBusy=true;render();
  try{
    const d=await post('/api/coach',{event:'user_question',mode:s.coachMode,fen:s.game.fen(),currentFen:s.game.fen(),recentMoves:recentMoves(),messages:s.messages});
    s.missingKey=false;
    if(d.coach?.message)s.messages.push({role:'coach',text:d.coach.message});
    captureEvidence(d.coach?.profile_updates||[]);
    if(d.coach?.pause_game)s.paused=true;
  }catch(e){
    if(e.data?.missingKey){s.missingKey=true;s.messages.push({role:'coach',text:'Stockfish is active, but conversational AI needs an OPENAI_API_KEY configured on Railway.'})}
    else s.messages.push({role:'coach',text:`Coach error: ${e.message}`});
  }finally{s.coachBusy=false;render()}
}
function profileInputGames(){
  return s.games.filter(g=>g.analysis).slice(0,40).map(g=>({
    id:g.id,opponent:g.opponent,opponentRating:g.opponentRating,rating:g.rating,result:g.result,timeClass:g.timeClass,color:g.color,
    analysis:{
      averageCpLoss:g.analysis.averageCpLoss,
      counts:g.analysis.counts,
      missedForcing:g.analysis.missedForcing,
      phaseLoss:g.analysis.phaseLoss,
      criticalPositions:(g.analysis.criticalPositions||[]).slice(0,5).map(x=>({moveNumber:x.moveNumber,playedSan:x.playedSan,bestSan:x.bestSan,cpLoss:x.cpLoss,classification:x.classification,phase:x.phase,forcingOpportunity:x.forcingOpportunity}))
    }
  }))
}
async function refreshProfilePlan(){
  if(s.profileBusy)return;
  const analyzed=profileInputGames();
  if(!analyzed.length){pop('Analyze at least one game first.');return}
  s.profileBusy=true;render();
  try{
    const puzzleEvidence=Object.values(s.puzzleMastery).filter(x=>x.attempts).slice(-50).map(x=>({skill:'puzzle mastery',direction:(x.mastery||0)>=80?'strength':(x.mastery||0)<40?'weakness':'neutral',evidence:`Puzzle ${x.id}: ${x.correct||0}/${x.attempts||0} correct, mastery ${x.mastery||0}%, streak ${x.streak||0}`,confidence:(x.attempts||0)>=3?'medium':'low'}));
    const d=await post('/api/profile-plan',{analyzedGames:analyzed,coachingEvidence:[...s.coachingEvidence,...puzzleEvidence],currentProfile:s.profilePlan,goals:{next:1800,longTerm:2000}});
    s.profilePlan=d;saveProfile();pushVoiceContext();pop('Player profile and training plan updated.');
  }catch(e){pop(e.message)}
  finally{s.profileBusy=false;render()}
}
async function batchAnalyze(){
  if(s.batchBusy)return;
  const todo=s.games.filter(g=>g.pgn&&!g.analysis).slice(0,5);
  if(!todo.length){pop('No unanalyzed games in your current library.');return}
  s.batchBusy=true;render();
  let done=0;
  for(const g of todo){
    try{
      g.analysis=await post('/api/analyze-game',{pgn:g.pgn,color:g.color,username:s.user,depth:8,maxPlayerMoves:16});
      done++;save();render();
    }catch(e){console.warn('Batch game analysis failed',e)}
  }
  s.batchBusy=false;render();
  pop(`Analyzed ${done} game${done===1?'':'s'}.`);
}


function hashText(text=''){
  let h=2166136261;
  for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)}
  return (h>>>0).toString(36);
}
function puzzleItems(){
  const seen=new Set(),items=[];
  for(const g of s.games){
    for(const p of g.analysis?.criticalPositions||[]){
      if(!p?.fen||!p?.bestUci||seen.has(p.fen))continue;
      seen.add(p.fen);
      const id=`${g.id||'game'}:${p.ply||p.moveNumber||0}:${hashText(p.fen)}`;
      items.push({...p,id,gameId:g.id,opponent:g.opponent||'Opponent',timeClass:g.timeClass||'',source:'your_game'});
    }
  }
  return items;
}
function puzzleQueue(){
  const all=puzzleItems();
  let queue;
  if(s.puzzleFilter==='all')queue=[...all].sort((a,b)=>(b.cpLoss||0)-(a.cpLoss||0));
  else if(s.puzzleFilter==='due')queue=prioritizePuzzles(all.filter(x=>masteryStatus(s.puzzleMastery[x.id])==='due'),s.puzzleMastery);
  else if(s.puzzleFilter==='new')queue=[...all].filter(x=>masteryStatus(s.puzzleMastery[x.id])==='new').sort((a,b)=>(b.cpLoss||0)-(a.cpLoss||0));
  else if(s.puzzleFilter==='mastered')queue=[...all].filter(x=>masteryStatus(s.puzzleMastery[x.id])==='mastered').sort((a,b)=>(b.cpLoss||0)-(a.cpLoss||0));
  else queue=prioritizePuzzles(all,s.puzzleMastery);
  return s.puzzleSessionSize==='all'?queue:queue.slice(0,Number(s.puzzleSessionSize)||10);
}
function currentPuzzle(){
  const items=puzzleQueue();
  if(!items.length)return null;
  return items[s.puzzleIndex%items.length];
}
function ensurePuzzleState(p){
  if(!p)return;
  if(s.puzzleBaseId!==p.id){
    s.puzzleBaseId=p.id;
    s.puzzleFen=p.fen;
    s.puzzleLineIndex=0;
    s.puzzleStep=0;
    s.puzzleResult=null;
    s.puzzleAttempt=null;
    s.puzzleHints=0;
    s.puzzleWrongThisRound=false;
    s.puzzleStartedAt=Date.now();
    s.puzzleMessages=[];
    s.puzzleLine=null;
    s.puzzleLineLoading=false;
  }
}
async function loadPuzzleLine(p){
  if(!p||s.puzzleLineLoading||(s.puzzleLine?.id===p.id))return;
  s.puzzleLineLoading=true;
  try{
    const d=await post('/api/analyze-position',{fen:p.fen,depth:10,multiPv:1});
    const pv=d.lines?.[0]?.pv||[];
    s.puzzleLine={id:p.id,pv:pv.slice(0,6)};
  }catch(e){console.warn('Puzzle continuation unavailable',e)}
  finally{s.puzzleLineLoading=false}
}
function puzzleRecord(p){
  return p?{...emptyMastery(p.id),...(s.puzzleMastery[p.id]||{}),id:p.id}:null;
}
function savePuzzleOutcome(p,correct){
  if(!p)return;
  const existing=puzzleRecord(p);
  const updated=recordPuzzleAttempt(existing,{
    correct,
    firstTry:correct&&!s.puzzleWrongThisRound&&s.puzzleHints===0,
    hints:s.puzzleHints,
    responseMs:Math.max(0,Date.now()-(s.puzzleStartedAt||Date.now()))
  });
  s.puzzleMastery[p.id]=updated;
  savePuzzleMastery();
}
function nextPuzzle(){
  const previous=currentPuzzle()?.id;
  let items=puzzleQueue();if(!items.length){s.puzzleIndex=0;s.puzzleBaseId=null;render();return}
  if(['for_you','due','new'].includes(s.puzzleFilter)){
    s.puzzleIndex=0;
    if(items[0]?.id===previous&&items.length>1)s.puzzleIndex=1;
  }else{
    s.puzzleIndex=(s.puzzleIndex+1)%items.length;
  }
  s.puzzleBaseId=null;
  ensurePuzzleState(currentPuzzle());
  render();
}
function resetPuzzle(){s.puzzleResult=null;s.puzzleAttempt=null;render()}
function setPuzzleFilter(filter){
  s.puzzleFilter=filter;s.puzzleIndex=0;s.puzzleBaseId=null;
  ensurePuzzleState(currentPuzzle());render();
}
function setPuzzleSessionSize(size){
  s.puzzleSessionSize=size==='all'?'all':Number(size);
  s.puzzleIndex=0;s.puzzleBaseId=null;
  ensurePuzzleState(currentPuzzle());render();
}
function formatNextReview(record){
  if(!record?.attempts)return 'New';
  const ms=(record.nextReviewAt||0)-Date.now();
  if(ms<=0)return 'Due now';
  const mins=Math.ceil(ms/60000);
  if(mins<60)return `In ${mins} min`;
  const hrs=Math.ceil(mins/60);
  if(hrs<24)return `In ${hrs} hr`;
  const days=Math.ceil(hrs/24);
  return `In ${days} day${days===1?'':'s'}`;
}
async function askPuzzleCoach(text){
  const p=currentPuzzle();if(!p||!text||s.puzzleCoachBusy)return;
  s.puzzleHints+=1;
  s.puzzleMessages.push({role:'user',text});s.puzzleCoachBusy=true;render();
  try{
    const d=await post('/api/coach',{
      event:'puzzle',
      mode:'guided',
      fen:s.puzzleFen||p.fen,
      currentFen:s.puzzleFen||p.fen,
      messages:s.puzzleMessages,
      studentProfile:s.profilePlan,
      reviewContext:{puzzle:{
        source:'student_game',
        opponent:p.opponent,
        moveNumber:p.moveNumber,
        phase:p.phase,
        originalMove:p.playedSan,
        bestMove:p.bestSan,
        bestUci:p.bestUci,
        classification:p.classification,
        cpLoss:p.cpLoss,
        currentAttempt:s.puzzleAttempt,
        currentResult:s.puzzleResult,
        mastery:puzzleRecord(p),
        step:s.puzzleStep
      }}
    });
    if(d.coach?.message)s.puzzleMessages.push({role:'coach',text:d.coach.message});
    captureEvidence(d.coach?.profile_updates||[]);
  }catch(e){s.puzzleMessages.push({role:'coach',text:`Coach error: ${e.message}`})}
  finally{s.puzzleCoachBusy=false;render()}
}
function puzzleDashboard(summary){
  const tabs=[['for_you','For You'],['due',`Due (${summary.due})`],['new',`New (${summary.new})`],['mastered',`Mastered (${summary.mastered})`],['all','All']];
  return `<div class="puzzleDashboard card"><div class="puzzleStats"><div><b>${summary.due}</b><span>due now</span></div><div><b>${summary.learning}</b><span>learning</span></div><div><b>${summary.mastered}</b><span>mastered</span></div><div><b>${summary.total}</b><span>total</span></div></div><div class="puzzleToolbar"><div class="puzzleTabs">${tabs.map(([v,l])=>`<button class="${s.puzzleFilter===v?'active':''}" data-puzzle-filter="${v}">${l}</button>`).join('')}</div><label class="sessionSize">Session <select class="select miniSelect" id="puzzleSessionSize">${[5,10,20,'all'].map(v=>`<option value="${v}" ${String(s.puzzleSessionSize)===String(v)?'selected':''}>${v==='all'?'All':v}</option>`).join('')}</select></label></div></div>`;
}
function puzzles(){
  const all=puzzleItems();
  const summary=masterySummary(all,s.puzzleMastery);
  const p=currentPuzzle();
  if(!all.length)return `<section class="page"><div class="head"><div><h1>Puzzles</h1><p>Personalized tactical and calculation practice.</p></div></div><div class="card pad emptyState"><h3>Build your personal puzzle queue</h3><p>Analyze a few of your Chess.com or uploaded games. Critical positions from those games will appear here automatically.</p><button class="btn primary" data-route="analyze">Analyze games</button></div></section>`;
  if(!p)return `<section class="page"><div class="head"><div><h1>Puzzles</h1><p>Spaced review from your own games.</p></div></div>${puzzleDashboard(summary)}<div class="card pad emptyState"><h3>Nothing in this queue</h3><p>${s.puzzleFilter==='due'?'You have no puzzles due right now.':'There are no puzzles in this category yet.'}</p><button class="btn" data-puzzle-filter="for_you">Return to For You</button></div></section>`;
  ensurePuzzleState(p);
  if(!s.puzzleLine&&!s.puzzleLineLoading)setTimeout(()=>loadPuzzleLine(p),0);
  const queue=puzzleQueue(),rec=puzzleRecord(p);
  const result=s.puzzleResult==='correct'
    ? `<div class="puzzleFeedback correct"><strong>Sequence complete.</strong><span>This position is scheduled for review ${formatNextReview(rec).toLowerCase()}.</span><button class="btn primary" data-action="puzzle-next">Next position</button></div>`
    : s.puzzleResult==='continue'
      ? `<div class="puzzleFeedback continue"><strong>Good first move.</strong><span>The opponent has replied. Find the continuation.</span></div>`
      : s.puzzleResult==='incorrect'
        ? `<div class="puzzleFeedback incorrect"><strong>Look again.</strong><span>${esc(s.puzzleAttempt||'That move')} was legal, but it misses the strongest continuation. This position is now in your review queue.</span><div class="actions"><button class="btn" data-action="puzzle-retry">Try again</button><button class="btn" data-action="puzzle-next">Skip</button></div></div>`
        : `<div class="notice">${rec.attempts?`This is a spaced review. Mastery: ${rec.mastery}%.`:'This position came from one of your analyzed games.'} Find the strongest continuation.</div>`;
  return `<section class="page"><div class="head"><div><h1>Puzzles</h1><p>Spaced repetition built from positions you actually mishandled.</p></div><span class="sub" style="margin-left:auto">${Math.min(s.puzzleIndex+1,queue.length)} / ${queue.length}</span></div>${puzzleDashboard(summary)}<div class="puzzleWorkspace"><div class="card boardCard"><div class="puzzleMeta"><span>vs. ${esc(p.opponent)}</span><span>Move ${p.moveNumber}</span><span>${esc(p.phase||'')}</span><span class="masteryChip">${rec.mastery}% mastery</span></div>${board(new Chess(s.puzzleFen||p.fen),true,'puzzle-board')}</div><aside class="card pad puzzleSide"><div class="label">From your game · ${esc(masteryStatus(rec))}</div><h2 style="margin:6px 0 4px">Find the best continuation</h2><p class="sub">Original move: <strong>${esc(p.playedSan||'—')}</strong> · ${esc((p.classification||'critical').replaceAll('_',' '))}</p><div class="masteryMeter"><div class="fill" style="width:${rec.mastery}%"></div></div><div class="masteryMeta"><span>${rec.attempts} reviews</span><span>${rec.streak} clean streak</span><span>${formatNextReview(rec)}</span></div>${result}<div class="puzzleCoachBox"><h3>Ask Coach</h3>${s.puzzleMessages.map(m=>`<div class="msg ${m.role}">${esc(m.text)}</div>`).join('')}${s.puzzleCoachBusy?'<div class="notice">Coach is thinking…</div>':''}<div class="compose puzzleCompose"><input id="puzzleCoachInput" class="input" placeholder="Explain what you see or ask for a hint…" ${s.puzzleCoachBusy?'disabled':''}><button class="btn primary" data-action="puzzle-coach-send" ${s.puzzleCoachBusy?'disabled':''}>Send</button></div></div><div class="section"><button class="btn" data-action="puzzle-next">Next puzzle</button></div></aside></div></section>`;
}
const go=r=>{s.route=r;location.hash='#/'+r;render()};
window.addEventListener('hashchange',()=>{s.route=location.hash.replace('#/','')||'home';render()});
function shell(body){const nav=NAV.map(([id,i,l])=>`<button class="${s.route===id?'active':''}" data-route="${id}">${i} &nbsp;${l}</button>`).join('');const mob=NAV.filter(n=>['home','play','puzzles','analyze','progress'].includes(n[0])).map(([id,i,l])=>`<button class="${s.route===id?'active':''}" data-route="${id}">${i}<br>${l}</button>`).join('');return `<div class="shell"><aside class="side"><div class="brand"><b>♞</b>Chess Coach</div><nav class="nav">${nav}</nav><div class="profile">CG &nbsp; Chris<br>Personal coach</div></aside><main><header class="top"><strong>${NAV.find(n=>n[0]===s.route)?.[2]||'Chess Coach'}</strong><button data-route="play">Ask Coach</button></header>${body}</main><nav class="mobile">${mob}</nav></div>${s.toast?`<div class="toast">${esc(s.toast)}</div>`:''}`}
function rec(i,t,d,r){return `<div class="recItem"><i>${i}</i><strong>${t}</strong><span>${d}</span><button class="btn" data-route="${r}">Start</button></div>`}
function quick(i,t,d,r){return `<button class="quick" data-route="${r}"><i>${i}</i><strong>${t}</strong><span>${d}</span></button>`}
function home(){
  const p=s.profilePlan;
  const mastery=masterySummary(puzzleItems(),s.puzzleMastery);
  const openingReviews=masterySummary(openingTrainingItems(),s.openingMastery);
  const weekly=[...(p?.weekly_plan||[])];
  const cards=[];
  if(mastery.due>0)cards.push({activity:'Review due puzzles',minutes:Math.min(15,Math.max(5,mastery.due*2)),focus:`${mastery.due} position${mastery.due===1?'':'s'} due`,destination:'puzzles'});
  if(openingReviews.due>0&&cards.length<4)cards.push({activity:'Review opening repertoire',minutes:Math.min(15,Math.max(5,openingReviews.due*2)),focus:`${openingReviews.due} position${openingReviews.due===1?'':'s'} due`,destination:'openings'});
  for(const x of weekly){if(cards.length>=4)break;cards.push(x)}
  if(!cards.length)cards.push(
    {activity:'Tactical warm-up',minutes:10,focus:'Recent weaknesses',destination:'puzzles'},
    {activity:'Calculation',minutes:15,focus:'Candidate moves',destination:'learn'},
    {activity:'Rook endings',minutes:15,focus:'Practical positions',destination:'learn'},
    {activity:'Play with Coach',minutes:20,focus:'Play and discuss',destination:'play'}
  );
  const recs=cards.slice(0,4).map((x,i)=>rec(['✣','◎','♜','♞'][i]||'•',x.activity,`${x.minutes} min · ${x.focus}`,x.destination)).join('');
  const dueParts=[];
  if(mastery.due)dueParts.push(`${mastery.due} puzzle${mastery.due===1?'':'s'}`);
  if(openingReviews.due)dueParts.push(`${openingReviews.due} opening position${openingReviews.due===1?'':'s'}`);
  const why=dueParts.length
    ? `${dueParts.join(' and ')} due for spaced review. ${p?.summary||'The rest of the plan comes from your current development priorities.'}`
    : p?.summary||'Your plan will be generated from imported games, puzzle mastery, opening mastery, and coaching evidence. It is always optional.';
  return `<section class="page"><div class="head"><div><h1>Good morning, Chris</h1><p>Better decisions. Stronger chess.</p></div></div><div class="grid3"><div class="card summary"><div class="label">Chess.com Rapid</div><div class="value">1,438</div><div class="sub">Current working baseline</div></div><div class="card summary"><div class="label">Next milestone</div><div class="value">1,800</div><div class="sub">Longer-term goal: 2,000</div></div><div class="card summary"><div class="label">Reviews due</div><div class="value">${mastery.due+openingReviews.due}</div><div class="sub">${mastery.due} puzzles · ${openingReviews.due} openings</div></div></div><div class="card rec"><div class="recHead"><h2>Today’s recommendation</h2><span class="sub">Optional</span><button class="btn" style="margin-left:auto" data-action="refresh-profile">${s.profileBusy?'Updating…':'Update plan'}</button></div><div class="recBody"><div class="recList">${recs}</div><div class="why"><strong>Why these?</strong><br><br>${esc(why)}</div></div></div><div class="section"><h2>Or choose what you’d like to do</h2><div class="quickGrid">${quick('🎮','Play','Train with the AI coach','play')}${quick('✣','Puzzles',mastery.due?`${mastery.due} due for review`:'Practice tactics and calculation','puzzles')}${quick('▤','Learn','Browse concepts and lessons','learn')}${quick('♙','Openings',openingReviews.due?`${openingReviews.due} due for review`:'Study and practice your repertoire','openings')}${quick('⌕','Analyze','Import and review games','analyze')}${quick('▥','Progress','See your learning profile','progress')}</div></div></section>`;
}
function board(game,interactive=true,id='chessboard'){return `<div class="boardShell"><div class="boardFrame"><div class="cmBoard" id="${id}" data-interactive="${interactive?'1':'0'}"></div></div></div>`}
function destroyBoards(){for(const b of mountedBoards){try{b.destroy()}catch{}}mountedBoards=[]}
function mountCmBoard(id,game,interactive=false){
  const el=document.getElementById(id);if(!el||!game)return;
  const cm=new CmChessboard(el,{
    position:game.fen(),
    orientation:s.orient==='white'?COLOR.white:COLOR.black,
    responsive:true,
    assetsUrl:CM_ASSETS,
    style:{cssClass:'blue',showCoordinates:true,aspectRatio:1,animationDuration:180}
  });
  mountedBoards.push(cm);
  if(!interactive)return;
  cm.enableMoveInput(event=>{
    if(event.type===INPUT_EVENT_TYPE.moveInputStarted){
      if(s.paused||s.opponentBusy||s.game.isGameOver()||s.game.turn()!=='w')return false;
      const piece=s.game.get(event.squareFrom);
      return !!piece&&piece.color==='w';
    }
    if(event.type===INPUT_EVENT_TYPE.validateMoveInput){
      const legal=s.game.moves({square:event.squareFrom,verbose:true});
      const move=legal.find(x=>x.to===event.squareTo&&(!x.promotion||x.promotion==='q'));
      if(!move)return false;
      const fenBefore=s.game.fen();
      const done=s.game.move({from:event.squareFrom,to:event.squareTo,promotion:move.promotion||'q'});
      pendingBoardMove={fenBefore,done};
      return true;
    }
    if(event.type===INPUT_EVENT_TYPE.moveInputFinished&&pendingBoardMove){
      const {fenBefore,done}=pendingBoardMove;pendingBoardMove=null;
      pushVoiceContext();render();coachAfterMove(fenBefore,done);
    }
    return true;
  },COLOR.white);
}

function mountPuzzleBoard(){
  const p=currentPuzzle(),el=document.getElementById('puzzle-board');if(!p||!el)return;
  ensurePuzzleState(p);
  const game=new Chess(s.puzzleFen||p.fen);
  const originalTurn=new Chess(p.fen).turn();
  const turn=game.turn();
  const cm=new CmChessboard(el,{
    position:game.fen(),
    orientation:originalTurn==='w'?COLOR.white:COLOR.black,
    responsive:true,
    assetsUrl:CM_ASSETS,
    style:{cssClass:'blue',showCoordinates:true,aspectRatio:1,animationDuration:180}
  });
  mountedBoards.push(cm);
  cm.enableMoveInput(event=>{
    if(['correct','incorrect'].includes(s.puzzleResult))return false;
    if(event.type===INPUT_EVENT_TYPE.moveInputStarted){
      const piece=game.get(event.squareFrom);return !!piece&&piece.color===turn;
    }
    if(event.type===INPUT_EVENT_TYPE.validateMoveInput){
      const legal=game.moves({square:event.squareFrom,verbose:true});
      const move=legal.find(x=>x.to===event.squareTo&&(!x.promotion||x.promotion==='q'));
      if(!move)return false;
      const uci=event.squareFrom+event.squareTo+(move.promotion||'');
      const line=s.puzzleLine?.id===p.id?s.puzzleLine.pv:[];
      const expected=line[s.puzzleLineIndex]||(s.puzzleLineIndex===0?p.bestUci:null);
      s.puzzleAttempt=move.san;
      if(expected&&uci!==expected){
        if(!s.puzzleWrongThisRound){s.puzzleWrongThisRound=true;savePuzzleOutcome(p,false)}
        s.puzzleResult='incorrect';
        setTimeout(render,80);
        return false;
      }
      const done=game.move({from:event.squareFrom,to:event.squareTo,promotion:move.promotion||'q'});
      if(!done)return false;
      pendingBoardMove={type:'puzzle',puzzle:p,game,cm};
      return true;
    }
    if(event.type===INPUT_EVENT_TYPE.moveInputFinished&&pendingBoardMove?.type==='puzzle'){
      const line=s.puzzleLine?.id===p.id?s.puzzleLine.pv:[];
      const opponentUci=line[s.puzzleLineIndex+1];
      const nextUserUci=line[s.puzzleLineIndex+2];
      s.puzzleStep+=1;
      pendingBoardMove=null;
      if(opponentUci&&nextUserUci&&s.puzzleStep<2&&!game.isGameOver()){
        try{
          game.move({from:opponentUci.slice(0,2),to:opponentUci.slice(2,4),promotion:opponentUci[4]||'q'});
          s.puzzleFen=game.fen();
          s.puzzleLineIndex+=2;
          s.puzzleResult='continue';
          setTimeout(render,180);
          return true;
        }catch{}
      }
      s.puzzleFen=game.fen();
      s.puzzleResult='correct';
      savePuzzleOutcome(p,true);
      setTimeout(render,100);
    }
    return true;
  },turn==='w'?COLOR.white:COLOR.black);
}
function mountBoards(){
  if(s.route==='play')mountCmBoard('play-board',s.game,true);
  if(s.route==='review')mountCmBoard('review-board',s.rgame,false);
  if(s.route==='puzzles')mountPuzzleBoard();
  if(s.route==='opening-practice')mountOpeningBoard();
}
function coach(){const status=s.opponentBusy?'Opponent is thinking…':s.coachBusy?'Coach is thinking…':s.paused?'Game paused for coaching discussion.':s.voiceStatus==='connecting'?'Connecting voice…':s.voiceStatus==='on'?'Voice coach connected. Think aloud or ask questions naturally.':s.missingKey?'Stockfish is active. Add OPENAI_API_KEY on Railway to enable conversational coaching.':'The coach uses engine evidence selectively and can stay quiet when no intervention is useful.';return `<aside class="card coach"><div class="coachHead">AI Coach <button class="btn voiceBtn" data-action="${s.voiceStatus==='on'?'voice-stop':'voice-start'}" ${s.voiceStatus==='connecting'?'disabled':''}>${s.voiceStatus==='on'?'End voice':s.voiceStatus==='connecting'?'Connecting…':'🎙 Voice'}</button></div><div class="feed">${s.messages.map(m=>`<div class="msg ${m.role}">${esc(m.text)}</div>`).join('')}<div class="notice">${status}</div>${s.voiceError?`<div class="notice">${esc(s.voiceError)}</div>`:''}${s.paused?`<button class="btn primary" data-action="continue-game">Continue game</button>`:''}</div><div class="compose"><input id="coachInput" class="input" placeholder="Ask about the position…" ${s.coachBusy?'disabled':''}><button class="btn primary" data-action="send" ${s.coachBusy?'disabled':''}>Send</button></div></aside>`}
function play(){return `<section class="page"><div class="head"><div><h1>Play with Coach</h1><p>Play White against a limited-strength Stockfish opponent while the coach observes your reasoning.</p></div></div><div class="workspace"><div class="card boardCard"><div class="player">Training opponent <select id="opponentElo" class="select miniSelect">${[1350,1450,1600,1800,2000].map(x=>`<option value="${x}" ${s.opponentElo===x?'selected':''}>~${x}</option>`).join('')}</select><span class="sub">&nbsp;Stockfish limited strength</span><span class="clock">15:00</span></div>${board(s.game,true,'play-board')}<div class="player">You <span class="sub">&nbsp;White · current baseline ~1438</span><span class="clock">15:00</span></div><div class="actions"><button class="btn" data-action="new">New game</button><button class="btn" data-action="undo">Undo turn</button><button class="btn" data-action="flip">Flip</button><select id="coachMode" class="select miniSelect">${[['normal','Normal'],['guided','Guided'],['minimal','Minimal'],['assessment','Assessment'],['ask_only','Ask only']].map(([v,l])=>`<option value="${v}" ${s.coachMode===v?'selected':''}>${l}</option>`).join('')}</select><span class="sub">${s.paused?'Paused':s.opponentBusy?'Opponent thinking':s.game.isGameOver()?'Game over':s.game.turn()==='w'?'Your move':'Opponent move'}</span></div></div>${coach()}</div></section>`}
function clickSquare(q){if(s.paused||s.opponentBusy||s.game.isGameOver()||s.game.turn()!=='w')return;if(!s.sel){const p=s.game.get(q);if(!p||p.color!=='w')return;s.sel=q;s.legal=s.game.moves({square:q,verbose:true});return render()}if(q===s.sel){s.sel=null;s.legal=[];return render()}const m=s.legal.find(x=>x.to===q);if(m){const fenBefore=s.game.fen();const done=s.game.move({from:s.sel,to:q,promotion:'q'});s.sel=null;s.legal=[];pushVoiceContext();render();coachAfterMove(fenBefore,done);return}const p=s.game.get(q);if(p&&p.color==='w'){s.sel=q;s.legal=s.game.moves({square:q,verbose:true});render()}}
function analyze(){const analyzed=s.games.filter(g=>g.analysis).length;return `<section class="page"><div class="head"><div><h1>Analyze a Game</h1><p>Import completed Chess.com games or upload PGNs.</p></div></div><div class="tabs"><button class="tab active">Import games</button><button class="tab">Your games</button></div><div class="importGrid"><div class="card pad"><h3>Import games</h3><div class="label">Chess.com username</div><div class="row" style="margin-top:7px"><input id="chessUser" class="input" value="${esc(s.user)}" placeholder="username"><button class="btn primary" data-action="sync">Sync</button></div><p class="sub">Imports completed public games only. No password required.</p><div style="height:12px"></div><label class="drop" id="drop"><input id="file" type="file" accept=".pgn,text/plain" hidden>Upload PGN file<br>or drag and drop here</label><div style="height:12px"></div><textarea id="pgn" class="textarea" placeholder="Paste PGN here…"></textarea><button class="btn" style="margin-top:8px" data-action="pgn">Import PGN</button></div><div class="card pad"><div style="display:flex;align-items:center;gap:8px"><h3 style="margin:0">Your games</h3><span class="sub" style="margin-left:auto">${s.games.length} imported · ${analyzed} analyzed</span></div><div class="actions"><button class="btn primary" data-action="batch-analyze" ${s.batchBusy?'disabled':''}>${s.batchBusy?'Analyzing games…':'Analyze next 5 games'}</button><button class="btn" data-action="refresh-profile" ${s.profileBusy||!analyzed?'disabled':''}>${s.profileBusy?'Updating…':'Update player profile'}</button></div><div class="gameList">${gameList()}</div></div></div></section>`}
function gameList(){if(!s.games.length)return '<div class="sub">No games imported yet.</div>';return s.games.slice(0,80).map((g,i)=>`<button class="game" data-review="${i}"><div><strong>vs. ${esc(g.opponent||'Opponent')}</strong><small>${esc(g.timeClass||'PGN')} · ${g.opponentRating||''}</small></div><strong>${g.result==='win'?'1–0':['agreed','repetition','stalemate','insufficient'].includes(g.result)?'½–½':'0–1'}</strong></button>`).join('')}
function parsePgn(txt){return txt.split(/(?=\[Event\s)/g).map(x=>x.trim()).filter(Boolean).flatMap((x,i)=>{try{const c=new Chess();c.loadPgn(x,{strict:false});const h=c.header();return[{id:'pgn-'+Date.now()+'-'+i,pgn:x,opponent:`${h.White||'White'} vs ${h.Black||'Black'}`,opponentRating:h.BlackElo||h.WhiteElo||'',result:h.Result==='1-0'?'win':h.Result==='1/2-1/2'?'agreed':'loss',timeClass:h.Event||'PGN'}]}catch{return[]}})}
async function sync(){const u=document.querySelector('#chessUser')?.value.trim();if(!u)return pop('Enter a Chess.com username.');try{const r=await fetch('/api/chesscom?username='+encodeURIComponent(u)),d=await r.json();if(!r.ok)throw new Error(d.error||'Import failed');const seen=new Set(s.games.map(g=>g.id));s.games=[...d.games.filter(g=>!seen.has(g.id)),...s.games];s.user=u;localStorage.setItem('cc_chess_user',u);save();pop(`Imported ${d.games.length} recent games.`)}catch(e){pop(e.message)}}
function openReview(i){const g=s.games[i];try{const c=new Chess();c.loadPgn(g.pgn,{strict:false});s.review={...g,h:c.history({verbose:true}),_index:i};s.rgame=new Chess();s.ply=0;s.reviewMessages=[{role:'coach',text:'Walk me through what you were thinking in the positions that mattered. I’ll use the engine as evidence, not as the lesson.'}];go('review')}catch{pop('Could not parse this game.')}}
async function analyzeReviewedGame(){
  if(!s.review||s.analysisBusy)return;
  s.analysisBusy=true;render();
  try{
    const d=await post('/api/analyze-game',{pgn:s.review.pgn,color:s.review.color,username:s.user,depth:9,maxPlayerMoves:18});
    s.review.analysis=d;
    const i=s.review._index;
    if(Number.isInteger(i)&&s.games[i]){s.games[i].analysis=d;save()}
    pop(`Analyzed ${d.analyzedMoves} of your moves with Stockfish.`);
  }catch(e){pop(e.message)}
  finally{s.analysisBusy=false;render()}
}
async function askReviewCoach(text){
  if(!text||s.reviewCoachBusy||!s.review)return;
  s.reviewMessages.push({role:'user',text});s.reviewCoachBusy=true;render();
  const evidence=s.review.analysis?.moves?.find(x=>x.ply===s.ply+1)||s.review.analysis?.moves?.find(x=>x.ply===s.ply)||null;
  try{
    const d=await post('/api/coach',{
      event:'game_review',
      mode:'normal',
      fen:s.rgame.fen(),
      currentFen:s.rgame.fen(),
      recentMoves:s.review.h.slice(0,s.ply).map(x=>x.san).slice(-20),
      messages:s.reviewMessages,
      reviewContext:{
        game:{opponent:s.review.opponent,result:s.review.result,color:s.review.color,timeClass:s.review.timeClass},
        currentPly:s.ply,
        currentMoveEvidence:evidence,
        gameSummary:s.review.analysis?{averageCpLoss:s.review.analysis.averageCpLoss,counts:s.review.analysis.counts,missedForcing:s.review.analysis.missedForcing,phaseLoss:s.review.analysis.phaseLoss}:null
      }
    });
    s.missingKey=false;
    if(d.coach?.message)s.reviewMessages.push({role:'coach',text:d.coach.message});
    captureEvidence(d.coach?.profile_updates||[]);
  }catch(e){
    if(e.data?.missingKey){s.missingKey=true;s.reviewMessages.push({role:'coach',text:'Conversational review is ready but needs OPENAI_API_KEY on Railway. Stockfish game analysis works without it.'})}
    else s.reviewMessages.push({role:'coach',text:`Coach error: ${e.message}`});
  }finally{s.reviewCoachBusy=false;render()}
}
function reviewAnalysis(){
  const a=s.review?.analysis;
  if(!a)return `<div class="msg coach">Run Stockfish analysis to identify the most important positions in this game. The coach can then use those positions as evidence for a conversational review.</div><button class="btn primary" data-action="analyze-review" ${s.analysisBusy?'disabled':''}>${s.analysisBusy?'Analyzing…':'Analyze with Stockfish'}</button>`;
  const c=a.counts||{};
  const critical=(a.criticalPositions||[]).map(x=>`<button class="crit" data-ply="${Math.max(0,x.ply-1)}"><strong>${x.moveNumber}. ${esc(x.playedSan)}</strong><span>${esc(x.classification.replaceAll('_',' '))} · ${x.cpLoss} cp</span><small>Engine preferred ${esc(x.bestSan||'another move')}</small></button>`).join('');
  return `<div class="analysisSummary"><div class="metric"><b>${a.averageCpLoss}</b><span>avg cp loss</span></div><div class="metric"><b>${c.blunder||0}</b><span>blunders</span></div><div class="metric"><b>${c.mistake||0}</b><span>mistakes</span></div></div><p class="sub">Engine evidence, not a coaching verdict. The AI coach uses these positions selectively.</p><div class="criticalList">${critical||'<div class="sub">No major errors found in the analyzed sample.</div>'}</div><button class="btn" data-action="analyze-review">Re-analyze</button>`;
}
function setPly(n){const c=new Chess(),h=s.review?.h||[];for(let i=0;i<Math.min(n,h.length);i++)c.move(h[i].san);s.rgame=c;s.ply=Math.max(0,Math.min(n,h.length));pushVoiceContext();render()}
function review(){if(!s.review)return analyze();const h=s.review.h,pairs=[];for(let i=0;i<h.length;i+=2)pairs.push([i/2+1,h[i],h[i+1]]);return `<section class="page"><div class="head"><div><h1>Game Review</h1><p>${esc(s.review.opponent||'Opponent')} · move ${s.ply}/${h.length}</p></div></div><div class="review"><div class="card boardCard">${board(s.rgame,false,'review-board')}<div class="actions"><button class="btn" data-ply="0">⏮</button><button class="btn" data-action="prev">←</button><button class="btn" data-action="next">→</button><button class="btn" data-ply="${h.length}">⏭</button></div></div><div class="card moves">${pairs.map(([n,w,b],i)=>`<div class="moveRow"><span class="sub">${n}.</span><button class="${s.ply===i*2+1?'active':''}" data-ply="${i*2+1}">${w?.san||''}</button><button class="${s.ply===i*2+2?'active':''}" ${b?`data-ply="${i*2+2}"`:''}>${b?.san||''}</button></div>`).join('')}</div><div class="card coach"><div class="coachHead">Coach Review <button class="btn voiceBtn" data-action="${s.voiceStatus==='on'?'voice-stop':'voice-start'}" ${s.voiceStatus==='connecting'?'disabled':''}>${s.voiceStatus==='on'?'End voice':s.voiceStatus==='connecting'?'Connecting…':'🎙 Voice'}</button></div><div class="feed"><div class="reviewEngine">${reviewAnalysis()}</div>${s.reviewMessages.map(m=>`<div class="msg ${m.role}">${esc(m.text)}</div>`).join('')}${s.reviewCoachBusy?'<div class="notice">Coach is analyzing this position…</div>':''}</div><div class="compose"><input id="reviewCoachInput" class="input" placeholder="Ask about this position or explain your thinking…" ${s.reviewCoachBusy?'disabled':''}><button class="btn primary" data-action="review-send" ${s.reviewCoachBusy?'disabled':''}>Send</button></div></div></div></section>`}
async function loadLesson(topic,force=false){
  if(s.lessonBusy||(!force&&s.lessonCache[topic]))return;
  s.lessonBusy=true;render();
  try{
    const lesson=await post('/api/lesson',{topic,profile:s.profilePlan,coachingEvidence:s.coachingEvidence});
    s.lessonCache[topic]=lesson;saveLessons();
  }catch(e){pop(e.message)}
  finally{s.lessonBusy=false;render()}
}
function openLesson(topic){
  s.lessonTopic=topic;s.route='lesson';location.hash='#/lesson';render();
  if(!s.lessonCache[topic])loadLesson(topic);
}
function lesson(){
  const topic=s.lessonTopic||'Calculation',l=s.lessonCache[topic];
  if(!l)return `<section class="page"><div class="head"><div><h1>${esc(topic)}</h1><p>Personalized lesson based on your current development profile.</p></div></div><div class="card pad lessonLoading">${s.lessonBusy?'Building your lesson…':'No lesson generated yet.'}<div class="section"><button class="btn primary" data-action="lesson-refresh">Generate lesson</button></div></div></section>`;
  return `<section class="page"><div class="head"><div><h1>${esc(l.title)}</h1><p>${esc(l.objective)}</p></div><button class="btn" style="margin-left:auto" data-action="lesson-refresh">Regenerate</button></div><div class="card pad lessonHero"><div class="label">Why this matters</div><p>${esc(l.why_it_matters)}</p></div><div class="lessonGrid section">${l.concepts.map(x=>`<div class="card pad"><h3>${esc(x.name)}</h3><p>${esc(x.explanation)}</p><div class="lessonQuestion">${esc(x.question)}</div></div>`).join('')}</div><div class="progressGrid section"><div class="card pad"><h3>Decision rules</h3><ol class="lessonList">${l.decision_rules.map(x=>`<li>${esc(x)}</li>`).join('')}</ol></div><div class="card pad"><h3>Common errors</h3><ul class="lessonList">${l.common_errors.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div></div><div class="card pad section"><h3>Practice assignment</h3><strong>${esc(l.practice_assignment.activity)}</strong><p>${esc(l.practice_assignment.instructions)}</p><div class="successCriteria"><strong>Success criterion:</strong> ${esc(l.practice_assignment.success_criteria)}</div></div><div class="card pad section"><h3>Reflection</h3><ol class="lessonList">${l.reflection_questions.map(x=>`<li>${esc(x)}</li>`).join('')}</ol></div></section>`;
}

function resultBucket(result){
  if(result==='win')return 'win';
  if(['agreed','repetition','stalemate','insufficient','50move','timevsinsufficient'].includes(result))return 'draw';
  return 'loss';
}
function openingName(headers){
  if(headers.Opening)return headers.Opening+(headers.Variation?' — '+headers.Variation:'');
  const url=headers.ECOUrl||headers.ECOURL||'';
  if(url.includes('/openings/')){
    try{return decodeURIComponent(url.split('/openings/')[1].split(/[?#]/)[0]).replace(/-/g,' ')}catch{}
  }
  return headers.ECO?('ECO '+headers.ECO):'Unclassified opening';
}
function openingStats(){
  const groups=new Map();
  for(const g of s.games){
    if(!g.pgn)continue;
    try{
      const game=new Chess();game.loadPgn(g.pgn,{strict:false});
      const h=game.header(),moves=game.history();
      let color=g.color;
      if(!color&&s.user){
        const u=s.user.toLowerCase();
        if((h.White||'').toLowerCase()===u)color='white';
        else if((h.Black||'').toLowerCase()===u)color='black';
      }
      color=color||'white';
      const name=openingName(h);
      const key=color+'|'+name;
      if(!groups.has(key))groups.set(key,{color,name,games:0,wins:0,draws:0,losses:0,oppRatings:[],lines:new Map()});
      const row=groups.get(key);row.games++;
      const b=resultBucket(g.result);row[b==='win'?'wins':b==='draw'?'draws':'losses']++;
      if(g.opponentRating)row.oppRatings.push(Number(g.opponentRating));
      const line=moves.slice(0,10).join(' ');
      row.lines.set(line,(row.lines.get(line)||0)+1);
    }catch{}
  }
  return [...groups.values()].map(x=>{
    const common=[...x.lines.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]||'';
    const avgOpp=x.oppRatings.length?Math.round(x.oppRatings.reduce((a,b)=>a+b,0)/x.oppRatings.length):null;
    return {...x,common,avgOpp};
  }).sort((a,b)=>b.games-a.games);
}
function openingNameMap(){
  const map=new Map();
  for(const g of s.games){
    if(!g.id||!g.pgn)continue;
    try{
      const game=new Chess();game.loadPgn(g.pgn,{strict:false});
      map.set(g.id,openingName(game.header()));
    }catch{}
  }
  return map;
}
function openingTrainingItems(){
  const names=openingNameMap();
  return buildOpeningItems(s.games).map(x=>({...x,opening:names.get(x.games?.[0])||'Opening position'}));
}
function openingTrainingQueue(){
  let items=openingTrainingItems();
  if(s.openingScope!=='all')items=items.filter(x=>x.opening===s.openingScope);
  return openingQueue(items,s.openingMastery,{filter:s.openingFilter,color:s.openingColor,limit:s.openingSessionSize});
}
function currentOpeningItem(){
  const q=openingTrainingQueue();
  return q.length?q[s.openingIndex%q.length]:null;
}
function openingRecord(item){
  return item?{...emptyMastery(item.id),...(s.openingMastery[item.id]||{}),id:item.id}:null;
}
function ensureOpeningState(item){
  if(!item)return;
  if(s.openingBaseId!==item.id){
    s.openingBaseId=item.id;s.openingResult=null;s.openingAttempt=null;s.openingHints=0;
    s.openingWrongThisRound=false;s.openingStartedAt=Date.now();s.openingCoachMessages=[];
  }
}
function saveOpeningOutcome(item,correct){
  if(!item)return;
  const existing=openingRecord(item);
  s.openingMastery[item.id]=recordMasteryAttempt(existing,{
    correct,firstTry:correct&&!s.openingWrongThisRound&&s.openingHints===0,
    hints:s.openingHints,responseMs:Math.max(0,Date.now()-(s.openingStartedAt||Date.now()))
  });
  saveOpeningMastery();
}
function startOpeningPractice({scope='all',color='all',filter='for_you'}={}){
  s.openingScope=scope;s.openingColor=color;s.openingFilter=filter;s.openingIndex=0;s.openingBaseId=null;
  ensureOpeningState(currentOpeningItem());s.route='opening-practice';location.hash='#/opening-practice';render();
}
function nextOpeningItem(){
  const previous=currentOpeningItem()?.id,q=openingTrainingQueue();
  if(!q.length){s.openingIndex=0;s.openingBaseId=null;render();return}
  if(['for_you','due','new'].includes(s.openingFilter)){s.openingIndex=0;if(q[0]?.id===previous&&q.length>1)s.openingIndex=1}
  else s.openingIndex=(s.openingIndex+1)%q.length;
  s.openingBaseId=null;ensureOpeningState(currentOpeningItem());render();
}
function retryOpeningItem(){s.openingResult=null;s.openingAttempt=null;render()}
function setOpeningFilter(filter){s.openingFilter=filter;s.openingIndex=0;s.openingBaseId=null;ensureOpeningState(currentOpeningItem());render()}
function setOpeningColor(color){s.openingColor=color;s.openingIndex=0;s.openingBaseId=null;ensureOpeningState(currentOpeningItem());render()}
function setOpeningSessionSize(size){s.openingSessionSize=size==='all'?'all':Number(size);s.openingIndex=0;s.openingBaseId=null;ensureOpeningState(currentOpeningItem());render()}
async function askOpeningCoach(text){
  const item=currentOpeningItem();if(!item||!text||s.openingCoachBusy)return;
  s.openingHints+=1;s.openingCoachMessages.push({role:'user',text});s.openingCoachBusy=true;render();
  try{
    const d=await post('/api/coach',{event:'opening_practice',mode:'guided',fen:item.fen,currentFen:item.fen,messages:s.openingCoachMessages,studentProfile:s.profilePlan,reviewContext:{opening:{name:item.opening,color:item.color,moveNumber:item.moveNumber,expectedMove:item.expectedSan,corrected:item.corrected,originalMove:item.sourceMove,classification:item.classification,mastery:openingRecord(item),currentAttempt:s.openingAttempt,currentResult:s.openingResult}}});
    if(d.coach?.message)s.openingCoachMessages.push({role:'coach',text:d.coach.message});
    captureEvidence(d.coach?.profile_updates||[]);
  }catch(e){s.openingCoachMessages.push({role:'coach',text:`Coach error: ${e.message}`})}
  finally{s.openingCoachBusy=false;render()}
}
function openingPracticeDashboard(summary){
  const tabs=[['for_you','For You'],['due',`Due (${summary.due})`],['new',`New (${summary.new})`],['mastered',`Mastered (${summary.mastered})`],['all','All']];
  return `<div class="puzzleDashboard card openingPracticeDash"><div class="puzzleStats"><div><b>${summary.due}</b><span>due now</span></div><div><b>${summary.learning}</b><span>learning</span></div><div><b>${summary.mastered}</b><span>mastered</span></div><div><b>${summary.total}</b><span>positions</span></div></div><div class="puzzleToolbar"><div class="puzzleTabs">${tabs.map(([v,l])=>`<button class="${s.openingFilter===v?'active':''}" data-opening-filter="${v}">${l}</button>`).join('')}</div><label class="sessionSize">Side <select class="select miniSelect" id="openingColor"><option value="all" ${s.openingColor==='all'?'selected':''}>Both</option><option value="white" ${s.openingColor==='white'?'selected':''}>White</option><option value="black" ${s.openingColor==='black'?'selected':''}>Black</option></select></label><label class="sessionSize">Session <select class="select miniSelect" id="openingSessionSize">${[5,10,20,'all'].map(v=>`<option value="${v}" ${String(s.openingSessionSize)===String(v)?'selected':''}>${v==='all'?'All':v}</option>`).join('')}</select></label></div></div>`;
}
function openingPractice(){
  const all=openingTrainingItems();
  const scoped=s.openingScope==='all'?all:all.filter(x=>x.opening===s.openingScope);
  const colorScoped=s.openingColor==='all'?scoped:scoped.filter(x=>x.color===s.openingColor);
  const summary=masterySummary(colorScoped,s.openingMastery),item=currentOpeningItem();
  if(!all.length)return `<section class="page"><div class="head"><div><h1>Opening Practice</h1><p>Move recall from analyzed games.</p></div></div><div class="card pad emptyState"><h3>Analyze games first</h3><p>Opening Practice only trains positions we have analyzed, so it does not reinforce unsound moves from your history.</p><button class="btn primary" data-route="analyze">Analyze games</button></div></section>`;
  if(!item)return `<section class="page"><div class="head"><div><h1>Opening Practice</h1><p>${esc(s.openingScope==='all'?'Your analyzed repertoire':s.openingScope)}</p></div></div>${openingPracticeDashboard(summary)}<div class="card pad emptyState"><h3>Nothing in this queue</h3><p>${s.openingFilter==='due'?'No opening positions are due right now.':'No positions match the current filters.'}</p><button class="btn" data-opening-filter="for_you">Return to For You</button></div></section>`;
  ensureOpeningState(item);
  const rec=openingRecord(item),q=openingTrainingQueue(),source=item.corrected?'Correction from an analyzed game':'Move already supported by your analyzed play';
  const result=s.openingResult==='correct'
    ? `<div class="puzzleFeedback correct"><strong>Correct.</strong><span>${esc(item.expectedSan||item.expectedUci)} is scheduled ${formatNextReview(rec).toLowerCase()}.</span><button class="btn primary" data-action="opening-next">Next position</button></div>`
    : s.openingResult==='incorrect'
      ? `<div class="puzzleFeedback incorrect"><strong>Not this move.</strong><span>${esc(s.openingAttempt||'That move')} was legal, but it is not the move this repertoire position is training.</span><div class="actions"><button class="btn" data-action="opening-retry">Try again</button><button class="btn" data-action="opening-next">Skip</button></div></div>`
      : `<div class="notice">${rec.attempts?`Spaced review · ${rec.mastery}% mastery.`:'New repertoire position.'} Play the move you want to remember here.</div>`;
  return `<section class="page"><div class="head"><div><h1>Opening Practice</h1><p>${esc(item.opening)}</p></div><span class="sub" style="margin-left:auto">${Math.min(s.openingIndex+1,q.length)} / ${q.length}</span></div>${openingPracticeDashboard(summary)}<div class="puzzleWorkspace"><div class="card boardCard"><div class="puzzleMeta"><span>${item.color==='white'?'White':'Black'} repertoire</span><span>Move ${item.moveNumber}</span><span>${esc(source)}</span><span class="masteryChip">${rec.mastery}% mastery</span></div>${board(new Chess(item.fen),true,'opening-board')}</div><aside class="card pad puzzleSide"><div class="label">${esc(masteryStatus(rec))}</div><h2 style="margin:6px 0 4px">What do you play?</h2><p class="sub">${item.corrected?'This position was added because analysis found a meaningful opening mistake.':'This position reinforces an opening move that held up in analysis.'}</p><div class="masteryMeter"><div class="fill" style="width:${rec.mastery}%"></div></div><div class="masteryMeta"><span>${rec.attempts} reviews</span><span>${rec.streak} clean streak</span><span>${formatNextReview(rec)}</span></div>${result}<div class="puzzleCoachBox"><h3>Ask Coach</h3>${s.openingCoachMessages.map(m=>`<div class="msg ${m.role}">${esc(m.text)}</div>`).join('')}${s.openingCoachBusy?'<div class="notice">Coach is thinking…</div>':''}<div class="compose puzzleCompose"><input id="openingCoachInput" class="input" placeholder="Ask why, explain your idea, or request a hint…" ${s.openingCoachBusy?'disabled':''}><button class="btn primary" data-action="opening-coach-send" ${s.openingCoachBusy?'disabled':''}>Send</button></div></div><div class="section actions"><button class="btn" data-opening-lesson="${encodeURIComponent(item.opening)}">Study ideas</button><button class="btn" data-action="opening-next">Next position</button></div></aside></div></section>`;
}
function mountOpeningBoard(){
  const item=currentOpeningItem(),el=document.getElementById('opening-board');if(!item||!el)return;
  ensureOpeningState(item);
  const game=new Chess(item.fen),turn=game.turn();
  const cm=new CmChessboard(el,{position:game.fen(),orientation:item.color==='black'?COLOR.black:COLOR.white,responsive:true,assetsUrl:CM_ASSETS,style:{cssClass:'blue',showCoordinates:true,aspectRatio:1,animationDuration:180}});
  mountedBoards.push(cm);
  cm.enableMoveInput(event=>{
    if(['correct','incorrect'].includes(s.openingResult))return false;
    if(event.type===INPUT_EVENT_TYPE.moveInputStarted){const piece=game.get(event.squareFrom);return !!piece&&piece.color===turn}
    if(event.type===INPUT_EVENT_TYPE.validateMoveInput){
      const legal=game.moves({square:event.squareFrom,verbose:true});
      const move=legal.find(x=>x.to===event.squareTo&&(!x.promotion||x.promotion==='q'));
      if(!move)return false;
      const uci=event.squareFrom+event.squareTo+(move.promotion||'');s.openingAttempt=move.san;
      if(uci!==item.expectedUci){
        if(!s.openingWrongThisRound){s.openingWrongThisRound=true;saveOpeningOutcome(item,false)}
        s.openingResult='incorrect';setTimeout(render,80);return false;
      }
      game.move({from:event.squareFrom,to:event.squareTo,promotion:move.promotion||'q'});
      s.openingResult='correct';saveOpeningOutcome(item,true);setTimeout(render,100);return true;
    }
    return true;
  },turn==='w'?COLOR.white:COLOR.black);
}

function openingRow(x){
  const encoded=encodeURIComponent(x.name);
  const trainCount=openingTrainingItems().filter(i=>i.opening===x.name&&i.color===x.color).length;
  return `<div class="openingRow"><div><strong>${esc(x.name)}</strong><small>${esc(x.common||'No line available')}</small></div><div class="openingStat"><b>${x.games}</b><span>games</span></div><div class="openingStat"><b>${x.wins}-${x.draws}-${x.losses}</b><span>W-D-L</span></div><div class="openingStat"><b>${trainCount}</b><span>drills</span></div><div class="openingRowActions"><button class="btn" data-opening-lesson="${encoded}">Study ideas</button><button class="btn primary" data-opening-practice-scope="${encoded}" data-opening-practice-color="${x.color}" ${trainCount?'':'disabled'}>Practice</button></div></div>`;
}
function learn(type='learn'){
  if(type==='openings'){
    const rows=openingStats(),white=rows.filter(x=>x.color==='white').slice(0,8),black=rows.filter(x=>x.color==='black').slice(0,8);
    const train=openingTrainingItems(),summary=masterySummary(train,s.openingMastery);
    const corrected=train.filter(x=>x.corrected).length;
    if(!rows.length)return `<section class="page"><div class="head"><div><h1>Opening Lab</h1><p>Your repertoire will be built from imported games.</p></div></div><div class="card pad emptyState"><h3>Import your games first</h3><p>Once your Chess.com or PGN history is available, this page will show what you actually play as White and Black.</p><button class="btn primary" data-route="analyze">Import games</button></div></section>`;
    return `<section class="page"><div class="head"><div><h1>Opening Lab</h1><p>Your actual repertoire, validated against analysis and trained with spaced repetition.</p></div></div><div class="openingSummary grid3"><div class="card summary"><div class="label">Trainable positions</div><div class="value">${train.length}</div><div class="sub">from analyzed games</div></div><div class="card summary"><div class="label">Due for review</div><div class="value">${summary.due}</div><div class="sub">${summary.mastered} mastered</div></div><div class="card summary"><div class="label">Opening corrections</div><div class="value">${corrected}</div><div class="sub">positions where analysis changed the move</div></div></div><div class="actions section openingPrimaryActions"><button class="btn primary" data-opening-practice-scope="all" data-opening-practice-color="all">Practice For You</button><button class="btn" data-opening-practice-scope="all" data-opening-practice-color="all" data-opening-practice-filter="due" ${summary.due?'':'disabled'}>Review ${summary.due} due</button></div><div class="openingColumns section"><div class="card pad"><h3>As White</h3><p class="sub">${white.reduce((n,x)=>n+x.games,0)} games represented</p><div class="openingList">${white.map(openingRow).join('')||'<div class="sub">No White games found.</div>'}</div></div><div class="card pad"><h3>As Black</h3><p class="sub">${black.reduce((n,x)=>n+x.games,0)} games represented</p><div class="openingList">${black.map(openingRow).join('')||'<div class="sub">No Black games found.</div>'}</div></div></div><div class="card pad section"><h3>How Opening Practice is built</h3><p class="sub">Positions come only from analyzed opening moves. Moves that were already sound reinforce your existing repertoire; meaningful opening mistakes are replaced with the analyzed correction before entering spaced repetition. Results are context, not proof that an opening itself is good or bad.</p></div></section>`;
  }
  const cards=[['◎','Calculation','Candidate moves, visualization, and disciplined calculation'],['♟','Strategy','Structures, piece quality, pawn breaks, and plans'],['♜','Endgames','Core technical endings and practical conversion'],['✣','Tactics','Pattern recognition and forcing-move awareness'],['⛨','Defense','Threat recognition, prophylaxis, and resource finding'],['▤','Practical Play','Clock use, decision quality, and conversion']];
  return `<section class="page"><div class="head"><div><h1>Learn</h1><p>Choose any topic. Lessons adapt to your current player profile.</p></div></div><div class="learnGrid">${cards.map(([i,t,d])=>`<button class="card learnCard" data-lesson="${t}"><i>${i}</i><strong>${t}</strong><p class="sub">${d}</p></button>`).join('')}</div></section>`;
}
function progress(){
  const analyzed=s.games.filter(g=>g.analysis), total=analyzed.length, p=s.profilePlan;
  const counts=analyzed.reduce((a,g)=>{for(const [k,v] of Object.entries(g.analysis.counts||{}))a[k]=(a[k]||0)+v;return a},{});
  const forcing=analyzed.reduce((n,g)=>n+(g.analysis.missedForcing||0),0);
  const skills=p?.skills||[];
  const skillOrder={priority:30,developing:50,solid:70,strong:88};
  const puzzlesAll=puzzleItems(), puzzleStats=masterySummary(puzzlesAll,s.puzzleMastery);
  const reviewed=Object.values(s.puzzleMastery).filter(x=>x.attempts);
  const avgMastery=reviewed.length?Math.round(reviewed.reduce((n,x)=>n+(x.mastery||0),0)/reviewed.length):0;
  const totalPuzzleAttempts=reviewed.reduce((n,x)=>n+(x.attempts||0),0);
  const puzzleAccuracy=totalPuzzleAttempts?Math.round(reviewed.reduce((n,x)=>n+(x.correct||0),0)/totalPuzzleAttempts*100):0;
  const evidence=`<div class="card pad"><div style="display:flex;align-items:center"><h3>Player profile</h3><button class="btn" style="margin-left:auto" data-action="refresh-profile">${s.profileBusy?'Updating…':'Update profile'}</button></div>${p?`<p>${esc(p.summary)}</p>${skills.map(x=>`<div class="skill"><span>${esc(x.skill)}</span><div class="bar"><div class="fill" style="width:${skillOrder[x.level]||50}%"></div></div><b style="font-size:10px">${esc(x.level)}</b></div>`).join('')}<p class="sub">Profile confidence grows as more games, puzzles, and coaching conversations are analyzed.</p>`:`<p class="sub">Analyze games and train puzzles to build your adaptive player profile.</p>${total?`<button class="btn primary" data-action="refresh-profile">Generate profile</button>`:`<button class="btn primary" data-route="analyze">Analyze games</button>`}`}</div>`;
  const priorities=p?.priorities?.length?p.priorities.map((x,i)=>`<div class="priority"><strong>${i+1}. ${esc(x.skill)}</strong><p>${esc(x.why)}</p><p class="sub">${esc(x.evidence)}</p></div>`).join(''):`<div class="priority"><strong>Evidence needed</strong><p>Analyze your completed games to identify recurring development priorities.</p></div>`;
  const stats=`<div class="card pad"><h3>Engine evidence</h3><div class="analysisSummary"><div class="metric"><b>${total}</b><span>games analyzed</span></div><div class="metric"><b>${counts.blunder||0}</b><span>blunders</span></div><div class="metric"><b>${forcing}</b><span>missed forcing ideas</span></div></div><h3 style="margin-top:20px">Current priorities</h3>${priorities}</div>`;
  const puzzleCard=`<div class="card pad section"><div style="display:flex;align-items:center"><h3>Puzzle mastery</h3><button class="btn" style="margin-left:auto" data-route="puzzles">Train</button></div><div class="puzzleProgressGrid"><div class="metric"><b>${puzzleStats.due}</b><span>due now</span></div><div class="metric"><b>${puzzleStats.mastered}</b><span>mastered</span></div><div class="metric"><b>${avgMastery}%</b><span>avg mastery</span></div><div class="metric"><b>${puzzleAccuracy}%</b><span>solve rate</span></div></div><p class="sub">${puzzleStats.total} personal positions generated from analyzed games. Missed positions return sooner; clean streaks expand their review interval.</p></div>`;
  return `<section class="page"><div class="head"><div><h1>My Chess</h1><p>Your goals, evidence-driven skill model, and adaptive plan.</p></div></div><div class="grid3"><div class="card summary"><div class="label">Current rapid</div><div class="value">1,438</div></div><div class="card summary"><div class="label">Next milestone</div><div class="value">1,800</div></div><div class="card summary"><div class="label">Long-term goal</div><div class="value">2,000</div></div></div><div class="progressGrid">${evidence}${stats}</div>${puzzleCard}${p?.weekly_plan?.length?`<div class="card pad section"><h3>Recommended training mix</h3><div class="quickGrid">${p.weekly_plan.map(x=>`<button class="quick" data-route="${x.destination}"><strong>${esc(x.activity)}</strong><span>${x.minutes} min · ${esc(x.focus)}</span><small class="sub">${esc(x.reason)}</small></button>`).join('')}</div><p class="sub">This plan is a recommendation, not a required sequence. You can train anywhere in the app at any time.</p></div>`:''}</section>`;
}
function page(){if(s.route==='home')return home();if(s.route==='play')return play();if(s.route==='analyze')return analyze();if(s.route==='review')return review();if(s.route==='progress')return progress();if(s.route==='lesson')return lesson();if(s.route==='puzzles')return puzzles();if(s.route==='opening-practice')return openingPractice();if(s.route==='openings')return learn('openings');return learn()}
function pop(m){s.toast=m;render();setTimeout(()=>{s.toast=null;render()},2300)}
function bind(){document.querySelectorAll('[data-route]').forEach(e=>e.onclick=()=>go(e.dataset.route));document.querySelectorAll('[data-lesson]').forEach(e=>e.onclick=()=>openLesson(e.dataset.lesson));document.querySelectorAll('[data-opening-lesson]').forEach(e=>e.onclick=()=>openLesson('Opening study: '+decodeURIComponent(e.dataset.openingLesson)));document.querySelectorAll('[data-opening-practice-scope]').forEach(e=>e.onclick=()=>startOpeningPractice({scope:decodeURIComponent(e.dataset.openingPracticeScope),color:e.dataset.openingPracticeColor||'all',filter:e.dataset.openingPracticeFilter||'for_you'}));document.querySelectorAll('[data-opening-filter]').forEach(e=>e.onclick=()=>setOpeningFilter(e.dataset.openingFilter));document.querySelector('#openingColor')?.addEventListener('change',e=>setOpeningColor(e.target.value));document.querySelector('#openingSessionSize')?.addEventListener('change',e=>setOpeningSessionSize(e.target.value));document.querySelector('[data-action=opening-next]')?.addEventListener('click',nextOpeningItem);document.querySelector('[data-action=opening-retry]')?.addEventListener('click',retryOpeningItem);document.querySelector('[data-action=opening-coach-send]')?.addEventListener('click',()=>askOpeningCoach(document.querySelector('#openingCoachInput')?.value.trim()));document.querySelector('#openingCoachInput')?.addEventListener('keydown',e=>{if(e.key==='Enter')askOpeningCoach(e.currentTarget.value.trim())});document.querySelector('[data-action=lesson-refresh]')?.addEventListener('click',()=>{if(s.lessonTopic)loadLesson(s.lessonTopic,true)});document.querySelectorAll('[data-square]').forEach(e=>e.onclick=()=>clickSquare(e.dataset.square));document.querySelector('[data-action=new]')?.addEventListener('click',()=>{s.game=new Chess();s.sel=null;s.legal=[];s.paused=false;s.opponentBusy=false;s.messages=[{role:'coach',text:'New training game. Play naturally; I’ll intervene selectively.'}];render()});document.querySelector('[data-action=undo]')?.addEventListener('click',()=>{if(s.opponentBusy)return;s.paused=false;s.game.undo();if(s.game.turn()==='b')s.game.undo();render()});document.querySelector('[data-action=flip]')?.addEventListener('click',()=>{s.orient=s.orient==='white'?'black':'white';render()});document.querySelector('[data-action=continue-game]')?.addEventListener('click',()=>{s.paused=false;render();if(s.game.turn()==='b')makeOpponentMove()});document.querySelector('#opponentElo')?.addEventListener('change',e=>{s.opponentElo=Number(e.target.value)});document.querySelector('#coachMode')?.addEventListener('change',e=>{s.coachMode=e.target.value});document.querySelector('[data-action=send]')?.addEventListener('click',()=>askCoach(document.querySelector('#coachInput')?.value.trim()));document.querySelector('[data-action=voice-start]')?.addEventListener('click',startVoice);document.querySelector('[data-action=voice-stop]')?.addEventListener('click',stopVoice);document.querySelector('#coachInput')?.addEventListener('keydown',e=>{if(e.key==='Enter')askCoach(e.currentTarget.value.trim())});document.querySelector('[data-action=analyze-review]')?.addEventListener('click',analyzeReviewedGame);document.querySelector('[data-action=review-send]')?.addEventListener('click',()=>askReviewCoach(document.querySelector('#reviewCoachInput')?.value.trim()));document.querySelector('#reviewCoachInput')?.addEventListener('keydown',e=>{if(e.key==='Enter')askReviewCoach(e.currentTarget.value.trim())});document.querySelectorAll('[data-puzzle-filter]').forEach(e=>e.addEventListener('click',()=>setPuzzleFilter(e.dataset.puzzleFilter)));document.querySelector('#puzzleSessionSize')?.addEventListener('change',e=>setPuzzleSessionSize(e.target.value));document.querySelector('[data-action=puzzle-next]')?.addEventListener('click',nextPuzzle);document.querySelector('[data-action=puzzle-retry]')?.addEventListener('click',resetPuzzle);document.querySelector('[data-action=puzzle-coach-send]')?.addEventListener('click',()=>askPuzzleCoach(document.querySelector('#puzzleCoachInput')?.value.trim()));document.querySelector('#puzzleCoachInput')?.addEventListener('keydown',e=>{if(e.key==='Enter')askPuzzleCoach(e.currentTarget.value.trim())});document.querySelector('[data-action=batch-analyze]')?.addEventListener('click',batchAnalyze);document.querySelector('[data-action=sync]')?.addEventListener('click',sync);document.querySelectorAll('[data-action=refresh-profile]').forEach(e=>e.addEventListener('click',refreshProfilePlan));document.querySelector('[data-action=pgn]')?.addEventListener('click',()=>{const a=parsePgn(document.querySelector('#pgn')?.value||'');if(!a.length)return pop('No valid PGN found.');s.games=[...a,...s.games];save();pop(`Imported ${a.length} PGN game${a.length===1?'':'s'}.`)});document.querySelectorAll('[data-review]').forEach(e=>e.onclick=()=>openReview(+e.dataset.review));document.querySelectorAll('[data-ply]').forEach(e=>e.onclick=()=>setPly(+e.dataset.ply));document.querySelector('[data-action=prev]')?.addEventListener('click',()=>setPly(s.ply-1));document.querySelector('[data-action=next]')?.addEventListener('click',()=>setPly(s.ply+1));const d=document.querySelector('#drop'),f=document.querySelector('#file');d?.addEventListener('click',()=>f.click());f?.addEventListener('change',async()=>{const file=f.files?.[0];if(!file)return;const a=parsePgn(await file.text());if(!a.length)return pop('No valid PGN found.');s.games=[...a,...s.games];save();render()});d?.addEventListener('dragover',e=>e.preventDefault());d?.addEventListener('drop',async e=>{e.preventDefault();const file=e.dataTransfer.files?.[0];if(!file)return;const a=parsePgn(await file.text());s.games=[...a,...s.games];save();render()})}
function render(){destroyBoards();app.innerHTML=shell(page());bind();requestAnimationFrame(()=>mountBoards())}
render();