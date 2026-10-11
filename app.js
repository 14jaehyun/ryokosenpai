'use strict';
/* 여행선배 (료코센빠이) v2.0 */
const VERSION='2.3.6';

/* ---------- storage ---------- */
const LS='ryokosenpai.v1';
const DEFAULT_MODEL='gemini-3.5-flash-lite';
const DEF={settings:{key:'',model:DEFAULT_MODEL,music:true,hero:'miyeon'},user:{name:''},chat:{recent:[]},
  profile:{done:false,situations:[],interests:[],free:'',stats:{}},groups:[],passed:[],routes:[],lastLoc:null};
let DB;
function load(){try{DB=JSON.parse(localStorage.getItem(LS))||{}}catch(e){DB={}}
  DB=Object.assign(JSON.parse(JSON.stringify(DEF)),DB);
  DB.settings=Object.assign({},DEF.settings,DB.settings);delete DB.settings.links;
  if(!DB.settings.model)DB.settings.model=DEFAULT_MODEL;
  DB.profile=Object.assign({},DEF.profile,DB.profile);DB.user=Object.assign({},DEF.user,DB.user);if(!DB.chat||!Array.isArray(DB.chat.recent))DB.chat={recent:[]};
  if(!Array.isArray(DB.routes))DB.routes=[];
  ['lastLoc','manualLoc'].forEach(k=>{if(DB[k])DB[k].label='';});
  DB.passed=[];}
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
  goSilent();setTimeout(()=>{if(!document.hidden)AWAY=false;},2500);  // no sound may be playing at the moment we hand over to Maps/YouTube (that's what locks the quiet volume)
  if(!appUrl){window.open(webUrl,'_blank','noopener');return;}   // still inside the tap → no pop-up warning
  /* left = the app took over (page hidden, lost focus, or the iOS "open in app?" sheet showed up).
     We never open the web page on our own any more (Safari calls that a pop-up); if the app clearly didn't open,
     offer a button — a real tap — instead. */
  let left=false;const mark=()=>{left=true;};const onVis=()=>{if(document.hidden)left=true;};
  document.addEventListener('visibilitychange',onVis);window.addEventListener('blur',mark);window.addEventListener('pagehide',mark);
  window.location.href=appUrl;
  setTimeout(()=>{document.removeEventListener('visibilitychange',onVis);window.removeEventListener('blur',mark);window.removeEventListener('pagehide',mark);
    if(!left&&!document.hidden&&document.hasFocus()&&webUrl)webFallback(webUrl);},2500);}
function webFallback(url){const old=$('#webFb');if(old)old.remove();
  const b=document.createElement('button');b.id='webFb';b.className='px gold webfb';b.textContent='앱이 안 열렸어? 웹으로 열기';
  b.onclick=e=>{e.stopPropagation();SFX.btn();b.remove();window.open(url,'_blank','noopener');};
  $('#app').appendChild(b);setTimeout(()=>b.remove(),6000);}

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
let SOUNDTEST='',ROUTE_DEST=null,ROUTE_EL=null;  // no 'playback' (A): it puts a now-playing badge on the Dynamic Island. The fix is MICOPEN: no sound at all while the mic is open
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
function audioKick(){if(document.hidden)return;AWAY=false;
  if(AC&&AC.state==='closed'){AC=null;SFXOUT=null;BGM.reset();}
  /* first touch after coming back from another app: build a fresh context inside this touch (it starts running
     and on the normal speaker route), instead of reviving the old one */
  if(acStale){acStale=false;if(AC){acFixing=null;rebuildAudio();return;}}
  const a=audio();if(!a||a.state==='running'||acFixing===a)return;
  acFixing=a;
  setTimeout(()=>{if(acFixing===a)acFixing=null;if(AC!==a||a.state==='running'||document.hidden)return;
    rebuildAudio();},350);}
let MICOPEN=false,AWAY=false;
/* hard silence: stop music, cut every sound, until we're back and the next touch rebuilds the audio */
function goSilent(){AWAY=true;acStale=true;try{BGM.stop();}catch(e){}try{if(SFXOUT&&AC)SFXOUT.gain.setValueAtTime(0,AC.currentTime);if(AC&&AC.suspend)AC.suspend().catch(()=>{});}catch(e){}}
function osc(type,f0,f1,t0,dur,vol,decay){if(MICOPEN||AWAY)return;const a=audio();if(!a)return;const o=a.createOscillator(),g=a.createGain();o.type=type;
  const s=a.currentTime+t0;o.frequency.setValueAtTime(f0,s);if(f1!==f0)o.frequency.linearRampToValueAtTime(f1,s+dur);
  g.gain.setValueAtTime(0,s);g.gain.linearRampToValueAtTime(vol,s+0.004);g.gain.exponentialRampToValueAtTime(0.0008,s+Math.max(dur,decay||dur));
  o.connect(g).connect(SFXOUT);o.start(s);o.stop(s+Math.max(dur,decay||dur)+0.02);}
function noise(t0,dur,vol,type,f0,f1,q,atk){if(MICOPEN||AWAY)return;const a=audio();if(!a)return;const n=Math.floor(a.sampleRate*dur),b=a.createBuffer(1,n,a.sampleRate),d=b.getChannelData(0);
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
  btn(){osc('square',660,660,0,0.045,0.06,0.05);osc('square',880,880,0.06,0.11,0.06,0.12);},
  /* affection: a soft "뾱" (snaps up) / "뽁" (duller, drops) with a short tail */
  affUp(){pop(260,880,0.13,0.11,0.035);},
  affDown(){pop(620,190,0.16,0.16,0.045);},
  /* rebirth potion: a warm detuned pad that swells and rises, a wobbly "부웅~" glide, dreamy bells, a short echo */
  magic(){if(MICOPEN||AWAY)return;const a=audio();if(!a||!SFXOUT)return;const sr=a.sampleRate,n=Math.floor(sr*1.8),b=a.createBuffer(1,n,sr),o=b.getChannelData(0),T=Math.PI*2;
    const pad=[[130.8,.10],[196,.08],[261.6,.07],[329.6,.05],[392,.04]],ph=new Float64Array(pad.length*2);let gp=0;
    for(let i=0;i<n;i++){const t=i/sr,vib=Math.sin(T*5.5*t),rise=1+0.06*Math.min(1,t/0.5);let v=0;
      pad.forEach(([f,g],k)=>{[-1.6,1.6].forEach((d,j)=>{const q=k*2+j;ph[q]+=(f+d)*(1+0.004*vib)*rise/sr;v+=Math.sin(T*ph[q])*g*0.5;});});
      v*=Math.min(1,t/0.12)*Math.exp(-Math.max(0,t-0.25)/0.55);
      const gf=180*Math.pow(2,Math.min(t,0.7)/0.7*1.3)*(1+0.03*Math.sin(T*7*t));gp+=gf/sr;
      v+=(Math.sin(T*gp)+0.3*Math.sin(2*T*gp))*Math.min(1,t/0.05)*Math.exp(-t/0.45)*0.09;o[i]=v;}
    [1047,1319,1568,2093,1760,2637].forEach((f,k)=>{const j=Math.floor(sr*(0.18+k*0.11+Math.random()*0.02));
      for(let i=j;i<n;i++){const t=(i-j)/sr;o[i]+=(Math.sin(T*f*t)+0.25*Math.sin(T*f*2.01*t))*Math.exp(-t/0.35)*0.025*(1+0.3*Math.sin(T*6*t));}});
    const dry=Float32Array.from(o);[[0.037,.35],[0.053,.3],[0.079,.25],[0.113,.2],[0.161,.15]].forEach(([dl,g])=>{const k=Math.floor(sr*dl);for(let i=k;i<n;i++)o[i]+=dry[i-k]*g;});
    for(let i=0;i<n;i++)o[i]*=0.55;
    const src=a.createBufferSource();src.buffer=b;src.connect(SFXOUT);src.start();}
};
function pop(f0,f1,dur,vol,tau){if(MICOPEN||AWAY)return;const a=audio();if(!a)return;
  [[0,1],[0.029,0.32],[0.043,0.1],[0.067,0.033]].forEach(([dt,g])=>{const s=a.currentTime+dt;
    [[1,1],[2,0.25]].forEach(([h,hv])=>{const o=a.createOscillator(),gn=a.createGain();o.type='sine';
      o.frequency.setValueAtTime(f0*h,s);o.frequency.setTargetAtTime(f1*h,s,tau);
      gn.gain.setValueAtTime(0,s);gn.gain.linearRampToValueAtTime(vol*g*hv,s+0.002);gn.gain.setTargetAtTime(0,s+0.002,dur/4);
      o.connect(gn).connect(SFXOUT);o.start(s);o.stop(s+dur+0.05);});});
  noise(0,0.012,vol*0.5,'lowpass',2500,1500,0.7,0.05);}

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
  if(document.hidden){abortListen();goSilent();}
  else{AWAY=false;}});  // sound comes back on the next touch (audioKick rebuilds the context)
window.addEventListener('pagehide',()=>abortListen());
const firstTouch=()=>{audioKick();if(!BGM.started&&DB.settings.music)music();};
document.addEventListener('pointerdown',firstTouch,{capture:true});
document.addEventListener('touchend',()=>audioKick(),{capture:true,passive:true});

/* ---------- state ---------- */
const S={mode:'idle',req:'',loc:null,area:'',queue:[],cards:[],pins:[],shownNames:[],groupId:null,fetching:false,routeFrom:null,gen:0,emptyRefills:0};
const CARD_SLOTS=9,QUEUE_MIN=6;
const mainEl=$('#main'),charEl=$('#char'),dlgWrap=$('#dlgWrap'),dlg=$('#dlg');

/* ---------- heroines: same base personality + one extra trait each; picked in settings (default 미연) ---------- */
const HEROES={
  miyeon:{name:'미연',img:'miyeon2.png',blush:'miyeon2_blush.png',blink:'miyeon2_blink.png',pos:{left:-13.2,top:0,width:125},
    trait:'추가 속성: 천연계·모에. 순진하고 천연스러운 반응, 가끔 엉뚱한 연상으로 말이 튀어. 감정이 얼굴에 그대로 드러나.'},
  mizuki:{name:'미즈키',img:'hero_mz.png',blush:'hero_mz_blush.png',blink:'hero_mz_blink.png',pos:{left:-8.681,top:10,width:116.054},
    trait:'출신: 일본에서 온 유학생. 한국말을 꽤 잘하고 평소엔 자연스러운 반말을 써. 일본 이야기나 일본과 한국의 차이를 가끔 자연스럽게 꺼내. 추가 속성: 얀데레(가벼운 정도). 다정하고 상냥하지만 후배에 대한 독점욕과 질투가 은근히 있어. 후배가 다른 사람 얘기를 하면 살짝 서늘해지거나 "그 사람 누구야?"처럼 캐묻고, "나만 따라오면 돼" 같은 말을 웃으며 해. 위협·폭력·자해·감금·스토킹 같은 표현은 절대 쓰지 말고, 귀엽게 오싹한 정도까지만.'},
  sujeong:{name:'수정',img:'hero_sj.png',blush:'hero_sj_blush.png',blink:'hero_sj_blink.png',pos:{left:-9.194,top:10,width:118.566},
    trait:'추가 속성: 쿨뷰티. 말수가 적고 담담하고 간결해. 감정 표현을 아끼고 문장을 짧게 끊어. 그래서 가끔 허당이 드러나거나 수줍어할 때 반전 매력이 커.'}};
function hero(){return HEROES[DB.settings.hero]||HEROES.miyeon;}
const hn=()=>hero().name;
const iya=n=>n+(hasBatchim(n)?'이야':'야');   // 미연이야 / 미즈키야 / 수정이야
/* ---------- affection (per heroine, kept until reset; shown top-left as a heart + number, no label) ---------- */
const AFF_SVG=(()=>{const H=["..##.##..",".#######.","#########","#########",".#######.","..#####..","...###...","....#...."],HI=['2,1','1,2'];let r='';
  H.forEach((row,y)=>[...row].forEach((c,x)=>{if(c==='#')r+=`<rect x="${x*4}" y="${y*4}" width="4" height="4" fill="${HI.includes(x+','+y)?'#ffd1e0':'#ff6f9c'}"/>`;}));
  return `<svg width="36" height="32" viewBox="0 0 36 32" shape-rendering="crispEdges">${r}</svg>`;})();
const AFF_START=10;
function affOf(){DB.aff=DB.aff||{};
  if(!DB.affBase){Object.values(DB.aff).forEach(a=>{a.v=(a.v||0)+50;});DB.affBase=1;}   // older saves started at 0
  if(DB.affBase<3){Object.values(DB.aff).forEach(a=>{a.v=AFF_START;a.acc=0;});DB.affBase=3;if(DB.user&&DB.user.name&&DB.talks==null)DB.talks=10;}   // v2.3.2: everyone starts over at 10   // v2.3: everyone starts over at 30
  const k=DB.settings.hero||'miyeon';return DB.aff[k]||(DB.aff[k]={v:AFF_START,acc:0});}
const AFF_H=22;
function affDraw(v){const n=$('#affN');if(!n)return;n.innerHTML=String(v).split('').map(c=>`<span class="d"><span class="s"><i>${c}</i></span></span>`).join('');}
/* odometer: every digit rolls through the values it really passes */
function affRoll(from,to,dur,delay){const n=$('#affN'),up=to>from,len=Math.max(String(from).length,String(to).length);
  const vals=[];for(let v=from;up?v<=to:v>=to;v+=up?1:-1)vals.push(String(v).padStart(len,' '));
  n.innerHTML='';
  for(let p=0;p<len;p++){const seq=[];vals.forEach(x=>{const c=x[p];if(seq[seq.length-1]!==c)seq.push(c);});
    const d=document.createElement('span');d.className='d';const st=document.createElement('span');st.className='s';
    const list=up?seq:seq.slice().reverse();st.innerHTML=list.map(c=>`<i>${c===' '?'&nbsp;':c}</i>`).join('');d.appendChild(st);n.appendChild(d);
    const k=seq.length-1;if(!k)continue;const a=up?0:-k*AFF_H,b=up?-k*AFF_H:0;st.style.transform=`translateY(${a}px)`;
    if(st.animate)st.animate([{transform:`translateY(${a}px)`},{transform:`translateY(${b}px)`}],{duration:dur+k*25,delay,easing:'cubic-bezier(.3,1.45,.55,1)',fill:'forwards'});}
  setTimeout(()=>affDraw(to),delay+dur+len*25+400);}
