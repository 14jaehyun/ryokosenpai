'use strict';
/* 여행선배 (료코센빠이) v2.0 */
const VERSION='2.0.2';

/* ---------- storage ---------- */
const LS='ryokosenpai.v1';
const DEFAULT_MODEL='gemini-3.5-flash-lite';
const DEF={settings:{key:'',model:DEFAULT_MODEL,music:true,links:{google:true,youtube:true,kakao:false}},
  profile:{done:false,situations:[],interests:[],free:'',stats:{}},groups:[],passed:[],routes:[],lastLoc:null};
let DB;
function load(){try{DB=JSON.parse(localStorage.getItem(LS))||{}}catch(e){DB={}}
  DB=Object.assign(JSON.parse(JSON.stringify(DEF)),DB);
  DB.settings=Object.assign({},DEF.settings,DB.settings);DB.settings.links=Object.assign({},DEF.settings.links,DB.settings.links);
  if(!DB.settings.model)DB.settings.model=DEFAULT_MODEL;
  DB.profile=Object.assign({},DEF.profile,DB.profile);
  if(!Array.isArray(DB.routes))DB.routes=[];
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
const transitTxt=m=>m<1200?'걸어가는 게 빨라요':'약 '+Math.round(8+m/1000*2.6)+'분';
const inKorea=p=>!!p&&p.lat>33&&p.lat<38.9&&p.lng>124.5&&p.lng<131.9;
const PIN_SVG='<svg class="pin" viewBox="0 0 6 8" shape-rendering="crispEdges"><rect x="1" y="0" width="4" height="3" fill="#ffd66e"/><rect x="0" y="3" width="6" height="1" fill="#ffd66e"/><rect x="2" y="4" width="2" height="4" fill="#ffd66e"/></svg>';
function toast(msg,ms=2200){const t=document.createElement('div');t.className='toast px solid';t.textContent=msg;$('#app').appendChild(t);setTimeout(()=>t.remove(),ms);}
const searchText=c=>[c.address,c.mapsTitle||c.name].filter(Boolean).join(' ').trim();

/* open another app without leaving a blank browser page behind */
function openExternal(appUrl,webUrl){
  if(!appUrl){window.open(webUrl,'_blank','noopener');return;}
  let left=false;const onHide=()=>{if(document.hidden)left=true;};
  document.addEventListener('visibilitychange',onHide);
  window.location.href=appUrl;
  setTimeout(()=>{document.removeEventListener('visibilitychange',onHide);if(!left&&!document.hidden&&webUrl)window.open(webUrl,'_blank','noopener');},1500);}

/* ---------- sound effects (Web Audio, ambient: follows silent switch, no now-playing) ---------- */
let AC=null,SFXOUT=null;
function audio(){try{if(!AC){if(navigator.audioSession)navigator.audioSession.type='ambient';AC=new(window.AudioContext||window.webkitAudioContext)();
    SFXOUT=AC.createGain();SFXOUT.gain.value=1;SFXOUT.connect(AC.destination);}
  if(AC.state==='suspended'&&!document.hidden)AC.resume();}catch(e){}return AC;}
function osc(type,f0,f1,t0,dur,vol,decay){const a=audio();if(!a)return;const o=a.createOscillator(),g=a.createGain();o.type=type;
  const s=a.currentTime+t0;o.frequency.setValueAtTime(f0,s);if(f1!==f0)o.frequency.linearRampToValueAtTime(f1,s+dur);
  g.gain.setValueAtTime(0,s);g.gain.linearRampToValueAtTime(vol,s+0.004);g.gain.exponentialRampToValueAtTime(0.0008,s+Math.max(dur,decay||dur));
  o.connect(g).connect(SFXOUT);o.start(s);o.stop(s+Math.max(dur,decay||dur)+0.02);}
function noise(t0,dur,vol,type,f0,f1){const a=audio();if(!a)return;const n=Math.floor(a.sampleRate*dur),b=a.createBuffer(1,n,a.sampleRate),d=b.getChannelData(0);
  for(let i=0;i<n;i++)d[i]=Math.random()*2-1;
  const s=a.createBufferSource();s.buffer=b;const g=a.createGain(),flt=a.createBiquadFilter();flt.type=type||'bandpass';const st=a.currentTime+t0;
  flt.frequency.setValueAtTime(f0||3000,st);flt.frequency.exponentialRampToValueAtTime(f1||f0||3000,st+dur);flt.Q.value=0.7;
  g.gain.setValueAtTime(0.0001,st);g.gain.linearRampToValueAtTime(vol,st+dur*0.25);g.gain.exponentialRampToValueAtTime(0.0008,st+dur);
  s.connect(flt).connect(g).connect(SFXOUT);s.start(st);s.stop(st+dur+0.02);}
const SFX={
  touch(){noise(0,0.02,0.35,'highpass',3000);osc('square',220,110,0.006,0.05,0.07,0.06);},
  trans(){osc('triangle',330,165,0,0.28,0.16,0.3);osc('triangle',165,262,0.40,0.32,0.14,0.34);},
  swipe(){noise(0,0.2,0.9,'bandpass',2600,500);osc('triangle',520,180,0,0.16,0.08,0.18);},
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
    filt.connect(dry).connect(out);filt.connect(dl);dl.connect(fb).connect(dl);dl.connect(wet).connect(out);out.connect(a.destination);
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
  return {play,stop,duck,get started(){return startedOnce;}};
})();
let SCREEN='main';
function music(){BGM.play(SCREEN==='room'?'room':SCREEN==='route'?'route':'main');}
document.addEventListener('visibilitychange',()=>{if(!AC)return;if(document.hidden){AC.suspend&&AC.suspend();}else{AC.resume&&AC.resume();}});
document.addEventListener('pointerdown',()=>{audio();if(!BGM.started&&DB.settings.music)music();},{capture:true});

/* ---------- state ---------- */
const S={mode:'idle',req:'',loc:null,area:'',queue:[],cards:[],pins:[],shownNames:[],groupId:null,fetching:false,routeFrom:null};
const mainEl=$('#main'),charEl=$('#char'),dlgWrap=$('#dlgWrap'),dlg=$('#dlg');

