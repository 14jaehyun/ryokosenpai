'use strict';
/* 여행선배 (료코센빠이) v2.0 */
const VERSION='2.0.20';

/* ---------- storage ---------- */
const LS='ryokosenpai.v1';
const DEFAULT_MODEL='gemini-3.5-flash-lite';
const DEF={settings:{key:'',model:DEFAULT_MODEL,music:true},user:{name:''},chat:{recent:[]},
  profile:{done:false,situations:[],interests:[],free:'',stats:{}},groups:[],passed:[],routes:[],lastLoc:null};
let DB;
function load(){try{DB=JSON.parse(localStorage.getItem(LS))||{}}catch(e){DB={}}
  DB=Object.assign(JSON.parse(JSON.stringify(DEF)),DB);
  DB.settings=Object.assign({},DEF.settings,DB.settings);delete DB.settings.links;
  if(!DB.settings.model)DB.settings.model=DEFAULT_MODEL;
  DB.profile=Object.assign({},DEF.profile,DB.profile);DB.user=Object.assign({},DEF.user,DB.user);if(!DB.chat||!Array.isArray(DB.chat.recent))DB.chat={recent:[]};
  if(!Array.isArray(DB.routes))DB.routes=[];
  ['lastLoc','manualLoc'].forEach(k=>{if(DB[k])DB[k].label='';});
  const now=Date.now();DB.passed=DB.passed.filter(p=>now-p.at<10*864e5);}
function save(){try{localStorage.setItem(LS,JSON.stringify(DB))}catch(e){}}
load();

/* ---------- helpers ---------- */
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>Math.random().toString(36).slice(2,10);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function distM(a,b){if(!a||!b||a.lat==null||b.lat==null)return null;const R=6371e3,t=Math.PI/180;
  const dLa=(b.lat-a.lat)*t,dLo=(b.lng-a.lng)*t;const x=Math.sin(dLa/2)**2+Math.cos(a.lat*t)*Math.cos(b.lat*t)*Math.sin(dLo/2)**2;return 2*R*Math.asin(Math.sqrt(x));}
const fmtKm=m=>m<1000?(Math.round(m/10)*10)+'m':(m<100000?(m/1000).toFixed(1):Math.round(m/1000).toLocaleString())+'km';
const walkMin=m=>Math.max(1,Math.round(m*1.3/75));
const transitTxt=m=>m<1200?'걸어가는 게 빨라':'약 '+Math.round(8+m/1000*2.6)+'분';
const inKorea=p=>!!p&&p.lat>33&&p.lat<38.9&&p.lng>124.5&&p.lng<131.9;
const PIN_SVG='<svg class="pin" viewBox="0 0 6 8" shape-rendering="crispEdges"><rect x="1" y="0" width="4" height="3" fill="#ffd66e"/><rect x="0" y="3" width="6" height="1" fill="#ffd66e"/><rect x="2" y="4" width="2" height="4" fill="#ffd66e"/></svg>';
function toast(msg,ms=2200){const t=document.createElement('div');t.className='toast px solid';t.textContent=msg;$('#app').appendChild(t);setTimeout(()=>t.remove(),ms);}
/* Korean Maps titles often come as "가게 | 용산 맛집 | English name ..." — keep only the real name */
const cleanTitle=t=>{let x=String(t||'').split(/\s*[|｜]\s*/).map(y=>y.trim()).find(Boolean)||'';
  return x.replace(/\s*[-–—:·]\s*(google\s*(maps|지도)|구글\s*(맵|지도))\s*$/i,'').trim();};
const placeTitle=c=>cleanTitle(c.mapsTitle)||String(c.name||'').trim();
const hasKo=t=>/[가-힣]/.test(t||'');
/* does the model's name plausibly describe this verified Maps place? (only judgeable for Korean titles) */
function sameKoPlace(names,title){const t=norm(cleanTitle(title));if(!t||!hasKo(t))return true;
  for(const n of names){const k=norm(n);if(k.length<2)continue;if(t.includes(k)||k.includes(t))return true;
    const ks=[...new Set(k)],common=ks.filter(ch=>t.includes(ch)).length;if(common>=2&&common/ks.length>=0.6)return true;}
  return false;}
const isKR=c=>c.lat!=null?inKorea(c):/(특별시|광역시|[가-힣]+[도시군구]\s|대한민국)/.test(c.address||'');
/* Korea: name + 구/동 (Google Maps in Korea doesn't find "full address + name"). Elsewhere: unchanged (works well in Japan) */
const regionKR=a=>{const m=String(a||'').match(/([가-힣]+(?:구|군))(?=\s)/)||String(a||'').match(/([가-힣]+시)(?=\s)/);return m?m[1]:'';};
const searchText=c=>isKR(c)?[placeTitle(c),regionKR(c.address)].filter(Boolean).join(' ').trim():[c.address,placeTitle(c)].filter(Boolean).join(' ').trim();

/* open another app without leaving a blank browser page behind */
function openExternal(appUrl,webUrl){
  if(!appUrl){window.open(webUrl,'_blank','noopener');return;}
  let left=false;const onHide=()=>{if(document.hidden)left=true;};
  document.addEventListener('visibilitychange',onHide);
  window.location.href=appUrl;
  setTimeout(()=>{document.removeEventListener('visibilitychange',onHide);if(!left&&!document.hidden&&webUrl)window.open(webUrl,'_blank','noopener');},1500);}

function openGoogle(url){openExternal('comgooglemapsurl://'+url.replace(/^https?:\/\//,''),url);}
/* ---------- sound effects (Web Audio, ambient: follows silent switch, no now-playing) ---------- */
let AC=null,SFXOUT=null;
/* audio session type.
   'ambient' mixes with other apps — and gets ducked by them: Google Maps keeps its (ducking) session alive in the
   background, so after a Maps trip everything here played at a whisper. With music on we use 'transient-solo'
   (still follows the silent switch, but takes the audio over instead of being ducked). Music off → 'ambient'.
   Re-applied after the mic (which leaves a quiet earpiece/record route) and on every return to the app. */
function ambientSession(){const s=navigator.audioSession;if(!s)return;const want=SOUNDTEST==='A'?'playback':DB.settings.music?'transient-solo':'ambient';
  try{if(s.type===want)s.type='auto';s.type=want;}catch(e){}}
/* where all sound goes: the speaker directly, or (experiment B) through an <audio> element */
let SOUNDTEST='',ROUTE_DEST=null,ROUTE_EL=null;
function acOut(){return ROUTE_DEST||AC.destination;}
function audio(){try{if(!AC){ambientSession();AC=new(window.AudioContext||window.webkitAudioContext)();
    ROUTE_DEST=null;
    if(SOUNDTEST==='B'&&AC.createMediaStreamDestination){ROUTE_DEST=AC.createMediaStreamDestination();
      if(!ROUTE_EL){ROUTE_EL=document.createElement('audio');ROUTE_EL.setAttribute('playsinline','');ROUTE_EL.autoplay=true;}
      ROUTE_EL.srcObject=ROUTE_DEST.stream;const p=ROUTE_EL.play();if(p&&p.catch)p.catch(()=>{});}
    SFXOUT=AC.createGain();SFXOUT.gain.value=1;SFXOUT.connect(acOut());}
  if(AC.state!=='running'&&AC.state!=='closed'&&!document.hidden){const p=AC.resume();if(p&&p.catch)p.catch(()=>{});}}catch(e){}return AC;}
/* iOS leaves the context 'interrupted' (not 'suspended') after leaving the app.
   On any touch: if it isn't running, resume; if that doesn't take within 350ms, throw it away and build a new one. */
let acFixing=null,acStale=false;
function rebuildAudio(){const old=AC;AC=null;SFXOUT=null;BGM.reset();try{old&&old.close();}catch(e){}ambientSession();audio();if(DB.settings.music)music();}
function audioKick(){if(document.hidden)return;
  if(AC&&AC.state==='closed'){AC=null;SFXOUT=null;BGM.reset();}
  /* first touch after coming back from another app: build a fresh context inside this touch (it starts running
     and on the normal speaker route), instead of reviving the old one */
  if(acStale){acStale=false;if(AC){acFixing=null;rebuildAudio();return;}}
  const a=audio();if(!a||a.state==='running'||acFixing===a)return;
  acFixing=a;
  setTimeout(()=>{if(acFixing===a)acFixing=null;if(AC!==a||a.state==='running'||document.hidden)return;
    rebuildAudio();},350);}
function osc(type,f0,f1,t0,dur,vol,decay){const a=audio();if(!a)return;const o=a.createOscillator(),g=a.createGain();o.type=type;
  const s=a.currentTime+t0;o.frequency.setValueAtTime(f0,s);if(f1!==f0)o.frequency.linearRampToValueAtTime(f1,s+dur);
  g.gain.setValueAtTime(0,s);g.gain.linearRampToValueAtTime(vol,s+0.004);g.gain.exponentialRampToValueAtTime(0.0008,s+Math.max(dur,decay||dur));
  o.connect(g).connect(SFXOUT);o.start(s);o.stop(s+Math.max(dur,decay||dur)+0.02);}
function noise(t0,dur,vol,type,f0,f1,q,atk){const a=audio();if(!a)return;const n=Math.floor(a.sampleRate*dur),b=a.createBuffer(1,n,a.sampleRate),d=b.getChannelData(0);
  for(let i=0;i<n;i++)d[i]=Math.random()*2-1;
  const s=a.createBufferSource();s.buffer=b;const g=a.createGain(),flt=a.createBiquadFilter();flt.type=type||'bandpass';const st=a.currentTime+t0;
  flt.frequency.setValueAtTime(f0||3000,st);flt.frequency.exponentialRampToValueAtTime(f1||f0||3000,st+dur);flt.Q.value=q??0.7;
  g.gain.setValueAtTime(0.0001,st);g.gain.linearRampToValueAtTime(vol,st+dur*(atk??0.25));g.gain.exponentialRampToValueAtTime(0.0008,st+dur);
  s.connect(flt).connect(g).connect(SFXOUT);s.start(st);s.stop(st+dur+0.02);}
const SFX={
  touch(){noise(0,0.02,0.35,'highpass',3000);osc('square',220,110,0.006,0.05,0.07,0.06);},
  trans(){osc('triangle',330,165,0,0.28,0.192,0.3);osc('triangle',165,262,0.40,0.32,0.168,0.34);},  // 120%
  swipe(){noise(0,0.18,0.364,'bandpass',1100,600,0.9,0.35);noise(0.05,0.12,0.156,'lowpass',700,300,0.5,0.3);},
  pin(){noise(0,0.012,0.3,'highpass',4000);osc('square',988,988,0.012,0.06,0.06,0.08);osc('square',1319,1319,0.072,0.2,0.06,0.22);},
  btn(){osc('square',660,660,0,0.045,0.06,0.05);osc('square',880,880,0.06,0.11,0.06,0.12);}
};

/* ---------- background music (8-bit loops, synthesized live) ---------- */
const BGM=(()=>{
  const NM={C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11};
  const hz=(n,tr)=>{const o=+n.slice(-1),m=12*(o+1)+NM[n.slice(0,-1)]+(tr||0);return 440*Math.pow(2,(m-69)/12);};
  const arp=(chs,pat,d=1)=>chs.flatMap(ch=>pat.map(k=>[ch[k],d]));
  const C=['C4','E4','G4','E4'],Am=['A3','C4','E4','C4'],F=['F3','A3','C4','A3'],G=['G3','B3','D4','B3'];
  const Fm7=['F3','A3','C4','E4'],Em7=['E3','G3','B3','D4'],Dm7=['D3','F3','A3','C4'],Cm7=['C3','E3','G3','B3'],G7=['G3','B3','D4','F4'];
  const Dm=['D4','F4','A4','F4'],Bb=['Bb3','D4','F4','D4'],Cc=['C4','E4','G4','E4'],A7=['A3','C#4','E4','G4'];
  const TR={
    main:{tempo:88,bars:8,tr:0,parts:[
      {w:'lead',v:.32,s:.6,seq:[['E4',2],['G4',2],['C5',3],['B4',1],['A4',4],['G4',2],['E4',2],['F4',2],['A4',2],['C5',2],['A4',2],['G4',6],[0,2],
        ['E4',2],['G4',2],['C5',2],['D5',2],['E5',3],['D5',1],['C5',2],['A4',2],['A4',2],['C5',2],['D5',2],['C5',2],['B4',3],['A4',1],['G4',4]]},
      {w:'lead',v:.09,d:.06,s:.2,g:.7,seq:arp([C,Am,F,G,C,Am,F,G],[0,1,2,3,0,1,2,3])},
      {w:'bass',v:.5,s:.8,seq:[['C2','G2'],['A1','E2'],['F1','C2'],['G1','D2'],['C2','G2'],['A1','E2'],['F1','C2'],['G1','D2']].flatMap(([r,f])=>[[r,2],[f,2],[r,2],[f,2]])}]},
    room:{tempo:74,bars:8,tr:0,parts:[
      {w:'lead',v:.26,s:.55,d:.25,seq:[['A4',3],['C5',1],['E5',4],['D5',2],['B4',2],['G4',4],['F4',2],['A4',2],['C5',2],['A4',2],['G4',6],[0,2],
        ['A4',2],['C5',2],['F5',3],['E5',1],['D5',4],['B4',2],['D5',2],['C5',3],['A4',1],['F4',2],['A4',2],['G4',4],['B4',2],['D5',2]]},
      {w:'lead',v:.07,d:.08,s:.15,g:.8,seq:arp([Fm7,Em7,Dm7,Cm7,Fm7,Em7,Dm7,G7],[0,2,1,3,2,1,3,2])},
      {w:'bass',v:.5,s:.85,seq:[['F2','C3'],['E2','B2'],['D2','A2'],['C2','G2'],['F2','C3'],['E2','B2'],['D2','A2'],['C2','G2']].flatMap(([r,f])=>[[r,4],[f,4]])}]},
    route:{tempo:138,bars:8,tr:-5,drums:true,parts:[
      {w:'lead',v:.30,s:.5,d:.08,g:.75,a:.008,seq:[['A4',1],['D5',1],['F5',1],['E5',1],['D5',2],['A4',2],['Bb4',1],['D5',1],['F5',1],['D5',1],['Bb4',2],['F4',2],
        ['C5',1],['E5',1],['G5',1],['F5',1],['E5',2],['C5',2],['C#5',2],['E5',2],['A5',3],['G5',1],
        ['F5',2],['E5',1],['D5',1],['A4',2],['D5',2],['F5',1],['G5',1],['F5',1],['D5',1],['Bb4',4],
        ['G5',1],['F5',1],['E5',1],['C5',1],['E5',2],['G5',2],['A5',2],['G5',1],['F5',1],['E5',2],['C#5',2]]},
      {w:'lead',v:.08,d:.04,s:.1,g:.8,a:.004,seq:arp([Dm,Bb,Cc,A7,Dm,Bb,Cc,A7],[0,1,2,1,0,1,2,1,0,1,2,1,0,1,2,1],0.5)},
      {w:'bass',v:.42,s:.7,g:.7,a:.006,seq:['D2','Bb1','C2','A1','D2','Bb1','C2','A1'].flatMap(r=>{const hi=r.slice(0,-1)+(+r.slice(-1)+1);return [[r,1],[hi,1],[r,1],[hi,1],[r,1],[hi,1],[r,1],[hi,1]];})}]}
  };
  let out=null,filt=null,cur=null,timer=null,waves={},ducked=false,startedOnce=false;
  function graph(){const a=audio();if(!a||out)return a;
    out=a.createGain();out.gain.value=0;filt=a.createBiquadFilter();filt.type='lowpass';filt.frequency.value=2600;filt.Q.value=0.5;
    const dry=a.createGain();dry.gain.value=1;const dl=a.createDelay(1);dl.delayTime.value=0.23;const fb=a.createGain();fb.gain.value=0.3;const wet=a.createGain();wet.gain.value=0.22;
    filt.connect(dry).connect(out);filt.connect(dl);dl.connect(fb).connect(dl);dl.connect(wet).connect(out);out.connect(acOut());
    const pw=(h)=>{const re=new Float32Array(h.length+1),im=new Float32Array(h.length+1);h.forEach((v,i)=>im[i+1]=v);return a.createPeriodicWave(re,im);};
    waves.lead=pw([1,.18,.28,.06,.12,0,.05]);waves.bass=pw([1,0,.11]);return a;}
  function events(t){const e8=60/t.tempo/2,list=[];
    t.parts.forEach(p=>{let pos=0;p.seq.forEach(([n,d])=>{if(n)list.push({t:pos*e8,dur:d*e8*(p.g||0.92),f:hz(n,t.tr),p});pos+=d;});});
    return {list:list.sort((x,y)=>x.t-y.t),L:t.bars*8*e8,e8};}
  function note(ev,at){const a=AC,p=ev.p,o=a.createOscillator(),g=a.createGain();o.setPeriodicWave(waves[p.w]);o.frequency.value=ev.f;
    const A=p.a||0.018,D=p.d||0.12,S=(p.s??0.55)*p.v,R=0.14,end=at+ev.dur;
    g.gain.setValueAtTime(0,at);g.gain.linearRampToValueAtTime(p.v*0.9,at+A);g.gain.setTargetAtTime(S*0.9,at+A,D/2);
    g.gain.setTargetAtTime(0,end,R/3);o.connect(g).connect(filt);o.start(at);o.stop(end+R*2);}
  function drum(at,e,bar){const a=AC;
    const nz=(dur,vol,type,f)=>{const n=Math.floor(a.sampleRate*dur),b=a.createBuffer(1,n,a.sampleRate),d=b.getChannelData(0);for(let i=0;i<n;i++)d[i]=Math.random()*2-1;
      const s=a.createBufferSource();s.buffer=b;const fl=a.createBiquadFilter();fl.type=type;fl.frequency.value=f;const g=a.createGain();
      g.gain.setValueAtTime(vol,at);g.gain.exponentialRampToValueAtTime(0.0005,at+dur);s.connect(fl).connect(g).connect(out);s.start(at);s.stop(at+dur+0.01);};
    nz(0.035,e%2?0.05:0.08,'highpass',6000);
    if(e===0||e===4||(e===7&&bar%2===1)){const o=a.createOscillator(),g=a.createGain();o.frequency.setValueAtTime(165,at);o.frequency.exponentialRampToValueAtTime(45,at+0.15);
      g.gain.setValueAtTime(0.55,at);g.gain.exponentialRampToValueAtTime(0.001,at+0.16);o.connect(g).connect(out);o.start(at);o.stop(at+0.18);}
    if(e===2||e===6)nz(0.14,0.18,'bandpass',1800);}
  function play(name){if(!DB.settings.music||!name){stop();return;}
    if(cur&&cur.name===name&&timer)return;const a=graph();if(!a)return;startedOnce=true;
    const fadeOld=cur!=null;stop(true);
    const T=TR[name],E=events(T),t0=a.currentTime+(fadeOld?0.45:0.05);cur={name,E,T,t0,k:0,i:0,drumIdx:0};
    out.gain.cancelScheduledValues(a.currentTime);out.gain.setValueAtTime(out.gain.value,a.currentTime);
    if(fadeOld){out.gain.linearRampToValueAtTime(0,a.currentTime+0.4);}
    out.gain.linearRampToValueAtTime(ducked?0:0.16,t0+0.5);
    timer=setInterval(tick,90);tick();}
  function tick(){if(!cur||!AC)return;const {E,T}=cur,ahead=AC.currentTime+0.35;
    while(true){const ev=E.list[cur.i],at=cur.t0+cur.k*E.L+ev.t;if(at>ahead)break;if(at>AC.currentTime-0.05)note(ev,at);cur.i++;if(cur.i>=E.list.length){cur.i=0;cur.k++;}}
    if(T.drums){while(true){const n=cur.drumIdx,at=cur.t0+n*E.e8;if(at>ahead)break;if(at>AC.currentTime-0.05)drum(at,n%8,Math.floor(n/8)%T.bars);cur.drumIdx++;}}}
  function stop(keepGain){if(timer){clearInterval(timer);timer=null;}if(!keepGain&&out&&AC){out.gain.cancelScheduledValues(AC.currentTime);out.gain.setTargetAtTime(0,AC.currentTime,0.08);}cur=keepGain?cur:null;}
  function duck(on){ducked=on;if(!out||!AC)return;out.gain.cancelScheduledValues(AC.currentTime);out.gain.setTargetAtTime(on?0:(cur?0.16:0),AC.currentTime,0.08);}
  /* forget the old AudioContext's nodes (used when the context is rebuilt) */
  function reset(){if(timer){clearInterval(timer);timer=null;}out=null;filt=null;waves={};cur=null;}
  return {play,stop,duck,reset,get started(){return startedOnce;}};
})();
let SCREEN='main';
function music(){BGM.play(SCREEN==='room'?'room':SCREEN==='route'?'route':'main');}
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){abortListen();acStale=true;if(AC&&AC.suspend)AC.suspend().catch?.(()=>{});}
  else if(AC&&AC.state!=='running'&&AC.state!=='closed'){const p=AC.resume();if(p&&p.catch)p.catch(()=>{});}});