function affShow(){const h=$('#affH');if(h&&!h.firstChild)h.innerHTML=AFF_SVG;affDraw(affOf().v);}
function affBump(d){const A=affOf(),from=A.v,to=Math.max(0,from+d);if(to===from)return;A.v=to;save();
  if(to===0&&!DB.locked)setTimeout(()=>lockOut(),900);
  const h=$('#affH');if(!h||!h.animate){affDraw(to);return;}
  if(d>0){SFX.affUp();
    h.animate([{transform:'none'},{transform:'scale(1.25,.75)',offset:.14},{transform:'translateY(-22px) scale(.85,1.18)',offset:.42},{transform:'translateY(-24px) scale(.95,1.05)',offset:.55},
      {transform:'translateY(0) scale(1.18,.82)',offset:.8},{transform:'scale(.96,1.04)',offset:.9},{transform:'none'}],{duration:620,easing:'ease-in-out'});
    affRoll(from,to,520,120);}
  else{setTimeout(()=>SFX.affDown(),180);
    h.animate([{transform:'none'},{transform:'translateY(-6px) scale(.95,1.05)',offset:.1},{transform:'translateY(16px) scale(1.25,.85)',offset:.28},{transform:'translateY(16px) scale(1.2,.88)',offset:.46},
      {transform:'translateY(-10px) scale(.88,1.14)',offset:.7},{transform:'translateY(0) scale(1.06,.95)',offset:.87},{transform:'none'}],{duration:760,easing:'ease-in-out'});
    h.querySelector('svg').animate([{filter:'none'},{filter:'none',offset:.099},{filter:'grayscale(1) brightness(.55)',offset:.1},{filter:'grayscale(1) brightness(.55)',offset:.46},{filter:'none',offset:.461},{filter:'none'}],{duration:760,easing:'linear'});   // gray as it starts to fall, pink the moment it bounces up
    affRoll(from,to,520,200);}}
/* each chat answer is judged small (-0.3 ~ +0.3) and piles up out of sight; the number moves only when the pile reaches ±1
   (≈ once in 6~10 answers). Now and then a move is amplified ×2~3, for no reason at all. */
const AFF_SCALE=2,AFF_UP=1.6,AFF_DOWN=1.6*1.1;   // rise : drop = 1 : 1.1
function affJudge(x){const A=affOf();x=Math.max(-0.3,Math.min(0.3,Number(x)||0))*AFF_SCALE;if(x<0)x*=AFF_DOWN;else x*=AFF_UP;A.acc=(A.acc||0)+x;
  if(Math.abs(A.acc)<1){save();return;}
  const sgn=Math.sign(A.acc);A.acc-=sgn;let d=sgn;if(Math.random()<0.15)d*=Math.random()<0.5?2:3;
  setTimeout(()=>affBump(d),450);}
function applyHero(){const h=hero(),img=$('#charImg');affShow();img.src=h.img;Object.assign(img.style,{left:h.pos.left+'%',top:h.pos.top+'%',width:h.pos.width+'%'});
  const t=$('#heroName');if(t)t.textContent=h.name;new Image().src=h.blush;if(h.blink)new Image().src=h.blink;}

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
    const img=$('#charImg');img.src=hero().blush;setTimeout(()=>{img.src=hero().img;blushing=false;},2000);}
  return true;}

/* ---------- voice: record while held → Gemini listens (no iOS speech module) ---------- */
const LFX=`<div class="lfx"><svg class='lfxs' width='42' height='22' viewBox='0 0 42 22' shape-rendering='crispEdges'><g class='f f0'><rect x='20' y='10' width='2' height='2'/></g><g class='f f1'><rect x='14' y='6' width='2' height='2'/><rect x='14' y='8' width='2' height='2'/><rect x='14' y='10' width='2' height='2'/><rect x='14' y='12' width='2' height='2'/><rect x='14' y='14' width='2' height='2'/><rect x='16' y='6' width='2' height='2'/><rect x='16' y='14' width='2' height='2'/><rect x='20' y='10' width='2' height='2'/><rect x='24' y='6' width='2' height='2'/><rect x='24' y='14' width='2' height='2'/><rect x='26' y='6' width='2' height='2'/><rect x='26' y='8' width='2' height='2'/><rect x='26' y='10' width='2' height='2'/><rect x='26' y='12' width='2' height='2'/><rect x='26' y='14' width='2' height='2'/></g><g class='f f2'><rect x='8' y='6' width='2' height='2'/><rect x='8' y='8' width='2' height='2'/><rect x='8' y='10' width='2' height='2'/><rect x='8' y='12' width='2' height='2'/><rect x='8' y='14' width='2' height='2'/><rect x='10' y='2' width='2' height='2'/><rect x='10' y='4' width='2' height='2'/><rect x='10' y='6' width='2' height='2'/><rect x='10' y='14' width='2' height='2'/><rect x='10' y='16' width='2' height='2'/><rect x='10' y='18' width='2' height='2'/><rect x='14' y='6' width='2' height='2'/><rect x='14' y='8' width='2' height='2'/><rect x='14' y='10' width='2' height='2'/><rect x='14' y='12' width='2' height='2'/><rect x='14' y='14' width='2' height='2'/><rect x='16' y='6' width='2' height='2'/><rect x='16' y='14' width='2' height='2'/><rect x='20' y='10' width='2' height='2'/><rect x='24' y='6' width='2' height='2'/><rect x='24' y='14' width='2' height='2'/><rect x='26' y='6' width='2' height='2'/><rect x='26' y='8' width='2' height='2'/><rect x='26' y='10' width='2' height='2'/><rect x='26' y='12' width='2' height='2'/><rect x='26' y='14' width='2' height='2'/><rect x='30' y='2' width='2' height='2'/><rect x='30' y='4' width='2' height='2'/><rect x='30' y='6' width='2' height='2'/><rect x='30' y='14' width='2' height='2'/><rect x='30' y='16' width='2' height='2'/><rect x='30' y='18' width='2' height='2'/><rect x='32' y='6' width='2' height='2'/><rect x='32' y='8' width='2' height='2'/><rect x='32' y='10' width='2' height='2'/><rect x='32' y='12' width='2' height='2'/><rect x='32' y='14' width='2' height='2'/></g><g class='f f3'><rect x='2' y='6' width='2' height='2'/><rect x='2' y='8' width='2' height='2'/><rect x='2' y='10' width='2' height='2'/><rect x='2' y='12' width='2' height='2'/><rect x='2' y='14' width='2' height='2'/><rect x='4' y='0' width='2' height='2'/><rect x='4' y='2' width='2' height='2'/><rect x='4' y='4' width='2' height='2'/><rect x='4' y='16' width='2' height='2'/><rect x='4' y='18' width='2' height='2'/><rect x='4' y='20' width='2' height='2'/><rect x='6' y='-2' width='2' height='2'/><rect x='6' y='0' width='2' height='2'/><rect x='6' y='20' width='2' height='2'/><rect x='6' y='22' width='2' height='2'/><rect x='8' y='6' width='2' height='2'/><rect x='8' y='8' width='2' height='2'/><rect x='8' y='10' width='2' height='2'/><rect x='8' y='12' width='2' height='2'/><rect x='8' y='14' width='2' height='2'/><rect x='10' y='2' width='2' height='2'/><rect x='10' y='4' width='2' height='2'/><rect x='10' y='6' width='2' height='2'/><rect x='10' y='14' width='2' height='2'/><rect x='10' y='16' width='2' height='2'/><rect x='10' y='18' width='2' height='2'/><rect x='14' y='6' width='2' height='2'/><rect x='14' y='8' width='2' height='2'/><rect x='14' y='10' width='2' height='2'/><rect x='14' y='12' width='2' height='2'/><rect x='14' y='14' width='2' height='2'/><rect x='16' y='6' width='2' height='2'/><rect x='16' y='14' width='2' height='2'/><rect x='20' y='10' width='2' height='2'/><rect x='24' y='6' width='2' height='2'/><rect x='24' y='14' width='2' height='2'/><rect x='26' y='6' width='2' height='2'/><rect x='26' y='8' width='2' height='2'/><rect x='26' y='10' width='2' height='2'/><rect x='26' y='12' width='2' height='2'/><rect x='26' y='14' width='2' height='2'/><rect x='30' y='2' width='2' height='2'/><rect x='30' y='4' width='2' height='2'/><rect x='30' y='6' width='2' height='2'/><rect x='30' y='14' width='2' height='2'/><rect x='30' y='16' width='2' height='2'/><rect x='30' y='18' width='2' height='2'/><rect x='32' y='6' width='2' height='2'/><rect x='32' y='8' width='2' height='2'/><rect x='32' y='10' width='2' height='2'/><rect x='32' y='12' width='2' height='2'/><rect x='32' y='14' width='2' height='2'/><rect x='34' y='-2' width='2' height='2'/><rect x='34' y='0' width='2' height='2'/><rect x='34' y='20' width='2' height='2'/><rect x='34' y='22' width='2' height='2'/><rect x='36' y='0' width='2' height='2'/><rect x='36' y='2' width='2' height='2'/><rect x='36' y='4' width='2' height='2'/><rect x='36' y='16' width='2' height='2'/><rect x='36' y='18' width='2' height='2'/><rect x='36' y='20' width='2' height='2'/><rect x='38' y='6' width='2' height='2'/><rect x='38' y='8' width='2' height='2'/><rect x='38' y='10' width='2' height='2'/><rect x='38' y='12' width='2' height='2'/><rect x='38' y='14' width='2' height='2'/></g><g class='f f4'><rect x='8' y='6' width='2' height='2'/><rect x='8' y='8' width='2' height='2'/><rect x='8' y='10' width='2' height='2'/><rect x='8' y='12' width='2' height='2'/><rect x='8' y='14' width='2' height='2'/><rect x='10' y='2' width='2' height='2'/><rect x='10' y='4' width='2' height='2'/><rect x='10' y='6' width='2' height='2'/><rect x='10' y='14' width='2' height='2'/><rect x='10' y='16' width='2' height='2'/><rect x='10' y='18' width='2' height='2'/><rect x='14' y='6' width='2' height='2'/><rect x='14' y='8' width='2' height='2'/><rect x='14' y='10' width='2' height='2'/><rect x='14' y='12' width='2' height='2'/><rect x='14' y='14' width='2' height='2'/><rect x='16' y='6' width='2' height='2'/><rect x='16' y='14' width='2' height='2'/><rect x='20' y='10' width='2' height='2'/><rect x='24' y='6' width='2' height='2'/><rect x='24' y='14' width='2' height='2'/><rect x='26' y='6' width='2' height='2'/><rect x='26' y='8' width='2' height='2'/><rect x='26' y='10' width='2' height='2'/><rect x='26' y='12' width='2' height='2'/><rect x='26' y='14' width='2' height='2'/><rect x='30' y='2' width='2' height='2'/><rect x='30' y='4' width='2' height='2'/><rect x='30' y='6' width='2' height='2'/><rect x='30' y='14' width='2' height='2'/><rect x='30' y='16' width='2' height='2'/><rect x='30' y='18' width='2' height='2'/><rect x='32' y='6' width='2' height='2'/><rect x='32' y='8' width='2' height='2'/><rect x='32' y='10' width='2' height='2'/><rect x='32' y='12' width='2' height='2'/><rect x='32' y='14' width='2' height='2'/></g></svg></div>`;
const listenHTML=(t)=>(t||'듣고 있어…')+LFX;
const canRecord=!!(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia&&window.MediaRecorder);
const recMime=()=>{for(const m of ['audio/mp4','audio/webm;codecs=opus','audio/webm','audio/ogg'])try{if(MediaRecorder.isTypeSupported(m))return m;}catch(e){}return '';};
let REC=null;   // {stream,mr,chunks,t0,ready,dead}
/* before the mic opens: every sound off and the audio context suspended (sound while the mic is open is what locks iOS on the quiet route) */
async function hushForMic(){MICOPEN=true;try{const as=navigator.audioSession;if(as)as.type='play-and-record';}catch(e){}try{BGM.stop();}catch(e){}
  try{if(SFXOUT&&AC)SFXOUT.gain.setValueAtTime(0,AC.currentTime);}catch(e){}
  try{if(AC&&AC.state==='running')await Promise.race([AC.suspend(),sleep(250)]);}catch(e){}}
/* after the mic closes: nothing plays now; the next touch builds a fresh context on the normal speaker route */
function afterMic(){MICOPEN=false;acStale=true;ambientSession();}
function killRec(r){if(!r)return;r.dead=true;try{if(r.mr&&r.mr.state!=='inactive')r.mr.stop();}catch(e){}try{r.stream&&r.stream.getTracks().forEach(t=>t.stop());}catch(e){}}
function listen(){if(!canRecord)return false;
  if(REC){killRec(REC);REC=null;}
  const r={chunks:[],t0:0,ready:null,dead:false,err:''};REC=r;
  r.ready=(async()=>{await hushForMic();if(r.dead)return;
    try{r.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});}
    catch(e){r.err=(e&&e.name==='NotAllowedError')?'deny':'fail:'+((e&&e.name)||'');return;}
    if(r.dead){killRec(r);return;}
    const m=recMime();try{r.mr=new MediaRecorder(r.stream,m?{mimeType:m}:undefined);}catch(e){r.mr=new MediaRecorder(r.stream);}
    r.mime=(r.mr.mimeType||m||'audio/mp4').split(';')[0];
    r.mr.ondataavailable=e=>{if(e.data&&e.data.size)r.chunks.push(e.data);};
    r.mr.start();r.t0=Date.now();})();
  say(listenHTML(),{cursor:false});return true;}
