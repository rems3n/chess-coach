import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.4.0/+esm';

const P={wp:'♙',wn:'♘',wb:'♗',wr:'♖',wq:'♕',wk:'♔',bp:'♟',bn:'♞',bb:'♝',br:'♜',bq:'♛',bk:'♚'};
const NAV=[['home','⌂','Home'],['play','♞','Play'],['puzzles','✣','Puzzles'],['learn','▤','Learn'],['openings','♙','Openings'],['analyze','⌕','Analyze'],['progress','▥','Progress']];
const s={route:location.hash.replace('#/','')||'home',game:new Chess(),sel:null,legal:[],orient:'white',games:JSON.parse(localStorage.getItem('cc_games')||'[]'),user:localStorage.getItem('cc_chess_user')||'',review:null,rgame:null,ply:0,toast:null,coachBusy:false,analysisBusy:false,missingKey:false,opponentBusy:false,paused:false,opponentElo:1450,coachMode:'normal',reviewCoachBusy:false,reviewMessages:[],profilePlan:JSON.parse(localStorage.getItem('cc_profile_plan')||'null'),coachingEvidence:JSON.parse(localStorage.getItem('cc_coaching_evidence')||'[]'),profileBusy:false,batchBusy:false,voiceStatus:'off',voiceError:null,messages:[{role:'coach',text:'Play naturally. I’ll focus on your reasoning, not narrate every engine change.'}]};
const app=document.querySelector('#app');
let voicePeer=null,voiceChannel=null,voiceMedia=null,voiceAudio=null;
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
    const d=await post('/api/profile-plan',{analyzedGames:analyzed,coachingEvidence:s.coachingEvidence,currentProfile:s.profilePlan,goals:{next:1800,longTerm:2000}});
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
const go=r=>{s.route=r;location.hash='#/'+r;render()};
window.addEventListener('hashchange',()=>{s.route=location.hash.replace('#/','')||'home';render()});
function shell(body){const nav=NAV.map(([id,i,l])=>`<button class="${s.route===id?'active':''}" data-route="${id}">${i} &nbsp;${l}</button>`).join('');const mob=NAV.filter(n=>['home','play','puzzles','analyze','progress'].includes(n[0])).map(([id,i,l])=>`<button class="${s.route===id?'active':''}" data-route="${id}">${i}<br>${l}</button>`).join('');return `<div class="shell"><aside class="side"><div class="brand"><b>♞</b>Chess Coach</div><nav class="nav">${nav}</nav><div class="profile">CG &nbsp; Chris<br>Personal coach</div></aside><main><header class="top"><strong>${NAV.find(n=>n[0]===s.route)?.[2]||'Chess Coach'}</strong><button data-route="play">Ask Coach</button></header>${body}</main><nav class="mobile">${mob}</nav></div>${s.toast?`<div class="toast">${esc(s.toast)}</div>`:''}`}
function rec(i,t,d,r){return `<div class="recItem"><i>${i}</i><strong>${t}</strong><span>${d}</span><button class="btn" data-route="${r}">Start</button></div>`}
function quick(i,t,d,r){return `<button class="quick" data-route="${r}"><i>${i}</i><strong>${t}</strong><span>${d}</span></button>`}
function home(){const p=s.profilePlan;const weekly=(p?.weekly_plan||[]).slice(0,4);const recs=weekly.length?weekly.map(x=>rec('◎',x.activity,`${x.minutes} min · ${x.focus}`,x.destination)).join(''):[rec('✣','Tactical warm-up','10 min · recent weaknesses','puzzles'),rec('◎','Calculation','15 min · candidate moves','learn'),rec('♜','Rook endings','15 min · practical positions','learn'),rec('♞','Play with Coach','20 min · play and discuss','play')].join('');const why=p?.summary||'Your plan will be generated from imported games and coaching evidence. It is always optional.';return `<section class="page"><div class="head"><div><h1>Good morning, Chris</h1><p>Better decisions. Stronger chess.</p></div></div><div class="grid3"><div class="card summary"><div class="label">Chess.com Rapid</div><div class="value">1,438</div><div class="sub">Current working baseline</div></div><div class="card summary"><div class="label">Next milestone</div><div class="value">1,800</div><div class="sub">Longer-term goal: 2,000</div></div><div class="card summary"><div class="label">Current focus</div><div style="font-weight:700;margin-top:10px">${esc(p?.priorities?.[0]?.skill||'Candidate moves')}</div><div class="sub">${esc(p?.priorities?.slice(1,3).map(x=>x.skill).join(' · ')||'Defensive awareness · Rook endings')}</div></div></div><div class="card rec"><div class="recHead"><h2>Today’s recommendation</h2><span class="sub">Optional</span><button class="btn" style="margin-left:auto" data-action="refresh-profile">${s.profileBusy?'Updating…':'Update plan'}</button></div><div class="recBody"><div class="recList">${recs}</div><div class="why"><strong>Why these?</strong><br><br>${esc(why)}</div></div></div><div class="section"><h2>Or choose what you’d like to do</h2><div class="quickGrid">${quick('🎮','Play','Train with the AI coach','play')}${quick('✣','Puzzles','Practice tactics and calculation','puzzles')}${quick('▤','Learn','Browse concepts and lessons','learn')}${quick('♙','Openings','Study your repertoire','openings')}${quick('⌕','Analyze','Import and review games','analyze')}${quick('▥','Progress','See your learning profile','progress')}</div></div></section>`}
function board(game,interactive=true){const files=s.orient==='white'?['a','b','c','d','e','f','g','h']:['h','g','f','e','d','c','b','a'];const ranks=s.orient==='white'?[8,7,6,5,4,3,2,1]:[1,2,3,4,5,6,7,8];return `<div class="board">${ranks.flatMap((r,ri)=>files.map((f,fi)=>{const q=f+r,p=game.get(q),key=p?p.color+p.type:'',light=(ri+fi)%2===0,legal=s.legal.some(m=>m.to===q);return `<button class="sq ${light?'light':'dark'} ${s.sel===q?'selected':''} ${legal?'legal':''}" ${interactive?`data-square="${q}"`:''}>${p?`<span class="piece">${P[key]}</span>`:''}</button>`})).join('')}</div>`}
function coach(){const status=s.opponentBusy?'Opponent is thinking…':s.coachBusy?'Coach is thinking…':s.paused?'Game paused for coaching discussion.':s.voiceStatus==='connecting'?'Connecting voice…':s.voiceStatus==='on'?'Voice coach connected. Think aloud or ask questions naturally.':s.missingKey?'Stockfish is active. Add OPENAI_API_KEY on Railway to enable conversational coaching.':'The coach uses engine evidence selectively and can stay quiet when no intervention is useful.';return `<aside class="card coach"><div class="coachHead">AI Coach <button class="btn voiceBtn" data-action="${s.voiceStatus==='on'?'voice-stop':'voice-start'}" ${s.voiceStatus==='connecting'?'disabled':''}>${s.voiceStatus==='on'?'End voice':s.voiceStatus==='connecting'?'Connecting…':'🎙 Voice'}</button></div><div class="feed">${s.messages.map(m=>`<div class="msg ${m.role}">${esc(m.text)}</div>`).join('')}<div class="notice">${status}</div>${s.voiceError?`<div class="notice">${esc(s.voiceError)}</div>`:''}${s.paused?`<button class="btn primary" data-action="continue-game">Continue game</button>`:''}</div><div class="compose"><input id="coachInput" class="input" placeholder="Ask about the position…" ${s.coachBusy?'disabled':''}><button class="btn primary" data-action="send" ${s.coachBusy?'disabled':''}>Send</button></div></aside>`}
function play(){return `<section class="page"><div class="head"><div><h1>Play with Coach</h1><p>Play White against a limited-strength Stockfish opponent while the coach observes your reasoning.</p></div></div><div class="workspace"><div class="card boardCard"><div class="player">Training opponent <select id="opponentElo" class="select miniSelect">${[1350,1450,1600,1800,2000].map(x=>`<option value="${x}" ${s.opponentElo===x?'selected':''}>~${x}</option>`).join('')}</select><span class="sub">&nbsp;Stockfish limited strength</span><span class="clock">15:00</span></div>${board(s.game,true)}<div class="player">You <span class="sub">&nbsp;White · current baseline ~1438</span><span class="clock">15:00</span></div><div class="actions"><button class="btn" data-action="new">New game</button><button class="btn" data-action="undo">Undo turn</button><button class="btn" data-action="flip">Flip</button><select id="coachMode" class="select miniSelect">${[['normal','Normal'],['guided','Guided'],['minimal','Minimal'],['assessment','Assessment'],['ask_only','Ask only']].map(([v,l])=>`<option value="${v}" ${s.coachMode===v?'selected':''}>${l}</option>`).join('')}</select><span class="sub">${s.paused?'Paused':s.opponentBusy?'Opponent thinking':s.game.isGameOver()?'Game over':s.game.turn()==='w'?'Your move':'Opponent move'}</span></div></div>${coach()}</div></section>`}
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
function review(){if(!s.review)return analyze();const h=s.review.h,pairs=[];for(let i=0;i<h.length;i+=2)pairs.push([i/2+1,h[i],h[i+1]]);return `<section class="page"><div class="head"><div><h1>Game Review</h1><p>${esc(s.review.opponent||'Opponent')} · move ${s.ply}/${h.length}</p></div></div><div class="review"><div class="card boardCard">${board(s.rgame,false)}<div class="actions"><button class="btn" data-ply="0">⏮</button><button class="btn" data-action="prev">←</button><button class="btn" data-action="next">→</button><button class="btn" data-ply="${h.length}">⏭</button></div></div><div class="card moves">${pairs.map(([n,w,b],i)=>`<div class="moveRow"><span class="sub">${n}.</span><button class="${s.ply===i*2+1?'active':''}" data-ply="${i*2+1}">${w?.san||''}</button><button class="${s.ply===i*2+2?'active':''}" ${b?`data-ply="${i*2+2}"`:''}>${b?.san||''}</button></div>`).join('')}</div><div class="card coach"><div class="coachHead">Coach Review <button class="btn voiceBtn" data-action="${s.voiceStatus==='on'?'voice-stop':'voice-start'}" ${s.voiceStatus==='connecting'?'disabled':''}>${s.voiceStatus==='on'?'End voice':s.voiceStatus==='connecting'?'Connecting…':'🎙 Voice'}</button></div><div class="feed"><div class="reviewEngine">${reviewAnalysis()}</div>${s.reviewMessages.map(m=>`<div class="msg ${m.role}">${esc(m.text)}</div>`).join('')}${s.reviewCoachBusy?'<div class="notice">Coach is analyzing this position…</div>':''}</div><div class="compose"><input id="reviewCoachInput" class="input" placeholder="Ask about this position or explain your thinking…" ${s.reviewCoachBusy?'disabled':''}><button class="btn primary" data-action="review-send" ${s.reviewCoachBusy?'disabled':''}>Send</button></div></div></div></section>`}
function learn(type='learn'){const title=type==='puzzles'?'Puzzles':type==='openings'?'Opening Lab':'Learn';const cards=type==='puzzles'?[['✣','For You','From your games and weak areas'],['⚔','Tactical motifs','Forks, pins and combinations'],['◎','Candidate moves','Compare plausible options'],['♜','Endgame tactics','Practical endings'],['◈','Defense','Find the opponent’s threat'],['＋','Browse all','Choose theme and difficulty']]:type==='openings'?[['♙','My Repertoire','White and Black trees'],['⌘','Explore','Browse openings and structures'],['▷','Practice','Train lines from positions'],['▤','Model Games','See plans in full games'],['◎','Ideas & Plans','Understand why moves work'],['＋','Add repertoire','Build with the coach']]:[['◎','Calculation','Candidate moves and visualization'],['♟','Strategy','Structures, squares and plans'],['♜','Endgames','Core technical endings'],['✣','Tactics','Patterns and combinations'],['⛨','Defense','Threat recognition'],['▤','Model Games','Concepts in complete games']];return `<section class="page"><div class="head"><div><h1>${title}</h1><p>Recommended work plus unrestricted self-directed training.</p></div></div><div class="learnGrid">${cards.map(([i,t,d])=>`<button class="card learnCard"><i>${i}</i><strong>${t}</strong><p class="sub">${d}</p></button>`).join('')}</div></section>`}
function progress(){
  const analyzed=s.games.filter(g=>g.analysis), total=analyzed.length, p=s.profilePlan;
  const counts=analyzed.reduce((a,g)=>{for(const [k,v] of Object.entries(g.analysis.counts||{}))a[k]=(a[k]||0)+v;return a},{});
  const forcing=analyzed.reduce((n,g)=>n+(g.analysis.missedForcing||0),0);
  const skills=p?.skills||[];
  const skillOrder={priority:30,developing:50,solid:70,strong:88};
  const evidence=`<div class="card pad"><div style="display:flex;align-items:center"><h3>Player profile</h3><button class="btn" style="margin-left:auto" data-action="refresh-profile">${s.profileBusy?'Updating…':'Update profile'}</button></div>${p?`<p>${esc(p.summary)}</p>${skills.map(x=>`<div class="skill"><span>${esc(x.skill)}</span><div class="bar"><div class="fill" style="width:${skillOrder[x.level]||50}%"></div></div><b style="font-size:10px">${esc(x.level)}</b></div>`).join('')}<p class="sub">Profile confidence grows as more games and coaching conversations are analyzed.</p>`:`<p class="sub">Analyze games, then generate your adaptive player profile.</p>${total?`<button class="btn primary" data-action="refresh-profile">Generate profile</button>`:`<button class="btn primary" data-route="analyze">Analyze games</button>`}`}</div>`;
  const priorities=p?.priorities?.length?p.priorities.map((x,i)=>`<div class="priority"><strong>${i+1}. ${esc(x.skill)}</strong><p>${esc(x.why)}</p><p class="sub">${esc(x.evidence)}</p></div>`).join(''):`<div class="priority"><strong>Evidence needed</strong><p>Analyze your completed games to identify recurring development priorities.</p></div>`;
  const stats=`<div class="card pad"><h3>Engine evidence</h3><div class="analysisSummary"><div class="metric"><b>${total}</b><span>games analyzed</span></div><div class="metric"><b>${counts.blunder||0}</b><span>blunders</span></div><div class="metric"><b>${forcing}</b><span>missed forcing ideas</span></div></div><h3 style="margin-top:20px">Current priorities</h3>${priorities}</div>`;
  return `<section class="page"><div class="head"><div><h1>My Chess</h1><p>Your goals, evidence-driven skill model, and adaptive plan.</p></div></div><div class="grid3"><div class="card summary"><div class="label">Current rapid</div><div class="value">1,438</div></div><div class="card summary"><div class="label">Next milestone</div><div class="value">1,800</div></div><div class="card summary"><div class="label">Long-term goal</div><div class="value">2,000</div></div></div><div class="progressGrid">${evidence}${stats}</div>${p?.weekly_plan?.length?`<div class="card pad section"><h3>Recommended training mix</h3><div class="quickGrid">${p.weekly_plan.map(x=>`<button class="quick" data-route="${x.destination}"><strong>${esc(x.activity)}</strong><span>${x.minutes} min · ${esc(x.focus)}</span><small class="sub">${esc(x.reason)}</small></button>`).join('')}</div><p class="sub">This plan is a recommendation, not a required sequence. You can train anywhere in the app at any time.</p></div>`:''}</section>`}