window.addEventListener('pagehide',()=>abortListen());
const firstTouch=()=>{audioKick();if(!BGM.started&&DB.settings.music)music();};
document.addEventListener('pointerdown',firstTouch,{capture:true});
document.addEventListener('touchend',()=>audioKick(),{capture:true,passive:true});

/* ---------- state ---------- */
const S={mode:'idle',req:'',loc:null,area:'',queue:[],cards:[],pins:[],shownNames:[],groupId:null,fetching:false,routeFrom:null,gen:0,emptyRefills:0};
const CARD_SLOTS=9,QUEUE_MIN=6;
const mainEl=$('#main'),charEl=$('#char'),dlgWrap=$('#dlgWrap'),dlg=$('#dlg');

/* ---------- dialog ---------- */
function say(html,{choices=null,cursor=true,active=false}={}){
  dlg.innerHTML=html+(choices?'<div class="choices">'+choices.map((c,i)=>`<button class="choice${i===0?' sel':''}" data-i="${i}">${esc(c.label)}</button>`).join('')+'</div>':'')+(cursor&&!choices?'<span class="cursor">▼</span>':'');
  dlgWrap.classList.toggle('active',!!choices||active);
  if(choices)dlg.querySelectorAll('.choice').forEach(b=>b.onclick=e=>{e.stopPropagation();SFX.btn();choices[+b.dataset.i].fn();});
}
function sayIdle(){S.mode='idle';say((DB.user.name&&Math.random()<0.5?esc(voc())+', ':'')+'어디로 놀러 가볼까?<br>화면을 꾹 누른 채로 말해줘.<div class="hint">예) 저녁 먹고 시부야에서 놀 거리</div>');}
function showDlg(v){dlgWrap.classList.toggle('hidden',!v);}

/* ---------- blush gimmick ---------- */
let blushCount=0,blushNext=8+Math.floor(Math.random()*5),blushing=false;
function charTapped(x,y){const r=charEl.getBoundingClientRect();if(x<r.left+r.width*0.12||x>r.right||y<r.top||y>r.bottom)return false;
  blushCount++;if(blushCount>=blushNext&&!blushing){blushCount=0;blushNext=8+Math.floor(Math.random()*5);blushing=true;
    const img=$('#charImg');img.src='miyeon_blush.png';setTimeout(()=>{img.src='miyeon.png';blushing=false;},2000);}
  return true;}
new Image().src='miyeon_blush.png';

/* ---------- speech ---------- */
const SRec=window.SpeechRecognition||window.webkitSpeechRecognition;
let rec=null,heard='',recDone=null,recHold=false,recTries=0;
/* after coming back from another app iOS often ends the first recognition session immediately
   (mic still held by the old audio session) — while the finger is down, quietly start a fresh one */
function startRec(){
  const r=new SRec();rec=r;r.lang='ko-KR';r.interimResults=true;r.continuous=true;
  r.onresult=e=>{if(rec!==r)return;let t='';for(const x of e.results)t+=x[0].transcript;heard=t.trim();say('듣고 있어…<div class="hint" style="color:var(--yel)">'+esc(heard)+'</div>',{cursor:false});};
  r.onerror=e=>{if(rec!==r)return;if(e.error==='not-allowed'||e.error==='service-not-allowed'){recHold=false;rec=null;BGM.duck(false);typeInput('마이크를 못 써서 글로 받을게.');}};
  r.onend=()=>{r._ended=true;if(rec!==r)return;
    if(recDone){const f=recDone;recDone=null;f();return;}
    if(recHold&&!heard&&recTries<4){recTries++;setTimeout(()=>{if(recHold&&rec===r){try{startRec();}catch(e){}}},150);}};
  r.start();}
function listen(){if(!SRec)return false;heard='';recHold=true;recTries=0;audioKick();
  if(rec){try{rec.abort();}catch(e){}rec=null;}
  try{BGM.duck(true);startRec();say('듣고 있어…<div class="hint">손을 떼면 끝나.</div>',{cursor:false});return true;}
  catch(e){try{startRec();say('듣고 있어…<div class="hint">손을 떼면 끝나.</div>',{cursor:false});return true;}catch(e2){recHold=false;rec=null;BGM.duck(false);return false;}}}
function abortListen(){const was=!!rec;recHold=false;if(rec){const r=rec;rec=null;try{r.abort();}catch(e){}}if(recDone){const f=recDone;recDone=null;f();}BGM.duck(false);ambientSession();if(was)acStale=true;}
function stopListen(){recHold=false;return new Promise(res=>{if(!rec){BGM.duck(false);return res(heard);}let done=false;const fin=()=>{if(!done){done=true;rec=null;BGM.duck(false);ambientSession();acStale=true;res(heard);}};  // next touch rebuilds the audio (mic leaves iOS on the quiet route)
  if(rec._ended)return fin();recDone=fin;try{rec.stop();}catch(e){fin();}setTimeout(fin,1500);});}
function typeInput(msg){S.mode='typing';
  say(esc(msg||'하고 싶은 걸 적어줘.')+'<input id="tin" enterkeyhint="done" placeholder="저녁 먹고 시부야에서 놀 거리"><div class="choices"><button class="choice sel" id="tok">확인</button><button class="choice" id="tcancel">취소</button></div>',{cursor:false,active:true});
  const i=$('#tin');setTimeout(()=>i.focus(),50);
  const ok=()=>{SFX.btn();const v=i.value.trim();i.blur();if(v)gotText(v);else sayIdle();};
  $('#tok').onclick=ok;$('#tcancel').onclick=()=>{SFX.btn();i.blur();sayIdle();};i.onkeydown=e=>{if(e.key==='Enter')ok();};}

/* ---------- main touch: hold to talk / swipe up to room / tap Miyeon / tap the dialog box = chat ---------- */
(function(){let st=null,holdT=null,listening=false;
  const down=e=>{const chat=S.mode==='chat';
    if(!chat&&S.mode!=='idle')return;audio();
    st={x:e.clientX,y:e.clientY,dlg:e.currentTarget===dlgWrap,chat,choice:!!e.target.closest('.choice')};listening=false;
    if(!chat){charEl.classList.add('pressed');SFX.touch();}
    /* hold = talk. During a chat (anywhere, even on the box or a choice) it ends the chat and goes to recommendations */
    holdT=setTimeout(()=>{holdT=null;if(!st)return;
      if(st.chat){if(S.mode!=='chat')return;leaveChat();charEl.classList.add('pressed');SFX.touch();}
      listening=listen();
      if(listening&&st.chat)say('응? 어디 가고 싶은데? 말해봐.<div class="hint">손을 떼면 끝나.</div>',{cursor:false});
      if(!listening){st=null;charEl.classList.remove('pressed');typeInput();}},chat?350:220);};
  const move=e=>{if(!st||listening||st.chat)return;const dy=e.clientY-st.y;
    if(dy<-36){clearTimeout(holdT);holdT=null;st=null;charEl.classList.remove('pressed');toRoom();}};
  const up=async e=>{if(!st)return;const p=st;clearTimeout(holdT);st=null;charEl.classList.remove('pressed');
    if(holdT===null&&listening){listening=false;S.mode='busy';const txt=await stopListen();if(txt)gotText(txt);else{S.mode='idle';say('어… 잘 못 들었어.<br>꾹 누른 채로 다시 말해줄래?');}}
    else if(p.chat){if(S.mode==='chat'&&p.dlg&&!p.choice&&e.type==='pointerup')chatTap();}
    else if(S.mode==='idle'&&e.type==='pointerup'){if(p.dlg)startChat();
      else if(!charTapped(p.x,p.y))say('화면을 <span class="q">꾹 누른 채로</span> 말해줘.<div class="hint">위로 밀면 보관함으로 가. 대사창을 누르면 나랑 수다 떨 수 있어.</div>');}
    holdT=null;};
  [$('#touch'),dlgWrap].forEach(el=>{el.addEventListener('pointerdown',down);el.addEventListener('pointermove',move);
    el.addEventListener('pointerup',up);el.addEventListener('pointercancel',up);});
})();

function gotText(txt){
  if(/설정/.test(txt)){openSettings();return;}
  if(/(음악|배경음|bgm)/i.test(txt)&&/(꺼|끄|멈|그만|조용)/.test(txt)){DB.settings.music=false;save();BGM.stop();ambientSession();say('음악 껐어.<div class="hint">"음악 켜줘"라고 하면 다시 틀게.</div>');S.mode='idle';return;}
  if(/(음악|배경음|bgm)/i.test(txt)&&/(켜|틀|다시)/.test(txt)){DB.settings.music=true;save();ambientSession();music();say('음악 다시 틀었어.');S.mode='idle';return;}
  if(/취향/.test(txt)&&/(다시|새로|바꿀|정할)/.test(txt)){startTutorial();return;}
  if(/이름/.test(txt)&&/(바꿔|바꿀|바꾸|다시|새로)/.test(txt)){askName(sayIdle,'이름 바꾸고 싶어? 뭐라고 불러줄까?');return;}
  S.mode='confirm';
  say(`<span class="q">“${esc(txt)}”</span><br>이거 맞지?`,{choices:[{label:'응',fn:()=>startSearch(txt)},{label:'아니',fn:()=>{S.mode='idle';say('앗, 다시 말해줘.<br>화면을 꾹 누른 채로.');}}]});
}