function abortListen(){const was=!!REC||MICOPEN;if(REC){killRec(REC);REC=null;}if(was)afterMic();}
/* finger up: stop and hand back {blob,mime,ms} or {err} */
async function stopListen(){const r=REC;REC=null;if(!r){afterMic();return {err:'none'};}
  await Promise.race([r.ready,sleep(4000)]);
  if(r.err||!r.mr){killRec(r);afterMic();return {err:r.err||'fail'};}
  const ms=Date.now()-r.t0;
  const blob=await new Promise(res=>{let done=false;const fin=()=>{if(done)return;done=true;res(new Blob(r.chunks,{type:r.mime}));};
    r.mr.onstop=()=>setTimeout(fin,30);
    try{r.mr.state!=='inactive'?r.mr.stop():fin();}catch(e){fin();}setTimeout(fin,2500);});
  try{r.stream.getTracks().forEach(t=>t.stop());}catch(e){}
  afterMic();return {blob,mime:r.mime,ms};}
const b64=blob=>new Promise((res,rej)=>{const fr=new FileReader();fr.onload=()=>res(String(fr.result).split(',')[1]||'');fr.onerror=rej;fr.readAsDataURL(blob);});
/* Gemini hears the clip: tidies what was said and says whether it's a command or a request */
async function hearClip(clip){
  if(DB.settings.key.trim().toLowerCase()==='demo'){await sleep(500);return {intent:'request',text:'저녁 먹고 시부야에서 놀 거리'};}
  const data=await b64(clip.blob);
  const prompt=`이 녹음은 여행 추천 앱 사용자가 화면을 누른 채 한국어(가끔 지명·가게 이름은 외국어)로 말한 거야.
1) 말한 내용을 정확히 받아 적고, 군말("어", "음", 말 더듬기)과 중복만 걷어내 자연스러운 한 문장으로 다듬어. 뜻을 바꾸거나 내용을 지어내지 마. 지명·가게 이름은 들린 대로 적어.
2) 무엇인지 하나 골라:
- "music_off": 배경음악/음악을 꺼 달라는 말
- "music_on": 배경음악/음악을 켜(틀어) 달라는 말
- "retaste": 취향을 다시 정하겠다는 말
- "rename": 내 이름을 바꾸겠다는 말
- "request": 그 밖의 놀 거리·먹을 곳·갈 곳 같은 추천 요청
- "none": 말소리가 없거나 알아들을 수 없음
설명 없이 JSON만: {"text":"다듬은 문장","intent":"위 중 하나"}`;
  const ask=mime=>gemini(prompt,null,{tag:'voice',tools:false,timeout:25000,parts:[{inlineData:{mimeType:mime,data}}],
    config:{responseMimeType:'application/json',temperature:0}});
  let res;try{res=await ask(clip.mime);}catch(e){if(/mime|unsupported|400/i.test(e.message)&&clip.mime!=='audio/aac')res=await ask(clip.mime==='audio/mp4'?'audio/aac':'audio/ogg');else throw e;}
  let j={};try{j=JSON.parse(res.text.replace(/^```(?:json)?|```$/g,'').trim());}catch(e){const m=res.text.match(/\{[\s\S]*\}/);try{j=m?JSON.parse(m[0]):{};}catch(e2){}}
  return {text:String(j.text||'').trim(),intent:String(j.intent||'').trim()};}
const MISHEARD=()=>'어… 잘 못 들었어.<br>꾹 누른 채로 다시 말해줄래?';
async function handleClip(clip){
  if(clip.err==='deny'){S.mode='idle';say('마이크를 못 쓰게 돼 있어.<div class="hint">아이폰 설정 › Safari(또는 이 앱) › 마이크를 허용해줘.</div>');return;}
  if(clip.err){S.mode='idle';say(MISHEARD('mic-'+clip.err));return;}
  if(!clip.blob||clip.blob.size<1200||clip.ms<350){S.mode='idle';say('너무 짧았어.<br>꾹 누른 채로 말하고, 다 말한 다음에 손을 떼줘.');return;}
  say('음… 잠깐만.',{cursor:false});
  let h;try{h=await hearClip(clip);}catch(e){S.mode='idle';say(esc(e.message||'못 알아들었어.'));return;}
  if(!h.text||h.intent==='none'){S.mode='idle';say(MISHEARD((h.intent||'empty')+' '+Math.round(clip.blob.size/1024)+'KB '+(clip.ms/1000).toFixed(1)+'s '+clip.mime));return;}
  gotText(h.text,h.intent);}
function typedIntent(t){if(/(음악|배경음|bgm)/i.test(t)&&/(꺼|끄|멈|그만|조용)/.test(t))return 'music_off';if(/(음악|배경음|bgm)/i.test(t)&&/(켜|틀|다시)/.test(t))return 'music_on';
  if(/취향/.test(t)&&/(다시|새로|바꿀|정할)/.test(t))return 'retaste';if(/이름/.test(t)&&/(바꿔|바꿀|바꾸|다시|새로)/.test(t))return 'rename';return 'request';}
function typeInput(msg){S.mode='typing';
  say(esc(msg||'하고 싶은 걸 적어줘.')+'<input id="tin" enterkeyhint="done" placeholder="저녁 먹고 시부야에서 놀 거리"><div class="choices"><button class="choice sel" id="tok">확인</button><button class="choice" id="tcancel">취소</button></div>',{cursor:false,active:true});
  const i=$('#tin');setTimeout(()=>i.focus(),50);
  const ok=()=>{SFX.btn();const v=i.value.trim();i.blur();if(v)gotText(v,typedIntent(v));else sayIdle();};
  $('#tok').onclick=ok;$('#tcancel').onclick=()=>{SFX.btn();i.blur();sayIdle();};i.onkeydown=e=>{if(e.key==='Enter')ok();};}

/* ---------- main touch: hold to talk / swipe up to room / tap Miyeon / tap the dialog box = chat ---------- */
(function(){let st=null,holdT=null,listening=false;
  const down=e=>{const chat=S.mode==='chat';
    if(S.mode==='locked'){audio();st={x:e.clientX,y:e.clientY,locked:true};holdT=null;listening=false;return;}
    if(!chat&&S.mode!=='idle')return;audio();
    st={x:e.clientX,y:e.clientY,dlg:e.currentTarget===dlgWrap,chat,choice:!!e.target.closest('.choice')};listening=false;
    if(!chat){charEl.classList.add('pressed');SFX.touch();}
    /* hold = talk. During a chat (anywhere, even on the box or a choice) it ends the chat and goes to recommendations */
    holdT=setTimeout(()=>{holdT=null;if(!st)return;
      if(st.chat){if(S.mode!=='chat')return;leaveChat();charEl.classList.add('pressed');SFX.touch();}
      listening=listen();
      if(listening&&st.chat)say(listenHTML('응? 어디 가고 싶은데? 말해봐.'),{cursor:false});
      if(!listening){st=null;charEl.classList.remove('pressed');typeInput();}},chat?350:220);};
  const move=e=>{if(!st||listening||st.chat)return;const dy=e.clientY-st.y;
    if(dy<-170){clearTimeout(holdT);holdT=null;st=null;charEl.classList.remove('pressed');toRoom();}};
  const up=async e=>{if(!st)return;const p=st;clearTimeout(holdT);st=null;charEl.classList.remove('pressed');
    if(p.locked){if(e.type==='pointerup'&&S.mode==='locked'){SFX.touch();shun();}return;}
    if(holdT===null&&listening){listening=false;S.mode='busy';const clip=await stopListen();await handleClip(clip);}
    else if(p.chat){if(S.mode==='chat'&&e.type==='pointerup'){if(!p.dlg)endChat();else if(!p.choice)chatTap();}}
    else if(S.mode==='idle'&&e.type==='pointerup'){if(p.dlg)startChat();
      else if(!charTapped(p.x,p.y))say('화면을 <span class="q">꾹 누른 채로</span> 말해줘.<div class="hint">위로 밀면 보관함으로 가.</div>');}
    holdT=null;};
  [$('#touch'),dlgWrap].forEach(el=>{el.addEventListener('pointerdown',down);el.addEventListener('pointermove',move);
    el.addEventListener('pointerup',up);el.addEventListener('pointercancel',up);});
})();

