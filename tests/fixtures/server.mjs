// Two origins for the e2e suite: http://localhost:<port> (page) and
// http://127.0.0.1:<port+1> (cross-origin iframe), each serving the same pages.

import http from 'node:http';

const PORT_A = Number(process.env.E2E_FIXTURE_PORT ?? 4100);
const PORT_B = PORT_A + 1;
export const SITE_A = `http://localhost:${PORT_A}`;
export const SITE_B = `http://127.0.0.1:${PORT_B}`;

const pages = {
  '/index.html': `<!doctype html><html><head><meta charset="utf-8"><title>Fixture Home</title>
<style>body{font-family:sans-serif;margin:20px}.drop{width:220px;height:60px;border:2px dashed #888;margin:8px 0}
.item{width:120px;padding:8px;background:#ddd;cursor:grab}iframe{border:1px solid #999;margin:6px 0}#spacer{height:2200px}</style></head><body>
<h1>Trang thử nghiệm</h1>
<p id="count">Đếm: 0</p>
<button id="inc" onclick="n=(window.n||0)+1;window.n=n;document.getElementById('count').textContent='Đếm: '+n">Tăng</button>
<label>Họ tên <input id="name"></label>
<label>Thành phố <select id="city"><option value="">--</option><option value="hn">Hà Nội</option><option value="hcm">Hồ Chí Minh</option></select></label>
<label><input type="checkbox" id="agree"> Đồng ý điều khoản</label>
<div id="editor" contenteditable="true" aria-label="Soạn thảo" style="border:1px solid #aaa;min-height:30px"></div>
<p id="keys">Phím: </p>
<button id="alert" onclick="document.getElementById('confirm-result').textContent = confirm('Bạn chắc chứ?') ? 'Xác nhận: có' : 'Xác nhận: không'">Hỏi xác nhận</button>
<p id="confirm-result"></p>
<custom-card></custom-card>
<div class="item" id="drag" draggable="true">Kéo tôi</div>
<div class="drop" id="drop" aria-label="Vùng thả" tabindex="0">Thả vào đây</div>
<p id="dropped"></p>
<input type="file" id="file" aria-label="Chọn file">
<p id="file-result"></p>
<iframe id="same" title="Khung cùng nguồn" src="/same.html" width="420" height="90"></iframe>
<iframe id="cross" title="Khung khác nguồn" src="${SITE_B}/cross.html" width="460" height="260"></iframe>
<div id="spacer"></div>
<p id="bottom">Đáy trang</p>
<script>
document.addEventListener('keydown',e=>{document.getElementById('keys').textContent='Phím: '+(e.ctrlKey?'Ctrl+':'')+(e.metaKey?'Meta+':'')+(e.shiftKey?'Shift+':'')+e.key});
const drag=document.getElementById('drag'),drop=document.getElementById('drop');
drag.addEventListener('dragstart',e=>e.dataTransfer.setData('text/plain','drag'));
drop.addEventListener('dragover',e=>e.preventDefault());
drop.addEventListener('drop',e=>{e.preventDefault();document.getElementById('dropped').textContent='Đã thả: '+e.dataTransfer.getData('text/plain')});
document.getElementById('file').addEventListener('change',async e=>{const f=e.target.files[0];document.getElementById('file-result').textContent='File: '+f.name+' = '+(await f.text())});
customElements.define('custom-card',class extends HTMLElement{constructor(){super();const r=this.attachShadow({mode:'closed'});
r.innerHTML='<div><button id="sb">Nút trong shadow</button><span id="ss"></span></div>';
r.getElementById('sb').onclick=()=>{r.getElementById('ss').textContent='Shadow OK'}}});
</script></body></html>`,
  '/same.html': `<!doctype html><meta charset="utf-8"><body><button onclick="this.nextElementSibling.textContent='Cùng nguồn OK'">Nút cùng nguồn</button><span></span></body>`,
  '/cross.html': `<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif">
<h3>Form trong iframe</h3>
<label>Email trong iframe <input id="email" type="email"></label>
<button onclick="document.getElementById('out').textContent='Đã gửi: '+document.getElementById('email').value">Gửi iframe</button>
<p id="out"></p>
<iframe title="Khung lồng" src="${SITE_A}/nested.html" width="380" height="70"></iframe></body>`,
  // Google-Sheets-like page: a hosting page with the sheet in a cross-origin iframe; the
  // grid is a canvas, keys go to a hidden focused textarea, and a nested same-site
  // iframe holds a paint canvas.
  '/sheet-host.html': `<!doctype html><meta charset="utf-8"><title>Sheet Host</title><body style="margin:0;font-family:sans-serif">
<h2 style="margin:10px">Bảng tính nhúng</h2>
<iframe title="Bảng tính" src="${SITE_B}/sheet.html" width="680" height="560" style="border:1px solid #999;margin-left:30px"></iframe></body>`,
  '/sheet.html': `<!doctype html><meta charset="utf-8"><body style="margin:0;font-family:sans-serif">
<canvas id="grid" width="600" height="264" style="display:block;margin:12px"></canvas>
<textarea id="keys" aria-hidden="true" style="position:absolute;left:-9999px;top:0;opacity:0"></textarea>
<pre id="log" style="margin:0 12px;font-size:12px"></pre>
<iframe title="Khung vẽ" src="${SITE_A}/paint.html" width="420" height="190" style="margin:0 12px;border:1px solid #bbb"></iframe>
<script>
const C=6,R=10,W=100,H=24,cols='ABCDEF',data={};let sel=null;
const g=document.getElementById('grid'),ctx=g.getContext('2d'),keys=document.getElementById('keys'),log=document.getElementById('log');
function draw(){ctx.clearRect(0,0,g.width,g.height);ctx.font='13px sans-serif';
 for(let r=0;r<=R;r++)for(let c=0;c<=C;c++){const x=c*W,y=r*H;ctx.strokeStyle='#ccc';ctx.strokeRect(x+.5,y+.5,W,H);
  ctx.fillStyle='#333';if(r===0&&c>0)ctx.fillText(cols[c-1],x+45,y+16);else if(c===0&&r>0)ctx.fillText(String(r),x+45,y+16);
  else if(r>0&&c>0){const k=cols[c-1]+r;if(data[k])ctx.fillText(data[k],x+6,y+16);}}
 if(sel){ctx.strokeStyle='#1a73e8';ctx.lineWidth=2;ctx.strokeRect(sel.c*W+1,sel.r*H+1,W-2,H-2);ctx.lineWidth=1;}}
g.addEventListener('mousedown',e=>{const b=g.getBoundingClientRect();const c=Math.floor((e.clientX-b.left)/W),r=Math.floor((e.clientY-b.top)/H);
 if(c<1||r<1||c>C||r>R)return;sel={c,r};keys.value='';keys.focus();draw();log.textContent='Chọn ô '+cols[c-1]+r;e.preventDefault();});
keys.addEventListener('keydown',e=>{if(!sel)return;if(e.key==='Enter'){const k=cols[sel.c-1]+sel.r;data[k]=keys.value;log.textContent='Đã ghi '+k+' = '+keys.value;keys.value='';sel={c:sel.c,r:Math.min(R,sel.r+1)};draw();e.preventDefault();}});
draw();
</script></body>`,
  '/paint.html': `<!doctype html><meta charset="utf-8"><body style="margin:0;font-family:sans-serif">
<canvas id="paint" width="400" height="140" style="display:block;background:#fafafa"></canvas><p id="out" style="margin:4px 0;font-size:12px"></p>
<script>const c=document.getElementById('paint'),x=c.getContext('2d'),o=document.getElementById('out');let s=null;
c.addEventListener('mousedown',e=>{s=[e.offsetX,e.offsetY];o.textContent='Vẽ tại '+e.offsetX+','+e.offsetY;});
c.addEventListener('mouseup',e=>{if(s&&(Math.abs(e.offsetX-s[0])>20||Math.abs(e.offsetY-s[1])>20)){x.beginPath();x.moveTo(s[0],s[1]);x.lineTo(e.offsetX,e.offsetY);x.stroke();o.textContent='Kéo từ '+s[0]+','+s[1]+' đến '+e.offsetX+','+e.offsetY;}s=null;});
</script></body>`,
  '/nested.html': `<!doctype html><meta charset="utf-8"><body><button onclick="this.nextElementSibling.textContent='Lồng OK'">Nút lồng</button><span></span></body>`,
};

function serve(port, host) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const body = pages[new URL(req.url, 'http://x').pathname === '/' ? '/index.html' : new URL(req.url, 'http://x').pathname];
      if (!body) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body);
    });
    server.listen(port, host, () => resolve(server));
  });
}

export async function startFixtures() {
  const a = await serve(PORT_A, 'localhost');
  const b = await serve(PORT_B, '127.0.0.1');
  return { url: `${SITE_A}/index.html`, close: () => Promise.all([a, b].map((s) => new Promise((r) => s.close(r)))) };
}