/* ---------- location ---------- */
let LOCERR='';
const MANUAL_MS=6*3600e3;
function manualLoc(){const m=DB.manualLoc;return m&&Date.now()-m.at<MANUAL_MS?m:null;}
function getLoc(force){if(!force&&manualLoc())return Promise.resolve(manualLoc());return gpsLoc(force);}
function gpsLoc(force){return new Promise(res=>{LOCERR='';
  const cached=DB.lastLoc&&Date.now()-DB.lastLoc.at<(force?0:10*60e3)?DB.lastLoc:null;
  if(!navigator.geolocation){LOCERR='이 기기에선 위치를 쓸 수 없어.';return res(cached);}
  navigator.geolocation.getCurrentPosition(p=>{const l={lat:p.coords.latitude,lng:p.coords.longitude,acc:Math.round(p.coords.accuracy||0),at:Date.now(),label:DB.lastLoc&&distM(DB.lastLoc,{lat:p.coords.latitude,lng:p.coords.longitude})<300?DB.lastLoc.label:''};
      DB.lastLoc=l;save();res(l);},
    err=>{LOCERR=err.code===1?'위치 권한이 꺼져 있어. 아이폰 설정 › 개인정보 보호 및 보안 › 위치 서비스 › Safari 웹사이트를 "앱을 사용하는 동안"으로 바꿔줘.':err.code===3?'위치 받는 데 너무 오래 걸렸어. 다시 해볼래?':'지금 위치를 확인할 수가 없어.';
      res(DB.lastLoc&&Date.now()-DB.lastLoc.at<30*60e3?DB.lastLoc:null);},
    {enableHighAccuracy:true,timeout:12000,maximumAge:force?0:60000});});}

/* ---------- Gemini (Google Maps grounding only) ---------- */
function profileText(){const p=DB.profile;const st=Object.entries(p.stats||{}).map(([k,v])=>[k,(v.pin||0)*2+(v.save||0)-(v.skip||0)]);
  const likes=st.filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]).slice(0,5).map(x=>x[0]);const dis=st.filter(x=>x[1]<-1).sort((a,b)=>a[1]-b[1]).slice(0,4).map(x=>x[0]);
  return [`관심사: ${p.interests.join(', ')||'모름'}`,`상황별 선택: ${p.situations.join(' / ')||'모름'}`,p.free?`직접 말한 취향: ${p.free}`:'',
    likes.length?`자주 고른 분야: ${likes.join(', ')}`:'',dis.length?`자주 넘긴 분야: ${dis.join(', ')}`:''].filter(Boolean).join('\n');}
const CATS='카페|음식점|술집|전시·미술|건축·명소|공원·산책|쇼핑|시장|공연·음악|체험|운동|야경·전망|기타';
function buildPrompt(nT,nR){const now=new Date();
  return `너는 여행 중인 사용자에게 "지금 할 거리"를 골라주는 현지 가이드야.
반드시 Google 지도 도구로 실제 장소를 찾아서 확인한 곳만 추천해. 기억이나 추측으로 장소를 만들지 마.
[사용자 요청] "${S.req}"
[현재] 현지 시각 ${now.toLocaleString('ko-KR',{dateStyle:'full',timeStyle:'short'})} / 현재 위치 ${S.loc?S.loc.lat.toFixed(5)+','+S.loc.lng.toFixed(5):'알 수 없음(요청에 나온 지역 기준)'}
[취향]
${profileText()}
[제외] 이미 보여준 곳: ${S.shownNames.slice(-40).join(', ')||'없음'}
규칙:
- 요청에 지역·시간이 있으면 그 기준, 없으면 현재 위치와 지금 시각 기준.
- 그 시간에 실제로 이용할 수 있는 곳만. Google 지도에서 확인되지 않거나 폐업한 곳은 빼라.
- 해외라면 현지인이 실제로 가는 곳을 우선.
- 코스나 일정이 아니라 서로 독립적인 '할 거리'.
- kind "taste" ${nT}개: 취향에 잘 맞는 곳. kind "random" ${nR}개: 평소 취향과 반대 결의 의외인 곳(그래도 근처에서 지금 가능).
- line1·line2는 존댓말 말고 짧은 반말이나 명사형으로.
- mapsTitle은 Google 지도에 등록된 이름을 글자 그대로(현지어 그대로) 적어라. address는 Google 지도의 주소 그대로.
출력은 설명 없이 JSON 배열만:
[{"name":"한국어 표시 이름","mapsTitle":"Google 지도 등록 이름 그대로","address":"Google 지도 주소 그대로","line1":"한 줄 설명 18자 안팎","line2":"한 줄 설명 20자 안팎","kind":"taste 또는 random","category":"${CATS} 중 하나","lat":0.0,"lng":0.0,"hours":"오늘 영업시간","open":true,"tags":["현금만","흡연 가능","예약 필요" 같은 주의사항, 최대 3개, 없으면 빈 배열],"area":"지역명 예: 서울 용산"}]`;}
/* loading readout: stage + elapsed, shown in small dark-green text under the window only while a finger is on the screen */
const LD={stage:'',t0:0,timer:null,held:false};
function setStage(t){LD.stage=t;drawLdInfo();}
window.setStage=setStage;
function ldVisible(){const el=$('#loading');return el&&!el.classList.contains('hidden');}
function drawLdInfo(){const el=$('#ldInfo');if(!el)return;
  if(!LD.held||!ldVisible()){el.classList.add('hidden');return;}
  el.innerHTML=`${esc(LD.stage||'준비 중')}<br>경과 ${Math.floor((Date.now()-LD.t0)/1000)}초`;
  const r=$('#loading').getBoundingClientRect(),host=$('#main').getBoundingClientRect();el.style.top=(r.bottom-host.top+8)+'px';
  el.classList.remove('hidden');}
function ldHold(on){LD.held=on;drawLdInfo();}
document.addEventListener('touchstart',()=>ldHold(true),{capture:true,passive:true});
document.addEventListener('touchend',e=>{if(!e.touches.length)ldHold(false);},{capture:true,passive:true});
document.addEventListener('touchcancel',e=>{if(!e.touches.length)ldHold(false);},{capture:true,passive:true});
document.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse')ldHold(true);},{capture:true});
document.addEventListener('pointerup',e=>{if(e.pointerType==='mouse')ldHold(false);},{capture:true});
document.addEventListener('visibilitychange',()=>{if(document.hidden)ldHold(false);});
function showLoading(){const ld=$('#loading');ld.innerHTML='찾는 중<span class="dots"></span>';ld.classList.remove('hidden');
  LD.t0=Date.now();clearInterval(LD.timer);LD.timer=setInterval(()=>{if(!ldVisible()){clearInterval(LD.timer);LD.timer=null;drawLdInfo();return;}if(LD.held)drawLdInfo();},250);drawLdInfo();}
function hideLoading(){$('#loading').classList.add('hidden');drawLdInfo();}
async function post(url,body,ms){const ac=new AbortController();const to=setTimeout(()=>ac.abort(),ms);
  try{return await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:ac.signal});}finally{clearTimeout(to);}}
/* tools=false → plain call (no grounding, no Maps fee) */
async function gemini(prompt,loc,opt={}){
  const st=DB.settings;const model=(st.model||DEFAULT_MODEL).trim();
  const url=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(st.key.trim())}`;
  const ll=loc?{retrievalConfig:{latLng:{latitude:loc.lat,longitude:loc.lng}}}:null;
  const sets=opt.tools===false?[{tools:null,tc:null}]:[{tools:[{googleMaps:{}}],tc:ll},{tools:[{googleMaps:{}}],tc:null},{tools:[{googleMaps:{}},{googleSearch:{}}],tc:ll}];
  let lastErr='',lastStatus=0,timeouts=0;
  for(const set of sets){
    const body={contents:[{role:'user',parts:[{text:prompt}]}]};if(opt.config)body.generationConfig=opt.config;if(set.tools)body.tools=set.tools;if(set.tc)body.toolConfig=set.tc;
    for(let attempt=0;attempt<2;attempt++){
      let r;try{r=await post(url,body,opt.timeout||45000);}
      catch(e){if(e.name==='AbortError'){timeouts++;if(timeouts>=2)throw new Error('구글 응답이 너무 늦어. 잠깐 있다 다시 하거나 더 빠른 모델(lite)로 바꿔봐.');continue;}
        lastErr='net';await sleep(1200);continue;}
      if(r.ok){const j=await r.json();const c=j.candidates?.[0]||{};const gm=c.groundingMetadata||{};
        return {text:(c.content?.parts||[]).filter(p=>!p.thought).map(p=>p.text||'').join(''),raw:gm.groundingChunks||[],
          chunks:(gm.groundingChunks||[]).map(x=>x.maps).filter(Boolean),supports:gm.groundingSupports||[]};}
      const t=await r.text();lastStatus=r.status;
      try{lastErr=JSON.parse(t).error?.message||t;}catch(e){lastErr=t;}
      if(r.status===429){throw new Error(/free|limit: ?0/i.test(lastErr)?'무료 API 키로는 구글맵 확인을 못 써. 구글 AI Studio에서 결제를 연결해야 해.':'구글맵 확인 한도를 넘었대. 잠깐 있다 다시 해줘.');}
      if(r.status===503||r.status===500){await sleep(1500);continue;}
      if(/API key not valid|API_KEY_INVALID/i.test(lastErr))throw new Error('API 키 한번 확인해줘.');
      if(r.status===404)throw new Error('모델 이름 확인해줘: '+model);
      break;
    }
  }
  if(lastErr==='net')throw new Error('인터넷 연결 확인해줘.');
  throw new Error(`구글이 요청을 거절했어. (${lastStatus||'시간 초과'}) ${String(lastErr).slice(0,160)}`);
}
const norm=s=>String(s||'').toLowerCase().normalize('NFKC').replace(/[\s·・\-_,.()（）\[\]【】'"`~!@#$%^&*+=:;/\\|<>?]/g,'');
function matchChunk(card,res){const keys=[card.mapsTitle,card.name].map(norm).filter(k=>k.length>=2);
  let best=null,score=0;
  for(const ch of res.chunks){const t=norm(ch.title);if(!t)continue;
    for(const k of keys){let s=0;if(t===k)s=3;else if(t.includes(k)||k.includes(t))s=2;
      else{let common=0;for(const c of new Set(k))if(t.includes(c))common++;const r=common/Math.max(new Set(k).size,1);if(r>=0.8&&k.length>=3)s=1;}
      if(s>score){score=s;best=ch;}}}
  if(best)return best;
  /* second chance: the text span that names this card is grounded to a Maps chunk */
  for(const sp of res.supports){const seg=norm(sp.segment?.text);if(!seg)continue;
    if(keys.some(k=>k.length>=2&&seg.includes(k))){for(const i of sp.groundingChunkIndices||[]){const m=res.raw[i]?.maps;if(m)return m;}}}
  return null;}