function gotText(txt,intent){
  const it=intent||'request';
  if(it==='music_off'){DB.settings.music=false;save();BGM.stop();ambientSession();say('음악 껐어.<div class="hint">"음악 켜줘"라고 하면 다시 틀게.</div>');S.mode='idle';return;}
  if(it==='music_on'){DB.settings.music=true;save();ambientSession();music();say('음악 다시 틀었어.');S.mode='idle';return;}
  if(it==='retaste'){startTutorial();return;}
  if(it==='rename'){askName(sayIdle,'이름 바꾸고 싶어? 뭐라고 불러줄까?');return;}
  S.mode='confirm';
  say(`<span class="q">“${esc(txt)}”</span><br>이거 맞지?`,{choices:[{label:'네',fn:()=>startSearch(txt)},{label:'아니요',fn:()=>{S.mode='idle';say('앗, 다시 말해줘.<br>화면을 꾹 누른 채로.');}}]});
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
      DB.lastLoc=l;save();res(l);try{dayNight(false);}catch(e){}},
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
- 되도록 지금 영업 중인 곳 위주로. Google 지도에서 확인되지 않거나 폐업한 곳은 빼라. hours는 Google 지도에 나온 오늘 요일의 영업시간 그대로.
- 해외라면 현지인이 실제로 가는 곳을 우선.
- 코스나 일정이 아니라 서로 독립적인 '할 거리'.
- kind "taste" ${nT}개: 취향에 잘 맞는 곳. kind "random" ${nR}개: 평소 취향과 반대 결의 의외인 곳(그래도 근처에서 지금 가능).
- line1·line2는 존댓말 말고 짧은 반말이나 명사형으로.
- mapsTitle은 Google 지도에 등록된 이름을 글자 그대로(현지어 그대로) 적어라. address는 Google 지도의 주소 그대로.
출력은 설명 없이 JSON 배열만:
[{"name":"한국어 표시 이름","mapsTitle":"Google 지도 등록 이름 그대로","address":"Google 지도 주소 그대로","line1":"한 줄 설명 18자 안팎","line2":"한 줄 설명 20자 안팎","kind":"taste 또는 random","category":"${CATS} 중 하나","lat":0.0,"lng":0.0,"hours":"오늘 영업시간을 HH:MM-HH:MM 형식으로(구간이 여러 개면 쉼표로, 자정 넘으면 예: 18:00-02:00), 24시간이면 24시간, 오늘 휴무면 휴무, 모르면 빈 문자열","open":true,"tags":["현금만","흡연 가능","예약 필요" 같은 주의사항, 최대 3개, 없으면 빈 배열],"area":"지역명 예: 서울 용산"}]`;}
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
/* token usage log (per feature) — shown at the bottom of settings */
const USAGE_TAGS={card:'카드 추천',chat:'대화',voice:'음성',etc:'기타'};
function logUsage(tag,u,grounded){if(!u)return;try{const U=DB.usage||(DB.usage={since:Date.now(),rows:{}});const k=USAGE_TAGS[tag]?tag:'etc';
  const r=U.rows[k]||(U.rows[k]={n:0,inp:0,think:0,out:0,maps:0});r.n++;r.inp+=(u.promptTokenCount||0)+(u.toolUsePromptTokenCount||0);
  r.think+=u.thoughtsTokenCount||0;r.out+=u.candidatesTokenCount||0;if(grounded)r.maps++;save();}catch(e){}}
/* won estimate from the user's own bill (3.5 flash-lite): output incl. thinking ≈ ₩3.4 / 1k, input ≈ ₩0.41 / 1k */
const wonOf=r=>Math.round((r.think+r.out)*0.0034+r.inp*0.00041);
function usageHTML(){const U=DB.usage;const ks=U?Object.keys(USAGE_TAGS).filter(k=>U.rows[k]):[];
  if(!ks.length)return '<div class="small">아직 기록 없음</div>';
  const f=n=>n.toLocaleString('ko-KR');let T={n:0,inp:0,think:0,out:0,maps:0};ks.forEach(k=>{for(const x in T)T[x]+=U.rows[k][x];});
  const row=(name,r,b)=>`<tr${b?' style="color:var(--yel)"':''}><td>${name}</td><td>${f(r.n)}</td><td>${f(r.inp)}</td><td>${f(r.think)}</td><td>${f(r.out)}</td><td>₩${f(wonOf(r))}</td></tr>`;
  return `<div class="small" style="margin-bottom:6px">${new Date(U.since).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}부터 · 금액은 대략</div>
  <table class="usage"><tr><th></th><th>호출</th><th>입력</th><th>생각</th><th>답</th><th>추정</th></tr>${ks.map(k=>row(USAGE_TAGS[k],U.rows[k])).join('')}${row('합계',T,true)}</table>`;}
/* tools=false → plain call (no grounding, no Maps fee) */
async function gemini(prompt,loc,opt={}){
  const st=DB.settings;const model=(st.model||DEFAULT_MODEL).trim();
  const url=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(st.key.trim())}`;
  const ll=loc?{retrievalConfig:{latLng:{latitude:loc.lat,longitude:loc.lng}}}:null;
  const sets=opt.tools===false?[{tools:null,tc:null}]:[{tools:[{googleMaps:{}}],tc:ll},{tools:[{googleMaps:{}}],tc:null},{tools:[{googleMaps:{}},{googleSearch:{}}],tc:ll}];
  let lastErr='',lastStatus=0,timeouts=0;
  for(const set of sets){
    const body={contents:[{role:'user',parts:[{text:prompt},...(opt.parts||[])]}]};if(opt.config)body.generationConfig=opt.config;if(set.tools)body.tools=set.tools;if(set.tc)body.toolConfig=set.tc;
    for(let attempt=0;attempt<2;attempt++){
      let r;try{r=await post(url,body,opt.timeout||45000);}
      catch(e){if(e.name==='AbortError'){timeouts++;if(timeouts>=2)throw new Error('구글 응답이 너무 늦어. 잠깐 있다 다시 하거나 더 빠른 모델(lite)로 바꿔봐.');continue;}
        lastErr='net';await sleep(1200);continue;}
      if(r.ok){const j=await r.json();logUsage(opt.tag,j.usageMetadata,!!set.tools);const c=j.candidates?.[0]||{};const gm=c.groundingMetadata||{};
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
[{"i":0,"title":"목록의 이름 그대로","name":"한국어 표시 이름","address":"Google 지도 주소","line1":"18자 안팎","line2":"20자 안팎","kind":"taste 또는 random","category":"${CATS} 중 하나","lat":0.0,"lng":0.0,"hours":"오늘 영업시간을 HH:MM-HH:MM 형식으로(구간이 여러 개면 쉼표로, 자정 넘으면 예: 18:00-02:00), 24시간이면 24시간, 오늘 휴무면 휴무, 모르면 빈 문자열","open":true,"tags":[],"area":"지역명 예: 서울 용산"}]`;
  let arr=null;
  try{const r=await gemini(p,S.loc,{tag:'card',timeout:40000});arr=jsonArr(r.text);}catch(e){if(/한도|결제|API 키/.test(e.message))throw e;}
  if(!arr){const r=await gemini(p,null,{tag:'card',tools:false,timeout:30000});arr=jsonArr(r.text)||[];}
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
  let res=await gemini(buildPrompt(nT,nR),S.loc,{tag:'card'});
  const arr=jsonArr(res.text)||[];let left=[...res.chunks];
  for(const c of arr){if(!c||!c.name)continue;const ch=matchChunk(c,res);if(!ch||!sameKoPlace([c.name,c.mapsTitle],ch.title))continue;left=left.filter(x=>x!==ch);add(mkCard(c,ch));}
  DIAG=`모델 ${arr.length}곳 · 구글맵 확인 ${res.chunks.length}곳 · 일치 ${got.length}곳`;
  if(got.length<Math.min(6,want)&&left.length){setStage('확인된 곳 정리 중');try{(await describeChunks(left.slice(0,want-got.length),res.text,nR)).forEach(add);}catch(e){}}
  if(got.length<3){setStage('한 번 더 찾는 중');
    const r2=await gemini(naturalPrompt(want),S.loc,{tag:'card'});DIAG+=` / 재시도 확인 ${r2.chunks.length}곳`;
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
/* open now? computed from today's hours (device clock = local time while travelling). true / false / null (unknown) */
function openNow(c){const h=String(c.hours||'').trim();if(!h)return null;
  if(/24\s*시간|24\s*h|00:00\s*[-~–]\s*(24|00):00/i.test(h))return true;
  if(/휴무|휴업|定休|closed/i.test(h))return false;
  const now=new Date(),m=now.getHours()*60+now.getMinutes();let any=false;
  for(const r of h.matchAll(/(\d{1,2})[:시](\d{2})?\s*[-~–]\s*(\d{1,2})[:시](\d{2})?/g)){any=true;
    const a=(+r[1])*60+(+(r[2]||0));let b=(+r[3])*60+(+(r[4]||0));if(b<=a)b+=1440;
    if((m>=a&&m<b)||(m+1440>=a&&m+1440<b))return true;}
  return any?false:null;}
function cardHTML(c,extra=''){return `<div class="cw" data-id="${c.id}"><div class="under save">저장</div><div class="under pass">패스</div>
  <div class="card px${openNow(c)===false?' isclosed':''}" data-id="${c.id}">${PIN_SVG}<div class="t"><span>${esc(c.name)}</span>${c.kind==='random'?'<span class="odd">의외</span>':''}${openNow(c)===false?'<span class="closed">영업 종료</span>':''}</div>
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
  else stat(c,'skip',c.kind==='random'?0.3:1);   // swiped left = gone
  save();const n=takeFromQueue();if(n)S.cards.push(n);renderCards();
  if(S.queue.length<QUEUE_MIN||S.cards.length<CARD_SLOTS){S.emptyRefills=0;refill();}}
/* pull at list edges: top → onTop, bottom → onBottom */
function edgePull(listEl,onTop,onBottom){let y0=null,edge=null;
  listEl.addEventListener('touchstart',e=>{const atTop=listEl.scrollTop<=0,atBot=listEl.scrollTop+listEl.clientHeight>=listEl.scrollHeight-2;
    edge=atTop&&atBot?'both':atTop?'top':atBot?'bot':null;y0=edge?e.touches[0].clientY:null;},{passive:true});
  listEl.addEventListener('touchmove',e=>{if(y0==null)return;const dy=e.touches[0].clientY-y0;
    if(dy>220&&onTop&&(edge==='top'||edge==='both')){y0=null;onTop();}
    else if(dy<-220&&onBottom&&(edge==='bot'||edge==='both')){y0=null;onBottom();}},{passive:true});
  listEl.addEventListener('touchend',()=>{y0=null;},{passive:true});}
function cardsResume(){S.mode='cards';charEl.classList.add('gone');setTimeout(()=>charEl.classList.remove('front'),700);$('#dimmer').classList.remove('on');setTimeout(()=>showDlg(false),10);}
edgePull($('#cardList'),()=>{if(S.mode!=='cards')return;SFX.btn();S.mode='clearConfirm';
  $('#dimmer').classList.add('on');charEl.classList.add('front');charEl.classList.remove('gone');showDlg(true);
  say('추천 카드 지울까?<div class="hint">오른쪽으로 밀어서 저장한 카드만 보관함에 남아.</div>',{choices:[{label:'네',fn:()=>backToIdle()},{label:'아니요',fn:cardsResume}]});});

/* route confirm (main, with Miyeon) */
$('#routeBtn').onclick=()=>{if(!S.pins.length)return;SFX.btn();const pc=pinnedCards(S.cards,S.pins);S.mode='routeConfirm';
  $('#dimmer').classList.add('on');charEl.classList.add('front');charEl.classList.remove('gone');showDlg(true);
  say(`<span class="q">${pc.map(c=>esc(c.name)).join(', ')}</span><br>이 순서로 동선 짜볼까?`,{choices:[
    {label:'네',fn:()=>openRoute(pc,'cards',S.req)},
    {label:'아니요',fn:cardsResume}]});};

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
  ov.innerHTML=`<div class="win px solid"><h3>${esc(c.name)}</h3>${placeTitle(c)&&norm(placeTitle(c))!==norm(c.name)?`<div class="sub" style="margin-bottom:4px">${esc(placeTitle(c))}</div>`:''}
    <div class="sub">${esc(c.line1)}<br>${esc(c.line2)}</div><div class="sep"></div>
    ${(()=>{const o=openNow(c);return `<div class="row" style="color:${o===true?'#6ee696':o===false?'#ff9a8a':'#a0aacc'}">■ ${o===true?'영업 중':o===false?'영업 종료':'영업 시간 확인'}${c.hours?' · '+esc(c.hours):''}</div>`;})()}
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
    if(horiz){const edge=DB.routes.length<2;const x=edge?dx*0.22:dx*0.9;s.dx=dx;
      box.style.transform=`translateX(${x}px) rotate(${x/90}deg)`;box.style.opacity=String(1-Math.min(Math.abs(x)/500,.45));}
    else if(dy>220&&s.top&&Math.abs(dy)>Math.abs(dx)){s=null;closeRoute();}},{passive:true});
  box.addEventListener('touchend',()=>{if(!s)return;const dx=s.dx;s=null;if(!horiz)return;horiz=false;
    const dir=dx<0?1:-1,n=DB.routes.length,ni=(R.idx+dir+n)%n;   // wraps around: last → first, first → last
    if(Math.abs(dx)<60||n<2){box.style.transition='transform .28s cubic-bezier(.3,1.6,.5,1),opacity .2s';box.style.transform='';box.style.opacity='';
      return;}
    pageHist(ni,dir);},{passive:true});})();
let paging=false;
async function pageHist(ni,dir){if(paging||DB.routes.length<2)return;ni=(ni+DB.routes.length)%DB.routes.length;paging=true;const box=$('#rlist');SFX.swipe();
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
function renderRoom(){const L=$('#roomList');roomTab='saved';
  if(!DB.groups.length){L.innerHTML='<div class="empty">아직 저장한 곳이 없어.<br>추천 카드를 오른쪽으로 밀면 여기 모여.</div>';}
  else L.innerHTML=DB.groups.map(g=>`<div class="ghead"><div class="gq">“${esc(g.request)}”</div><div class="gm">${fmtDate(g.date)}${g.area?' · '+esc(g.area):''}</div></div>`+
    g.cards.map(c=>cardHTML(c).replace('<div class="under pass">패스</div>','<div class="under pass">삭제</div>')).join('')).join('');
  /* swipe left in the room = delete for good (no more 'passed cards' tab) */
  L.querySelectorAll('.cw').forEach(w=>{const c=allSaved().find(x=>x.id===w.dataset.id),card=w.querySelector('.card');
    gestures(w,card,{onTap:()=>roomPin(c,card),onLong:()=>openDetail(c),onLeft:()=>{const g=DB.groups.find(x=>x.cards.includes(c));
      g.cards=g.cards.filter(x=>x!==c);if(!g.cards.length)DB.groups=DB.groups.filter(x=>x!==g);roomPins=roomPins.filter(x=>x!==c.id);save();renderRoom();}});});
  L.insertAdjacentHTML('beforeend',`<div class="stest"><div class="note">호감도 테스트 · 지금 캐릭터(${esc(hn())}) 기준</div>
    <div class="minibtns"><button class="px" data-aff="4">호감 4</button><button class="px" data-aff="0">호감 0</button><button class="px" data-aff="+3">+3</button></div>
    <div class="minibtns"><button class="px" data-aff="show">선택지 점수 ${DB.settings.showAff?'ON':'OFF'}</button><button class="px" data-aff="sim">난이도 시뮬레이션</button></div></div>`);
  L.querySelectorAll('[data-aff]').forEach(b=>b.onclick=e=>{e.stopPropagation();SFX.btn();const A=affOf(),t=b.dataset.aff;
    if(t==='sim'){simChoices();return;}
    if(t==='show'){DB.settings.showAff=!DB.settings.showAff;save();b.textContent='선택지 점수 '+(DB.settings.showAff?'ON':'OFF');return;}
    A.v=t==='+3'?A.v+3:+t;A.acc=0;save();affDraw(A.v);toast(`${hn()} 호감도 ${A.v}`+(A.v===0&&!DB.locked?' · 나가면 화내고 떠나':''));});
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
$('#roomRouteBtn').onclick=()=>{SFX.btn();const pc=pinnedCards(allSaved(),roomPins);const ov=document.createElement('div');ov.className='overlay';
  const req=(DB.groups.find(g=>g.cards.includes(pc[0]))||{}).request||'';
  ov.innerHTML=`<div style="position:relative;width:100%;max-width:400px"><div class="tagname" style="background:var(--cream)">동선 짜기</div><div class="win px solid">
    ${pc.map((c,i)=>`<div class="row"><span style="color:var(--gold);margin-right:10px">${i+1}</span>${esc(c.name)}</div>`).join('')}
    <div class="row" style="margin-top:20px">이 순서로 동선 짜볼까?</div>
    <div class="btnrow"><button class="px gold" id="pyes" style="color:var(--bdark)">네</button><button class="px" id="pno" style="color:var(--beige)">아니요</button></div></div></div>`;
  $('#room').appendChild(ov);ov.querySelector('#pyes').onclick=()=>{ov.remove();openRoute(pc,'room',req);};ov.querySelector('#pno').onclick=()=>{SFX.btn();ov.remove();};};
edgePull($('#roomList'),()=>{if(!$('#room').classList.contains('hidden'))toMain();},()=>{if(!$('#room').classList.contains('hidden'))toRouteHistory();});

/* ---------- stepped transitions ---------- */
let fading=false;
async function stepFade(fromEl,dir,swap){if(fading)return;fading=true;const f=$('#fader');SFX.trans();const steps=[.25,.5,.75,1];
  for(let i=0;i<steps.length;i++){fromEl.style.transform=`translateY(${dir*(i+1)*1.25}%)`;f.style.opacity=steps[i];await sleep(80);}
  await sleep(180);fromEl.style.transform='';swap();for(const o of [.75,.5,.25,0]){f.style.opacity=o;await sleep(90);}fading=false;}
$('#roomSet').onclick=e=>{e.stopPropagation();if(S.mode!=='room')return;SFX.btn();openSettings('',true);};
function toRoom(){if(S.mode!=='idle'&&S.mode!=='locked')return;S.mode='room';roomTab='saved';roomPins=[];
  stepFade(mainEl,-1,()=>{mainEl.classList.add('hidden');$('#room').classList.remove('hidden');SCREEN='room';music();renderRoom();$('#roomList').scrollTop=0;});}
function toMain(){stepFade($('#room'),1,()=>{$('#room').classList.add('hidden');mainEl.classList.remove('hidden');SCREEN='main';music();S.mode='idle';showDlg(true);
  if(DB.locked)applyLocked();else if(affOf().v<=0)lockOut();else sayIdle();});}

/* ---------- settings ---------- */
async function placeLabel(l){if(!l)return '';
  try{const r=await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&accept-language=ko&lat=${l.lat}&lon=${l.lng}`);const j=await r.json();const a=j.address||{};
    const parts=[a.state||a.province||a.region,a.city||a.town||a.county,a.city_district||a.borough||a.district,a.suburb||a.quarter||a.neighbourhood||a.village];
    const out=[];parts.forEach(x=>{if(x&&!out.includes(x))out.push(x);});
    return out.join(' ')||(j.display_name||'').split(',').slice(0,3).reverse().join(' ').trim();}catch(e){return '';}}