/* ---------- dialog ---------- */
function say(html,{choices=null,cursor=true,active=false}={}){
  dlg.innerHTML=html+(choices?'<div class="choices">'+choices.map((c,i)=>`<button class="choice${i===0?' sel':''}" data-i="${i}">${esc(c.label)}</button>`).join('')+'</div>':'')+(cursor&&!choices?'<span class="cursor">▼</span>':'');
  dlgWrap.classList.toggle('active',!!choices||active);
  if(choices)dlg.querySelectorAll('.choice').forEach(b=>b.onclick=e=>{e.stopPropagation();SFX.btn();choices[+b.dataset.i].fn();});
}
function sayIdle(){S.mode='idle';say('어디로 놀러 가볼까요?<br>화면을 꾹 누른 채로 말해주세요.<div class="hint">예) 저녁 먹고 시부야에서 놀 거리</div>');}
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
let rec=null,heard='',recDone=null;
function listen(){if(!SRec)return false;heard='';
  try{rec=new SRec();rec.lang='ko-KR';rec.interimResults=true;rec.continuous=true;
    rec.onresult=e=>{let t='';for(const r of e.results)t+=r[0].transcript;heard=t.trim();say('듣고 있어요…<div class="hint" style="color:var(--yel)">'+esc(heard)+'</div>',{cursor:false});};
    rec.onerror=e=>{if(e.error==='not-allowed'||e.error==='service-not-allowed'){rec=null;BGM.duck(false);typeInput('마이크를 쓸 수 없어서 글로 받을게요.');}};
    rec.onend=()=>{if(recDone){const f=recDone;recDone=null;f();}};
    BGM.duck(true);rec.start();say('듣고 있어요…<div class="hint">손을 떼면 끝나요.</div>',{cursor:false});return true;}catch(e){rec=null;BGM.duck(false);return false;}}
function stopListen(){return new Promise(res=>{if(!rec){BGM.duck(false);return res(heard);}let done=false;const fin=()=>{if(!done){done=true;rec=null;BGM.duck(false);res(heard);}};
  recDone=fin;try{rec.stop();}catch(e){fin();}setTimeout(fin,1500);});}
function typeInput(msg){S.mode='typing';
  say(esc(msg||'하고 싶은 걸 적어주세요.')+'<input id="tin" enterkeyhint="done" placeholder="저녁 먹고 시부야에서 놀 거리"><div class="choices"><button class="choice sel" id="tok">확인</button><button class="choice" id="tcancel">취소</button></div>',{cursor:false,active:true});
  const i=$('#tin');setTimeout(()=>i.focus(),50);
  const ok=()=>{SFX.btn();const v=i.value.trim();i.blur();if(v)gotText(v);else sayIdle();};
  $('#tok').onclick=ok;$('#tcancel').onclick=()=>{SFX.btn();i.blur();sayIdle();};i.onkeydown=e=>{if(e.key==='Enter')ok();};}

/* ---------- main touch: hold to talk / swipe up to room / tap Miyeon ---------- */
(function(){const t=$('#touch');let st=null,holdT=null,listening=false;
  t.addEventListener('pointerdown',e=>{if(S.mode!=='idle')return;audio();st={x:e.clientX,y:e.clientY};listening=false;
    charEl.classList.add('pressed');SFX.touch();
    holdT=setTimeout(()=>{holdT=null;if(!st)return;listening=listen();if(!listening){st=null;charEl.classList.remove('pressed');typeInput();}},220);});
  t.addEventListener('pointermove',e=>{if(!st||listening)return;const dy=e.clientY-st.y;
    if(dy<-36){clearTimeout(holdT);holdT=null;st=null;charEl.classList.remove('pressed');toRoom();}});
  const up=async e=>{if(!st)return;const p=st;clearTimeout(holdT);st=null;charEl.classList.remove('pressed');
    if(holdT===null&&listening){listening=false;S.mode='busy';const txt=await stopListen();if(txt)gotText(txt);else{S.mode='idle';say('잘 못 들었어요.<br>꾹 누른 채로 다시 말해주세요.');}}
    else if(S.mode==='idle'){if(!charTapped(p.x,p.y))say('화면을 <span class="q">꾹 누른 채로</span> 말해주세요.<div class="hint">위로 밀면 보관함으로 가요.</div>');}
    holdT=null;};
  t.addEventListener('pointerup',up);t.addEventListener('pointercancel',up);
})();

function gotText(txt){
  if(/설정/.test(txt)){openSettings();return;}
  if(/(음악|배경음|bgm)/i.test(txt)&&/(꺼|끄|멈|그만|조용)/.test(txt)){DB.settings.music=false;save();BGM.stop();say('음악을 껐어요.<div class="hint">"음악 켜줘"라고 하면 다시 틀어요.</div>');S.mode='idle';return;}
  if(/(음악|배경음|bgm)/i.test(txt)&&/(켜|틀|다시)/.test(txt)){DB.settings.music=true;save();music();say('음악을 다시 틀었어요.');S.mode='idle';return;}
  if(/취향/.test(txt)&&/(다시|새로|바꿀|정할)/.test(txt)){startTutorial();return;}
  S.mode='confirm';
  say(`<span class="q">“${esc(txt)}”</span><br>이게 맞나요?`,{choices:[{label:'네',fn:()=>startSearch(txt)},{label:'아니요',fn:()=>{S.mode='idle';say('다시 말해주세요.<br>화면을 꾹 누른 채로요.');}}]});
}

