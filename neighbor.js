/* night only: the neighbor across the alley leans out of his lit window, shakes a fist at the noise, and leans back in.
   neighbor.png: 5 frames of 14x13 cells — 0 upright (inside), 1 half lean, 2 full lean, 3/4 fist up / fist forward */
window.NEIGHBOR=(()=>{
  let clip=null,man=null,busy=false;
  const C=4,FW=14*C,FH=13*C;
  function geo(){const main=document.querySelector('#main'),W=main.clientWidth,H=main.clientHeight,bw=H*462/898,ox=(W-bw)/2;
    const P=(px,py)=>[ox+px/100*bw,py/100*H];const [x0,y0]=P(65.9,27.6),[x1,y1]=P(69.2,32.3);return {W,H,x0,y0,x1,y1};}
  function make(){const g=geo();
    if(!clip){clip=document.createElement('div');Object.assign(clip.style,{position:'absolute',inset:'0',zIndex:2,pointerEvents:'none'});
      man=document.createElement('div');
      Object.assign(man.style,{position:'absolute',width:FW+'px',height:FH+'px',background:`url(neighbor.png) 0 0/${5*FW}px ${FH}px no-repeat`,
        imageRendering:'pixelated',filter:'brightness(.8)',opacity:0});
      clip.appendChild(man);const m=document.querySelector('#main');m.insertBefore(clip,document.querySelector('#char'));}
    /* waist sits at the window's lower right; everything below the sill and right of the frame stays hidden */
    const wx=g.x1-1,wy=g.y1+3;Object.assign(man.style,{left:(wx-11.5*C)+'px',top:(wy-12.5*C)+'px'});
    clip.style.clipPath=`inset(${g.y0-70}px ${g.W-g.x1}px ${g.H-g.y1}px ${g.x0-80}px)`;}
  const fr=i=>{man.style.backgroundPosition=(-FW*i)+'px 0';};
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  /* old PCM feel: a bit-crushed grumble + 6 ticks, one buffer */
  function sound(){if(typeof audio!=='function'||MICOPEN||AWAY)return;const a=audio();if(!a||!SFXOUT)return;
    const sr=a.sampleRate,n=Math.floor(sr*2.4),b=a.createBuffer(1,n,sr),d=b.getChannelData(0);
    const crush=(v,bits)=>{const q=Math.pow(2,bits-1);return Math.round(v*q)/q;};
    const g0=Math.floor(sr*0.15),gl=Math.floor(sr*1.3),hold=Math.max(1,Math.floor(sr/6000));let ph=0,f=160,held=0;
    for(let i=0;i<gl;i++){const t=i/sr;if(i%Math.floor(sr*0.07)===0)f=110+Math.random()*110;ph+=f/sr;
      if(i%hold===0){const saw=2*(ph%1)-1,gate=Math.sin(2*Math.PI*7.5*t)>-0.2?1:0,env=Math.min(1,t/0.03)*Math.min(1,(1.3-t)/0.08);held=crush(saw*gate*env*0.9,4);}
      d[g0+i]+=held*0.04;}
    const tl=Math.floor(sr*0.008),th=Math.max(1,Math.floor(sr/8000));
    for(let k=0;k<6;k++){const s0=Math.floor(sr*(0.57+k*0.17));let h=0;
      for(let i=0;i<tl;i++){if(i%th===0)h=crush(Math.sign(Math.sin(2*Math.PI*1800*i/sr))*(1-i/tl),3);d[s0+i]+=h*0.08;}}
    const src=a.createBufferSource();src.buffer=b;src.connect(SFXOUT);src.start();}
  async function show(){if(busy)return;busy=true;
    try{make();sound();man.style.opacity=1;
      fr(0);await sleep(110);fr(1);await sleep(110);fr(2);await sleep(350);
      for(let i=0;i<6;i++){fr(i%2?4:3);await sleep(170);}
      fr(2);await sleep(450);fr(1);await sleep(110);fr(0);await sleep(110);}
    finally{if(man)man.style.opacity=0;busy=false;}}
  return {show,get busy(){return busy;}};})();
