// WebPiano 本地 HTTP 服务器 (Node.js 内置模块，零依赖)
const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = 8000;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.wav':  'audio/wav',
  '.ogg':  'audio/ogg',
  '.mp3':  'audio/mpeg',
  '.mid':  'audio/midi',
  '.midi': 'audio/midi',
  '.json': 'application/json',
};

http.createServer((req, res) => {
  // Decode percent-encoded URL (handles spaces: %20 → ' ')
  let pathname;
  try { pathname = decodeURIComponent(req.url.split('?')[0]); }
  catch { res.writeHead(400); res.end(); return; }

  let filePath = path.join(ROOT, pathname);

  // Prevent path traversal
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  // Serve index.html for bare directories
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext  = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type':  mime,
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log('');
  console.log('  WebPiano 服务器已启动');
  console.log('  请在浏览器中打开: http://localhost:' + PORT);
  console.log('');
  console.log('  按 Ctrl+C 停止服务器');
});