/* ---------- location ---------- */
let LOCERR='';
function getLoc(force){return new Promise(res=>{LOCERR='';
  const cached=DB.lastLoc&&Date.now()-DB.lastLoc.at<(force?0:10*60e3)?DB.lastLoc:null;
  if(!navigator.geolocation){LOCERR='이 기기에서 위치를 쓸 수 없어요.';return res(cached);}
  navigator.geolocation.getCurrentPosition(p=>{const l={lat:p.coords.latitude,lng:p.coords.longitude,acc:Math.round(p.coords.accuracy||0),at:Date.now(),label:DB.lastLoc&&distM(DB.lastLoc,{lat:p.coords.latitude,lng:p.coords.longitude})<300?DB.lastLoc.label:''};
      DB.lastLoc=l;save();res(l);},
    err=>{LOCERR=err.code===1?'위치 권한이 꺼져 있어요. 아이폰 설정 › 개인정보 보호 및 보안 › 위치 서비스 › Safari 웹사이트를 "앱을 사용하는 동안"으로 바꿔주세요.':err.code===3?'위치를 받는 데 시간이 너무 걸렸어요. 다시 시도해 주세요.':'지금 위치를 확인할 수 없어요.';
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
- mapsTitle은 Google 지도에 등록된 이름을 글자 그대로(현지어 그대로) 적어라. address는 Google 지도의 주소 그대로.
출력은 설명 없이 JSON 배열만:
[{"name":"한국어 표시 이름","mapsTitle":"Google 지도 등록 이름 그대로","address":"Google 지도 주소 그대로","line1":"한 줄 설명 18자 안팎","line2":"한 줄 설명 20자 안팎","kind":"taste 또는 random","category":"${CATS} 중 하나","lat":0.0,"lng":0.0,"hours":"오늘 영업시간","open":true,"tags":["현금만","흡연 가능","예약 필요" 같은 주의사항, 최대 3개, 없으면 빈 배열],"area":"지역명 예: 서울 용산"}]`;}
async function gemini(prompt,loc){
  const st=DB.settings;const model=(st.model||DEFAULT_MODEL).trim();
  const url=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(st.key.trim())}`;
  const ll=loc?{retrievalConfig:{latLng:{latitude:loc.lat,longitude:loc.lng}}}:null;
  const sets=[{tools:[{googleMaps:{}},{googleSearch:{}}],tc:ll},{tools:[{googleMaps:{}}],tc:ll},{tools:[{googleMaps:{}}],tc:null},{tools:[{google_maps:{}}],tc:null}];
  let lastErr='',lastStatus=0;
  for(const set of sets){
    const body={contents:[{role:'user',parts:[{text:prompt}]}],tools:set.tools};
    if(set.tc)body.toolConfig=set.tc;
    for(let attempt=0;attempt<2;attempt++){
      let r;try{r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});}catch(e){lastErr='net';await sleep(1200);continue;}
      if(r.ok){const j=await r.json();const c=j.candidates?.[0]||{};
        return {text:(c.content?.parts||[]).map(p=>p.text||'').join(''),chunks:(c.groundingMetadata?.groundingChunks||[]).map(x=>x.maps).filter(Boolean)};}
      const t=await r.text();lastStatus=r.status;
      try{lastErr=JSON.parse(t).error?.message||t;}catch(e){lastErr=t;}
      if(r.status===503||r.status===429||r.status===500){await sleep(1500);continue;}
      if(/API key not valid|API_KEY_INVALID/i.test(lastErr))throw new Error('API 키를 확인해주세요.');
      if(r.status===404)throw new Error('모델 이름을 확인해주세요: '+model);
      break; // try next request form
    }
  }
  if(lastErr==='net')throw new Error('인터넷 연결을 확인해주세요.');
  throw new Error(`구글맵 확인 요청이 거절됐어요. (${lastStatus}) 구글 메시지: ${String(lastErr).slice(0,180)}`);
}
const norm=s=>String(s||'').toLowerCase().normalize('NFKC').replace(/[\s·・\-_,.()（）\[\]【】'"`~!@#$%^&*+=:;/\\|<>?]/g,'');
function matchChunk(card,chunks){const keys=[card.mapsTitle,card.name].map(norm).filter(k=>k.length>=2);
  let best=null,score=0;
  for(const ch of chunks){const t=norm(ch.title);if(!t)continue;
    for(const k of keys){let s=0;if(t===k)s=3;else if(t.includes(k)||k.includes(t))s=2;
      else{let common=0;for(const c of new Set(k))if(t.includes(c))common++;const r=common/Math.max(new Set(k).size,1);if(r>=0.8&&k.length>=3)s=1;}
      if(s>score){score=s;best=ch;}}}
  return best;}
function parseCards(res){const txt=res.text;const a=txt.indexOf('['),b=txt.lastIndexOf(']');if(a<0||b<a)throw new Error('추천을 읽지 못했어요. 다시 해볼게요.');
  let arr;try{arr=JSON.parse(txt.slice(a,b+1));}catch(e){throw new Error('추천을 읽지 못했어요. 다시 해볼게요.');}
  if(!res.chunks.length)throw new Error('구글맵에서 확인된 곳이 없어서 보여드리지 않을게요. 지역을 넣어서 다시 말해주세요.');
  const used=new Set();const out=[];
  for(const c of arr){if(!c||!c.name)continue;const ch=matchChunk(c,res.chunks);if(!ch)continue;
    const pid=String(ch.placeId||'').replace(/^places\//,'');if(pid&&used.has(pid))continue;if(pid)used.add(pid);
    if(S.shownNames.includes(c.name))continue;
    out.push({id:uid(),name:String(c.name),mapsTitle:String(ch.title||c.mapsTitle||c.name),placeId:pid,mapsUri:ch.uri||'',address:String(c.address||''),
      line1:String(c.line1||''),line2:String(c.line2||''),kind:c.kind==='random'?'random':'taste',category:String(c.category||'기타'),
      lat:isFinite(+c.lat)&&+c.lat!==0?+c.lat:null,lng:isFinite(+c.lng)&&+c.lng!==0?+c.lng:null,hours:String(c.hours||''),open:c.open!==false,
      tags:Array.isArray(c.tags)?c.tags.slice(0,3).map(String):[],area:String(c.area||'')});}
  return out;}
async function fetchCards(nT,nR){
  if(DB.settings.key.trim().toLowerCase()==='demo'){await sleep(700);return demoCards(nT,nR);}
  let got=[];
  for(let i=0;i<2&&got.length<3;i++){
    const res=await gemini(buildPrompt(nT,nR),S.loc);
    try{const p=parseCards(res);const seen=new Set(got.map(c=>c.placeId||c.name));p.forEach(c=>{if(!seen.has(c.placeId||c.name))got.push(c);});}
    catch(e){if(i===1&&!got.length)throw e;}
  }
  return got;}

/* ---------- search flow ---------- */
async function startSearch(txt){
  if(!DB.settings.key.trim()){openSettings('먼저 제미나이 API 키를 넣어주세요.');return;}
  S.mode='loading';S.req=txt;S.queue=[];S.cards=[];S.pins=[];S.shownNames=[];S.groupId=null;S.area='';
  showDlg(false);charEl.classList.add('gone');$('#mainShade').style.opacity=.45;
  await sleep(700);$('#loading').classList.remove('hidden');
  S.loc=await getLoc();
  try{const got=await fetchCards(10,5);if(!got.length)throw new Error('지금 갈 만한 곳을 확인하지 못했어요.');
    S.area=got.find(c=>c.area)?.area||'';
    const t=got.filter(c=>c.kind==='taste'),r=got.filter(c=>c.kind==='random');
    const first=[];const pattern=['t','t','r','t','t','r','t','r','t'];
    for(const p of pattern){const src=p==='r'?(r.length?r:t):(t.length?t:r);if(src.length)first.push(src.shift());}
    S.queue=[...t,...r];S.cards=first;first.concat(S.queue).forEach(c=>S.shownNames.push(c.name));
    $('#loading').classList.add('hidden');showCards();
    if(!S.loc)toast('현재 위치를 못 받아서 거리 표시가 빠져요');
  }catch(e){$('#loading').classList.add('hidden');backToIdle();say(esc(e.message||'문제가 생겼어요.')+'<br>꾹 눌러서 다시 말해주세요.');}
}
function backToIdle(){S.mode='idle';S.cards=[];S.pins=[];$('#cardLayer').classList.add('hidden');$('#dimmer').classList.remove('on');
  $('#mainShade').style.opacity=.30;charEl.classList.remove('gone','front');showDlg(true);sayIdle();}
async function refill(){if(S.fetching||S.queue.length>=4)return;S.fetching=true;
  try{const got=await fetchCards(4,2);got.forEach(c=>S.shownNames.push(c.name));S.queue.push(...got);}catch(e){}S.fetching=false;}
function takeFromQueue(){if(!S.queue.length)return null;const wantR=Math.random()<0.3;let i=S.queue.findIndex(c=>(c.kind==='random')===wantR);if(i<0)i=0;
  const c=S.queue.splice(i,1)[0];if(S.queue.length<4)refill();return c;}

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
  L.querySelectorAll('.cw').forEach(w=>{const id=w.dataset.id,c=S.cards.find(x=>x.id===id),card=w.querySelector('.card');
    gestures(w,card,{onTap:()=>togglePin(c,card),onLong:()=>openDetail(c),onRight:()=>removeCard(c,'save'),onLeft:()=>removeCard(c,'pass')});});
  L.scrollTop=st;updatePins();}
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
  if(!S.cards.length){refill();}}
/* pull at list edges: top → onTop, bottom → onBottom */
function edgePull(listEl,onTop,onBottom){let y0=null,edge=null;
  listEl.addEventListener('touchstart',e=>{const atTop=listEl.scrollTop<=0,atBot=listEl.scrollTop+listEl.clientHeight>=listEl.scrollHeight-2;
    edge=atTop&&atBot?'both':atTop?'top':atBot?'bot':null;y0=edge?e.touches[0].clientY:null;},{passive:true});
  listEl.addEventListener('touchmove',e=>{if(y0==null)return;const dy=e.touches[0].clientY-y0;
    if(dy>90&&onTop&&(edge==='top'||edge==='both')){y0=null;onTop();}
    else if(dy<-90&&onBottom&&(edge==='bot'||edge==='both')){y0=null;onBottom();}},{passive:true});
  listEl.addEventListener('touchend',()=>{y0=null;},{passive:true});}
edgePull($('#cardList'),()=>{if(S.mode==='cards'){SFX.btn();backToIdle();}});

/* route confirm (main, with Miyeon) */
$('#routeBtn').onclick=()=>{if(!S.pins.length)return;SFX.btn();const pc=pinnedCards(S.cards,S.pins);S.mode='routeConfirm';
  $('#dimmer').classList.add('on');charEl.classList.add('front');charEl.classList.remove('gone');showDlg(true);
  say(`<span class="q">${pc.map(c=>esc(c.name)).join(', ')}</span><br>이 순서로 동선 짜볼까요?`,{choices:[
    {label:'네',fn:()=>openRoute(pc,'cards',S.req)},
    {label:'아니요',fn:()=>{S.mode='cards';charEl.classList.add('gone');setTimeout(()=>charEl.classList.remove('front'),700);$('#dimmer').classList.remove('on');setTimeout(()=>showDlg(false),10);}}]});};

/* ---------- external links ---------- */
function gSearch(c){const q=encodeURIComponent(searchText(c));return `https://www.google.com/maps/search/?api=1&query=${q}${c.placeId?`&query_place_id=${encodeURIComponent(c.placeId)}`:''}`;}
function kSearch(c){const q=encodeURIComponent(searchText(c)||c.name);return {app:`kakaomap://search?q=${q}`,web:`https://map.kakao.com/link/search/${q}`};}
function ySearch(c){const q=encodeURIComponent((c.mapsTitle||c.name)+' '+(c.area||''));return {app:`youtube://www.youtube.com/results?search_query=${q}`,web:`https://www.youtube.com/results?search_query=${q}`};}
function kakaoOK(items){const p=S.loc||items.find(c=>c.lat!=null);return DB.settings.links.kakao&&(p?inKorea(p):true);}

/* ---------- detail window ---------- */
function openDetail(c){SFX.btn();const st=DB.settings.links;const d=distM(S.loc,c);
  const ov=document.createElement('div');ov.className='overlay';
  const btns=[];if(st.google)btns.push('<button class="px" data-l="g">구글맵<small>지도 · 후기</small></button>');
  if(kakaoOK([c]))btns.push('<button class="px" data-l="k">카카오맵<small>지도</small></button>');
  if(st.youtube)btns.push('<button class="px" data-l="y">유튜브<small>관련 영상</small></button>');
  ov.innerHTML=`<div class="win px solid"><h3>${esc(c.name)}</h3>${c.mapsTitle&&c.mapsTitle!==c.name?`<div class="sub" style="margin-bottom:4px">${esc(c.mapsTitle)}</div>`:''}
    <div class="sub">${esc(c.line1)}<br>${esc(c.line2)}</div><div class="sep"></div>
    <div class="row" style="color:${c.open?'#6ee696':'#a0aacc'}">■ ${c.open?'영업 중':'영업 시간 확인'}${c.hours?' · '+esc(c.hours):''}</div>
    ${d!=null?`<div class="row">현재 위치에서 도보 ${walkMin(d)}분 · ${fmtKm(d)}</div>`:''}
    ${c.address?`<div class="sub" style="margin-top:6px">${esc(c.address)}</div>`:''}
    ${c.tags.length?`<div class="tags">${c.tags.map(t=>`<span>${esc(t)}</span>`).join('')}</div>`:''}
    ${btns.length?`<div class="btnrow">${btns.join('')}</div>`:''}</div><div class="closehint">바깥을 누르면 닫혀요</div>`;
  ov.addEventListener('click',e=>{if(e.target===ov||e.target.classList.contains('closehint'))ov.remove();});
  ov.querySelectorAll('[data-l]').forEach(b=>b.onclick=()=>{SFX.btn();const l=b.dataset.l;
    if(l==='g')window.open(gSearch(c),'_blank','noopener');
    if(l==='k'){const k=kSearch(c);openExternal(k.app,k.web);}
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
  else{$('#routeTitle').textContent='이동 순서';$('#routeMeta').textContent='카드를 끌어서 순서를 바꿀 수 있어요.';$('#routeDots').innerHTML='';}
  if(S.loc)html+=`<div class="rstart gbox"><i></i>현재 위치</div>`;
  R.items.forEach((c,i)=>{const lg=S.loc?legs[i]:(i>0?legs[i-1]:null);
    if(lg){const d=lg.d;const ch=changed.has(lg.key);
      if(d!=null){tw+=walkMin(d);tt+=d<1200?walkMin(d):Math.round(8+d/1000*2.6);}
      html+=`<div class="leg${ch?' chg':''}"><div>도보 ${d!=null?walkMin(d)+'분':'—'}</div><div>대중교통 ${d!=null?transitTxt(d):'—'}</div>${ch?'<span class="upd">갱신</span>':''}</div>`;}
    html+=`<div class="rcard gbox" data-i="${i}"><div class="n">${i+1}</div><div class="bar"></div><div class="tx"><div class="t">${esc(c.name)}</div><div class="l">${esc(c.address||c.line1)}</div></div><div class="h"><b></b><b></b><b></b></div></div>`;});
  if(legs.length&&legs.some(l=>l.d!=null))html+=`<div class="total">총 이동&nbsp;&nbsp;<b>도보 ${tw}분 · 대중교통 약 ${tt}분</b></div>`;
  if(!S.loc)html+=`<div class="total">현재 위치를 못 받았어요. 설정에서 위치를 확인해 주세요.</div>`;
  box.innerHTML=html;
  box.querySelectorAll('.rcard').forEach(el=>el.querySelector('.h').addEventListener('pointerdown',e=>startDrag(e,el)));
  const st=DB.settings.links;const btns=[];const useK=kakaoOK(R.items);const useG=st.google||!useK;
  if(useG)btns.push(`<button class="gbtn" id="goG">Google Map으로 ▶</button>`);
  if(useK){const n=R.items.length,k=Math.min(R.kIdx,n-1);btns.push(`<button class="gbtn" id="goK">카카오맵 ${n>1?(k+1)+'번':''} 찾기 ▶</button>`);}
  const g=$('#gbtns');g.innerHTML=btns.join('');
  if($('#goG'))$('#goG').onclick=()=>{SFX.btn();window.open(gmapsUrl(),'_blank','noopener');if(R.mode==='new')setTimeout(finishRoute,600);};
  if($('#goK'))$('#goK').onclick=()=>{SFX.btn();const k=Math.min(R.kIdx,R.items.length-1);const u=kSearch(R.items[k]);openExternal(u.app,u.web);
    R.kIdx=(k+1)%R.items.length;setTimeout(()=>renderRoute(new Set()),800);};}
function gmapsUrl(){const it=R.items;if(!it.length)return'#';const dest=it[it.length-1],way=it.slice(0,-1);
  const allIds=it.every(c=>c.placeId);let u=`https://www.google.com/maps/dir/?api=1${S.loc?`&origin=${S.loc.lat},${S.loc.lng}`:''}&destination=${encodeURIComponent(searchText(dest))}`;
  if(allIds)u+=`&destination_place_id=${encodeURIComponent(dest.placeId)}`;
  if(way.length){u+=`&waypoints=${way.map(c=>encodeURIComponent(searchText(c))).join('%7C')}`;if(allIds)u+=`&waypoint_place_ids=${way.map(c=>encodeURIComponent(c.placeId)).join('%7C')}`;}
  return u+'&travelmode=walking';}
function finishRoute(){$('#route').classList.add('hidden');SCREEN='main';if(S.routeFrom==='cards'){backToIdle();music();}else{SCREEN='room';roomPins=[];renderRoom();music();}}
$('#routeBack').onclick=()=>{SFX.btn();closeRoute();};
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
/* history: swipe left/right between saved routes, pull down to leave */
(function(){const box=$('#rlist');let s=null;
  box.addEventListener('touchstart',e=>{if(R.mode!=='hist'||e.target.closest('.h'))return;s={x:e.touches[0].clientX,y:e.touches[0].clientY,top:box.scrollTop<=0};},{passive:true});
  box.addEventListener('touchmove',e=>{if(!s)return;const dx=e.touches[0].clientX-s.x,dy=e.touches[0].clientY-s.y;
    if(Math.abs(dx)>70&&Math.abs(dx)>Math.abs(dy)*1.5){const n=DB.routes.length;const ni=R.idx+(dx<0?1:-1);s=null;
      if(ni<0||ni>=n){box.classList.remove('shake');void box.offsetWidth;box.classList.add('shake');return;}
      SFX.swipe();showHist(ni);}
    else if(dy>90&&s.top&&Math.abs(dy)>Math.abs(dx)){s=null;closeRoute();}},{passive:true});
  box.addEventListener('touchend',()=>{s=null;},{passive:true});})();
function showHist(i){R.mode='hist';R.idx=i;R.entry=DB.routes[i];R.items=R.entry.items;R.kIdx=0;renderRoute(new Set());}
function toRouteHistory(){if(!DB.routes.length){toast('아직 저장된 동선이 없어요');return;}
  stepFade($('#room'),-1,()=>{$('#room').classList.add('hidden');$('#route').classList.remove('hidden');$('#route').classList.add('hist');
    SCREEN='route';music();S.routeFrom='room';showHist(0);getLoc().then(l=>{if(l){S.loc=l;renderRoute(new Set());}});});}

/* ---------- room (archive) ---------- */
let roomTab='saved',roomPins=[],sparkleId=null;
function allSaved(){return DB.groups.flatMap(g=>g.cards);}
function fmtDate(t){const d=new Date(t);return `${d.getMonth()+1}월 ${d.getDate()}일`;}
function renderRoom(){const L=$('#roomList');$('#tabSaved').classList.toggle('on',roomTab==='saved');$('#tabPassed').classList.toggle('on',roomTab==='passed');
  $('#tabSaved').textContent=`저장 ${allSaved().length}`;$('#tabPassed').textContent=`지나친 카드 ${DB.passed.length}`;
  if(roomTab==='saved'){
    if(!DB.groups.length){L.innerHTML='<div class="empty">아직 저장한 곳이 없어요.<br>추천 카드를 오른쪽으로 밀면 여기 모여요.</div>';}
    else L.innerHTML=DB.groups.map(g=>`<div class="ghead${g.id===sparkleId?' sparkle':''}"><div class="gq">“${esc(g.request)}”</div><div class="gm">${fmtDate(g.date)}${g.area?' · '+esc(g.area):''}</div></div>`+
      g.cards.map(c=>cardHTML(c).replace('class="cw"',`class="cw${c._spark?' sparkle':''}"`)).join('')).join('');
    L.querySelectorAll('.cw').forEach(w=>{const c=allSaved().find(x=>x.id===w.dataset.id),card=w.querySelector('.card');
      gestures(w,card,{onTap:()=>roomPin(c,card),onLong:()=>openDetail(c),onLeft:()=>{const g=DB.groups.find(x=>x.cards.includes(c));
        g.cards=g.cards.filter(x=>x!==c);DB.passed.unshift({card:c,groupId:g.id,request:g.request,area:g.area,date:g.date,at:Date.now()});
        if(!g.cards.length)DB.groups=DB.groups.filter(x=>x!==g);roomPins=roomPins.filter(x=>x!==c.id);save();renderRoom();}});});
    allSaved().forEach(c=>delete c._spark);sparkleId=null;save();
  }else{
    L.innerHTML='<div class="note">오른쪽으로 밀면 다시 저장돼요. 10일 지나면 사라져요.</div>'+(DB.passed.length?DB.passed.map(p=>{const left=Math.max(1,10-Math.floor((Date.now()-p.at)/864e5));
      return cardHTML(p.card,`<span class="left${left<=2?' soon':''}">${left}일 남음</span>`).replace('<div class="under save">저장</div>','<div class="under save">되살리기</div>');}).join(''):'<div class="empty">지나친 카드가 없어요.</div>');
    L.querySelectorAll('.cw').forEach(w=>{const p=DB.passed.find(x=>x.card.id===w.dataset.id),card=w.querySelector('.card');
      gestures(w,card,{onLong:()=>openDetail(p.card),onRight:()=>{DB.passed=DB.passed.filter(x=>x!==p);
        let g=DB.groups.find(x=>x.id===p.groupId);if(!g){g={id:p.groupId||uid(),request:p.request,date:p.date||Date.now(),area:p.area||'',cards:[]};DB.groups.unshift(g);}
        p.card._spark=true;g.cards.push(p.card);sparkleId=g.id;save();renderRoom();}});});
    if(sparkleId){$('#tabSaved').classList.add('ringgold');setTimeout(()=>$('#tabSaved').classList.remove('ringgold'),3000);}
  }
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
    <div class="row" style="margin-top:20px">이 순서로 동선 짜볼까요?</div>
    <div class="btnrow"><button class="px gold" id="pyes" style="color:var(--bdark)">네</button><button class="px" id="pno" style="color:var(--beige)">아니요</button></div></div></div>`;
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
async function placeLabel(l){if(!l||DB.settings.key.trim().toLowerCase()==='demo'||!DB.settings.key.trim())return '';
  try{const r=await gemini('Google 지도 도구로 이 좌표가 어느 동네인지 확인해서 "시·구·동" 수준 한 줄로만 답해. 다른 말 하지 마.',l);
    return (r.text||'').split('\n')[0].trim().slice(0,40);}catch(e){return '';}}
function openSettings(msg){S.mode='settings';const st=DB.settings;const ov=document.createElement('div');ov.className='overlay';ov.style.alignItems='flex-start';ov.style.overflowY='auto';
  const L={...st.links};let music=st.music!==false;
  ov.innerHTML=`<div style="position:relative;width:100%;max-width:400px;margin:calc(var(--sat) + 30px) 0 30px"><div class="tagname">설정</div><div class="win px solid">
    ${msg?`<div class="sub" style="color:var(--yel);margin-bottom:10px">${esc(msg)}</div>`:''}
    <div class="row" style="margin-top:4px">제미나이 API 키</div>
    <div class="field"><input id="sKey" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(st.key)}" placeholder="AIza…"><button class="px gold" id="sPaste" style="padding:2px 8px;font-size:12px;font-weight:700">붙여넣기</button></div>
    <div class="small" id="sKeyHint">키는 이 폰에만 저장돼요. 체험만 하려면 demo 라고 넣으세요.</div>
    <div class="row" style="margin-top:16px">제미나이 모델</div>
    <div class="field"><input id="sModel" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(st.model)}"></div>
    <div class="small">모델 이름을 직접 입력해요. 기본: ${DEFAULT_MODEL}</div>
    <div class="sep"></div><div class="row" style="margin-top:0">현재 위치</div>
    <div class="locbox" id="sLoc">확인 중…</div>
    <div class="minibtns"><button class="px" id="sLocRe">다시 받기</button><button class="px" id="sLocMap">구글맵에서 보기</button></div>
    <div class="sep"></div><div class="row" style="margin-top:0">상세 창 링크 버튼</div>
    ${[['google','구글맵'],['youtube','유튜브'],['kakao','카카오맵 (한국에서만)']].map(([k,n])=>`<button class="chk ${L[k]?'on':'off'}" data-k="${k}"><i></i>${n}</button>`).join('')}
    <div class="sep"></div>
    <button class="chk ${music?'on':'off'}" id="sMusic" style="margin-top:0"><i></i>배경음악</button>
    <div class="btnrow"><button class="px gold" id="sSave">저장</button><button class="px" id="sClose" style="color:var(--muted)">닫기</button></div>
    <div class="small" style="text-align:center;margin-top:12px">여행선배 v${VERSION}</div></div></div>`;
  $('#overlayHost').appendChild(ov);showDlg(false);
  const locBox=ov.querySelector('#sLoc');let shown=null;
  const showLoc=async(force)=>{locBox.innerHTML='확인 중…';const l=await getLoc(force);shown=l;
    if(!l){locBox.innerHTML=`<span class="err">${esc(LOCERR||'위치를 받지 못했어요.')}</span>`;return;}
    const age=Math.round((Date.now()-l.at)/60000);
    locBox.innerHTML=`<b>${l.lat.toFixed(5)}, ${l.lng.toFixed(5)}</b> <span style="color:var(--muted)">±${l.acc||'?'}m${age>0?` · ${age}분 전`:''}</span><div id="sLocName" style="color:var(--yel)">${esc(l.label||'')}</div>${LOCERR?`<div class="err">${esc(LOCERR)}</div>`:''}`;
    if(!l.label){const name=await placeLabel(l);if(name){l.label=name;if(DB.lastLoc&&DB.lastLoc.at===l.at){DB.lastLoc.label=name;save();}const n=ov.querySelector('#sLocName');if(n)n.textContent=name;}}};
  showLoc(false);
  ov.querySelector('#sLocRe').onclick=()=>{SFX.btn();showLoc(true);};
  ov.querySelector('#sLocMap').onclick=()=>{SFX.btn();if(!shown){toast('먼저 위치를 받아주세요');return;}window.open(`https://www.google.com/maps/search/?api=1&query=${shown.lat},${shown.lng}`,'_blank','noopener');};
  ov.querySelectorAll('.chk[data-k]').forEach(b=>b.onclick=()=>{SFX.touch();L[b.dataset.k]=!L[b.dataset.k];b.classList.toggle('on',L[b.dataset.k]);b.classList.toggle('off',!L[b.dataset.k]);});
  ov.querySelector('#sMusic').onclick=e=>{SFX.touch();music=!music;e.currentTarget.classList.toggle('on',music);e.currentTarget.classList.toggle('off',!music);};
  const keyIn=ov.querySelector('#sKey');
  ov.querySelector('#sPaste').onclick=async()=>{SFX.btn();let t='';
    try{if(navigator.clipboard&&navigator.clipboard.readText)t=await navigator.clipboard.readText();}catch(e){}
    if(t&&t.trim()){keyIn.type='text';keyIn.value=t.trim();setTimeout(()=>keyIn.type='password',1500);ov.querySelector('#sKeyHint').textContent='붙여넣었어요. 저장을 눌러주세요.';}
    else{keyIn.type='text';keyIn.focus();keyIn.select();ov.querySelector('#sKeyHint').innerHTML='<span style="color:var(--yel)">입력칸을 길게 눌러 "붙여넣기"를 골라주세요.</span>';}};
  const close=()=>{ov.remove();showDlg(true);
    if(!DB.profile.done&&DB.settings.key.trim())startTutorial();else sayIdle();};
  ov.querySelector('#sSave').onclick=()=>{SFX.btn();DB.settings.key=keyIn.value.trim();DB.settings.model=ov.querySelector('#sModel').value.trim()||DEFAULT_MODEL;
    DB.settings.links=L;DB.settings.music=music;save();if(music)music_on();else BGM.stop();close();};
  ov.querySelector('#sClose').onclick=()=>{SFX.btn();close();};}
function music_on(){music();}

/* ---------- tutorial ---------- */
const SITU=[
  ['비 오는 오후 3시, 낯선 도시예요.',['박물관이나 미술관','분위기 좋은 카페','현지 시장 구경']],
  ['저녁 8시, 꽤 걸어서 다리가 아파요.',['루프탑 바에서 한잔','숙소 근처 현지 맛집','야경 보며 천천히 산책']],
  ['아침 일찍 눈이 떠졌어요.',['동네 산책이나 공원','운동 한 번','유명한 빵집 오픈런']],
  ['일정 사이에 2시간이 비었어요.',['골목 구경','쇼핑이나 편집숍','공연이나 체험 하나']],
  ['오늘은 혼자예요.',['조용한 바에서 한잔','책방이나 레코드 가게','사람 많은 핫플 구경']]];
const ROUNDS=[['볼 거리',['미술관','건축','야경','공연','박물관','자연·공원']],['먹을 거리',['커피','디저트','로컬 식당','시장','술집','길거리 음식']],
  ['할 거리',['운동','산책','쇼핑','체험·클래스','서점·음반','사진 찍기']]];
function startTutorial(){S.mode='tutorial';const P=DB.profile;P.situations=[];P.interests=[];showDlg(true);
  say('처음 뵙네요, 미연이에요.<br>취향을 조금만 알려주시면 더 잘 골라드릴게요.',{choices:[{label:'시작하기',fn:()=>situ(0)},{label:'건너뛰기',fn:finishTut}]});}
function tutBox(html){const t=$('#tut');t.innerHTML=html;t.classList.remove('hidden');return t;}
function situ(i){if(i>=SITU.length)return round(0);const [q,opts]=SITU[i];
  say(`이럴 땐 뭐가 끌려요? <span style="color:var(--muted);font-weight:400">(${i+1}/5)</span>`,{cursor:false});
  const t=tutBox(`<div class="opts px solid"><div class="q">${esc(q)}</div>${opts.map((o,k)=>`<button class="opt px" data-k="${k}">${esc(o)}</button>`).join('')}<button class="opt px" data-k="-1" style="color:var(--muted)">다 별로예요</button></div>`);
  t.querySelectorAll('.opt').forEach(b=>b.onclick=()=>{SFX.btn();const k=+b.dataset.k;DB.profile.situations.push(k<0?`${q} → 다 별로`:`${q} → ${opts[k]}`);situ(i+1);});}
function round(i){if(i>=ROUNDS.length)return finishTut();const [name,opts]=ROUNDS[i];let pick=[];
  say(`${esc(name)} 중에 딱 3개만 골라주세요.`,{cursor:false});
  const draw=()=>{const t=tutBox(`<div class="opts px solid"><div class="q">${esc(name)} <span class="count">${pick.length}/3</span></div><div class="grid">${opts.map(o=>`<button class="chip px${pick.includes(o)?' on':''}">${esc(o)}</button>`).join('')}</div>
      <button class="next px ${pick.length?'gold':''}" ${pick.length?'':'style="color:var(--muted)"'}>${i<2?'다음':'끝'}</button></div>`);
    t.querySelectorAll('.chip').forEach(b=>b.onclick=()=>{const o=b.textContent;if(pick.includes(o)){pick=pick.filter(x=>x!==o);SFX.touch();}else if(pick.length<3){pick.push(o);SFX.pin();}else{b.classList.add('shake');setTimeout(()=>b.classList.remove('shake'),400);return;}draw();});
    t.querySelector('.next').onclick=()=>{if(!pick.length)return;SFX.btn();DB.profile.interests.push(...pick);round(i+1);};};draw();}
function finishTut(){$('#tut').classList.add('hidden');DB.profile.done=true;save();S.mode='idle';
  say('좋아요, 기억해둘게요.<br>이제 화면을 꾹 누른 채로 말해보세요.<div class="hint">예) 저녁 먹고 시부야에서 놀 거리</div>');}

/* ---------- demo ---------- */
const DEMO=[['시부야 스카이','SHIBUYA SKY','스크램블 스퀘어 옥상 전망대','해 진 뒤 교차로 야경이 최고','taste','야경·전망',35.6585,139.7023,'11:00–22:30',[]],
 ['미야시타 파크 옥상','MIYASHITA PARK','쇼핑몰 위 옥상 공원 산책','아래층 요코초 골목에서 한잔도','taste','공원·산책',35.6622,139.7022,'08:00–23:00',[]],
 ['논베이 요코초','のんべい横丁','선로 옆 좁은 골목 작은 술집들','자리 몇 개뿐인 단골 분위기','taste','술집',35.6605,139.7027,'18:00–01:00',['현금만','흡연 가능']],
 ['푸글렌 도쿄','Fuglen Tokyo','밤엔 칵테일 바가 되는 카페','오쿠시부야 조용한 골목','taste','카페',35.6676,139.6927,'07:00–01:00',[]],
 ['JBS 재즈 바','JBS','주인장 LP가 벽을 채운 바','말없이 음악 듣기 좋은 곳','taste','공연·음악',35.6577,139.7005,'19:00–02:00',['현금만','좌석 10석 내외']],
 ['PARCO 갤러리 층','渋谷PARCO','전시·서브컬처 매장 모음','늦게까지 열어 구경하기 좋아요','taste','전시·미술',35.6620,139.6987,'11:00–21:00',[]],
 ['타워레코드 시부야','TOWER RECORDS 渋谷店','층마다 장르가 다른 음반 매장','시청 코너에서 한참 머물기','taste','쇼핑',35.6618,139.7016,'11:00–22:00',[]],
 ['돈키호테 메가 시부야','MEGAドン・キホーテ渋谷本店','24시간 잡동사니 쇼핑 천국','기념품 사냥, 평소라면 안 갈 곳','random','쇼핑',35.6597,139.6985,'24시간',[]],
 ['히토카라','ひとからオケ','혼자 노래방 1시간','1인용 부스라 눈치 안 봐요','random','체험',35.6596,139.6990,'24시간',[]],
 ['게임센터 인형뽑기','タイトーステーション渋谷','센터가이 오락실에서 운 시험','일본식 크레인은 의외로 잘 뽑혀요','random','체험',35.6600,139.6993,'10:00–24:00',[]],
 ['오쿠시부야 책방','SHIBUYA PUBLISHING & BOOKSELLERS','작은 독립 서점','밤 산책 중 들르기 좋아요','taste','쇼핑',35.6640,139.6930,'12:00–22:00',[]],
 ['시부야 대중목욕탕','改良湯','동네 목욕탕에서 피로 풀기','수건 대여 가능','random','체험',35.6560,139.6960,'15:00–24:00',['현금만']],
 ['스크램블 교차로','渋谷スクランブル交差点','세계에서 제일 붐비는 횡단보도','2층 카페에서 내려다보기','taste','건축·명소',35.6595,139.7005,'24시간',[]],
 ['도겐자카 라멘 골목','道玄坂','늦게까지 하는 라멘집들','저녁 먹었어도 한 그릇?','random','음식점',35.6570,139.6965,'11:00–04:00',[]]];
let demoI=0;
function demoCards(nT,nR){const out=[];let t=0,r=0;for(let k=0;k<DEMO.length*2&&(t<nT||r<nR);k++){const d=DEMO[(demoI++)%DEMO.length];
  if(S.shownNames.includes(d[0])||out.some(o=>o.name===d[0]))continue;if(d[4]==='random'?r>=nR:t>=nT)continue;d[4]==='random'?r++:t++;
  out.push({id:uid(),name:d[0],mapsTitle:d[1],placeId:'',mapsUri:'',line1:d[2],line2:d[3],kind:d[4],category:d[5],lat:d[6],lng:d[7],address:'도쿄도 시부야구',hours:d[8],open:true,tags:d[9],area:'도쿄 시부야'});}
  if(!S.loc)S.loc={lat:35.6590,lng:139.7006,acc:20,at:Date.now()};return out;}

/* ---------- boot ---------- */
document.addEventListener('gesturestart',e=>e.preventDefault());
document.addEventListener('dblclick',e=>e.preventDefault(),{passive:false});
let lastTouch=0;document.addEventListener('touchend',e=>{const n=Date.now();if(n-lastTouch<300&&!e.target.closest('input'))e.preventDefault();lastTouch=n;},{passive:false});
document.addEventListener('contextmenu',e=>{if(!e.target.closest('input'))e.preventDefault();});
if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('sw.js').catch(()=>{});
if(!DB.settings.key.trim()){showDlg(true);say('안녕하세요, 여행선배 미연이에요.',{cursor:false});setTimeout(()=>openSettings('처음이시네요. 제미나이 API 키를 넣어주세요.'),600);}
else if(!DB.profile.done)startTutorial();
else sayIdle();
window.__S=S;window.__DB=DB;window.__R=R;
