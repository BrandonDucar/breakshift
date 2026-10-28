import diagnosis from '../.cf-preview/preview-diagnosis.json' with { type: 'json' };
import release from '../.cf-preview/release.json' with { type: 'json' };
import { authenticate, exchangeAccess, GRANT_ID, limitedJson, probeTransport } from './live-muse.mjs';
import {MAX_PHOTO_BODY} from './photo-contract.mjs';
import {MAX_PERCEPTION_BODY} from './sam-wonder.mjs';
export { MuseBudget } from './live-muse.mjs';

const headers = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(self), microphone=(), geolocation=(), payment=()',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob: data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...headers, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/muse/')) {
      const origin=request.headers.get('origin');
      if((request.method==='POST'&&origin!==url.origin)||(origin&&origin!==url.origin))return json({error:'MUSE_ORIGIN_REJECTED'},403);
      try {
        if(url.pathname==='/api/muse/access'&&request.method==='POST')return await exchangeAccess(request,env);
        const authenticated=await authenticate(request,env);
        const stub=()=>env.MUSE_BUDGET.get(env.MUSE_BUDGET.idFromName(GRANT_ID));
        if(url.pathname==='/api/muse/audit'&&request.method==='GET')return authenticated?await stub().fetch('https://budget/audit'):json({error:'MUSE_TESTER_ACCESS_REQUIRED'},403);
        if(url.pathname==='/api/muse/photo-result'&&request.method==='GET')return authenticated?await stub().fetch(`https://budget/photo-result${url.search}`):json({error:'MUSE_TESTER_ACCESS_REQUIRED'},403);
        if(url.pathname==='/api/muse/connectivity'&&request.method==='GET')return authenticated?stub().fetch('https://budget/connectivity'):json({error:'MUSE_TESTER_ACCESS_REQUIRED'},403);
        if(url.pathname==='/api/muse/status'&&request.method==='GET') {
          if(!authenticated)return json({enabled:false,authenticated:false,appAccess:'OPEN_LINK',signInRequired:false,model:'muse-spark-1.3',mode:'RECORDED_MUSE_PREVIEW',reason:'MUSE_TESTER_ACCESS_REQUIRED',remainingScans:0});
          const response=await stub().fetch('https://budget/status');
          return json({...await response.json(),authenticated:true,appAccess:'OPEN_LINK',signInRequired:false});
        }
        if(url.pathname==='/api/muse/result'&&request.method==='GET') {
          if(authenticated)return stub().fetch(`https://budget/result${url.search}`);
          return json({result:url.searchParams.get('zoneId')===diagnosis.zoneId&&url.searchParams.get('snapshotId')===diagnosis.evidenceSnapshotId?{...diagnosis,cached:true,stale:false}:null});
        }
        if(['/api/muse/scan','/api/muse/photo-scan','/api/muse/perception-scan'].includes(url.pathname)&&request.method==='POST') {
          if(!authenticated)return json({error:'MUSE_TESTER_ACCESS_REQUIRED'},403);
          const enhanced=url.pathname.endsWith('/perception-scan'),photo=url.pathname.endsWith('/photo-scan');
          const input=await limitedJson(request,enhanced?MAX_PERCEPTION_BODY:photo?MAX_PHOTO_BODY:2048);
          return await stub().fetch(`https://budget/${enhanced?'perception-start':photo?'photo-start':'scan'}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});
        }
        return json({error:'MUSE_ROUTE_NOT_FOUND'},404);
      }catch{return json({error:'MUSE_SCAN_UNAVAILABLE'},503);}
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'PUBLIC_PREVIEW_NO_SERVER_MUTATIONS', newPaidScansEnabled: false }, 403);
    if (url.pathname === '/api/health') return json({ status: 'ok', mode: 'PROTECTED_LIVE_MUSE_BAY', release: release.id, appAccess:'OPEN_LINK',signInRequired:false,simulated: true, sessionScope: 'THIS_BROWSER', liveScansRequireTesterAccess: true });
    if (url.pathname === '/api/muse/status') return json({ enabled: false, model: 'muse-spark-1.3', mode: 'RECORDED_MUSE_PREVIEW', reason: 'RECORDED_MUSE_PREVIEW', remainingScans: 0 });
    if (url.pathname === '/api/muse/result') return json({ result: url.searchParams.get('zoneId') === diagnosis.zoneId && url.searchParams.get('snapshotId') === diagnosis.evidenceSnapshotId ? { ...diagnosis, cached: true, stale: false } : null });
    if (url.pathname.startsWith('/api/')) return json({ error: 'PREVIEW_DEVICE_LOCAL_SESSION' }, 404);
    // Only the staged allowlisted files exist in ASSETS. No credential loaders,
    // internal receipts, correspondence, environment files or model transport.
    const response = await env.ASSETS.fetch(request);
    const result = new Response(response.body, response);
    for (const [name,value] of Object.entries(headers)) result.headers.set(name,value);
    result.headers.set('x-breakshift-release',release.id);
    if (url.pathname === '/' || url.pathname.endsWith('.html')) result.headers.set('cache-control','no-cache');
    return result;
  },
};
