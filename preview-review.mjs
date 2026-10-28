import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./.cf-preview/', import.meta.url));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4' };

export function createReviewPreviewServer() {
  return createServer(async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(403); res.end(); return; }
    try {
      const url = new URL(req.url, 'http://localhost'), pathname = url.pathname;
      if (pathname.startsWith('/api/')) {
        res.setHeader('content-type', 'application/json');
        if(pathname==='/api/muse/result') {
          const diagnosis=JSON.parse(await readFile(resolve(root,'preview-diagnosis.json'),'utf8'));
          const match=url.searchParams.get('zoneId')===diagnosis.zoneId&&url.searchParams.get('snapshotId')===diagnosis.evidenceSnapshotId;
          res.end(JSON.stringify({result:match?diagnosis:null}));return;
        }
        res.end(JSON.stringify(pathname === '/api/muse/status' ? { authenticated: false, enabled: false, mode: 'LOCAL_REVIEW_PREVIEW', reason: 'LOCAL_PREVIEW_NO_PROVIDER', remainingScans: 0 } : { result: null }));
        return;
      }
      const path = resolve(root, pathname === '/' ? 'index.html' : `.${pathname}`);
      if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) { res.writeHead(403); res.end(); return; }
      const body = await readFile(path); res.writeHead(200, { 'content-type': mime[extname(path)] || 'application/octet-stream', 'x-content-type-options': 'nosniff' }); res.end(req.method === 'HEAD' ? undefined : body);
    } catch { res.writeHead(404); res.end(); }
  });
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 5193);
  createReviewPreviewServer().listen(port, '127.0.0.1', () => console.log(`BREAKSHIFT local review: http://127.0.0.1:${port}/ (no provider calls)`));
}
