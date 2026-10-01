// Refreshes YouTube figures on seller pages (any root *.html with data-yt="..." markers).
// Markers: video:<id> (view count), sum:<id>.<id>... (total views of those videos), channel:views, channel:subs, channel:videos, asof (Month YYYY).
// Uses the YouTube Data API when the YT_API_KEY secret is set; otherwise reads public YouTube pages.
// Last known counts live in scripts/yt-cache.json, so a video YouTube won't return this run keeps its previous count.
// "As of" only moves on a page when its channel figures and at least 80% of its videos were fetched fresh this run.
import fs from 'node:fs';

const CHANNEL = '@masonbleasdellaustin';
const KEY = process.env.YT_API_KEY || '';
const HEADERS = { 'accept-language': 'en-US,en;q=0.9', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', cookie: 'CONSENT=YES+1; SOCS=CAI' };
const MARK = /(<[^>]*\bdata-yt="([^"]+)"[^>]*>)([^<]*)(<)/g;

const files = fs.readdirSync('.').filter(f => f.endsWith('.html') && fs.readFileSync(f, 'utf8').includes('data-yt="'));
if (!files.length) { console.log('No pages with YouTube figures yet.'); }

const wanted = new Set();
for (const f of files) for (const m of fs.readFileSync(f, 'utf8').matchAll(MARK)) wanted.add(m[2]);
const videoIds = [...new Set([...wanted].flatMap(k => k.startsWith('video:') ? [k.slice(6)] : k.startsWith('sum:') ? k.slice(4).split('.') : []))];

const num = s => { const n = Number(String(s).replace(/[^\d]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };
const abbr = s => { const m = String(s).replace(/,/g, '').match(/([\d.]+)\s*([KM]?)/i); if (!m) return null; const n = parseFloat(m[1]) * ({ K: 1e3, M: 1e6 }[m[2].toUpperCase()] || 1); return n > 0 ? Math.round(n) : null; };

async function viaApi() {
  const out = {};
  const ch = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=statistics&forHandle=${encodeURIComponent(CHANNEL)}&key=${KEY}`).then(r => r.json());
  const st = ch.items?.[0]?.statistics;
  if (st) { out['channel:views'] = num(st.viewCount); out['channel:subs'] = num(st.subscriberCount); out['channel:videos'] = num(st.videoCount); }
  for (let i = 0; i < videoIds.length; i += 50) {
    const v = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${videoIds.slice(i, i + 50).join(',')}&key=${KEY}`).then(r => r.json());
    for (const it of v.items || []) out['video:' + it.id] = num(it.statistics?.viewCount);
  }
  return out;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const CLIENT = { clientName: 'WEB', clientVersion: '2.20250101.00.00', hl: 'en', gl: 'US' };
async function videoViews(id) {
  try {   // InnerTube player API (lighter than the watch page)
    const r = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', { method: 'POST', headers: { ...HEADERS, 'content-type': 'application/json' }, body: JSON.stringify({ context: { client: CLIENT }, videoId: id }) }).then(r => r.json());
    const n = num(r?.videoDetails?.viewCount); if (n) return n;
  } catch {}
  try {
    const w = await fetch(`https://www.youtube.com/watch?v=${id}`, { headers: HEADERS }).then(r => r.text());
    return num((w.match(/"viewCount":"(\d+)"/) || [])[1]);
  } catch { return null; }
}

async function viaPages() {
  const out = {};
  try {
    const a = await fetch(`https://www.youtube.com/${CHANNEL}/about`, { headers: HEADERS }).then(r => r.text());
    out['channel:views'] = num((a.match(/"viewCountText":"([\d,]+) views"/) || [])[1]);
    out['channel:subs'] = abbr((a.match(/"subscriberCountText":"([^"]+?) subscribers"/) || [])[1] || '');
    out['channel:videos'] = num((a.match(/"videoCountText":"([\d,]+) videos?"/) || [])[1]);
  } catch (e) { console.log('Channel page failed:', e.message); }
  let todo = videoIds;
  for (let pass = 0; pass < 3 && todo.length; pass++) {
    if (pass) { console.log(`Retrying ${todo.length} video(s) after a pause...`); await sleep(30000); }
    for (const id of todo) { const n = await videoViews(id); if (n) out['video:' + id] = n; await sleep(1200); }
    todo = todo.filter(id => !out['video:' + id]);
  }
  return out;
}

const raw = KEY ? await viaApi().catch(e => (console.log('API failed, using pages:', e.message), viaPages())) : await viaPages();
const CACHE = 'scripts/yt-cache.json';
let cache = {}; try { cache = JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch {}
for (const k of Object.keys(raw)) if (raw[k] && cache[k] && raw[k] < cache[k] * 0.9) { console.log(`Ignoring ${k}: ${raw[k]} is well below last known ${cache[k]}`); raw[k] = null; }   // counts shouldn't drop; treat a big drop as a bad read
const fresh = new Set(Object.keys(raw).filter(k => raw[k]));
for (const k of fresh) cache[k] = raw[k];
for (const k of Object.keys(cache)) if (!raw[k]) raw[k] = cache[k];
fs.writeFileSync(CACHE, JSON.stringify(cache, null, 1) + '\n');
console.log(`Fetched channel: ${JSON.stringify({views: raw['channel:views'], subs: raw['channel:subs'], videos: raw['channel:videos']})}; videos fresh: ${videoIds.filter(i => fresh.has('video:' + i)).length}/${videoIds.length} (others use last known counts)`);

const fmt = {
  'channel:views': n => `${Math.floor(n / 1000)}K+`,
  'channel:subs': n => n >= 1000 ? `${(Math.floor(n / 100) / 10).toFixed(1).replace(/\.0$/, '')}K` : String(n),
  'channel:videos': n => n.toLocaleString('en-US'),
};
for (const k of wanted) if (k.startsWith('sum:')) { const ids = k.slice(4).split('.'); raw[k] = ids.every(i => raw['video:' + i]) ? ids.reduce((a, i) => a + raw['video:' + i], 0) : null; }
const value = k => { const n = raw[k]; if (!n) return null; return (fmt[k] || (x => x.toLocaleString('en-US')))(n); };
const asof = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'America/Chicago' });

let changed = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const keys = [...src.matchAll(MARK)].map(m => m[2]).filter(k => k !== 'asof');
  const vids = [...new Set(keys.flatMap(k => k.startsWith('video:') ? [k.slice(6)] : k.startsWith('sum:') ? k.slice(4).split('.') : []))];
  const freshVids = vids.filter(i => fresh.has('video:' + i)).length;
  const complete = keys.every(k => value(k)) && keys.filter(k => k.startsWith('channel:')).every(k => fresh.has(k)) && (!vids.length || freshVids / vids.length >= 0.8);
  const out = src.replace(MARK, (all, open, k, cur, close) => {
    if (k === 'asof') return complete ? open + asof + close : all;
    const v = value(k); return v ? open + v + close : all;
  });
  if (out !== src) { fs.writeFileSync(f, out); changed++; console.log(`Updated ${f}${complete ? '' : ' (not enough fresh figures; kept the old "as of" date)'}`); }
}
console.log(`${files.length} page(s) checked, ${changed} updated.`);
