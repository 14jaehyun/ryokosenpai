/* 메인 화면 도로 위 참새 — 5×5 도트, 날아와서 몇 걸음 걷고 쪼다가 다시 날아감.
   BIRD.visit() = 한 번 방문, BIRD.scare() = 놀라서 바로 날아감 (화면 터치·대화·검색 시작 등) */
(function(){
  const PAL={d:'#3b2a1c',b:'#8a5a32',w:'#e3cfa8',k:'#e8a838',e:'#111018',l:'#5a3a22'};
  // facing left; '.' = empty
  const SPR={
    stand:['.dd..','kebb.','.bbbd','.wwb.','..l..'],
    step: ['.dd..','kebb.','.bbbd','.wwb.','.l.l.'],
    peck: ['.....','.dd..','kebbd','.wwb.','..l..'],
    up:   ['..db.','kdb..','ebbbd','.ww..','.....'],
    down: ['.....','kd...','ebbbd','.wbd.','..d..'],
  };
  const DOT=5;                       // css px per dot
  const host=document.getElementById('main');
  const cv=document.createElement('canvas');cv.id='bird';
  cv.width=5;cv.height=5;
  Object.assign(cv.style,{position:'absolute',width:5*DOT+'px',height:5*DOT+'px',imageRendering:'pixelated',zIndex:2,pointerEvents:'none',left:'0',top:'0',display:'none'});
  host.appendChild(cv);const g=cv.getContext('2d');
  function draw(name,flip){g.clearRect(0,0,5,5);SPR[name].forEach((row,y)=>[...row].forEach((ch,x)=>{if(ch==='.')return;g.fillStyle=PAL[ch];g.fillRect(flip?4-x:x,y,1,1);}));}
  const W=()=>host.clientWidth,H=()=>host.clientHeight;
  function place(x,y){cx=x;cy=y;cv.style.transform=`translate(${Math.round(x/DOT)*DOT}px,${Math.round(y/DOT)*DOT}px)`;} // stay on the dot grid
  let busy=false,scared=false,cx=0,cy=0;
  const SCARE={};
  const sleep=ms=>new Promise((r,j)=>setTimeout(()=>scared?j(SCARE):r(),ms));
  const ease=t=>t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2;
  async function fly(x0,y0,x1,y1,ms,flip,landing){const t0=performance.now();
    while(true){const t=Math.min(1,(performance.now()-t0)/ms),e=landing?1-Math.pow(1-t,2):t*t;
      const x=x0+(x1-x0)*e,y=y0+(y1-y0)*e-Math.sin(Math.PI*t)*18*(landing?1:-1);
      draw(Math.floor(performance.now()/110)%2?'up':'down',flip);place(x,y);if(t>=1)break;await (landing?sleep(16):new Promise(r=>setTimeout(r,16)));}}
  async function hop(x,y,dx,flip){for(let i=0;i<=6;i++){draw(i%3===1?'step':'stand',flip);place(x+dx*i/6,y-Math.sin(Math.PI*i/6)*DOT);await sleep(28);}return x+dx;}
  async function visit(o={}){if(busy)return;busy=true;scared=false;
    try{await stay(o);}
    catch(e){if(e!==SCARE)throw e;scared=false;   // startled: flap up and away from where it is
      const w=W(),h=H(),away=cx<w*0.5?-1:1;await fly(cx,cy,away<0?-40:w+40,h*0.06,650,away>0,false);}
    finally{cv.style.display='none';busy=false;scared=false;}}
  function scare(){if(busy)scared=true;}
  async function stay(o){
    const w=W(),h=H();
    // road surface in bg.jpg: lower-left part of the street, clear of 미연 (right, now 120%) and the dialog (bottom)
    let x=w*(0.22+Math.random()*0.04),y=h*(o.high?0.50+Math.random()*0.03:0.60+Math.random()*0.05);  // high: above the big chat box
    const fromRight=Math.random()<0.5;const flipIn=!fromRight;   // sprite faces left; flip when coming from the left
    cv.style.display='block';
    await fly(fromRight?w+30:-30,h*0.22,x,y,1500,flipIn,true);
    draw('stand',flipIn);await sleep(500);
    let dir=flipIn?1:-1,flip=flipIn;
    for(let i=0;i<4;i++){
      if(Math.random()<0.35){draw('peck',flip);await sleep(220);draw('stand',flip);await sleep(180);draw('peck',flip);await sleep(220);draw('stand',flip);await sleep(300);}
      if(i===2&&Math.random()<0.6){dir=-dir;flip=!flip;draw('stand',flip);await sleep(350);}  // look the other way
      // stay on the road strip between the utility pole (left) and 미연's hair (right)
      if(x+dir*DOT*2<w*0.21||x+dir*DOT*2+5*DOT>w*0.37){dir=-dir;flip=!flip;draw('stand',flip);await sleep(300);}
      x=await hop(x,y,dir*DOT*2,flip);await sleep(260+Math.random()*300);}
    draw('stand',flip);await sleep(600);
    const away=Math.random()<0.5?-1:1;
    await fly(x,y,away<0?-40:w+40,h*0.08,1300,away>0,false);}
  window.BIRD={visit,scare,get busy(){return busy;}};
})();