function page(){if(s.route==='home')return home();if(s.route==='play')return play();if(s.route==='analyze')return analyze();if(s.route==='review')return review();if(s.route==='progress')return progress();if(s.route==='puzzles')return learn('puzzles');if(s.route==='openings')return learn('openings');return learn()}
function pop(m){s.toast=m;render();setTimeout(()=>{s.toast=null;render()},2300)}
function bind(){document.querySelectorAll('[data-route]').forEach(e=>e.onclick=()=>go(e.dataset.route));document.querySelectorAll('[data-square]').forEach(e=>e.onclick=()=>clickSquare(e.dataset.square));document.querySelector('[data-action=new]')?.addEventListener('click',()=>{s.game=new Chess();s.sel=null;s.legal=[];s.paused=false;s.opponentBusy=false;s.messages=[{role:'coach',text:'New training game. Play naturally; I’ll intervene selectively.'}];render()});document.querySelector('[data-action=undo]')?.addEventListener('click',()=>{if(s.opponentBusy)return;s.paused=false;s.game.undo();if(s.game.turn()==='b')s.game.undo();render()});document.querySelector('[data-action=flip]')?.addEventListener('click',()=>{s.orient=s.orient==='white'?'black':'white';render()});document.querySelector('[data-action=continue-game]')?.addEventListener('click',()=>{s.paused=false;render();if(s.game.turn()==='b')makeOpponentMove()});document.querySelector('#opponentElo')?.addEventListener('change',e=>{s.opponentElo=Number(e.target.value)});document.querySelector('#coachMode')?.addEventListener('change',e=>{s.coachMode=e.target.value});document.querySelector('[data-action=send]')?.addEventListener('click',()=>askCoach(document.querySelector('#coachInput')?.value.trim()));document.querySelector('[data-action=voice-start]')?.addEventListener('click',startVoice);document.querySelector('[data-action=voice-stop]')?.addEventListener('click',stopVoice);document.querySelector('#coachInput')?.addEventListener('keydown',e=>{if(e.key==='Enter')askCoach(e.currentTarget.value.trim())});document.querySelector('[data-action=analyze-review]')?.addEventListener('click',analyzeReviewedGame);document.querySelector('[data-action=review-send]')?.addEventListener('click',()=>askReviewCoach(document.querySelector('#reviewCoachInput')?.value.trim()));document.querySelector('#reviewCoachInput')?.addEventListener('keydown',e=>{if(e.key==='Enter')askReviewCoach(e.currentTarget.value.trim())});document.querySelector('[data-action=batch-analyze]')?.addEventListener('click',batchAnalyze);document.querySelector('[data-action=sync]')?.addEventListener('click',sync);document.querySelectorAll('[data-action=refresh-profile]').forEach(e=>e.addEventListener('click',refreshProfilePlan));document.querySelector('[data-action=pgn]')?.addEventListener('click',()=>{const a=parsePgn(document.querySelector('#pgn')?.value||'');if(!a.length)return pop('No valid PGN found.');s.games=[...a,...s.games];save();pop(`Imported ${a.length} PGN game${a.length===1?'':'s'}.`)});document.querySelectorAll('[data-review]').forEach(e=>e.onclick=()=>openReview(+e.dataset.review));document.querySelectorAll('[data-ply]').forEach(e=>e.onclick=()=>setPly(+e.dataset.ply));document.querySelector('[data-action=prev]')?.addEventListener('click',()=>setPly(s.ply-1));document.querySelector('[data-action=next]')?.addEventListener('click',()=>setPly(s.ply+1));const d=document.querySelector('#drop'),f=document.querySelector('#file');d?.addEventListener('click',()=>f.click());f?.addEventListener('change',async()=>{const file=f.files?.[0];if(!file)return;const a=parsePgn(await file.text());if(!a.length)return pop('No valid PGN found.');s.games=[...a,...s.games];save();render()});d?.addEventListener('dragover',e=>e.preventDefault());d?.addEventListener('drop',async e=>{e.preventDefault();const file=e.dataTransfer.files?.[0];if(!file)return;const a=parsePgn(await file.text());s.games=[...a,...s.games];save();render()})}
function render(){app.innerHTML=shell(page());bind()}
render();