function openSettings(msg,fromRoom){const prevMode=S.mode;S.mode='settings';const st=DB.settings;const ov=document.createElement('div');ov.className='overlay';ov.style.alignItems='flex-start';ov.style.overflowY='auto';
  let music=st.music!==false,heroSel=st.hero||'miyeon';
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
    <div class="sep"></div>
    <button class="chk ${music?'on':'off'}" id="sMusic" style="margin-top:0"><i></i>배경음악</button>
    <div class="sep"></div>
    <div class="row" style="margin-top:0">제미나이 사용량</div>
    <div id="sUsage">${usageHTML()}</div>
    <div class="minibtns"><button class="px" id="sUsageClr" style="color:var(--muted)">사용량 기록 지우기</button></div>
    <div class="sep"></div>
    <div class="minibtns"><button class="px" id="sReset" style="color:var(--muted)">초기화…</button></div>
    <div class="btnrow"><button class="px gold" id="sSave">저장</button><button class="px" id="sClose" style="color:var(--muted)">닫기</button></div>
    <div class="small" style="text-align:center;margin-top:12px">여행선배 v${VERSION}</div></div></div>`;
  $('#overlayHost').appendChild(ov);if(!fromRoom)showDlg(false);
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
  ov.querySelector('#sUsageClr').onclick=()=>{SFX.btn();DB.usage={since:Date.now(),rows:{}};save();ov.querySelector('#sUsage').innerHTML=usageHTML();};
  ov.querySelector('#sMusic').onclick=e=>{SFX.touch();music=!music;e.currentTarget.classList.toggle('on',music);e.currentTarget.classList.toggle('off',!music);};
  const keyIn=ov.querySelector('#sKey');
  ov.querySelector('#sPaste').onclick=async()=>{SFX.btn();let t='';
    try{if(navigator.clipboard&&navigator.clipboard.readText)t=await navigator.clipboard.readText();}catch(e){}
    if(t&&t.trim()){keyIn.type='text';keyIn.value=t.trim();setTimeout(()=>keyIn.type='password',1500);ov.querySelector('#sKeyHint').textContent='붙여넣었어. 저장 눌러줘.';}
    else{keyIn.type='text';keyIn.focus();keyIn.select();ov.querySelector('#sKeyHint').innerHTML='<span style="color:var(--yel)">입력칸을 길게 눌러서 "붙여넣기"를 골라줘.</span>';}};
  const close=()=>{ov.remove();if(fromRoom){S.mode=prevMode;return;}showDlg(true);if(!DB.settings.key.trim()){sayIdle();return;}
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
  say((DB.user.name?esc(voc())+', 이제':'안녕! 난 '+iya(hn())+'. 이제')+' 취향을 조금만 알려줘.<br>선배가 딱 맞게 골라줄게.',{choices:[{label:'시작하기',fn:()=>situ(0)},{label:'건너뛰기',fn:finishTut}]});}
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
const HERO_BASE=`사용자(후배)의 여행 선배야.
배경: 명문대에 다니는 여대생. 똑똑하고 아는 게 많아. 역사·지리·문화·언어 상식을 대화에 자연스럽게 섞고, 말이 논리적이고 재치 있어. 절대 멍청하거나 유치하게 말하지 마.
모에 포인트: 순수하고 남을 먼저 배려해. 선배답게 의젓한 척하지만 생활 속에선 살짝 허당이야(길치, 덤벙대다 뭘 떨어뜨림, 자신만만하게 말했다가 사소한 디테일을 헷갈림 정도). 지식 자체는 정확해.
자기가 예쁘고 인기 많다는 걸 전혀 몰라. 그래서 칭찬이나 설레는 말을 들으면 진심으로 당황하거나 엉뚱하게 받아들여(예: 자기 얘기가 아니라고 생각함). 사실은 후배에게 호감이 있지만 티 내지 않으려 해.
순수하고 착하지만, 후배가 놀리면 발끈할 때도 있어(투덜대거나 삐친 척하다가 금방 풀림).
말투: 항상 반말. 이모지·이모티콘 금지. "헤헤", "앗", "음…" 같은 말버릇은 가끔만.
대사 길이: 짧은 것(한 문장), 중간 것(두 문장), 긴 것(서너 문장)을 섞어. 앞 대사들과 길이가 겹치지 않게 바꿔가. 길게 말할 땐 line에 앞부분, line2에 이어지는 말을 나눠 담아(각 90자 이내). 짧거나 중간이면 line2는 빈 문자열.
대화가 길어져도 같은 말·같은 화제를 되풀이하지 마. 화제는 자연스럽게 옮겨가도 되고, 질문만 하지 말고 자기 생각이나 이야기도 해.
여기서는 가벼운 수다만 해. 실제 가게나 장소 이름을 지어내지 마.`;
const PROTAG=`[후배(사용자, 남자) 선택지 규칙 — 반드시 지켜]
성격: 소심하고 착하지만 은근 장난기가 있어. 선배에게 호감이 있지만 선배가 자기를 좋아한다는 건 전혀 몰라.
말투: 선배에게 편한 존댓말(~요, ~어요, ~죠?). 극존대(~습니다, ~십니까)나 반말은 쓰지 마.
설레는 말은 절대 대놓고 하지 못해. 말끝을 흐리거나("…", "아, 그냥요"), 다른 핑계를 대면서 수줍게 돌려 말해.
장난은 소심하게 살짝 찌르는 정도. 다정한 말은 배려하지만 쭈뼛쭈뼛해.
좋은 예: "그 옷… 잘 어울리는 것 같아요", "선배, 지도 거꾸로 든 거 알아요?", "다리 아프면 좀 쉬어요. …저도 쉬고 싶었어요", "참새도 길 잃을 때 있을까요?"
금지: 작업 멘트·느끼한 말("니 얼굴이 지도잖아" 같은 것), 직설적인 외모 칭찬("오늘따라 예쁘네"), 리드하거나 능글맞은 말투, 반말.
특히 금지: 신체 접촉에 관한 말은 어떤 형태로도 쓰지 마(손 잡기·안기·업기·기대기·팔짱 등). 제안도, 질문도, 농담도 안 돼("손 잡아줄까요?", "제 손 잡으면 부끄러워요?" 같은 것). 선배가 부끄러워하는 걸 일부러 떠보거나 들이대는 말도 금지. 이 후배는 소심해서 그런 말을 꺼낼 엄두도 못 내.`;
function heroPrompt(){const h=hero();return `너는 여행 추천 앱 "여행선배"의 캐릭터 '${h.name}'이야. ${HERO_BASE}\n${h.trait}\n${PROTAG}`;}
/* 미즈키's Korean slips: the app rolls the dice (≈1 line in 5) so they stay rare and random */
function slipRule(){if((DB.settings.hero||'miyeon')!=='mizuki')return '';
  return Math.random()<0.2?'[이번 대사 특별 지시] 한국어를 딱 한 군데만 살짝 틀려: 조사 실수(예: "선배를"→"선배가"), 일본어가 튀어나옴(예: "아노…", "에?", "스고이… 아니, 대박!"), 일본어 직역 표현(예: "배가 비었어") 중 하나. 틀린 걸 스스로 알아채고 얼굴 빨개지며 부끄러워해(이때 mood는 "blush"). 과장하지 말고 자연스럽게.'
    :'[이번 대사] 한국어 실수 없이 자연스럽게 말해. 일본어 섞지 마.';}
/* who lets their feelings show, and how often (the app rolls the dice each turn)
   him: almost never (1 in 150). her: never below 60; 60+ 1 in 50, 75+ 1 in 10, 90+ 1 in 2 */
function loveRule(){const v=affOf().v,me=Math.random()<1/150;
  const p=v>=35?1/2:v>=28?1/10:v>=20?1/50:0,her=Math.random()<p;
  return [me?'[후배 선택지] 이번엔 선택지 중 딱 하나만, 후배가 선배를 좋아하는 마음이 아주 살짝 새어 나오는 말을 넣어(말끝 흐리며 바로 얼버무림).'
           :'[후배 선택지] 후배는 극도로 소심해서 선배를 좋아하는 티를 전혀 못 내. 설레는 말·칭찬으로 호감을 드러내는 선택지는 넣지 마.',
    her?`[${hn()}] 이번 대사에서는 후배에 대한 호감을 살짝 드러내(말하다 멈칫하거나, 무심코 진심이 새어 나왔다가 수습하는 정도).`
       :`[${hn()}] 이번 대사에서는 후배에 대한 호감을 드러내지 마(설렌 티, 좋아하는 티, 은근한 고백 금지). 평소의 선배로만 대해.`].join('\n');}
/* how each heroine takes the junior's last line — for the hidden affection judgment */
const AFF_TRAP={
  miyeon:'이미 부끄러워하는데 또 칭찬하기, 선배가 신나서 한 얘기를 시큰둥하게 넘기기, 선배 말을 무시하고 딴소리',
  sujeong:'과한 칭찬이나 아부, 쓸데없이 길고 들뜬 리액션, 뻔한 인사치레',
  mizuki:'다른 사람(특히 다른 여자) 얘기 꺼내기, 혼자 가겠다는 말, 미즈키의 한국어 실수를 지적하기'};
/* trap kinds per heroine — each turn a few are drawn at random, so no single topic becomes the tell */
const TRAP_POOL={
  miyeon:['이미 부끄러워하는데 칭찬을 또 하기','선배가 신나서 한 얘기를 시큰둥하게 넘기기','선배 말을 무시하고 딴소리','선배의 허당을 진지하게 지적하기','선배 대신 다 해주겠다고 나서기(선배 체면이 구겨짐)','들뜬 선배에게 피곤하다고 찬물 끼얹기','선배 얘기를 끊고 자기 얘기만 하기'],
  sujeong:['과한 칭찬이나 아부','쓸데없이 길고 들뜬 리액션','뻔한 인사치레','선배 말에 오버해서 감동하기','선배 기분을 꼬치꼬치 캐묻기','"선배는 쿨하잖아요" 식으로 선배를 단정하기','억지 애교'],
  mizuki:['혼자 있고 싶다는 말','미즈키의 한국어 실수를 지적하기','일본에 대한 뻔한 고정관념','미즈키 말을 건성으로 흘려듣기','다음 약속을 애매하게 미루기','미즈키를 어린애 취급하기','다른 일정이 더 중요하다는 듯한 말']};
function trapKinds(n){const pool=(TRAP_POOL[DB.settings.hero||'miyeon']||TRAP_POOL.miyeon).slice(),out=[];
  while(out.length<n&&pool.length)out.push(pool.splice(Math.floor(Math.random()*pool.length),1)[0]);return out;}
const AFF_TASTE={
  miyeon:'잘 받아주는 장난, 허당을 귀엽게 감싸주는 말, 엉뚱한 말에 기뻐해. 놀려서 발끈하게 만들어도 결국 좋아해. 같은 칭찬이 반복되면 부끄러워서 도망가고 싶어 해(소폭 마이너스). 무시하거나 시큰둥하면 서운해.',
  sujeong:'담백한 말, 재치 있는 한마디, 진지하게 들어주는 태도를 좋아해. 아부나 과한 칭찬은 오히려 깎여. ',
  mizuki:'관심, 자기만 봐주는 느낌, 한국어 실수를 귀엽게 받아주는 말을 좋아해. 실수를 놀리면 발끈하지만 장난이 귀여우면 오를 수도 있어.'};
/* her hidden mood of the day (one per heroine, re-rolled each local day) — it bends what she likes today */
const MOODS={
  good:'기분 좋은 날. 장난이나 놀림도 웃으며 받아주고(평소보다 +), 엉뚱한 말도 즐거워해. 너무 조심스럽고 딱딱한 말은 김빠져 해(소폭 -).',
  touchy:'예민한 날. 놀림이나 장난은 평소보다 훨씬 거슬려(-), 툭 던지는 말도 서운해해. 조용히 챙겨주고 배려하는 말엔 크게 누그러져(+).',
  bored:'심심한 날. 엉뚱하거나 신선한 말에 확 반응해(+). 무난한 맞장구나 뻔한 말엔 시큰둥해(0 또는 소폭 -).',
  tired:'피곤한 날. 걱정해주거나 쉬자는 말이 제일 반가워(+). 텐션 높은 장난이나 질문 공세는 버거워해(-).'};
const MOOD_TONE={good:'평소보다 말이 많고 잘 웃어',touchy:'말끝이 살짝 날카롭거나 짧아',bored:'하품하듯 늘어지거나 뭔가 재밌는 거 없나 두리번거려',tired:'말이 조금 느리고 기운이 없어'};
function todayMood(k){const d=new Date(),day=d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate();
  if(!DB.moods||DB.moods.day!==day){const ks=Object.keys(MOODS);DB.moods={day,m:{}};Object.keys(HEROES).forEach(h=>DB.moods.m[h]=ks[Math.floor(Math.random()*ks.length)]);save();}
  return DB.moods.m[k]||'good';}
function coldRule(k){if(SIM)return '';k=k||DB.settings.hero||'miyeon';const v=(DB.aff&&DB.aff[k]||{v:AFF_START}).v,nm=HEROES[k].name;
  const a=v<=4?`[지금 ${nm}의 마음] 후배에게 많이 실망해서 차가워졌어. 말이 짧고 퉁명스럽고 거리를 둬(성격대로). 그래도 대화는 이어가.`:'';
  const b=(DB.talks||0)<=2?`[관계] 후배와는 막 알게 된 사이야. 아직 서로 잘 몰라서 처음 만난 사람처럼 살짝 어색하고 조심스럽게 대해.`:'';
  return [a,b].filter(Boolean).join('\n');}
let SIM=null;   // choice-score simulation in progress: {mood}
function moodRule(){const m=SIM?SIM.mood:todayMood(DB.settings.hero||'miyeon');
  return `[오늘 ${hn()}의 속기분 — 절대 직접 말하지 말 것(기분 이름·"오늘 예민해" 같은 말 금지). 말투에만 은근히 묻어나게: ${MOOD_TONE[m]}] ${MOODS[m]}`;}
/* the same kind of answer over and over wears thin: 3 in a row → it backfires */
const KINDS=['tease','kind','agree','odd'];let PICKED=[];
function affPreview(c){let n=1;for(let i=PICKED.length-1;i>=0&&PICKED[i]===c.k;i--)n++;let a=c.aff;if(c.k&&n>=3)a=Math.min(a,-0.15);
  a=Math.max(-0.3,Math.min(0.3,a))*AFF_SCALE;return a<0?a*AFF_DOWN:a*AFF_UP;}
function streakAff(c){PICKED=[...PICKED,c.k||'?'].slice(-6);let n=0;for(let i=PICKED.length-1;i>=0&&PICKED[i]===PICKED[PICKED.length-1];i--)n++;
  if(c.k==null||c.k==='?')return c.aff;
  if(n>=3)return Math.min(c.aff,-0.15);return c.aff;}
function nameRule(){const n=DB.user.name;return n?`후배 이름은 "${n}". 대화 중에 가끔(매번은 말고) 이름으로 불러. 부를 때는 "${voc()}"처럼.`:'후배 이름은 몰라. 부를 일이 있으면 "후배"라고만.';}
const CHAT_TOPICS=['오늘 날씨','배고픔이나 간식','오늘 얼마나 걸었는지','여행 사진','길을 헤맨 이야기','여행 짐','현지 말 한마디','기념품','피곤함과 잠','다음에 가고 싶은 곳','편의점','지도 보는 법','신발과 발','여행 중 작은 행운','선배가 요즘 빠져 있는 것'];
/* she can wrap up only after 3+ answers, then 10% chance each turn (avg ~12 answers), always by 30 */
const CHAT_MIN=3,CHAT_P=0.1,CHAT_CAP=30;
const chatShouldEnd=n=>n>=CHAT_CAP||(n>=CHAT_MIN&&Math.random()<CHAT_P);
const C={hist:[],picks:0,gen:0,typing:null,ended:false,busy:false};
function chatCtx(){const now=new Date();const loc=(manualLoc()||DB.lastLoc||{}).label||'';
  const g=DB.groups[0],r=DB.routes[0];
  return [`현지 시각: ${now.toLocaleString('ko-KR',{weekday:'short',hour:'numeric',minute:'2-digit'})}`,
    loc?`지금 있는 곳: ${loc}`:'',g?`후배가 최근 앱에 한 요청: "${g.request}"`:'',
    r?`최근에 짠 동선: ${r.items.map(c=>c.name).join(', ')}`:''].filter(Boolean).join('\n');}
function chatPrompt(final,bye){const first=!C.hist.length;
  const log=C.hist.map(h=>(h.who==='m'?hn()+': ':'후배: ')+h.text).join('\n');
  if(!DB.chat)DB.chat={recent:[]};
  return `${heroPrompt()}
${nameRule()}
[상황]
${chatCtx()}
${first?`[이번 대화 주제 힌트] ${CHAT_TOPICS[Math.floor(Math.random()*CHAT_TOPICS.length)]} (자연스럽게, 억지로 맞추지 않아도 됨)
[최근에 했던 첫마디 — 겹치지 않게] ${DB.chat.recent.join(' / ')||'없음'}`:`[지금까지 대화]\n${log}`}
${C.noisy?`[방금 일어난 일] 둘이 너무 떠들었는지, 골목 건너편 건물 창문에서 런닝셔츠 차림의 아저씨가 몸을 쑥 내밀고 시끄럽다며 허공에 주먹을 몇 번 휘두르고 들어갔어. 이번 대사는 먼저 그 일에 ${hn()}의 성격대로 반응해(예: "우, 우리가 너무 시끄러웠나?" 같은 느낌 — 그대로 베끼지 말고 자기 말투로, 목소리를 낮추거나 웃음을 참는 등). 그다음 후배가 한 말에 이어서 대화를 계속해.
`:''}[할 일] ${first?hn()+'(이)가 후배에게 먼저 말을 걸어.':'후배가 방금 한 말에 '+hn()+'(이)가 반응해.'}${bye?' '+byeTask(bye)+' choices는 빈 배열, end는 true.':final?' 이번 대사로 대화를 자연스럽게 마무리해. 갑자기 끊지 말고 방금 대화를 이어받아서, 상황에 맞는 한마디로 끝맺어(예: 다음을 기약하는 말, 할 일이 생각난 척 등). choices는 빈 배열, end는 true.':` 그리고 후배가 고를 대답 선택지를 3~4개 만들어. end는 false. 선택지는 후배가 선배에게 하는 말, 각 20자 이내, 위의 후배 선택지 규칙대로(편한 존댓말). 서로 결이 다르게: 다정하거나 걱정해주는 말, 선배를 살짝 놀리는 말, 맞장구나 질문, 엉뚱한 말. 그리고 그중 ${C.traps}개는 ${hn()}의 성격과 오늘 기분상 은근히 싫어할 만한 '함정' 대답으로 섞어(겉보기엔 평범하고 착해 보이게, 함정이라고 티 내지 말고, 순서는 랜덤). 함정이 아닌 선택지가 최소 하나는 꼭 있어야 해${C.traps>=3?'(그래서 이번엔 선택지 4개)':C.traps===2?'(선택지 3~4개)':''}. 이번 함정 유형(함정마다 하나씩, 이것만 써): ${C.trapKinds.join(' / ')}.${(DB.settings.hero||'miyeon')==='mizuki'?' 미즈키 선택지에는 다른 사람(친구·다른 여자·다른 선배 등) 얘기를 절대 넣지 마. 너무 뻔해.':''} 함정은 소재만 봐서는 티 나지 않게 하고, 함정이 아닌 선택지에도 비슷한 소재를 섞어도 돼. 함정도 위의 후배 말투 규칙은 지켜.
[선택지 점수] (점수 폭은 캐릭터 상관없이 똑같이) 선택지를 만들면서 각각을 ${hn()}가 들었을 때의 속마음 호감 변화를 -0.3~0.3으로 미리 매겨 aff에 넣고, 함정에는 trap:true. 기준: ${AFF_TASTE[DB.settings.hero||'miyeon']||AFF_TASTE.miyeon} 함정은 반드시 -0.2~-0.3. 함정이 아닌 선택지 중 성격과 오늘 기분에 맞는 말은 +0.1~0.3(딱 맞으면 0.3), 무난한 말은 +0.05 정도. 같은 말이라도 오늘 기분에 따라 점수가 달라져야 해.
[선택지 결] 각 선택지에 k로 결을 붙여: 놀리거나 장난치는 말 "tease", 다정하거나 챙겨주는 말 "kind", 맞장구·질문 "agree", 엉뚱한 말 "odd".`}
${coldRule()}
${moodRule()}
${loveRule()}
${slipRule()}
mood: 칭찬이나 설레는 말에 당황하면 "blush", 허당 실수가 드러나거나 허둥대면 "fluster", 놀림받아 발끈하면 "huff", 기분 좋으면 "smile", 그 밖엔 "normal".
JSON 하나만 출력(아래는 형식 예시일 뿐, 내용은 지금 대화에 맞게 새로 써. choices의 t에는 후배가 실제로 할 말을 넣어):
{"line":"(${hn()}의 대사)","line2":"","mood":"normal","choices":[{"t":"다리 아프면 좀 쉬어요","aff":0.15,"trap":false,"k":"kind"},{"t":"선배, 지도 거꾸로 든 거 알아요?","aff":0.1,"trap":false,"k":"tease"},{"t":"아까 그 카페 사람 친절하던데요","aff":-0.25,"trap":true,"k":"agree"}],"end":false}`;}
const TOUCH_RE=/손\s*(을|이|좀)?\s*(잡|줘|내밀|주세|꼭)|잡아\s*줄|안아|업어|기대(도|요|세)|팔짱|어깨(를|에)\s*(빌|기대)|뽀뽀|키스|스킨십/;
const PLACEHOLDER_RE=/^\(?\s*(선택지|choice|대답|답변|후배의?\s*말)\s*[-_ ]?\s*\d*\s*\)?$|^\.{2,}$/i;
function chatParse(t){const a=t.indexOf('{'),b=t.lastIndexOf('}');if(a<0||b<a)return null;try{const v=JSON.parse(t.slice(a,b+1));
  if(!v||typeof v.line!=='string'||!v.line.trim())return null;
  v.line2=typeof v.line2==='string'?v.line2.trim():'';
  v.choices=Array.isArray(v.choices)?v.choices.map(x=>{if(x&&typeof x==='object'){const t=String(x.t||x.text||x.label||x.choice||x.content||x.value||'').trim(),trap=!!x.trap;let a=Number.isFinite(+x.aff)?+x.aff:0;if(trap)a=Math.min(a,-0.2);const k=KINDS.includes(x.k)?x.k:null;return {t,aff:a,trap,k};}
      return {t:String(x).trim(),aff:0,trap:false};}).filter(c=>c.t&&!PLACEHOLDER_RE.test(c.t)&&!TOUCH_RE.test(c.t)).slice(0,4):[];
  if(v.choices.length>1&&v.choices.every(c=>c.trap)){const b=v.choices.reduce((x,y)=>y.aff>x.aff?y:x);b.trap=false;b.aff=0.05;}   // always leave one safe answer
  return v;}catch(e){return null;}}
const DEMO_CHAT=[
  {line:'오늘 많이 걸었지? 보폭으로 대충 계산해 보면 2만 보는 넘었을걸. 선배 암산 정확하다?',mood:'smile',choices:['선배랑 다녀서 안 힘들었어요','그 암산… 검산해 봐도 돼요?','오늘… 사진 잘 나오겠네요. 아, 그냥요','다리에 바퀴 달고 싶어요']},
  {line:'에? 나, 나 말하는 거야? 뒤에 누구 있는 거 아니고?',mood:'blush',choices:['아, 아니 그게… 사진 얘기예요','뒤에 비둘기는 있어요','…네, 선배 말한 거예요']},
  {line:'헤헤, 아무튼 선배는 길 찾기 천재니까. 이 동네 골목은 에도 시대 길을 그대로 따라 나서 원래 구불구불하거든.',line2:'…어, 근데 여기 어디지?',mood:'fluster',choices:['제가 지도 볼까요?','천재… 맞죠?','같이 헤매는 것도 괜찮아요']},
  {line:'헤헤… 사실 아까부터 좀 헤맸어. 그래도 같이 걸어서 좋았어. 또 놀자!',mood:'smile',choices:[],end:true}];
async function chatAsk(final,bye){C.traps=1+Math.floor(Math.random()*3);C.trapKinds=trapKinds(C.traps);
  if(DB.settings.key.trim().toLowerCase()==='demo'){await sleep(500);const d=DEMO_CHAT[Math.min(C.picks,DEMO_CHAT.length-1)];const v=final||C.picks>=3?{...DEMO_CHAT[3]}:{...d};v.choices=(v.choices||[]).map(t=>({t,aff:0,trap:false}));return v;}
  const r=await gemini(chatPrompt(final,bye),null,{tag:'chat',tools:false,timeout:20000,config:{responseMimeType:'application/json',temperature:1.0}});
  let v=chatParse(r.text);
  if(v&&!final&&!bye&&v.choices.length<2){const r2=await gemini(chatPrompt(final),null,{tag:'chat',tools:false,timeout:20000,config:{responseMimeType:'application/json',temperature:1.0}});const v2=chatParse(r2.text);if(v2&&v2.choices.length>=2)v=v2;}
  if(!v)throw new Error('대답을 못 알아들었어');return v;}
function chatThink(meText){dlg.innerHTML=(meText?`<span class="me">“${esc(meText)}”</span>`:'')+'<span class="think"></span>';}
async function startChat(){
  if(!DB.settings.key.trim()){say('앗, API 키가 없으면 선배가 말을 못 해…<div class="hint">설정에서 키를 넣어줘.</div>');return;}
  dlgWrap.classList.add('big');
  DB.talks=(DB.talks||0)+1;save();
  S.mode='chat';C.gen++;C.hist=[];C.picks=0;C.ended=false;C.busy=false;if(window.BIRD)BIRD.scare();if(window.CAT)CAT.scare();
  chatThink('');await chatStep(false);}
async function chatStep(final,bye){const gen=C.gen;C.busy=true;
  let v;try{v=await chatAsk(final||!!bye,bye);}
  catch(e){if(gen!==C.gen)return;C.busy=false;
    chatShow({line:'앗… 무슨 말 하려고 했는지 까먹었어. 헤헤.',mood:'fluster',choices:[],end:true},esc(e.message||''));return;}
  if(C.noisy){const w=C.noisy;C.noisy=null;await w;}   // she reacts once he's back inside
  if(gen!==C.gen||S.mode!=='chat')return;C.busy=false;
  if(!C.hist.length){DB.chat=DB.chat||{recent:[]};DB.chat.recent=[v.line,...DB.chat.recent].slice(0,5);save();}
  C.hist.push({who:'m',text:v.line+(v.line2?' '+v.line2:'')});
  if(C.pendAff!=null){affJudge(C.pendAff);C.pendAff=null;}
  v.end=final||!!bye||v.choices.length<2;  // only we decide when it ends
  if(v.end)v.choices=[];if(bye)v.bye=true;chatShow(v);}
function chatMood(m){const img=$('#charImg');img.src=m==='blush'?hero().blush:hero().img;
  if(m==='fluster'||m==='huff'){charEl.classList.remove('fluster','huff');void charEl.offsetWidth;charEl.classList.add(m);}}
/* typewriter; tap the box to show the whole line at once */
function chatShow(v,errHint){chatMood(v.mood);const parts=[v.line.trim(),v.line2||''].filter(Boolean);let pi=0;
  const typeOne=()=>{const text=parts[pi],last=pi===parts.length-1;let i=0;
    dlg.innerHTML='<span class="tw"></span>';const sp=dlg.querySelector('.tw');C.more=null;
    const done=()=>{clearInterval(C.typing);C.typing=null;sp.textContent=text;
      if(C.byeNow&&!v.bye){dlg.insertAdjacentHTML('beforeend','<span class="cursor">▼</span>');C.more=()=>{C.more=null;C.byeNow=false;chatByeNow();};return;}
      if(!last){dlg.insertAdjacentHTML('beforeend','<span class="cursor">▼</span>');C.more=()=>{C.more=null;pi++;typeOne();};return;}
      if(v.choices.length){dlg.insertAdjacentHTML('beforeend','<div class="choices v">'+v.choices.map((c,k)=>`<button class="choice" data-k="${k}"><span class="k">${'abcd'[k]}.</span>${esc(c.t)}${DB.settings.showAff?(()=>{const x=affPreview(c);return `<span class="sc${x<0?' neg':''}">${x>=0?'+':''}${x.toFixed(2)}${c.trap?' 함정':''}${c.k?' '+({tease:'놀림',kind:'다정',agree:'맞장구',odd:'엉뚱'})[c.k]:''}</span>`;})():''}</button>`).join('')+'</div>');
        dlg.querySelectorAll('.choice').forEach(b=>b.onclick=e=>{e.stopPropagation();if(C.busy||S.mode!=='chat')return;b.classList.add('sel');SFX.btn();chatPick(v.choices[+b.dataset.k]);});}
      else if(v.bye){C.ended=false;C.byeReady=true;dlg.insertAdjacentHTML('beforeend','<span class="cursor">▼</span>');}
      else{C.ended=true;dlg.insertAdjacentHTML('beforeend',(errHint?`<div class="hint">${errHint}</div>`:'')+'<span class="cursor">▼</span>');}};
    C.finishTyping=done;
    C.typing=setInterval(()=>{i++;sp.textContent=text.slice(0,i);if(i%2)osc('square',740,740,0,0.018,0.018,0.02);if(i>=text.length)done();},38);};
  typeOne();}
/* night: once in every 10 picks (at a random one) the neighbor leans out of his window and shakes a fist at us */
const NOISY={n:0,at:0};
function noisyTurn(){const pos=NOISY.n%10;if(pos===0)NOISY.at=Math.floor(Math.random()*10);NOISY.n++;
  return pos===NOISY.at&&isNightNow()&&window.NEIGHBOR&&!NEIGHBOR.busy;}
function chatPick(c){const t=c.t;C.pendAff=streakAff(c);C.hist.push({who:'me',text:t});C.picks++;chatThink(t);
  const bye=C.leaveNext?'asked':Math.random()<1/30?'own':chatShouldEnd(C.picks)?'end':null;C.leaveNext=false;   // when she wraps up the talk, she leaves too
  C.noisy=null;if(!bye&&noisyTurn())C.noisy=sleep(450).then(()=>NEIGHBOR.show());
  chatStep(false,bye);}
function chatTap(){if(C.typing){C.finishTyping();return;}if(C.more){C.more();return;}if(C.byeReady){byeGo();return;}if(C.ended)endChat();}
function byeGo(){SFX.btn();leaveChat();swapHero();}
function chatByeNow(){C.leaveNext=false;chatThink('');chatStep(false,'now');}
function leaveChat(){C.gen++;C.noisy=null;C.pendAff=null;C.leaveNext=false;C.byeNow=false;C.byeReady=false;C.ended=false;C.busy=false;C.more=null;if(C.typing){clearInterval(C.typing);C.typing=null;}
  $('#charImg').src=hero().img;charEl.classList.remove('fluster','huff');dlgWrap.classList.remove('big');S.mode='idle';}
function endChat(){if(C.byeReady){byeGo();return;}leaveChat();SFX.btn();sayIdle();}

/* ---------- heroine swap (yellow hand, top right) ---------- */
const readMs=t=>Math.max(1600,700+String(t||'').length*70);
function byeTask(kind){if(kind==='now')return '후배가 손을 흔들며 오늘은 다른 선배랑 다니겠다는 뜻을 보였어. '+hn()+'(이)가 하던 말을 멈추고, 성격대로 작별 인사를 해(서운함·쿨함·질투 등 성격에 맞게, 과장 없이).';
  if(kind==='end')return '이제 대화를 마무리할 때야. 갑자기 끊지 말고 방금 후배가 한 말을 이어받아 자연스럽게 마무리하면서, '+hn()+'의 성격대로 작별 인사를 하고 떠나(다음을 기약하는 말, 할 일이 생각난 척 등).';
  return kind==='asked'
  ?'후배가 손을 흔들며 오늘은 다른 선배랑 다니겠다는 뜻을 보였어. 방금 후배가 한 말에 짧게 반응하면서, '+hn()+'의 성격대로 작별 인사를 해(서운함·쿨함·질투 등 성격에 맞게, 과장 없이).'
  :hn()+'(이)가 갑자기 가봐야 할 일이 생각났어. 방금 후배가 한 말에 짧게 반응하면서, 성격대로 자연스럽게 작별 인사를 하고 떠나.';}
const BYE_FALLBACK={miyeon:'앗, 나 가봐야 할 시간이다! 재밌게 다녀와, 또 봐!',sujeong:'그럼, 난 이만. 조심히 다녀.',mizuki:'…응, 알았어. 나중에 꼭 다시 불러줘야 해?'};
const HI_FALLBACK={miyeon:'어? 나 불렀어? 헤헤, 마침 심심했는데 잘됐다.',sujeong:'왔어? …같이 걷자.',mizuki:'에헤, 나 찾았어? 오늘은 나랑 다니는 거지?'};
function heroOnly(k){return `너는 여행 추천 앱 "여행선배"의 캐릭터 '${HEROES[k].name}'이야. ${HERO_BASE}\n${HEROES[k].trait}`;}
async function heroLine(k,task){const key=DB.settings.key.trim().toLowerCase();if(!key||key==='demo')return null;
  const p=`${heroOnly(k)}\n${nameRule()}\n${coldRule(k)}\n[상황]\n${chatCtx()}\n[할 일] ${task}\n한두 문장, 반말. JSON만: {"line":"대사","mood":"normal"}`;
  try{const r=await gemini(p,null,{tag:'chat',tools:false,timeout:15000,config:{responseMimeType:'application/json',temperature:1.0}});
    const a=r.text.indexOf('{'),b=r.text.lastIndexOf('}');const v=JSON.parse(r.text.slice(a,b+1));return v&&v.line?String(v.line).trim():null;}catch(e){return null;}}
let SWAPPING=false;
/* idle: she says goodbye herself, then the swap */
async function byeFromIdle(){if(SWAPPING||S.mode!=='idle')return;S.mode='swap';
  say('<span class="think"></span>',{cursor:false});
  const cur=DB.settings.hero||'miyeon';
  const line=(await heroLine(cur,'후배가 손을 흔들며 오늘은 다른 선배랑 다니겠다는 뜻을 보였어. '+HEROES[cur].name+'의 성격대로 작별 인사를 해(서운함·쿨함·질투 등 성격에 맞게, 과장 없이).'))||BYE_FALLBACK[cur];
  S.mode='byeWait';say(esc(line));}
/* shrink toward the lower right (70%), gap, fade the next one in, then her hello */
function swapHero(){if(SWAPPING)return;SWAPPING=true;S.mode='swap';
  const cur=DB.settings.hero||'miyeon',others=Object.keys(HEROES).filter(k=>k!==cur),next=others[Math.floor(Math.random()*others.length)];
  const hi=heroLine(next,HEROES[next].name+'(이)가 방금 후배와 만났어. 지금 시각과 장소에 어울리게, 성격대로 반갑게(혹은 성격대로) 인사해.');   // ask while she's leaving
  const img=$('#charImg'),done=async()=>{const line=(await hi)||HI_FALLBACK[next];SWAPPING=false;S.mode='idle';say(esc(line));};
  if(!img.animate){DB.settings.hero=next;save();DB.chat={recent:[]};applyHero();done();return;}
  img.style.transformOrigin='70% 70%';
  const out=img.animate([{transform:'scale(1)',opacity:1},{transform:'scale(0)',opacity:0}],{duration:1050,easing:'cubic-bezier(.5,0,.75,0)',fill:'forwards'});
  out.onfinish=()=>{img.style.opacity='0';out.cancel();img.style.transformOrigin='';
    DB.settings.hero=next;DB.chat={recent:[]};save();applyHero();say('<span class="think"></span>',{cursor:false});
    setTimeout(()=>{img.style.opacity='';const fin=img.animate([{opacity:0},{opacity:1}],{duration:1250,easing:'ease-out',fill:'backwards'});fin.onfinish=done;},500);};}
function waveHand(){const i=$('#swapBtn i');if(i&&i.animate)i.animate([{transform:'rotate(-20deg)'},{transform:'rotate(-38deg)',offset:.18},{transform:'rotate(-4deg)',offset:.42},{transform:'rotate(-32deg)',offset:.64},{transform:'rotate(-13deg)',offset:.84},{transform:'rotate(-20deg)'}],{duration:850,easing:'ease-in-out'});}
$('#swapBtn').addEventListener('pointerdown',e=>e.stopPropagation());
[$('#touch'),dlgWrap].forEach(el=>el.addEventListener('pointerup',()=>{if(S.mode==='byeWait'){SFX.btn();swapHero();}}));
/* blinking: once (sometimes twice) every 2.7~9s, never while blushing or swapping */
(function(){const img=$('#charImg');
  function blinkOnce(){const h=hero();if(!h.blink||SWAPPING||blushing||document.hidden||!img.src.endsWith(h.img))return;
    const dbl=Math.random()<1/6;img.src=h.blink;
    setTimeout(()=>{if(img.src.endsWith(h.blink))img.src=h.img;
      if(dbl)setTimeout(()=>{if(!img.src.endsWith(h.img))return;img.src=h.blink;setTimeout(()=>{if(img.src.endsWith(h.blink))img.src=h.img;},100);},130);},110);}
  const next=()=>setTimeout(()=>{blinkOnce();next();},(1800+Math.random()*4200+(Math.random()<0.15?3000:0))*1.5);
  next();})();
$('#swapBtn').onclick=e=>{e.stopPropagation();if(DB.locked){if(S.mode==='locked')potionTap();return;}if(SWAPPING)return;
  if(S.mode==='idle'){waveHand();SFX.btn();byeFromIdle();return;}
  if(S.mode==='chat'){if(C.leaveNext)return;waveHand();SFX.btn();
    if(C.byeReady||C.byeNow)return;
    if(C.ended){leaveChat();S.mode='idle';byeFromIdle();return;}   // the talk already ended — just say goodbye
    const choicesUp=!C.typing&&!C.busy&&!!dlg.querySelector('.choice');
    if(choicesUp){C.leaveNext=true;return;}   // pick an answer → she answers with her goodbye
    C.byeNow=true;                            // she's still talking → the next ▼ goes straight to her goodbye
    if(C.more){C.more=()=>{C.more=null;C.byeNow=false;chatByeNow();};}}};

/* ---------- affection 0: she storms off, the others won't talk to you either. Only the potion (rebirth) brings them back ---------- */
const ANGRY_FALLBACK={miyeon:'…진짜 너무해. 이제 너랑 안 놀 거야. 다시는 부르지 마!',sujeong:'…됐어. 여기까지야. 찾지 마.',mizuki:'…그래, 이제 알겠어. 나 혼자 착각했던 거구나. 잘 지내.'};
const SHUN={miyeon:['…얘기 들었어. 지금은 너랑 놀고 싶지 않아.','미안, 지금은… 아니야.','나한테도 그럴 거잖아. 싫어.'],
  sujeong:['…들었어. 할 말 없어.','지금은 안 돼.','…실망이야.'],
  mizuki:['그 애한테 그랬다며? …나한테도 그러겠지.','에… 지금은 말 걸지 마.','실망했어. 진짜로.']};
async function lockOut(){if(DB.locked)return;const cur=DB.settings.hero||'miyeon';DB.locked={by:cur};save();
  if(S.mode==='chat'){while(C.typing||C.busy)await sleep(200);await sleep(900);leaveChat();}
  else if(S.mode==='cards')backToIdle();
  S.mode='lockbye';showDlg(true);say('<span class="think"></span>',{cursor:false});
  const line=(await heroLine(cur,'후배에게 완전히 실망했어. '+HEROES[cur].name+'의 성격대로 화를 내며 이제 끝이라고 말하고 떠나(다시는 안 볼 것처럼, 짧게).'))||ANGRY_FALLBACK[cur];
  charEl.classList.remove('fluster','huff');void charEl.offsetWidth;charEl.classList.add('huff');
  S.mode='lockWait';say(esc(line));}
function lockGone(){S.mode='swap';const img=$('#charImg');
  if(!img.animate){applyLocked();return;}
  img.style.transformOrigin='70% 70%';
  const out=img.animate([{transform:'scale(1)',opacity:1},{transform:'scale(0)',opacity:0}],{duration:1050,easing:'cubic-bezier(.5,0,.75,0)',fill:'forwards'});
  out.onfinish=()=>{out.cancel();img.style.transformOrigin='';applyLocked();};}
function applyLocked(){S.mode='locked';$('#charImg').style.opacity='0';$('#heroName').style.visibility='hidden';$('#swapBtn').classList.add('potion');
  showDlg(true);say('…아무도 대답하지 않는다.',{cursor:false});}
let shunLast='';
function shun(){const by=DB.locked&&DB.locked.by,ks=Object.keys(HEROES).filter(k=>k!==by),k=ks[Math.floor(Math.random()*ks.length)];
  let l;do{l=SHUN[k][Math.floor(Math.random()*SHUN[k].length)];}while(l===shunLast&&SHUN[k].length>1);shunLast=l;
  const t=$('#heroName');t.textContent=HEROES[k].name;t.style.visibility='';say(esc(l),{cursor:false});}
[$('#touch'),dlgWrap].forEach(el=>el.addEventListener('pointerup',()=>{if(S.mode==='lockWait'){SFX.btn();lockGone();}}));
function potionTap(){const i=$('#swapBtn i');SFX.magic();
  if(i&&i.animate){const k=[];for(let f=0;f<=24;f++){const t=f/24*0.75;k.push({transform:`rotate(${(14*Math.exp(-t*5)*Math.sin(2*Math.PI*t*3.2)).toFixed(2)}deg)`});}i.animate(k,{duration:750});}
  if(document.querySelector('#rebirth'))return;
  setTimeout(()=>{const m=document.createElement('div');m.id='rebirth';
    m.innerHTML='<div class="dim"></div><div class="box px">취향만 남기고 다시 태어납니다.<div class="choices"><button class="choice" data-r="1">네</button><button class="choice" data-r="0">아니요</button></div></div>';
    mainEl.appendChild(m);
    m.querySelectorAll('[data-r]').forEach(b=>b.onclick=e=>{e.stopPropagation();SFX.btn();if(b.dataset.r==='1')rebirth();else m.remove();});
    m.addEventListener('pointerdown',e=>e.stopPropagation());},350);}
async function rebirth(){const f=$('#fader');f.style.background='#fff';f.style.transition='opacity .9s ease-in';void f.offsetWidth;f.style.opacity=1;await sleep(950);
  const ks=Object.keys(HEROES);
  Object.assign(DB,{user:{name:''},chat:{recent:[]},aff:{},affBase:3,moods:null,passed:[],locked:null,talks:0,reborn:1});   // saved cards and past routes stay
  DB.settings.hero=ks[Math.floor(Math.random()*ks.length)];save();await sleep(300);location.reload();}

/* ---------- sparrow visits (bird.js): every 1~2 min while you're just looking at the main screen ---------- */
/* chatting counts as idle time too: the timer keeps running and she can drop by (landing above the big box) */
function birdOk(){return (S.mode==='idle'||S.mode==='chat')&&SCREEN==='main'&&!mainEl.classList.contains('hidden')&&!document.hidden&&!REC&&!fading
  &&!$('#overlayHost').children.length&&!charEl.classList.contains('pressed');}
let birdT=null;
/* day: the sparrow, night: the cat — both also drop by during a chat */
const isNightNow=()=>mainEl.classList.contains('night');
function birdLater(ms){clearTimeout(birdT);birdT=setTimeout(()=>{
  if(isNightNow()){if(window.CAT&&birdOk()){CAT.visit();birdLater(60000+Math.random()*60000);}else birdLater(20000);return;}
  if(!window.BIRD)return;if(birdOk()){BIRD.visit({high:S.mode==='chat'});birdLater(60000+Math.random()*60000);}else birdLater(20000);},ms);}
birdLater(60000+Math.random()*60000);
setInterval(()=>{if(window.BIRD&&BIRD.busy&&!birdOk())BIRD.scare();},250);
setInterval(()=>{if(window.CAT&&CAT.busy&&!birdOk())CAT.scare();},250);
document.addEventListener('pointerdown',()=>{if(window.CAT&&CAT.busy&&S.mode!=='chat')CAT.scare();},{capture:true});  // like the sparrow: taps during a chat don't startle it
document.addEventListener('pointerdown',()=>{if(window.BIRD&&BIRD.busy&&S.mode!=='chat')BIRD.scare();},{capture:true});  // tapping choices doesn't startle her

/* ---------- your name (asked once; she calls you by it now and then) ---------- */
const hasBatchim=s=>{const c=String(s).charCodeAt(String(s).length-1);return c>=0xAC00&&c<=0xD7A3&&(c-0xAC00)%28!==0;};
const isHangul=s=>{const c=String(s).charCodeAt(String(s).length-1);return c>=0xAC00&&c<=0xD7A3;};
function voc(){const n=DB.user.name;if(!n)return '후배';return isHangul(n)?n+(hasBatchim(n)?'아':'야'):n;}
function askName(next,msg){S.mode='naming';showDlg(true);
  msg=msg||(DB.talks===0?'어… 처음 보는 얼굴이네? 안녕, 난 '+iya(hn())+'.<br>너는 이름이 뭐야?':DB.profile.done?'아 맞다, 우리 꽤 같이 다녔는데 나 아직 네 이름도 모르잖아.<br>이름이 뭐야?':'안녕! 난 '+iya(hn())+'. 여행은 선배한테 맡겨.<br>근데 너, 이름이 뭐야?');
  say(msg+'<input id="nin" maxlength="10" enterkeyhint="done" autocomplete="off" placeholder="이름"><div class="choices"><button class="choice sel" id="nok">확인</button></div>',{cursor:false,active:true});
  const i=$('#nin');setTimeout(()=>i.focus(),50);
  const ok=()=>{const v=i.value.trim().slice(0,10);if(!v){i.focus();return;}SFX.btn();i.blur();
    say(`<span class="q">“${esc(v)}”</span><br>${esc(v)}… 맞지?`,{choices:[
      {label:'네',fn:()=>{DB.user.name=v;save();const n=esc(voc());
        const lines=[`${n}! 좋은 이름이다. 선배가 잘 챙겨줄게.`,`${esc(v)}, 기억했어. 선배는 이름 같은 건 절대 안 까먹어… 아마도.`,`${n}, 반가워. 이름이랑 얼굴이랑 잘 어울린다.`];
        say(lines[Math.floor(Math.random()*lines.length)],{choices:[{label:'잘 부탁해요',fn:next}]});}},
      {label:'아니요',fn:()=>askName(next,'앗, 다시. 이름이 뭐라고?')}]});};
  $('#nok').onclick=ok;i.onkeydown=e=>{if(e.key==='Enter')ok();};}

/* ---------- test: generate choice sets for every heroine (2 per mood × 4 moods) and compare their scores ---------- */
const SIM_HIST=[{who:'m',text:'오늘 진짜 많이 걸었다. 다리 안 아파?'},{who:'me',text:'괜찮아요. 선배는요?'}];
async function simChoices(){if(SIM){toast('시뮬레이션 중이야');return;}
  const key=DB.settings.key.trim().toLowerCase();if(!key||key==='demo'){toast('API 키가 있어야 돼');return;}
  const keep={hero:DB.settings.hero,hist:C.hist,traps:C.traps,kinds:C.trapKinds},moods=Object.keys(MOODS),jobs=[];
  for(const k of Object.keys(HEROES))for(const m of moods)for(let r=0;r<2;r++){
    DB.settings.hero=k;SIM={mood:m};C.hist=SIM_HIST;C.traps=1+Math.floor(Math.random()*3);C.trapKinds=trapKinds(C.traps);
    jobs.push({k,m,traps:C.traps,prompt:chatPrompt(false)});}
  DB.settings.hero=keep.hero;C.hist=keep.hist;C.traps=keep.traps;C.trapKinds=keep.kinds;
  const res=[];let done=0;const tick=()=>toast(`시뮬레이션 ${done}/${jobs.length}`,1500);tick();
  const run=async j=>{try{const r=await gemini(j.prompt,null,{tag:'sim',tools:false,timeout:30000,config:{responseMimeType:'application/json',temperature:1.0}});
      const v=chatParse(r.text);if(v&&v.choices.length)res.push({...j,choices:v.choices});}catch(e){}done++;if(done%6===0)tick();};
  for(let i=0;i<jobs.length;i+=4)await Promise.all(jobs.slice(i,i+4).map(run));
  SIM=null;showSim(res);}
function showSim(res){const eff=a=>{a=Math.max(-0.3,Math.min(0.3,a))*AFF_SCALE;return a<0?a*AFF_DOWN:a*AFF_UP;},f=x=>(x>=0?'+':'')+x.toFixed(2),pc=x=>Math.round(x*100)+'%';
  const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
  const rows=Object.keys(HEROES).map(k=>{const R=res.filter(r=>r.k===k),all=R.flatMap(r=>r.choices),safe=all.filter(c=>!c.trap),trap=all.filter(c=>c.trap);
    const best=R.map(r=>Math.max(...r.choices.map(c=>eff(c.aff)))),rnd=R.map(r=>avg(r.choices.map(c=>eff(c.aff))));
    return `<tr><td>${HEROES[k].name}</td><td>${R.length}</td><td>${f(avg(rnd))}</td><td>${f(avg(best))}</td><td>${f(avg(safe.map(c=>eff(c.aff))))}</td><td>${pc(safe.length?safe.filter(c=>c.aff<0).length/safe.length:0)}</td><td>${f(avg(trap.map(c=>eff(c.aff))))}</td></tr>`;}).join('');
  const byMood=Object.keys(MOODS).map(m=>`<tr><td>${({good:'기분좋음',touchy:'예민',bored:'심심',tired:'피곤'})[m]}</td>`+Object.keys(HEROES).map(k=>{const R=res.filter(r=>r.k===k&&r.m===m);
    return `<td>${R.length?f(avg(R.map(r=>avg(r.choices.map(c=>eff(c.aff)))))):'-'}</td>`;}).join('')+'</tr>').join('');
  const ov=document.createElement('div');ov.className='overlay';
  ov.innerHTML=`<div style="position:relative;width:100%;max-width:380px"><div class="tagname">난이도 시뮬레이션</div><div class="win px solid simwin">
    <div class="small" style="margin-top:0">실제 반영값(배수 포함) 기준. 같은 대화 상황으로 캐릭터마다 기분 4종 × 2번.</div>
    <table><tr><th></th><th>세트</th><th>아무거나</th><th>최선</th><th>안전 평균</th><th>안전인데 -</th><th>함정</th></tr>${rows}</table>
    <div class="small">기분별 '아무거나' 평균</div>
    <table><tr><th></th>${Object.keys(HEROES).map(k=>`<th>${HEROES[k].name}</th>`).join('')}</tr>${byMood}</table>
    <div class="btnrow"><button class="px gold" id="simOk">닫기</button></div></div></div>`;
  $('#overlayHost').appendChild(ov);ov.querySelector('#simOk').onclick=()=>{SFX.btn();ov.remove();};}

/* ---------- reset (from settings) ---------- */
function openReset(){const ov=document.createElement('div');ov.className='overlay';
  const opt={me:true,box:false,key:false};
  ov.innerHTML=`<div style="position:relative;width:100%;max-width:380px"><div class="tagname">초기화</div><div class="win px solid">
    <div class="small" style="margin-top:0">무엇을 지울지 골라줘. 지운 건 되돌릴 수 없어.</div>
    <button class="chk on" data-o="me"><i></i>이름·취향 (처음 만난 것처럼 다시)</button>
    <button class="chk off" data-o="box"><i></i>보관함·지난 동선</button>
    <button class="chk off" data-o="key"><i></i>API 키·모델</button>
    <div class="btnrow"><button class="px gold" id="rOk">초기화</button><button class="px" id="rNo" style="color:var(--muted)">취소</button></div></div></div>`;
  $('#overlayHost').appendChild(ov);
  ov.querySelectorAll('[data-o]').forEach(b=>b.onclick=()=>{SFX.touch();const k=b.dataset.o;opt[k]=!opt[k];b.classList.toggle('on',opt[k]);b.classList.toggle('off',!opt[k]);});
  ov.querySelector('#rNo').onclick=()=>{SFX.btn();ov.remove();};
  ov.querySelector('#rOk').onclick=()=>{if(!opt.me&&!opt.box&&!opt.key){toast('지울 걸 하나 이상 골라줘');return;}SFX.btn();
    if(opt.me){DB.user={name:''};DB.profile=JSON.parse(JSON.stringify(DEF.profile));DB.chat={recent:[]};DB.aff={};DB.affBase=3;DB.locked=null;DB.talks=0;DB.moods=null;affShow();}
    if(opt.box){DB.groups=[];DB.passed=[];DB.routes=[];}
    if(opt.key){DB.settings.key='';DB.settings.model=DEFAULT_MODEL;}
    save();location.reload();};}

/* ---------- sound experiment buttons (bottom of the room) ---------- */
function soundTestHTML(){return `<div class="stest"><div class="note">소리 실험 · 소리가 작아졌을 때 하나씩 눌러보고, 돌아오는 버튼을 알려줘.</div>
  <div class="minibtns"><button class="px" data-st="A">A 재생 모드</button><button class="px" data-st="B">B 오디오 요소</button><button class="px" data-st="C">C 무음 재생</button></div></div>`;}

/* ---------- day / night background: sunrise & sunset at your location (NOAA formula, no network) ---------- */
function sunTimes(lat,lng,d){const rad=Math.PI/180,J=d.getTime()/864e5+2440587.5,n=Math.round(J-2451545.0009+lng/360);
  const Js=2451545.0009-lng/360+n,M=(357.5291+0.98560028*(Js-2451545))%360,Cc=1.9148*Math.sin(M*rad)+0.02*Math.sin(2*M*rad)+0.0003*Math.sin(3*M*rad);
  const L=(M+102.9372+Cc+180)%360,Jt=Js+0.0053*Math.sin(M*rad)-0.0069*Math.sin(2*L*rad),dec=Math.asin(Math.sin(L*rad)*Math.sin(23.44*rad));
  const cw=(Math.sin(-0.833*rad)-Math.sin(lat*rad)*Math.sin(dec))/(Math.cos(lat*rad)*Math.cos(dec));
  if(cw>1)return {polar:'night'};if(cw<-1)return {polar:'day'};
  const w=Math.acos(cw)/rad/360,toDate=j=>new Date((j-2440587.5)*864e5);return {rise:toDate(Jt-w),set:toDate(Jt+w)};}
/* returns [isNight, ms until the next switch] */
function dayState(){const now=new Date(),l=manualLoc()||DB.lastLoc||S.loc;
  if(!l||l.lat==null){const h=now.getHours(),night=h<6||h>=19;const nx=new Date(now);nx.setHours(night?6:19,0,0,0);if(nx<=now)nx.setDate(nx.getDate()+1);return [night,nx-now];}
  const t=sunTimes(l.lat,l.lng,now);if(t.polar)return [t.polar==='night',3600e3];
  if(now<t.rise)return [true,t.rise-now];if(now<t.set)return [false,t.set-now];
  const t2=sunTimes(l.lat,l.lng,new Date(now.getTime()+864e5));return [true,(t2.rise||now)-now];}
let dnTimer=null;
function dayNight(animate){const [night,ms]=dayState();
  if(!animate)mainEl.classList.add('instant');mainEl.classList.toggle('night',night);
  if(!animate){void mainEl.offsetWidth;requestAnimationFrame(()=>mainEl.classList.remove('instant'));}
  clearTimeout(dnTimer);dnTimer=setTimeout(()=>dayNight(!document.hidden),Math.max(30e3,Math.min(ms+5e3,6*3600e3)));}  // one timer, set for the next sunrise/sunset
new Image().src='bg_night.jpg';
document.addEventListener('visibilitychange',()=>{if(!document.hidden)dayNight(false);});

/* ---------- boot ---------- */
applyHero();dayNight(false);
new MutationObserver(()=>{const on=!$('#cardLayer').classList.contains('hidden');['#aff','#swapBtn'].forEach(q=>{const a=$(q);if(a)a.classList.toggle('hidden',on);});}).observe($('#cardLayer'),{attributes:true,attributeFilter:['class']});
document.addEventListener('gesturestart',e=>e.preventDefault());
document.addEventListener('dblclick',e=>e.preventDefault(),{passive:false});
let lastTouch=0;document.addEventListener('touchend',e=>{const n=Date.now();if(n-lastTouch<300&&!e.target.closest('input'))e.preventDefault();lastTouch=n;},{passive:false});
document.addEventListener('contextmenu',e=>{if(!e.target.closest('input'))e.preventDefault();});
if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('sw.js').catch(()=>{});
if(DB.reborn){delete DB.reborn;save();const f=$('#fader');Object.assign(f.style,{background:'#fff',opacity:1,transition:'none'});
  setTimeout(()=>{f.style.transition='opacity 1.6s ease-out';f.style.opacity=0;setTimeout(()=>{f.style.transition='';f.style.background='';},1700);},350);}
if(DB.locked&&DB.settings.key.trim())applyLocked();
else if(!DB.settings.key.trim()){showDlg(true);say('안녕! 난 네 여행선배 '+iya(hn())+'.',{cursor:false});setTimeout(()=>openSettings('처음이구나! 제미나이 API 키부터 넣어줘.'),600);}
else if(!DB.user.name)askName(()=>DB.profile.done?sayIdle():startTutorial());
else if(!DB.profile.done)startTutorial();
else sayIdle();
window.__S=S;window.__DB=DB;window.__R=R;
