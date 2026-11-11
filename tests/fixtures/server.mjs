// Two origins for the e2e suite: http://localhost:4100 (page) and
// http://127.0.0.1:4101 (cross-origin iframe), each serving the same pages.

import http from 'node:http';

const SITE_A = 'http://localhost:4100';
const SITE_B = 'http://127.0.0.1:4101';

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
  const a = await serve(4100, 'localhost');
  const b = await serve(4101, '127.0.0.1');
  return { url: `${SITE_A}/index.html`, close: () => Promise.all([a, b].map((s) => new Promise((r) => s.close(r)))) };
}