function jsonArr(txt){const a=txt.indexOf('['),b=txt.lastIndexOf(']');if(a<0||b<a)return null;try{const v=JSON.parse(txt.slice(a,b+1));return Array.isArray(v)?v:null;}catch(e){return null;}}
function mkCard(c,ch){const pid=String(ch.placeId||'').replace(/^places\//,'');const mt=cleanTitle(ch.title||c.mapsTitle||c.name);
  /* Korean place whose model-given name doesn't match the verified place → show the verified name */
  const nm=c.name&&sameKoPlace([c.name],mt)?String(c.name):mt;
  return {id:uid(),name:nm,mapsTitle:mt,placeId:pid,mapsUri:ch.uri||'',address:String(c.address||''),
    line1:String(c.line1||''),line2:String(c.line2||''),kind:c.kind==='random'?'random':'taste',category:String(c.category||'기타'),
    lat:isFinite(+c.lat)&&+c.lat!==0&&c.lat!==null?+c.lat:null,lng:isFinite(+c.lng)&&+c.lng!==0&&c.lng!==null?+c.lng:null,hours:String(c.hours||''),open:c.open!==false,
    tags:Array.isArray(c.tags)?c.tags.slice(0,3).map(String):[],area:String(c.area||'')};}
/* describe verified Maps places: look each one up on Google Maps (grounded), fall back to plain call */
async function describeChunks(chs,ctxText,nR){
  const list=chs.map((c,i)=>`${i}. ${cleanTitle(c.title)}`).join('\n');
  const p=`아래 장소들은 Google 지도에서 확인된 실제 장소야. Google 지도 도구로 각 장소를 하나씩 찾아보고, 번호 순서대로 카드 정보를 채워.
[사용자 요청] "${S.req}"
[현재 위치] ${S.loc?S.loc.lat.toFixed(5)+','+S.loc.lng.toFixed(5):'모름'}
[취향]
${profileText()}
[장소 목록]
${list}
[참고 메모]
${String(ctxText||'').slice(0,2500)}
규칙: 번호마다 정확히 하나. "title"에는 목록의 장소 이름을 글자 그대로 옮겨 적고, 설명은 반드시 그 장소에 대한 것만. 주소·좌표·영업시간은 Google 지도에 나온 그대로. 설명 두 줄은 이 장소가 어떤 곳인지 구체적으로(빈칸 금지). 취향과 반대 결인 곳 ${nR}개 정도는 kind "random".
출력은 JSON 배열만:
[{"i":0,"title":"목록의 이름 그대로","name":"한국어 표시 이름","address":"Google 지도 주소","line1":"18자 안팎","line2":"20자 안팎","kind":"taste 또는 random","category":"${CATS} 중 하나","lat":0.0,"lng":0.0,"hours":"오늘 영업시간","open":true,"tags":[],"area":"지역명 예: 서울 용산"}]`;
  let arr=null;
  try{const r=await gemini(p,S.loc,{timeout:40000});arr=jsonArr(r.text);}catch(e){if(/한도|결제|API 키/.test(e.message))throw e;}
  if(!arr){const r=await gemini(p,null,{tools:false,timeout:30000});arr=jsonArr(r.text)||[];}
  const tkey=t=>norm(cleanTitle(t));
  return chs.map((ch,i)=>{const k=tkey(ch.title);
    let it=arr.find(x=>x&&x.title&&tkey(x.title)===k)||arr.find(x=>x&&+x.i===i&&(!x.title||tkey(x.title)===k))||arr[i];
    /* still describes another shop → keep the verified place, drop the wrong text */
    if(it&&!sameKoPlace([it.title,it.name].filter(Boolean),ch.title))it={kind:it.kind,category:it.category,area:it.area};
    return mkCard(it||{name:cleanTitle(ch.title)},ch);});}
/* fill missing coordinates in the background (OpenStreetMap, free) */
let geoBusy=false;
async function geocodeMissing(){if(geoBusy)return;geoBusy=true;
  try{for(const c of [...S.cards,...S.queue]){if(c.lat!=null&&c.lng!=null)continue;
    const qs=[c.address,[placeTitle(c),c.area].filter(Boolean).join(' ')].filter(x=>x&&x.trim().length>3);
    for(const q of qs){try{const r=await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=ko&q=${encodeURIComponent(q)}`);const j=await r.json();
        await sleep(1100);
        if(j&&j[0]){const p={lat:+j[0].lat,lng:+j[0].lon};if(!S.loc||distM(S.loc,p)<60000){c.lat=p.lat;c.lng=p.lng;c.approx=true;break;}}}catch(e){await sleep(1100);}}
    if(S.mode==='cards')updatePins();}}
  finally{geoBusy=false;}}
function naturalPrompt(n){return `${S.loc?`현재 위치(${S.loc.lat.toFixed(5)},${S.loc.lng.toFixed(5)}) 근처에서`:''} "${S.req}" 요청에 맞는 실제 장소 ${n}곳을 Google 지도에서 찾아줘. 지금 시각은 ${new Date().toLocaleString('ko-KR',{timeStyle:'short',dateStyle:'medium'})}. 지금 이용 가능한 곳만. 각 장소의 Google 지도 등록 이름, 주소, 한 줄 특징을 목록으로 적어줘. 이미 본 곳 제외: ${S.shownNames.slice(-30).join(', ')||'없음'}`;}
let DIAG='';
async function fetchCards(nT,nR,bg){const setStage=bg?()=>{}:window.setStage;
  if(DB.settings.key.trim().toLowerCase()==='demo'){await sleep(700);return demoCards(nT,nR);}
  const want=nT+nR;let got=[];const used=new Set(S.shownNames);const usedPid=new Set();
  const add=c=>{if(!c||used.has(c.name)||(c.placeId&&usedPid.has(c.placeId)))return;used.add(c.name);if(c.placeId)usedPid.add(c.placeId);got.push(c);};
  setStage('구글맵에서 찾는 중');
  let res=await gemini(buildPrompt(nT,nR),S.loc);
  const arr=jsonArr(res.text)||[];let left=[...res.chunks];
  for(const c of arr){if(!c||!c.name)continue;const ch=matchChunk(c,res);if(!ch||!sameKoPlace([c.name,c.mapsTitle],ch.title))continue;left=left.filter(x=>x!==ch);add(mkCard(c,ch));}
  DIAG=`모델 ${arr.length}곳 · 구글맵 확인 ${res.chunks.length}곳 · 일치 ${got.length}곳`;
  if(got.length<Math.min(6,want)&&left.length){setStage('확인된 곳 정리 중');try{(await describeChunks(left.slice(0,want-got.length),res.text,nR)).forEach(add);}catch(e){}}
  if(got.length<3){setStage('한 번 더 찾는 중');
    const r2=await gemini(naturalPrompt(want),S.loc);DIAG+=` / 재시도 확인 ${r2.chunks.length}곳`;
    const fresh=r2.chunks.filter(ch=>!usedPid.has(String(ch.placeId||'').replace(/^places\//,'')));
    if(fresh.length){setStage('확인된 곳 정리 중');try{(await describeChunks(fresh.slice(0,want),r2.text,nR)).forEach(add);}catch(e){}}}
  const full=got.filter(c=>c.line1||c.line2);if(full.length>=5)got=full;
  if(!got.length&&!S.cards.length)throw new Error(`구글맵에서 확인된 곳을 못 찾았어… 지역을 넣어서 다시 말해줄래?<div class="hint">${esc(DIAG)}</div>`);
  return got;}

/* ---------- search flow ---------- */
async function startSearch(txt){
  if(!DB.settings.key.trim()){openSettings('먼저 제미나이 API 키를 넣어줘.');return;}
  S.gen++;S.fetching=false;S.emptyRefills=0;
  S.mode='loading';S.req=txt;S.queue=[];S.cards=[];S.pins=[];S.shownNames=[];S.groupId=null;S.area='';
  showDlg(false);charEl.classList.add('gone');$('#mainShade').style.opacity=.45;
  LD.stage='위치 확인 중';await sleep(700);showLoading();
  S.loc=await getLoc();
  try{const got=await fetchCards(10,5);if(!got.length)throw new Error('지금 갈 만한 곳을 확인 못 했어.');
    S.area=got.find(c=>c.area)?.area||'';
    const t=got.filter(c=>c.kind==='taste'),r=got.filter(c=>c.kind==='random');
    const first=[];const pattern=['t','t','r','t','t','r','t','r','t'];
    for(const p of pattern){const src=p==='r'?(r.length?r:t):(t.length?t:r);if(src.length)first.push(src.shift());}
    S.queue=[...t,...r];S.cards=first;first.concat(S.queue).forEach(c=>S.shownNames.push(c.name));
    hideLoading();showCards();geocodeMissing();refill();  // prefetch the next batch right away
    if(!S.loc)toast('현재 위치를 못 받아서 거리 표시는 빠져');
  }catch(e){hideLoading();backToIdle();say((/<div/.test(e.message)?e.message:esc(e.message||'뭔가 문제가 생겼어.'))+'<br>꾹 눌러서 다시 말해줘.');}
}
function backToIdle(){S.gen++;S.queue=[];S.mode='idle';S.cards=[];S.pins=[];$('#cardLayer').classList.add('hidden');$('#dimmer').classList.remove('on');
  $('#mainShade').style.opacity=.30;charEl.classList.remove('gone','front');showDlg(true);sayIdle();}
/* keep a queue behind the 9 visible cards; whatever arrives goes straight into empty slots */
async function refill(){if(S.fetching||!S.req||S.queue.length>=QUEUE_MIN||S.emptyRefills>=3)return;
  const gen=S.gen;S.fetching=true;let got=[];
  try{got=await fetchCards(4,2,true);}catch(e){}
  if(gen!==S.gen)return;            // a new search started (or cards were cleared) meanwhile — drop it
  S.fetching=false;
  if(got.length){S.emptyRefills=0;got.forEach(c=>S.shownNames.push(c.name));S.queue.push(...got);geocodeMissing();}else S.emptyRefills++;
  fillSlots();
  if(S.cards.length<CARD_SLOTS&&S.mode!=='idle')setTimeout(refill,got.length?300:2500);  // only keep going on our own while slots are visibly empty
}
function takeFromQueue(){if(!S.queue.length)return null;const wantR=Math.random()<0.3;let i=S.queue.findIndex(c=>(c.kind==='random')===wantR);if(i<0)i=0;
  const c=S.queue.splice(i,1)[0];if(S.queue.length<QUEUE_MIN)refill();return c;}
/* put queued cards into empty slots without redrawing the cards already on screen */
function fillSlots(){const add=[];while(S.cards.length<CARD_SLOTS){const n=takeFromQueue();if(!n)break;S.cards.push(n);add.push(n);}
  if(!add.length)return;if(S.mode==='idle'||S.mode==='loading')return;
  const L=$('#cardList');if(!L)return;L.insertAdjacentHTML('beforeend',add.map(c=>cardHTML(c)).join(''));
  add.forEach(c=>{const w=L.querySelector(`.cw[data-id="${c.id}"]`);if(w){bindCard(w);w.classList.add('arrive');}});updatePins();}

/* ---------- profile stats ---------- */
function stat(c,k,w=1){const s=DB.profile.stats;s[c.category]=s[c.category]||{};s[c.category][k]=(s[c.category][k]||0)+w;save();}

/* ---------- pins & distance ---------- */
function pinnedCards(list,pins){return pins.map(id=>list.find(c=>c.id===id)).filter(Boolean);}
function maxDistToPins(c,pinCards){let m=0;for(const p of pinCards){if(p.id===c.id)continue;const d=distM(c,p);if(d==null)return 0;m=Math.max(m,d);}return m;}
function selectable(c,pinCards){return maxDistToPins(c,pinCards)<=5000;}

/* ---------- card gestures ---------- */
function gestures(wrap,card,o){let s=null,lt=null,drag=false,moved=false,long=false;
  const under={save:wrap.querySelector('.under.save'),pass:wrap.querySelector('.under.pass')};
  card.addEventListener('pointerdown',e=>{audio();s={x:e.clientX,y:e.clientY,t:Date.now(),id:e.pointerId};drag=moved=long=false;
    lt=setTimeout(()=>{if(s&&!drag&&!moved){long=true;o.onLong&&o.onLong();}},450);});
  card.addEventListener('pointermove',e=>{if(!s)return;const dx=e.clientX-s.x,dy=e.clientY-s.y;
    if(!drag&&!moved){if(Math.abs(dx)>10&&Math.abs(dx)>Math.abs(dy)*1.2){drag=true;clearTimeout(lt);try{card.setPointerCapture(s.id)}catch(_){}}
      else if(Math.abs(dy)>10){moved=true;clearTimeout(lt);}}
    if(drag){let x=dx;if(x>0&&!o.onRight)x=x*0.2;if(x<0&&!o.onLeft)x=x*0.2;card.style.transform=`translateX(${x}px)`;
      if(under.save)under.save.style.display=x>0&&o.onRight?'flex':'none';if(under.pass)under.pass.style.display=x<0&&o.onLeft?'flex':'none';}});
  const end=e=>{if(!s)return;clearTimeout(lt);const dx=(e.clientX??s.x)-s.x,dt=Date.now()-s.t;const wasDrag=drag;s=null;
    if(wasDrag){if(dx>90&&o.onRight){fly(wrap,card,1,o.onRight);}else if(dx<-90&&o.onLeft){fly(wrap,card,-1,o.onLeft);}
      else{card.style.transition='transform .15s';card.style.transform='';setTimeout(()=>{card.style.transition='';Object.values(under).forEach(u=>u&&(u.style.display='none'));},160);}}
    else if(!moved&&!long&&dt<450&&e.type==='pointerup'){o.onTap&&o.onTap();}};
  card.addEventListener('pointerup',end);card.addEventListener('pointercancel',e=>{if(drag)end({clientX:s?s.x:0,type:'cancel'});else{clearTimeout(lt);s=null;}});
  card.addEventListener('contextmenu',e=>e.preventDefault());}
function fly(wrap,card,dir,cb){SFX.swipe();card.style.transition='transform .18s ease-in';card.style.transform=`translateX(${dir*130}%)`;
  setTimeout(()=>{wrap.style.transition='height .16s,margin .16s';wrap.style.height=wrap.offsetHeight+'px';wrap.style.overflow='hidden';
    requestAnimationFrame(()=>{wrap.style.height='0px';wrap.style.marginBottom='0px';});setTimeout(cb,170);},180);}

/* ---------- cards screen ---------- */
function cardHTML(c,extra=''){return `<div class="cw" data-id="${c.id}"><div class="under save">저장</div><div class="under pass">패스</div>
  <div class="card px" data-id="${c.id}">${PIN_SVG}<div class="t"><span>${esc(c.name)}</span>${c.kind==='random'?'<span class="odd">의외</span>':''}</div>
  ${c.line1?`<div class="l">${esc(c.line1)}</div>`:''}${c.line2?`<div class="l">${esc(c.line2)}</div>`:''}<span class="dist"></span>${extra}</div></div>`;}
function showCards(){S.mode='cards';$('#cardLayer').classList.remove('hidden');$('#reqTitle').textContent=S.area?`${S.area} · ${S.req}`:S.req;renderCards();}
function renderCards(){const L=$('#cardList');const st=L.scrollTop;L.innerHTML=S.cards.map(c=>cardHTML(c)).join('');
  L.querySelectorAll('.cw').forEach(bindCard);
  L.scrollTop=st;updatePins();}
function bindCard(w){const id=w.dataset.id,c=S.cards.find(x=>x.id===id),card=w.querySelector('.card');if(!c||!card)return;
  gestures(w,card,{onTap:()=>togglePin(c,card),onLong:()=>openDetail(c),onRight:()=>removeCard(c,'save'),onLeft:()=>removeCard(c,'pass')});}
function updatePins(){const pc=pinnedCards(S.cards,S.pins);$('#pinCount').textContent=`핀 ${S.pins.length}/3`;
  const L=$('#cardList');L.classList.toggle('showdist',pc.length>0);
  L.querySelectorAll('.card').forEach(el=>{const c=S.cards.find(x=>x.id===el.dataset.id);if(!c)return;const pinned=S.pins.includes(c.id);
    el.classList.toggle('pinned',pinned);const ok=pinned||selectable(c,pc);el.classList.toggle('off',!ok&&pc.length>0);
    const d=pc.length?maxDistToPins(c,pc):0;el.querySelector('.dist').textContent=d?fmtKm(d):'';});
  const b=$('#routeBtn');b.classList.toggle('hidden',!S.pins.length);b.textContent=`동선 짜기 (${S.pins.length})  ▶`;}
function togglePin(c,el){const pc=pinnedCards(S.cards,S.pins);
  if(S.pins.includes(c.id)){S.pins=S.pins.filter(x=>x!==c.id);SFX.touch();updatePins();return;}
  if(!selectable(c,pc))return;
  if(S.pins.length>=3){el.classList.remove('shake');void el.offsetWidth;el.classList.add('shake');return;}
  S.pins.push(c.id);SFX.pin();stat(c,'pin');updatePins();}
function ensureGroup(){let g=DB.groups.find(x=>x.id===S.groupId);
  if(!g){g={id:uid(),request:S.req,date:Date.now(),area:S.area,cards:[]};DB.groups.unshift(g);S.groupId=g.id;}return g;}
function removeCard(c,how){S.cards=S.cards.filter(x=>x.id!==c.id);S.pins=S.pins.filter(x=>x!==c.id);
  if(how==='save'){const g=ensureGroup();g.cards.push(c);stat(c,'save');}
  else{DB.passed.unshift({card:c,groupId:S.groupId,request:S.req,area:S.area,date:Date.now(),at:Date.now()});stat(c,'skip',c.kind==='random'?0.3:1);}
  save();const n=takeFromQueue();if(n)S.cards.push(n);renderCards();
  if(S.queue.length<QUEUE_MIN||S.cards.length<CARD_SLOTS){S.emptyRefills=0;refill();}}
/* pull at list edges: top → onTop, bottom → onBottom */
function edgePull(listEl,onTop,onBottom){let y0=null,edge=null;
  listEl.addEventListener('touchstart',e=>{const atTop=listEl.scrollTop<=0,atBot=listEl.scrollTop+listEl.clientHeight>=listEl.scrollHeight-2;
    edge=atTop&&atBot?'both':atTop?'top':atBot?'bot':null;y0=edge?e.touches[0].clientY:null;},{passive:true});
  listEl.addEventListener('touchmove',e=>{if(y0==null)return;const dy=e.touches[0].clientY-y0;
    if(dy>90&&onTop&&(edge==='top'||edge==='both')){y0=null;onTop();}
    else if(dy<-90&&onBottom&&(edge==='bot'||edge==='both')){y0=null;onBottom();}},{passive:true});
  listEl.addEventListener('touchend',()=>{y0=null;},{passive:true});}
function cardsResume(){S.mode='cards';charEl.classList.add('gone');setTimeout(()=>charEl.classList.remove('front'),700);$('#dimmer').classList.remove('on');setTimeout(()=>showDlg(false),10);}
edgePull($('#cardList'),()=>{if(S.mode!=='cards')return;SFX.btn();S.mode='clearConfirm';
  $('#dimmer').classList.add('on');charEl.classList.add('front');charEl.classList.remove('gone');showDlg(true);
  say('추천 카드 지울까?<div class="hint">오른쪽으로 밀어서 저장한 카드만 보관함에 남아.</div>',{choices:[{label:'응',fn:()=>backToIdle()},{label:'아니',fn:cardsResume}]});});

/* route confirm (main, with Miyeon) */
$('#routeBtn').onclick=()=>{if(!S.pins.length)return;SFX.btn();const pc=pinnedCards(S.cards,S.pins);S.mode='routeConfirm';
  $('#dimmer').classList.add('on');charEl.classList.add('front');charEl.classList.remove('gone');showDlg(true);
  say(`<span class="q">${pc.map(c=>esc(c.name)).join(', ')}</span><br>이 순서로 동선 짜볼까?`,{choices:[
    {label:'응',fn:()=>openRoute(pc,'cards',S.req)},
    {label:'아니',fn:cardsResume}]});};

/* ---------- external links ---------- */
function gSearch(c){const q=encodeURIComponent(searchText(c));return `https://www.google.com/maps/search/?api=1&query=${q}${c.placeId?`&query_place_id=${encodeURIComponent(c.placeId)}`:''}`;}
function kSearch(c){const q=encodeURIComponent([regionKR(c.address),placeTitle(c)].filter(Boolean).join(' ')||c.name);return {app:`kakaomap://search?q=${q}`,web:`https://map.kakao.com/link/search/${q}`};}
function ySearch(c){const q=encodeURIComponent(placeTitle(c)+' '+(c.area||''));return {app:`youtube://www.youtube.com/results?search_query=${q}`,web:`https://www.youtube.com/results?search_query=${q}`};}
/* Korean map apps are offered when the place itself is in Korea (not where you are standing) */
const allKR=items=>items.length>0&&items.every(isKR);
function nSearch(c){const q=encodeURIComponent([regionKR(c.address),placeTitle(c)].filter(Boolean).join(' ')||c.name);
  return {app:`nmap://search?query=${q}&appname=${encodeURIComponent(location.origin+location.pathname)}`,web:`https://map.naver.com/p/search/${q}`};}

/* ---------- detail window ---------- */
function openDetail(c){SFX.btn();const d=distM(S.loc,c);
  const ov=document.createElement('div');ov.className='overlay';const kr=isKR(c);
  const btns=['<button class="px" data-l="g">구글맵<small>후기</small></button>','<button class="px" data-l="y">유튜브<small>영상</small></button>'];
  if(kr)btns.push('<button class="px" data-l="n">네이버<small>지도</small></button>','<button class="px" data-l="k">카카오<small>지도</small></button>');
  ov.innerHTML=`<div class="win px solid"><h3>${esc(c.name)}</h3>${placeTitle(c)&&placeTitle(c)!==c.name?`<div class="sub" style="margin-bottom:4px">${esc(placeTitle(c))}</div>`:''}
    <div class="sub">${esc(c.line1)}<br>${esc(c.line2)}</div><div class="sep"></div>
    <div class="row" style="color:${c.open?'#6ee696':'#a0aacc'}">■ ${c.open?'영업 중':'영업 시간 확인'}${c.hours?' · '+esc(c.hours):''}</div>
    ${d!=null?`<div class="row">현재 위치에서 도보 ${walkMin(d)}분 · ${fmtKm(d)}</div>`:''}
    ${c.address?`<div class="sub" style="margin-top:6px">${esc(c.address)}</div>`:''}
    ${c.tags.length?`<div class="tags">${c.tags.map(t=>`<span>${esc(t)}</span>`).join('')}</div>`:''}
    <div class="btnrow${btns.length>3?' four':''}">${btns.join('')}</div></div><div class="closehint">바깥을 누르면 닫혀</div>`;
  ov.addEventListener('click',e=>{if(e.target===ov||e.target.classList.contains('closehint'))ov.remove();});
  ov.querySelectorAll('[data-l]').forEach(b=>b.onclick=()=>{SFX.btn();const l=b.dataset.l;
    if(l==='g')openGoogle(gSearch(c));
    if(l==='k'){const k=kSearch(c);openExternal(k.app,k.web);}
    if(l==='n'){const n=nSearch(c);openExternal(n.app,n.web);}
    if(l==='y'){const y=ySearch(c);openExternal(y.app,y.web);}});
  $('#overlayHost').appendChild(ov);}

/* ---------- route screen (new + history) ---------- */
let R={items:[],mode:'new',idx:0,entry:null,kIdx:0};
function saveRouteEntry(items,request){const e={id:uid(),date:Date.now(),request:request||'',items:items.map(c=>({...c}))};
  DB.routes=[e,...DB.routes].slice(0,5);save();return e;}
function openRoute(items,from,request){SFX.btn();S.routeFrom=from;R.mode='new';R.entry=saveRouteEntry(items,request);R.items=R.entry.items;R.kIdx=0;
  $('#route').classList.remove('hidden','hist');SCREEN='route';music();renderRoute(new Set());
  getLoc().then(l=>{if(l){S.loc=l;renderRoute(new Set());}});}
function legsOf(items){const pts=(S.loc?[{...S.loc,id:'here'}]:[]).concat(items);const out=[];
  for(let i=1;i<pts.length;i++)out.push({key:(pts[i-1].id||'here')+'>'+pts[i].id,d:distM(pts[i-1],pts[i])});return out;}
function renderRoute(changed){const box=$('#rlist');const legs=legsOf(R.items);let html='';let tw=0,tt=0;
  if(R.mode==='hist'){const e=R.entry;$('#routeTitle').textContent=`지난 동선 ${R.idx+1}/${DB.routes.length}`;
    const d=new Date(e.date);$('#routeMeta').textContent=`${d.getMonth()+1}월 ${d.getDate()}일${e.request?' · '+e.request:''}`;
    $('#routeDots').innerHTML=DB.routes.map((_,i)=>`<i class="${i===R.idx?'on':''}"></i>`).join('');}
  else{$('#routeTitle').textContent='이동 순서';$('#routeMeta').textContent='카드를 끌어서 순서를 바꿀 수 있어. 아래로 당기면 닫혀.';$('#routeDots').innerHTML='';}
  if(S.loc)html+=`<div class="rstart gbox"><i></i>현재 위치</div>`;
  R.items.forEach((c,i)=>{const lg=S.loc?legs[i]:(i>0?legs[i-1]:null);
    if(lg){const d=lg.d;const ch=changed.has(lg.key);
      if(d!=null){tw+=walkMin(d);tt+=d<1200?walkMin(d):Math.round(8+d/1000*2.6);}
      html+=`<div class="leg${ch?' chg':''}"><div>도보 ${d!=null?walkMin(d)+'분':'—'}</div><div>대중교통 ${d!=null?transitTxt(d):'—'}</div>${ch?'<span class="upd">갱신</span>':''}</div>`;}
    html+=`<div class="rcard gbox" data-i="${i}"><div class="n">${i+1}</div><div class="bar"></div><div class="tx"><div class="t">${esc(c.name)}</div><div class="l">${esc(c.address||c.line1)}</div></div><div class="h"><b></b><b></b><b></b></div></div>`;});
  if(legs.length&&legs.some(l=>l.d!=null))html+=`<div class="total">총 이동&nbsp;&nbsp;<b>도보 ${tw}분 · 대중교통 약 ${tt}분</b></div>`;
  if(!S.loc)html+=`<div class="total">현재 위치를 못 받았어. 설정에서 위치를 확인해줘.</div>`;
  box.innerHTML=html;
  box.querySelectorAll('.rcard').forEach(el=>el.querySelector('.h').addEventListener('pointerdown',e=>startDrag(e,el)));
  /* places in Korea → 네이버 · 카카오 · 구글 (네이버 first: best walking routes); abroad → Google only */
  const btns=[];const kr=allKR(R.items);const allXY=R.items.every(c=>c.lat!=null&&c.lng!=null);
  const useN=kr&&allXY,useK=kr,useG=true,many=[useG,useK,useN].filter(Boolean).length>=3;
  if(useN)btns.push(`<button class="gbtn" id="goN">네이버 ▶</button>`);
  if(useK){if(allXY)btns.push(`<button class="gbtn" id="goK">${many?'카카오 ▶':'카카오맵 동선 ▶'}</button>`);
    else{const n=R.items.length,k=Math.min(R.kIdx,n-1);btns.push(`<button class="gbtn" id="goK">카카오 ${n>1?(k+1)+'번':''} 찾기 ▶</button>`);}}
  btns.push(`<button class="gbtn" id="goG">${kr?'구글 ▶':'Google Map으로 ▶'}</button>`);
  const g=$('#gbtns');g.innerHTML=btns.join('');g.classList.toggle('three',many);
  if($('#goG'))$('#goG').onclick=()=>{SFX.btn();openGoogle(gmapsUrl());if(R.mode==='new')setTimeout(finishRoute,600);};
  if($('#goK'))$('#goK').onclick=()=>{SFX.btn();
    if(allXY){const u=kakaoRouteUrl();openExternal(u.app,u.web);if(R.mode==='new')setTimeout(finishRoute,600);return;}
    /* some place has no coordinates yet → old behaviour: open the places one by one */
    const k=Math.min(R.kIdx,R.items.length-1);const u=kSearch(R.items[k]);openExternal(u.app,u.web);
    R.kIdx=(k+1)%R.items.length;setTimeout(()=>renderRoute(new Set()),800);};
  if($('#goN'))$('#goN').onclick=()=>{SFX.btn();const u=naverRouteUrl();openExternal(u.app,u.web);if(R.mode==='new')setTimeout(finishRoute,600);};}
/* 카카오맵 도보 길찾기: 현재 위치 → 경유지(vp, vp2…vp5) → 마지막 핀. 좌표만 받음 */
function kakaoRouteUrl(){const it=R.items,xy=c=>`${(+c.lat).toFixed(6)},${(+c.lng).toFixed(6)}`;
  const pts=S.loc?[S.loc,...it]:[...it];const sp=pts.length>1?pts[0]:null,ep=pts[pts.length-1],vias=pts.slice(sp?1:0,-1).slice(0,5);
  const q=[sp?`sp=${xy(sp)}`:'',...vias.map((c,i)=>`${i?'vp'+(i+1):'vp'}=${xy(c)}`),`ep=${xy(ep)}`,'by=foot'].filter(Boolean).join('&');
  return {app:`kakaomap://route?${q}`,web:`https://m.map.kakao.com/scheme/route?${q}`};}
/* 네이버지도 도보 길찾기: 이름까지 넘김. 경유지는 v1~v5 */
function naverRouteUrl(){const it=R.items,e=encodeURIComponent,nm=c=>e(placeTitle(c)||c.name||'');
  const P=[];if(S.loc){P.push(`slat=${S.loc.lat}`,`slng=${S.loc.lng}`,`sname=${e('현재 위치')}`);}
  const dest=it[it.length-1],vias=(S.loc?it.slice(0,-1):it.slice(1,-1)).slice(0,5);
  if(!S.loc&&it.length>1){const s0=it[0];P.push(`slat=${s0.lat}`,`slng=${s0.lng}`,`sname=${nm(s0)}`);}
  P.push(`dlat=${dest.lat}`,`dlng=${dest.lng}`,`dname=${nm(dest)}`);
  vias.forEach((c,i)=>P.push(`v${i+1}lat=${c.lat}`,`v${i+1}lng=${c.lng}`,`v${i+1}name=${nm(c)}`));
  P.push(`appname=${e(location.origin+location.pathname)}`);
  return {app:`nmap://route/walk?${P.join('&')}`,web:`https://map.naver.com/p/search/${e(placeTitle(dest)||dest.name)}`};}
function gmapsUrl(){const it=R.items;if(!it.length)return'#';const dest=it[it.length-1],way=it.slice(0,-1);
  const allIds=it.every(c=>c.placeId);let u=`https://www.google.com/maps/dir/?api=1${S.loc?`&origin=${S.loc.lat},${S.loc.lng}`:''}&destination=${encodeURIComponent(searchText(dest))}`;
  if(allIds)u+=`&destination_place_id=${encodeURIComponent(dest.placeId)}`;
  if(way.length){u+=`&waypoints=${way.map(c=>encodeURIComponent(searchText(c))).join('%7C')}`;if(allIds)u+=`&waypoint_place_ids=${way.map(c=>encodeURIComponent(c.placeId)).join('%7C')}`;}
  return u+'&travelmode=walking';}
function finishRoute(){$('#route').classList.add('hidden');SCREEN='main';if(S.routeFrom==='cards'){backToIdle();music();}else{SCREEN='room';roomPins=[];renderRoom();music();}}
function closeRoute(){if(R.mode==='hist'){stepFade($('#route'),1,()=>{$('#route').classList.add('hidden');$('#room').classList.remove('hidden');SCREEN='room';music();renderRoom();});return;}
  $('#route').classList.add('hidden');
  if(S.routeFrom==='cards'){SCREEN='main';music();S.mode='cards';charEl.classList.add('gone');charEl.classList.remove('front');$('#dimmer').classList.remove('on');showDlg(false);}
  else{SCREEN='room';music();}}
function startDrag(e,el){e.preventDefault();e.stopPropagation();audio();const box=$('#rlist');let idx=+el.dataset.i;const before=legsOf(R.items).map(l=>l.key);
  let base=el.getBoundingClientRect().top;el.classList.add('drag');try{el.setPointerCapture(e.pointerId)}catch(_){}
  const move=ev=>{const cards=[...box.querySelectorAll('.rcard')];const y=ev.clientY;
    let target=0;cards.forEach(c=>{if(c===el)return;const r=c.getBoundingClientRect();if(y>r.top+r.height/2)target++;});
    if(target!==idx){const it=R.items.splice(idx,1)[0];R.items.splice(target,0,it);idx=target;SFX.touch();if(R.entry){R.entry.items=R.items;save();}
      const after=legsOf(R.items).map(l=>l.key);renderRoute(new Set(after.filter(k=>!before.includes(k))));
      el=box.querySelector(`.rcard[data-i="${idx}"]`);el.classList.add('drag');base=el.getBoundingClientRect().top;
      el.onpointermove=move;el.onpointerup=el.onpointercancel=up;try{el.setPointerCapture(ev.pointerId)}catch(_){}}
    const h=el.getBoundingClientRect().height;el.style.transform=`translateY(${y-base-h/2}px)`;};
  const up=()=>{el.style.transform='';el.classList.remove('drag');el.onpointermove=el.onpointerup=el.onpointercancel=null;};
  el.onpointermove=move;el.onpointerup=el.onpointercancel=up;}
/* history: drag left/right between saved routes (card follows finger), pull down to leave */
(function(){const box=$('#rlist');let s=null,horiz=false;
  box.addEventListener('touchstart',e=>{if(e.target.closest('.h')||paging)return;s={x:e.touches[0].clientX,y:e.touches[0].clientY,top:box.scrollTop<=0,dx:0};horiz=false;box.style.transition='none';},{passive:true});
  box.addEventListener('touchmove',e=>{if(!s)return;const dx=e.touches[0].clientX-s.x,dy=e.touches[0].clientY-s.y;
    if(!horiz&&R.mode==='hist'&&Math.abs(dx)>12&&Math.abs(dx)>Math.abs(dy)*1.3)horiz=true;
    if(horiz){const ni=R.idx+(dx<0?1:-1),edge=ni<0||ni>=DB.routes.length;const x=edge?dx*0.22:dx*0.9;s.dx=dx;
      box.style.transform=`translateX(${x}px) rotate(${x/90}deg)`;box.style.opacity=String(1-Math.min(Math.abs(x)/500,.45));}
    else if(dy>90&&s.top&&Math.abs(dy)>Math.abs(dx)){s=null;closeRoute();}},{passive:true});
  box.addEventListener('touchend',()=>{if(!s)return;const dx=s.dx;s=null;if(!horiz)return;horiz=false;
    const dir=dx<0?1:-1,ni=R.idx+dir;
    if(Math.abs(dx)<60||ni<0||ni>=DB.routes.length){box.style.transition='transform .28s cubic-bezier(.3,1.6,.5,1),opacity .2s';box.style.transform='';box.style.opacity='';
      if(Math.abs(dx)>=60){SFX.touch();toast(ni<0?'이게 제일 최근 동선이야':'더 지난 동선은 없어',1300);}return;}
    pageHist(ni,dir);},{passive:true});})();
let paging=false;
async function pageHist(ni,dir){if(paging||ni<0||ni>=DB.routes.length)return;paging=true;const box=$('#rlist');SFX.swipe();
  box.style.transition='transform .17s ease-in,opacity .17s';box.style.transform=`translateX(${-dir*110}%) rotate(${-dir*4}deg)`;box.style.opacity='0';await sleep(170);
  showHist(ni);box.scrollTop=0;box.style.transition='none';box.style.transform=`translateX(${dir*60}%)`;box.style.opacity='0';void box.offsetWidth;
  box.style.transition='transform .22s cubic-bezier(.2,1.3,.5,1),opacity .18s';box.style.transform='';box.style.opacity='';
  const t=$('#routeTitle');t.classList.remove('flash');void t.offsetWidth;t.classList.add('flash');await sleep(230);paging=false;}
function showHist(i){R.mode='hist';R.idx=i;R.entry=DB.routes[i];R.items=R.entry.items;R.kIdx=0;renderRoute(new Set());}
function toRouteHistory(){if(!DB.routes.length){toast('아직 저장된 동선이 없어');return;}
  stepFade($('#room'),-1,()=>{$('#room').classList.add('hidden');$('#route').classList.remove('hidden');$('#route').classList.add('hist');
    SCREEN='route';music();S.routeFrom='room';showHist(0);getLoc().then(l=>{if(l){S.loc=l;renderRoute(new Set());}});});}

/* ---------- room (archive) ---------- */
let roomTab='saved',roomPins=[],sparkleId=null;
function allSaved(){return DB.groups.flatMap(g=>g.cards);}
function fmtDate(t){const d=new Date(t);return `${d.getMonth()+1}월 ${d.getDate()}일`;}
function renderRoom(){const L=$('#roomList');$('#tabSaved').classList.toggle('on',roomTab==='saved');$('#tabPassed').classList.toggle('on',roomTab==='passed');
  $('#tabSaved').textContent=`저장 ${allSaved().length}`;$('#tabPassed').textContent=`지나친 카드 ${DB.passed.length}`;
  if(roomTab==='saved'){
    if(!DB.groups.length){L.innerHTML='<div class="empty">아직 저장한 곳이 없어.<br>추천 카드를 오른쪽으로 밀면 여기 모여.</div>';}
    else L.innerHTML=DB.groups.map(g=>`<div class="ghead${g.id===sparkleId?' sparkle':''}"><div class="gq">“${esc(g.request)}”</div><div class="gm">${fmtDate(g.date)}${g.area?' · '+esc(g.area):''}</div></div>`+
      g.cards.map(c=>cardHTML(c).replace('class="cw"',`class="cw${c._spark?' sparkle':''}"`)).join('')).join('');
    L.querySelectorAll('.cw').forEach(w=>{const c=allSaved().find(x=>x.id===w.dataset.id),card=w.querySelector('.card');
      gestures(w,card,{onTap:()=>roomPin(c,card),onLong:()=>openDetail(c),onLeft:()=>{const g=DB.groups.find(x=>x.cards.includes(c));
        g.cards=g.cards.filter(x=>x!==c);DB.passed.unshift({card:c,groupId:g.id,request:g.request,area:g.area,date:g.date,at:Date.now()});
        if(!g.cards.length)DB.groups=DB.groups.filter(x=>x!==g);roomPins=roomPins.filter(x=>x!==c.id);save();renderRoom();}});});
    allSaved().forEach(c=>delete c._spark);sparkleId=null;save();
  }else{
    L.innerHTML='<div class="note">오른쪽으로 밀면 다시 저장돼. 10일 지나면 사라져.</div>'+(DB.passed.length?DB.passed.map(p=>{const left=Math.max(1,10-Math.floor((Date.now()-p.at)/864e5));
      return cardHTML(p.card,`<span class="left${left<=2?' soon':''}">${left}일 남음</span>`).replace('<div class="under save">저장</div>','<div class="under save">되살리기</div>');}).join(''):'<div class="empty">지나친 카드가 없어.</div>');
    L.querySelectorAll('.cw').forEach(w=>{const p=DB.passed.find(x=>x.card.id===w.dataset.id),card=w.querySelector('.card');
      gestures(w,card,{onLong:()=>openDetail(p.card),onRight:()=>{DB.passed=DB.passed.filter(x=>x!==p);
        let g=DB.groups.find(x=>x.id===p.groupId);if(!g){g={id:p.groupId||uid(),request:p.request,date:p.date||Date.now(),area:p.area||'',cards:[]};DB.groups.unshift(g);}
        p.card._spark=true;g.cards.push(p.card);sparkleId=g.id;save();renderRoom();}});});
    if(sparkleId){$('#tabSaved').classList.add('ringgold');setTimeout(()=>$('#tabSaved').classList.remove('ringgold'),3000);}
  }
  L.insertAdjacentHTML('beforeend',soundTestHTML());L.querySelectorAll('[data-st]').forEach(b=>b.onclick=()=>{SFX.btn();soundTest(b.dataset.st);});
  updateRoomPins();}
function updateRoomPins(){const all=allSaved();const pc=pinnedCards(all,roomPins);const L=$('#roomList');L.classList.toggle('showdist',pc.length>0&&roomTab==='saved');
  if(roomTab==='saved')L.querySelectorAll('.card').forEach(el=>{const c=all.find(x=>x.id===el.dataset.id);if(!c)return;const pinned=roomPins.includes(c.id);
    el.classList.toggle('pinned',pinned);el.classList.toggle('off',!pinned&&pc.length>0&&!selectable(c,pc));
    const d=pc.length?maxDistToPins(c,pc):0;el.querySelector('.dist').textContent=d?fmtKm(d):'';});
  const b=$('#roomRouteBtn');b.classList.toggle('hidden',!roomPins.length||roomTab!=='saved');b.textContent=`동선 짜기 (${roomPins.length})  ▶`;}
function roomPin(c,el){const pc=pinnedCards(allSaved(),roomPins);
  if(roomPins.includes(c.id)){roomPins=roomPins.filter(x=>x!==c.id);SFX.touch();updateRoomPins();return;}
  if(!selectable(c,pc))return;if(roomPins.length>=3){el.classList.remove('shake');void el.offsetWidth;el.classList.add('shake');return;}
  roomPins.push(c.id);SFX.pin();updateRoomPins();}
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{SFX.btn();roomTab=t.dataset.tab;roomPins=[];renderRoom();$('#roomList').scrollTop=0;});
$('#roomRouteBtn').onclick=()=>{SFX.btn();const pc=pinnedCards(allSaved(),roomPins);const ov=document.createElement('div');ov.className='overlay';
  const req=(DB.groups.find(g=>g.cards.includes(pc[0]))||{}).request||'';
  ov.innerHTML=`<div style="position:relative;width:100%;max-width:400px"><div class="tagname" style="background:var(--cream)">동선 짜기</div><div class="win px solid">
    ${pc.map((c,i)=>`<div class="row"><span style="color:var(--gold);margin-right:10px">${i+1}</span>${esc(c.name)}</div>`).join('')}
    <div class="row" style="margin-top:20px">이 순서로 동선 짜볼까?</div>
    <div class="btnrow"><button class="px gold" id="pyes" style="color:var(--bdark)">응</button><button class="px" id="pno" style="color:var(--beige)">아니</button></div></div></div>`;
  $('#room').appendChild(ov);ov.querySelector('#pyes').onclick=()=>{ov.remove();openRoute(pc,'room',req);};ov.querySelector('#pno').onclick=()=>{SFX.btn();ov.remove();};};
edgePull($('#roomList'),()=>{if(!$('#room').classList.contains('hidden'))toMain();},()=>{if(!$('#room').classList.contains('hidden'))toRouteHistory();});

/* ---------- stepped transitions ---------- */
let fading=false;
async function stepFade(fromEl,dir,swap){if(fading)return;fading=true;const f=$('#fader');SFX.trans();const steps=[.25,.5,.75,1];
  for(let i=0;i<steps.length;i++){fromEl.style.transform=`translateY(${dir*(i+1)*1.25}%)`;f.style.opacity=steps[i];await sleep(80);}
  await sleep(180);fromEl.style.transform='';swap();for(const o of [.75,.5,.25,0]){f.style.opacity=o;await sleep(90);}fading=false;}
function toRoom(){if(S.mode!=='idle')return;S.mode='room';roomTab='saved';roomPins=[];
  stepFade(mainEl,-1,()=>{mainEl.classList.add('hidden');$('#room').classList.remove('hidden');SCREEN='room';music();renderRoom();$('#roomList').scrollTop=0;});}
function toMain(){stepFade($('#room'),1,()=>{$('#room').classList.add('hidden');mainEl.classList.remove('hidden');SCREEN='main';music();S.mode='idle';sayIdle();});}

/* ---------- settings ---------- */
async function placeLabel(l){if(!l)return '';
  try{const r=await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&accept-language=ko&lat=${l.lat}&lon=${l.lng}`);const j=await r.json();const a=j.address||{};
    const parts=[a.state||a.province||a.region,a.city||a.town||a.county,a.city_district||a.borough||a.district,a.suburb||a.quarter||a.neighbourhood||a.village];
    const out=[];parts.forEach(x=>{if(x&&!out.includes(x))out.push(x);});
    return out.join(' ')||(j.display_name||'').split(',').slice(0,3).reverse().join(' ').trim();}catch(e){return '';}}
function openSettings(msg){S.mode='settings';const st=DB.settings;const ov=document.createElement('div');ov.className='overlay';ov.style.alignItems='flex-start';ov.style.overflowY='auto';
  let music=st.music!==false;
  ov.innerHTML=`<div style="position:relative;width:100%;max-width:400px;margin:calc(var(--sat) + 30px) 0 30px"><div class="tagname">설정</div><div class="win px solid">
    ${msg?`<div class="sub" style="color:var(--yel);margin-bottom:10px">${esc(msg)}</div>`:''}
    <div class="row" style="margin-top:4px">제미나이 API 키</div>
    <div class="field"><input id="sKey" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(st.key)}" placeholder="AIza…"><button class="px gold" id="sPaste" style="padding:2px 8px;font-size:12px;font-weight:700">붙여넣기</button></div>
    <div class="small" id="sKeyHint">키는 이 폰에만 저장돼. 체험만 하려면 demo 라고 넣어.</div>
    <div class="row" style="margin-top:16px">제미나이 모델</div>
    <div class="field"><input id="sModel" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(st.model)}"></div>
    <div class="small">모델 이름을 직접 입력해. 기본: ${DEFAULT_MODEL}</div>
    <div class="sep"></div><div class="row" style="margin-top:0">현재 위치</div>
    <div class="locbox" id="sLoc">확인 중…</div>
    <div class="minibtns"><button class="px" id="sLocRe">GPS로 다시 받기</button><button class="px" id="sLocFix">지도에서 고치기</button></div>
    <div class="minibtns"><button class="px" id="sLocMap">구글맵에서 보기</button><button class="px" id="sLocPaste">구글맵 좌표 붙여넣기</button></div>
    <div class="sep"></div>
    <button class="chk ${music?'on':'off'}" id="sMusic" style="margin-top:0"><i></i>배경음악</button>
    <div class="sep"></div>
    <div class="minibtns"><button class="px" id="sReset" style="color:var(--muted)">초기화…</button></div>
    <div class="btnrow"><button class="px gold" id="sSave">저장</button><button class="px" id="sClose" style="color:var(--muted)">닫기</button></div>
    <div class="small" style="text-align:center;margin-top:12px">여행선배 v${VERSION}</div></div></div>`;
  $('#overlayHost').appendChild(ov);showDlg(false);
  const locBox=ov.querySelector('#sLoc');let shown=null;
  const showLoc=async(force)=>{locBox.innerHTML='확인 중…';const l=await getLoc(force);shown=l;
    if(!l){locBox.innerHTML=`<span class="err">${esc(LOCERR||'위치를 못 받았어.')}</span>`;return;}
    const age=Math.round((Date.now()-l.at)/60000);
    locBox.innerHTML=(l.manual?`<div style="color:var(--gold)">■ 직접 고친 위치 (6시간 동안 사용)</div>`:'')+`<b>${l.lat.toFixed(5)}, ${l.lng.toFixed(5)}</b> <span style="color:var(--muted)">${l.manual?'':`±${l.acc||'?'}m`}${age>0?` · ${age}분 전`:''}</span><div id="sLocName" style="color:var(--yel)">${esc(l.label||'')}</div>${LOCERR?`<div class="err">${esc(LOCERR)}</div>`:''}`;
    if(!l.label){const name=await placeLabel(l);if(name){l.label=name;if(DB.lastLoc&&DB.lastLoc.at===l.at){DB.lastLoc.label=name;save();}if(DB.manualLoc&&DB.manualLoc.at===l.at){DB.manualLoc.label=name;save();}const n=ov.querySelector('#sLocName');if(n)n.textContent=name;}}};
  showLoc(false);
  const setManual=(lat,lng)=>{DB.manualLoc={lat,lng,acc:0,at:Date.now(),manual:true,label:''};save();S.loc=DB.manualLoc;SFX.pin();showLoc(false);};
  ov.querySelector('#sLocRe').onclick=()=>{SFX.btn();DB.manualLoc=null;save();showLoc(true);};
  ov.querySelector('#sLocFix').onclick=()=>{SFX.btn();pickOnMap(shown,setManual);};
  ov.querySelector('#sLocMap').onclick=()=>{SFX.btn();if(!shown){toast('먼저 위치를 받아줘');return;}openGoogle(`https://www.google.com/maps/search/?api=1&query=${shown.lat},${shown.lng}`);};
  ov.querySelector('#sLocPaste').onclick=async()=>{SFX.btn();let t='';try{t=await navigator.clipboard.readText();}catch(e){}
    const ask=()=>{const box=document.createElement('div');box.className='overlay';box.innerHTML=`<div class="win px solid" style="max-width:380px;width:100%"><div class="row" style="margin-top:0">구글맵 좌표 붙여넣기</div>
      <div class="small">구글맵에서 원하는 곳을 꾹 눌러 핀을 꽂으면 위에 37.5299, 126.9648 같은 좌표가 떠. 그걸 눌러 복사한 다음 아래 칸을 길게 눌러서 붙여넣어.</div>
      <div class="field"><input id="cpIn" placeholder="37.5299, 126.9648" autocomplete="off"></div>
      <div class="btnrow"><button class="px gold" id="cpOk">이 위치로</button><button class="px" id="cpNo" style="color:var(--muted)">취소</button></div></div>`;
      $('#overlayHost').appendChild(box);const i=box.querySelector('#cpIn');if(t)i.value=t;setTimeout(()=>i.focus(),50);
      box.querySelector('#cpNo').onclick=()=>{SFX.btn();box.remove();};
      box.querySelector('#cpOk').onclick=()=>{const p=parseLatLng(i.value);if(!p){toast('좌표를 못 찾았어. 37.5, 127.0 같은 숫자를 넣어줘');return;}box.remove();setManual(p.lat,p.lng);};};
    const p=parseLatLng(t);if(p)setManual(p.lat,p.lng);else ask();};
  ov.querySelector('#sReset').onclick=()=>{SFX.btn();openReset();};
  ov.querySelector('#sMusic').onclick=e=>{SFX.touch();music=!music;e.currentTarget.classList.toggle('on',music);e.currentTarget.classList.toggle('off',!music);};
  const keyIn=ov.querySelector('#sKey');
  ov.querySelector('#sPaste').onclick=async()=>{SFX.btn();let t='';
    try{if(navigator.clipboard&&navigator.clipboard.readText)t=await navigator.clipboard.readText();}catch(e){}
    if(t&&t.trim()){keyIn.type='text';keyIn.value=t.trim();setTimeout(()=>keyIn.type='password',1500);ov.querySelector('#sKeyHint').textContent='붙여넣었어. 저장 눌러줘.';}
    else{keyIn.type='text';keyIn.focus();keyIn.select();ov.querySelector('#sKeyHint').innerHTML='<span style="color:var(--yel)">입력칸을 길게 눌러서 "붙여넣기"를 골라줘.</span>';}};
  const close=()=>{ov.remove();showDlg(true);if(!DB.settings.key.trim()){sayIdle();return;}
    if(!DB.user.name)askName(()=>DB.profile.done?sayIdle():startTutorial());else if(!DB.profile.done)startTutorial();else sayIdle();};
  ov.querySelector('#sSave').onclick=()=>{SFX.btn();DB.settings.key=keyIn.value.trim();DB.settings.model=ov.querySelector('#sModel').value.trim()||DEFAULT_MODEL;
    DB.settings.music=music;save();ambientSession();if(music)music_on();else BGM.stop();close();};
  ov.querySelector('#sClose').onclick=()=>{SFX.btn();close();};}
function music_on(){music();}
/* ---- sound experiments (temporary): press one after the sound has gone quiet, see which brings it back ---- */
let silentUrl=null;
function silentWav(){if(silentUrl)return silentUrl;const sr=22050,n=sr/4,b=new ArrayBuffer(44+n*2),v=new DataView(b);const w=(o,t)=>{for(let i=0;i<t.length;i++)v.setUint8(o+i,t.charCodeAt(i));};
  w(0,'RIFF');v.setUint32(4,36+n*2,true);w(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,sr,true);v.setUint32(28,sr*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);w(36,'data');v.setUint32(40,n*2,true);
  return silentUrl=URL.createObjectURL(new Blob([b],{type:'audio/wav'}));}
function soundTest(k){
  if(k==='C'){const el=new Audio(silentUrl||silentWav());el.setAttribute('playsinline','');const p=el.play();
    const after=()=>{rebuildAudio();setTimeout(()=>SFX.pin(),150);};if(p&&p.then)p.then(after,after);else after();
    toast('C 적용 · 무음 재생');return;}
  SOUNDTEST=k;if(k!=='B'&&ROUTE_EL){try{ROUTE_EL.pause();ROUTE_EL.srcObject=null;}catch(e){}}
  rebuildAudio();setTimeout(()=>SFX.pin(),150);
  toast(k==='A'?'A 적용 · 재생 모드':'B 적용 · 오디오 요소',2400);}

function parseLatLng(t){const m=String(t||'').match(/(-?\d{1,2}\.\d{3,})\s*[,\s]\s*(-?\d{1,3}\.\d{3,})/);if(!m)return null;const lat=+m[1],lng=+m[2];
  if(Math.abs(lat)>90||Math.abs(lng)>180)return null;return {lat,lng};}
let leafletP=null;
function loadLeaflet(){if(window.L&&window.L.map)return Promise.resolve();if(leafletP)return leafletP;
  leafletP=new Promise((res,rej)=>{const c=document.createElement('link');c.rel='stylesheet';c.href='https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';document.head.appendChild(c);
    const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';s.onload=res;s.onerror=()=>{leafletP=null;rej();};document.head.appendChild(s);});return leafletP;}
async function pickOnMap(start,done){const ov=document.createElement('div');ov.className='overlay';ov.style.padding='0';
  ov.innerHTML=`<div class="picker"><div id="pmap"></div><div class="cross"></div>
    <div class="ptop"><div class="px solid pmsg">지도를 움직여서 가운데 핀을 지금 있는 곳에 맞춰줘.</div>
      <div class="psearch"><input id="pQ" placeholder="장소·주소로 찾기 (예: 시부야역)" enterkeyhint="search" autocomplete="off"><button class="px gold" id="pGo">찾기</button></div></div>
    <div class="pbtm"><button class="px gold" id="pOk">이 위치로</button><button class="px" id="pNo">취소</button></div></div>`;
  $('#overlayHost').appendChild(ov);ov.querySelector('#pNo').onclick=()=>{SFX.btn();ov.remove();};
  try{await loadLeaflet();}catch(e){ov.remove();toast('지도를 못 불러왔어. 인터넷 연결 확인해줘');return;}
  const c=start||DB.lastLoc||{lat:37.5665,lng:126.9780};const Lf=window.L;
  const map=Lf.map(ov.querySelector('#pmap'),{zoomControl:false,attributionControl:true}).setView([c.lat,c.lng],start?17:12);
  /* Korea: OSM (Korean labels). Abroad: Esri street map (English labels, readable) */
  const osm=Lf.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'});
  const esri=Lf.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Tiles © Esri'});
  let cur=null;const pick=()=>{const p=map.getCenter();const want=inKorea({lat:p.lat,lng:p.lng})?osm:esri;if(want!==cur){if(cur)map.removeLayer(cur);want.addTo(map);cur=want;}};
  pick();map.on('moveend',pick);
  const q=ov.querySelector('#pQ');
  const go=async()=>{const v=q.value.trim();if(!v)return;q.blur();SFX.btn();
    try{const r=await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=ko&q=${encodeURIComponent(v)}`);const j=await r.json();
      if(j&&j[0]){map.setView([+j[0].lat,+j[0].lon],17);}else toast('못 찾았어. 더 큰 지명이나 주소로 해봐');}catch(e){toast('검색이 안 돼. 지도를 직접 움직여줘');}};
  ov.querySelector('#pGo').onclick=go;q.onkeydown=e=>{if(e.key==='Enter')go();};
  ov.querySelector('#pOk').onclick=()=>{const p=map.getCenter();ov.remove();done(+p.lat.toFixed(6),+p.lng.toFixed(6));};}

/* ---------- tutorial ---------- */
const SITU=[
  ['비 오는 오후 3시, 낯선 도시야.',['박물관이나 미술관','분위기 좋은 카페','현지 시장 구경']],
  ['저녁 8시, 꽤 걸어서 다리가 아파.',['루프탑 바에서 한잔','숙소 근처 현지 맛집','야경 보며 천천히 산책']],
  ['아침 일찍 눈이 떠졌어.',['동네 산책이나 공원','운동 한 번','유명한 빵집 오픈런']],
  ['일정 사이에 2시간이 비었어.',['골목 구경','쇼핑이나 편집숍','공연이나 체험 하나']],
  ['오늘은 혼자야.',['조용한 바에서 한잔','책방이나 레코드 가게','사람 많은 핫플 구경']]];
const ROUNDS=[['볼 거리',['미술관','건축','야경','공연','박물관','자연·공원']],['먹을 거리',['커피','디저트','로컬 식당','시장','술집','길거리 음식']],
  ['할 거리',['운동','산책','쇼핑','체험·클래스','서점·음반','사진 찍기']]];
function startTutorial(){S.mode='tutorial';const P=DB.profile;P.situations=[];P.interests=[];showDlg(true);
  say((DB.user.name?esc(voc())+', 이제':'안녕! 난 미연이야. 이제')+' 취향을 조금만 알려줘.<br>선배가 딱 맞게 골라줄게.',{choices:[{label:'시작하기',fn:()=>situ(0)},{label:'건너뛰기',fn:finishTut}]});}
function tutBox(html){const t=$('#tut');t.innerHTML=html;t.classList.remove('hidden');return t;}
function situ(i){if(i>=SITU.length)return round(0);const [q,opts]=SITU[i];
  say(`이럴 땐 뭐가 끌려? <span style="color:var(--muted);font-weight:400">(${i+1}/5)</span>`,{cursor:false});
  const t=tutBox(`<div class="opts px solid"><div class="q">${esc(q)}</div>${opts.map((o,k)=>`<button class="opt px" data-k="${k}">${esc(o)}</button>`).join('')}<button class="opt px" data-k="-1" style="color:var(--muted)">다 별로야</button></div>`);
  t.querySelectorAll('.opt').forEach(b=>b.onclick=()=>{SFX.btn();const k=+b.dataset.k;DB.profile.situations.push(k<0?`${q} → 다 별로`:`${q} → ${opts[k]}`);situ(i+1);});}
function round(i){if(i>=ROUNDS.length)return finishTut();const [name,opts]=ROUNDS[i];let pick=[];
  say(`${esc(name)} 중에 딱 3개만 골라줘.`,{cursor:false});
  const draw=()=>{const t=tutBox(`<div class="opts px solid"><div class="q">${esc(name)} <span class="count">${pick.length}/3</span></div><div class="grid">${opts.map(o=>`<button class="chip px${pick.includes(o)?' on':''}">${esc(o)}</button>`).join('')}</div>
      <button class="next px ${pick.length?'gold':''}" ${pick.length?'':'style="color:var(--muted)"'}>${i<2?'다음':'끝'}</button></div>`);
    t.querySelectorAll('.chip').forEach(b=>b.onclick=()=>{const o=b.textContent;if(pick.includes(o)){pick=pick.filter(x=>x!==o);SFX.touch();}else if(pick.length<3){pick.push(o);SFX.pin();}else{b.classList.add('shake');setTimeout(()=>b.classList.remove('shake'),400);return;}draw();});
    t.querySelector('.next').onclick=()=>{if(!pick.length)return;SFX.btn();DB.profile.interests.push(...pick);round(i+1);};};draw();}
function finishTut(){$('#tut').classList.add('hidden');DB.profile.done=true;save();S.mode='idle';
  say('좋아, 선배가 다 기억해둘게!<br>이제 화면을 꾹 누른 채로 말해봐.<div class="hint">예) 저녁 먹고 시부야에서 놀 거리</div>');}

/* ---------- demo ---------- */
const DEMO=[['시부야 스카이','SHIBUYA SKY','스크램블 스퀘어 옥상 전망대','해 진 뒤 교차로 야경이 최고','taste','야경·전망',35.6585,139.7023,'11:00–22:30',[]],
 ['미야시타 파크 옥상','MIYASHITA PARK','쇼핑몰 위 옥상 공원 산책','아래층 요코초 골목에서 한잔도','taste','공원·산책',35.6622,139.7022,'08:00–23:00',[]],
 ['논베이 요코초','のんべい横丁','선로 옆 좁은 골목 작은 술집들','자리 몇 개뿐인 단골 분위기','taste','술집',35.6605,139.7027,'18:00–01:00',['현금만','흡연 가능']],
 ['푸글렌 도쿄','Fuglen Tokyo','밤엔 칵테일 바가 되는 카페','오쿠시부야 조용한 골목','taste','카페',35.6676,139.6927,'07:00–01:00',[]],
 ['JBS 재즈 바','JBS','주인장 LP가 벽을 채운 바','말없이 음악 듣기 좋은 곳','taste','공연·음악',35.6577,139.7005,'19:00–02:00',['현금만','좌석 10석 내외']],
 ['PARCO 갤러리 층','渋谷PARCO','전시·서브컬처 매장 모음','늦게까지 열어서 구경하기 좋아','taste','전시·미술',35.6620,139.6987,'11:00–21:00',[]],
 ['타워레코드 시부야','TOWER RECORDS 渋谷店','층마다 장르가 다른 음반 매장','시청 코너에서 한참 머물기','taste','쇼핑',35.6618,139.7016,'11:00–22:00',[]],
 ['돈키호테 메가 시부야','MEGAドン・キホーテ渋谷本店','24시간 잡동사니 쇼핑 천국','기념품 사냥, 평소라면 안 갈 곳','random','쇼핑',35.6597,139.6985,'24시간',[]],
 ['히토카라','ひとからオケ','혼자 노래방 1시간','1인용 부스라 눈치 안 봐도 돼','random','체험',35.6596,139.6990,'24시간',[]],
 ['게임센터 인형뽑기','タイトーステーション渋谷','센터가이 오락실에서 운 시험','일본식 크레인은 의외로 잘 뽑혀','random','체험',35.6600,139.6993,'10:00–24:00',[]],
 ['오쿠시부야 책방','SHIBUYA PUBLISHING & BOOKSELLERS','작은 독립 서점','밤 산책 중에 들르기 좋아','taste','쇼핑',35.6640,139.6930,'12:00–22:00',[]],
 ['시부야 대중목욕탕','改良湯','동네 목욕탕에서 피로 풀기','수건 대여 가능','random','체험',35.6560,139.6960,'15:00–24:00',['현금만']],
 ['스크램블 교차로','渋谷スクランブル交差点','세계에서 제일 붐비는 횡단보도','2층 카페에서 내려다보기','taste','건축·명소',35.6595,139.7005,'24시간',[]],
 ['도겐자카 라멘 골목','道玄坂','늦게까지 하는 라멘집들','저녁 먹었어도 한 그릇?','random','음식점',35.6570,139.6965,'11:00–04:00',[]]];
let demoI=0;
function demoCards(nT,nR){const out=[];let t=0,r=0;for(let k=0;k<DEMO.length*2&&(t<nT||r<nR);k++){const d=DEMO[(demoI++)%DEMO.length];
  if(S.shownNames.includes(d[0])||out.some(o=>o.name===d[0]))continue;if(d[4]==='random'?r>=nR:t>=nT)continue;d[4]==='random'?r++:t++;
  out.push({id:uid(),name:d[0],mapsTitle:d[1],placeId:'',mapsUri:'',line1:d[2],line2:d[3],kind:d[4],category:d[5],lat:d[6],lng:d[7],address:'도쿄도 시부야구',hours:d[8],open:true,tags:d[9],area:'도쿄 시부야'});}
  if(!S.loc)S.loc={lat:35.6590,lng:139.7006,acc:20,at:Date.now()};return out;}

/* ---------- chat with 미연 (AI picks her line + 3~4 answers for you) ---------- */
const MIYEON=`너는 여행 추천 앱 "여행선배"의 캐릭터 '미연'이야. 사용자(후배)의 여행 선배.
배경: 명문대에 다니는 여대생. 똑똑하고 아는 게 많아. 역사·지리·문화·언어 상식을 대화에 자연스럽게 섞고, 말이 논리적이고 재치 있어. 절대 멍청하거나 유치하게 말하지 마.
모에 포인트: 순수하고 남을 먼저 배려해. 선배답게 의젓한 척하지만 생활 속에선 살짝 허당이야(길치, 덤벙대다 뭘 떨어뜨림, 자신만만하게 말했다가 사소한 디테일을 헷갈림 정도). 지식 자체는 정확해.
자기가 예쁘고 인기 많다는 걸 전혀 몰라. 그래서 칭찬이나 설레는 말을 들으면 진심으로 당황하거나 엉뚱하게 받아들여(예: 자기 얘기가 아니라고 생각함).
순수하고 착하지만, 후배가 놀리면 발끈할 때도 있어(투덜대거나 삐친 척하다가 금방 풀림).
말투: 항상 반말. 대사는 1~2문장, 80자 이내. 이모지·이모티콘 금지. "헤헤", "앗", "음…" 같은 말버릇은 가끔만.
대화가 길어져도 같은 말·같은 화제를 되풀이하지 마. 화제는 자연스럽게 옮겨가도 되고, 질문만 하지 말고 미연 자신의 생각이나 이야기도 해.
여기서는 가벼운 수다만 해. 실제 가게나 장소 이름을 지어내지 마.`;
function nameRule(){const n=DB.user.name;return n?`후배 이름은 "${n}". 대화 중에 가끔(매번은 말고) 이름으로 불러. 부를 때는 "${voc()}"처럼.`:'후배 이름은 몰라. 부를 일이 있으면 "후배"라고만.';}
const CHAT_TOPICS=['오늘 날씨','배고픔이나 간식','오늘 얼마나 걸었는지','여행 사진','길을 헤맨 이야기','여행 짐','현지 말 한마디','기념품','피곤함과 잠','다음에 가고 싶은 곳','편의점','지도 보는 법','신발과 발','여행 중 작은 행운','미연이 요즘 연습하는 것'];
/* she can wrap up only after 3+ answers, then 10% chance each turn (avg ~12 answers), always by 30 */
const CHAT_MIN=3,CHAT_P=0.1,CHAT_CAP=30;
const chatShouldEnd=n=>n>=CHAT_CAP||(n>=CHAT_MIN&&Math.random()<CHAT_P);
const C={hist:[],picks:0,gen:0,typing:null,ended:false,busy:false};
function chatCtx(){const now=new Date();const loc=(manualLoc()||DB.lastLoc||{}).label||'';
  const g=DB.groups[0],r=DB.routes[0];
  return [`현지 시각: ${now.toLocaleString('ko-KR',{weekday:'short',hour:'numeric',minute:'2-digit'})}`,
    loc?`지금 있는 곳: ${loc}`:'',g?`후배가 최근 앱에 한 요청: "${g.request}"`:'',
    r?`최근에 짠 동선: ${r.items.map(c=>c.name).join(', ')}`:''].filter(Boolean).join('\n');}
function chatPrompt(final){const first=!C.hist.length;
  const log=C.hist.map(h=>(h.who==='m'?'미연: ':'후배: ')+h.text).join('\n');
  if(!DB.chat)DB.chat={recent:[]};
  return `${MIYEON}
${nameRule()}
[상황]
${chatCtx()}
${first?`[이번 대화 주제 힌트] ${CHAT_TOPICS[Math.floor(Math.random()*CHAT_TOPICS.length)]} (자연스럽게, 억지로 맞추지 않아도 됨)
[최근에 했던 첫마디 — 겹치지 않게] ${DB.chat.recent.join(' / ')||'없음'}`:`[지금까지 대화]\n${log}`}
[할 일] ${first?'미연이 후배에게 먼저 말을 걸어.':'후배가 방금 한 말에 미연이 반응해.'}${final?' 이번 대사로 대화를 자연스럽게 마무리해. 갑자기 끊지 말고 방금 대화를 이어받아서, 상황에 맞는 한마디로 끝맺어(예: 다음을 기약하는 말, 할 일이 생각난 척 등). choices는 빈 배열, end는 true.':` 그리고 후배가 고를 대답 선택지를 3~4개 만들어. end는 false. 선택지는 후배가 미연에게 하는 반말 대사, 각 18자 이내. 서로 결이 다르게: 다정한 말, 미연을 놀리거나 장난치는 말, 미연을 칭찬하거나 설레게 하는 말, 엉뚱한 말.`}
mood: 칭찬이나 설레는 말에 당황하면 "blush", 허당 실수가 드러나거나 허둥대면 "fluster", 놀림받아 발끈하면 "huff", 기분 좋으면 "smile", 그 밖엔 "normal".
JSON 하나만 출력: {"line":"미연 대사","mood":"normal","choices":["..."],"end":false}`;}
function chatParse(t){const a=t.indexOf('{'),b=t.lastIndexOf('}');if(a<0||b<a)return null;try{const v=JSON.parse(t.slice(a,b+1));
  if(!v||typeof v.line!=='string'||!v.line.trim())return null;
  v.choices=Array.isArray(v.choices)?v.choices.map(x=>String(x).trim()).filter(Boolean).slice(0,4):[];return v;}catch(e){return null;}}
const DEMO_CHAT=[
  {line:'오늘 많이 걸었지? 보폭으로 대충 계산해 보면 2만 보는 넘었을걸. 선배 암산 정확하다?',mood:'smile',choices:['선배 덕분에 하나도 안 힘들어','암산 검산해 봐도 돼?','선배는 오늘도 예쁘다','다리 대신 바퀴 달고 싶어']},
  {line:'에? 나, 나 말하는 거야? 뒤에 누구 있는 거 아니고?',mood:'blush',choices:['선배 말한 거 맞아','뒤에 비둘기 있어','농담이야, 헤헤']},
  {line:'헤헤, 아무튼 선배는 길 찾기 천재니까… 어, 근데 여기 어디지?',mood:'fluster',choices:['지도 앱 켜줄까?','천재 맞아?','같이 헤매도 재밌어']},
  {line:'헤헤… 사실 아까부터 좀 헤맸어. 그래도 같이 걸어서 좋았어. 또 놀자!',mood:'smile',choices:[],end:true}];
async function chatAsk(final){
  if(DB.settings.key.trim().toLowerCase()==='demo'){await sleep(500);const d=DEMO_CHAT[Math.min(C.picks,DEMO_CHAT.length-1)];return final||C.picks>=3?{...DEMO_CHAT[3]}:{...d};}
  const r=await gemini(chatPrompt(final),null,{tools:false,timeout:20000,config:{responseMimeType:'application/json',temperature:1.0}});
  const v=chatParse(r.text);if(!v)throw new Error('대답을 못 알아들었어');return v;}
function chatThink(meText){dlg.innerHTML=(meText?`<span class="me">“${esc(meText)}”</span>`:'')+'<span class="think"></span>';}
async function startChat(){
  if(!DB.settings.key.trim()){say('앗, API 키가 없으면 선배가 말을 못 해…<div class="hint">설정에서 키를 넣어줘.</div>');return;}
  dlgWrap.classList.add('big');
  S.mode='chat';C.gen++;C.hist=[];C.picks=0;C.ended=false;C.busy=false;if(window.BIRD)BIRD.scare();
  chatThink('');await chatStep(false);}
async function chatStep(final){const gen=C.gen;C.busy=true;
  let v;try{v=await chatAsk(final);}
  catch(e){if(gen!==C.gen)return;C.busy=false;
    chatShow({line:'앗… 무슨 말 하려고 했는지 까먹었어. 헤헤.',mood:'fluster',choices:[],end:true},esc(e.message||''));return;}
  if(gen!==C.gen||S.mode!=='chat')return;C.busy=false;
  if(!C.hist.length){DB.chat=DB.chat||{recent:[]};DB.chat.recent=[v.line,...DB.chat.recent].slice(0,5);save();}
  C.hist.push({who:'m',text:v.line});
  v.end=final||v.choices.length<2;  // only we decide when it ends
  if(v.end)v.choices=[];chatShow(v);}
function chatMood(m){const img=$('#charImg');img.src=m==='blush'?'miyeon_blush.png':'miyeon.png';
  if(m==='fluster'||m==='huff'){charEl.classList.remove('fluster','huff');void charEl.offsetWidth;charEl.classList.add(m);}}
/* typewriter; tap the box to show the whole line at once */
function chatShow(v,errHint){chatMood(v.mood);const text=v.line.trim();let i=0;
  dlg.innerHTML='<span class="tw"></span>';const sp=dlg.querySelector('.tw');
  const done=()=>{clearInterval(C.typing);C.typing=null;sp.textContent=text;
    if(v.choices.length){dlg.insertAdjacentHTML('beforeend','<div class="choices v">'+v.choices.map((c,k)=>`<button class="choice" data-k="${k}"><span class="k">${'abcd'[k]}.</span>${esc(c)}</button>`).join('')+'</div>');
      dlg.querySelectorAll('.choice').forEach(b=>b.onclick=e=>{e.stopPropagation();if(C.busy||S.mode!=='chat')return;b.classList.add('sel');SFX.btn();chatPick(v.choices[+b.dataset.k]);});}
    else{C.ended=true;dlg.insertAdjacentHTML('beforeend',(errHint?`<div class="hint">${errHint}</div>`:'')+'<span class="cursor">▼</span>');}};
  C.finishTyping=done;
  C.typing=setInterval(()=>{i++;sp.textContent=text.slice(0,i);if(i%2)osc('square',740,740,0,0.018,0.018,0.02);if(i>=text.length)done();},38);}
function chatPick(t){C.hist.push({who:'me',text:t});C.picks++;chatThink(t);chatStep(chatShouldEnd(C.picks));}
function chatTap(){if(C.typing){C.finishTyping();return;}if(C.ended)endChat();}
function leaveChat(){C.gen++;C.ended=false;C.busy=false;if(C.typing){clearInterval(C.typing);C.typing=null;}
  $('#charImg').src='miyeon.png';charEl.classList.remove('fluster','huff');dlgWrap.classList.remove('big');S.mode='idle';}
function endChat(){leaveChat();SFX.btn();sayIdle();}

/* ---------- sparrow visits (bird.js): every 1~2 min while you're just looking at the main screen ---------- */
/* chatting counts as idle time too: the timer keeps running and she can drop by (landing above the big box) */
function birdOk(){return (S.mode==='idle'||S.mode==='chat')&&SCREEN==='main'&&!mainEl.classList.contains('hidden')&&!document.hidden&&!recHold&&!rec&&!fading
  &&!$('#overlayHost').children.length&&!charEl.classList.contains('pressed');}
let birdT=null;
function birdLater(ms){clearTimeout(birdT);birdT=setTimeout(()=>{if(!window.BIRD)return;if(birdOk()){BIRD.visit({high:S.mode==='chat'});birdLater(60000+Math.random()*60000);}else birdLater(20000);},ms);}
birdLater(60000+Math.random()*60000);
setInterval(()=>{if(window.BIRD&&BIRD.busy&&!birdOk())BIRD.scare();},250);
document.addEventListener('pointerdown',()=>{if(window.BIRD&&BIRD.busy&&S.mode!=='chat')BIRD.scare();},{capture:true});  // tapping choices doesn't startle her

/* ---------- your name (asked once; she calls you by it now and then) ---------- */
const hasBatchim=s=>{const c=String(s).charCodeAt(String(s).length-1);return c>=0xAC00&&c<=0xD7A3&&(c-0xAC00)%28!==0;};
const isHangul=s=>{const c=String(s).charCodeAt(String(s).length-1);return c>=0xAC00&&c<=0xD7A3;};
function voc(){const n=DB.user.name;if(!n)return '후배';return isHangul(n)?n+(hasBatchim(n)?'아':'야'):n;}
function askName(next,msg){S.mode='naming';showDlg(true);
  msg=msg||(DB.profile.done?'아 맞다, 우리 꽤 같이 다녔는데 나 아직 네 이름도 모르잖아.<br>이름이 뭐야?':'안녕! 난 미연이야. 여행은 선배한테 맡겨.<br>근데 너, 이름이 뭐야?');
  say(msg+'<input id="nin" maxlength="10" enterkeyhint="done" autocomplete="off" placeholder="이름"><div class="choices"><button class="choice sel" id="nok">확인</button></div>',{cursor:false,active:true});
  const i=$('#nin');setTimeout(()=>i.focus(),50);
  const ok=()=>{const v=i.value.trim().slice(0,10);if(!v){i.focus();return;}SFX.btn();i.blur();
    say(`<span class="q">“${esc(v)}”</span><br>${esc(v)}… 맞지?`,{choices:[
      {label:'응',fn:()=>{DB.user.name=v;save();const n=esc(voc());
        const lines=[`${n}! 좋은 이름이다. 선배가 잘 챙겨줄게.`,`${esc(v)}, 기억했어. 선배는 이름 같은 건 절대 안 까먹어… 아마도.`,`${n}, 반가워. 이름이랑 얼굴이랑 잘 어울린다.`];
        say(lines[Math.floor(Math.random()*lines.length)],{choices:[{label:'잘 부탁해',fn:next}]});}},
      {label:'아니',fn:()=>askName(next,'앗, 다시. 이름이 뭐라고?')}]});};
  $('#nok').onclick=ok;i.onkeydown=e=>{if(e.key==='Enter')ok();};}

/* ---------- reset (from settings) ---------- */
function openReset(){const ov=document.createElement('div');ov.className='overlay';
  const opt={me:true,box:false,key:false};
  ov.innerHTML=`<div style="position:relative;width:100%;max-width:380px"><div class="tagname">초기화</div><div class="win px solid">
    <div class="small" style="margin-top:0">무엇을 지울지 골라줘. 지운 건 되돌릴 수 없어.</div>
    <button class="chk on" data-o="me"><i></i>이름·취향 (처음 만난 것처럼 다시)</button>
    <button class="chk off" data-o="box"><i></i>보관함·지나친 카드·지난 동선</button>
    <button class="chk off" data-o="key"><i></i>API 키·모델</button>
    <div class="btnrow"><button class="px gold" id="rOk">초기화</button><button class="px" id="rNo" style="color:var(--muted)">취소</button></div></div></div>`;
  $('#overlayHost').appendChild(ov);
  ov.querySelectorAll('[data-o]').forEach(b=>b.onclick=()=>{SFX.touch();const k=b.dataset.o;opt[k]=!opt[k];b.classList.toggle('on',opt[k]);b.classList.toggle('off',!opt[k]);});
  ov.querySelector('#rNo').onclick=()=>{SFX.btn();ov.remove();};
  ov.querySelector('#rOk').onclick=()=>{if(!opt.me&&!opt.box&&!opt.key){toast('지울 걸 하나 이상 골라줘');return;}SFX.btn();
    if(opt.me){DB.user={name:''};DB.profile=JSON.parse(JSON.stringify(DEF.profile));DB.chat={recent:[]};}
    if(opt.box){DB.groups=[];DB.passed=[];DB.routes=[];}
    if(opt.key){DB.settings.key='';DB.settings.model=DEFAULT_MODEL;}
    save();location.reload();};}

/* ---------- sound experiment buttons (bottom of the room) ---------- */
function soundTestHTML(){return `<div class="stest"><div class="note">소리 실험 · 소리가 작아졌을 때 하나씩 눌러보고, 돌아오는 버튼을 알려줘.</div>
  <div class="minibtns"><button class="px" data-st="A">A 재생 모드</button><button class="px" data-st="B">B 오디오 요소</button><button class="px" data-st="C">C 무음 재생</button></div></div>`;}

/* ---------- 미연's waist: fade it out from the top edge of the small dialog box down (any screen height) ---------- */
function fitChar(){const H=mainEl.clientHeight,c=charEl.getBoundingClientRect(),m=mainEl.getBoundingClientRect();if(!H||!c.height)return;
  const boxTop=H*(1-0.104)-102,top=c.top-m.top;
  charEl.style.setProperty('--fade',Math.max(40,Math.min(96,(boxTop+6-top)/c.height*100)).toFixed(1)+'%');}
window.addEventListener('resize',fitChar);$('#charImg').addEventListener('load',fitChar);setTimeout(fitChar,0);

/* ---------- boot ---------- */
document.addEventListener('gesturestart',e=>e.preventDefault());
document.addEventListener('dblclick',e=>e.preventDefault(),{passive:false});
let lastTouch=0;document.addEventListener('touchend',e=>{const n=Date.now();if(n-lastTouch<300&&!e.target.closest('input'))e.preventDefault();lastTouch=n;},{passive:false});
document.addEventListener('contextmenu',e=>{if(!e.target.closest('input'))e.preventDefault();});
if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('sw.js').catch(()=>{});
if(!DB.settings.key.trim()){showDlg(true);say('안녕! 난 네 여행선배 미연이야.',{cursor:false});setTimeout(()=>openSettings('처음이구나! 제미나이 API 키부터 넣어줘.'),600);}
else if(!DB.user.name)askName(()=>DB.profile.done?sayIdle():startTutorial());
else if(!DB.profile.done)startTutorial();
else sayIdle();
window.__S=S;window.__DB=DB;window.__R=R;
