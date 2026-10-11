/* night visitor: a black pixel cat that runs through the alley (bird.js's night-time counterpart) */
window.CAT=(()=>{
  const F={r0:0,r1:1,r2:2,r3:3,jump:4,stand:5,land:6},RUN=['r0','r1','r2','r3'];
  let el=null,busy=false,stop=false;
  function make(){if(el)return el;el=document.createElement('div');el.id='cat';
    Object.assign(el.style,{position:'absolute',left:'0',top:'0',width:'44px',height:'32px',background:'url(cat.png) 0 0/308px 32px no-repeat',
      imageRendering:'pixelated',transformOrigin:'50% 100%',pointerEvents:'none',zIndex:2,opacity:0,filter:'drop-shadow(0 1px 0 rgba(0,0,0,.4))'});
    const m=document.querySelector('#main');m.insertBefore(el,document.querySelector('#char'));return el;}
  /* routes in background-image % (x,y); each step: [from,to,scaleFrom,scaleTo,ms,mode,{fadeIn,fadeOut}] */
  const ROUTES=[
    // into the alley, up onto the low wall, along it, over the far side
    [[[13,73],[27,55],1.5,.7,1700,'run',{fi:1}],[[27,55],[33,46.2],.7,.55,520,'jump'],[[33,46.2],[33,46.2],.55,.55,500,'stand'],
     [[33,46.2],[44,45.6],.55,.5,1700,'walk'],[[44,45.6],[47,47.5],.5,.48,450,'drop',{fo:1}]],
    // out of the alley toward you, off the left edge
    [[[31,50],[19,62],.55,.95,1100,'run',{fi:1}],[[19,62],[2,80],.95,1.7,1100,'run',{fo:1}]],
    // a stroll on the wall, a sit, then down and away
    [[[44,45.6],[34,46.2],.5,.55,2000,'walk',{fi:1}],[[34,46.2],[34,46.2],.55,.55,1400,'stand'],[[34,46.2],[26,56],.55,.75,560,'jump'],
     [[26,56],[10,72],.75,1.4,1100,'run',{fo:1}]],
    // a dash across the far road
    [[[20,51.5],[42,50.5],.6,.55,1500,'run',{fi:1,fo:1}]]];
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  function frame(mode,t,k){if(mode==='run')return RUN[Math.floor(t/85)%4];if(mode==='walk')return RUN[Math.floor(t/150)%4];
    if(mode==='jump')return k<.75?'jump':'land';if(mode==='drop')return 'jump';return 'stand';}
  async function visit(){if(busy)return;busy=true;stop=false;const c=make();
    const main=document.querySelector('#main'),W=main.clientWidth,H=main.clientHeight,bw=H*462/898,ox=(W-bw)/2;
    const P=([px,py])=>[ox+px/100*bw,py/100*H];
    let route=ROUTES[Math.floor(Math.random()*ROUTES.length)];
    let mirror=false;
    if(route.length===1&&Math.random()<.5){route=[[route[0][1],route[0][0],route[0][3],route[0][2],route[0][4],'run',route[0][6]]];}
    for(const s of route){const [a,b,s0,s1,ms,mode,o={}]=s;const [ax,ay]=P(a),[bx,by]=P(b);const goingLeft=bx<ax-1;
      const face=goingLeft?-1:(bx>ax+1?1:(mirror?-1:1));mirror=face<0;
      const t0=performance.now();
      while(true){if(stop)break;const t=performance.now()-t0,k=Math.min(1,t/ms);
        let x=ax+(bx-ax)*k,y=ay+(by-ay)*k;if(mode==='jump')y-=Math.sin(k*Math.PI)*28*s0;
        let op=1;if(o.fi&&t<250)op=t/250;if(o.fo)op=Math.min(op,(1-k)*4>1?1:(1-k)*4);if(mode==='drop')op=1-k;
        const sc=s0+(s1-s0)*k;c.style.opacity=op;c.style.backgroundPosition=(-44*F[frame(mode,t,k)])+'px 0';
        c.style.transform=`translate(${x-22}px,${y-32}px) scale(${sc*face},${sc})`;
        if(k>=1)break;await new Promise(r=>requestAnimationFrame(r));}
      if(stop)break;}
    if(!fleeing){c.style.opacity=0;busy=false;}}
  /* startled: a hop straight up, then a dash off the nearest side of the screen */
  let fleeing=false;
  async function scare(){if(!busy||fleeing||!el)return;stop=true;fleeing=true;
    await new Promise(r=>requestAnimationFrame(r));
    const m=el.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([-\d.]+),\s*([-\d.]+)\)/);
    if(!m){el.style.opacity=0;fleeing=false;busy=false;return;}
    let x=+m[1],y=+m[2],sc=Math.abs(+m[4]);const W=document.querySelector('#main').clientWidth;
    const dir=(x+22<W*0.3)?-1:(Math.random()<.5?-1:1);   // usually bolts out to the left, away from the heroine
    el.style.opacity=1;
    const t0=performance.now(),hop=260,run=420;
    while(true){const t=performance.now()-t0;
      if(t<hop){const k=t/hop;el.style.backgroundPosition=(-44*F.jump)+'px 0';
        el.style.transform=`translate(${x}px,${y-Math.sin(k*Math.PI)*26*sc}px) scale(${sc*dir*(1+0.15*Math.sin(k*Math.PI))},${sc*(1+0.25*Math.sin(k*Math.PI))})`;}
      else{const k=Math.min(1,(t-hop)/run),nx=x+dir*k*(W*0.9),s2=sc*(1+0.4*k);
        el.style.backgroundPosition=(-44*F[RUN[Math.floor(t/55)%4]])+'px 0';
        el.style.transform=`translate(${nx}px,${y+k*8}px) scale(${s2*dir},${s2})`;if(k>=1)break;}
      await new Promise(r=>requestAnimationFrame(r));}
    el.style.opacity=0;fleeing=false;busy=false;}
  return {visit,scare,get busy(){return busy;}};
})();
