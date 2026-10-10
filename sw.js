const CACHE='ryokosenpai-v2.0.17';
const CORE=['./','index.html','style.css?v=2.0.17','app.js?v=2.0.17','bird.js?v=2.0.17','manifest.webmanifest','bg.jpg','room.jpg','miyeon.png','miyeon_blush.png','icon-180.png','icon-192.png','Galmuri11.woff2','Galmuri11-Bold.woff2'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin)return;
  if(/\.(png|jpg|jpeg|webp|woff2)$/.test(u.pathname)){e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(res=>{const cp=res.clone();caches.open(CACHE).then(c=>c.put(e.request,cp));return res;})));return;}
  e.respondWith(fetch(e.request).then(res=>{const cp=res.clone();caches.open(CACHE).then(c=>c.put(e.request,cp));return res;}).catch(()=>caches.match(e.request).then(r=>r||caches.match('index.html'))));});
