// Refreshes YouTube figures on seller pages (any root *.html with data-yt="..." markers).
// Markers: video:<id> (view count), channel:views, channel:subs, channel:videos, asof (Month YYYY).
// Uses the YouTube Data API when the YT_API_KEY secret is set; otherwise reads public YouTube pages.
// A number that can't be fetched is left as-is, and "as of" only moves when every figure on that page was refreshed.
import fs from 'node:fs';

const CHANNEL = '@masonbleasdellaustin';
const KEY = process.env.YT_API_KEY || '';
const HEADERS = { 'accept-language': 'en-US,en;q=0.9', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', cookie: 'CONSENT=YES+1; SOCS=CAI' };
const MARK = /(<[^>]*\bdata-yt="([^"]+)"[^>]*>)([^<]*)(<)/g;

const files = fs.readdirSync('.').filter(f => f.endsWith('.html') && fs.readFileSync(f, 'utf8').includes('data-yt="'));
if (!files.length) { console.log('No pages with YouTube figures yet.'); }

const wanted = new Set();
for (const f of files) for (const m of fs.readFileSync(f, 'utf8').matchAll(MARK)) wanted.add(m[2]);
const videoIds = [...wanted].filter(k => k.startsWith('video:')).map(k => k.slice(6));

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

async function viaPages() {
  const out = {};
  try {
    const a = await fetch(`https://www.youtube.com/${CHANNEL}/about`, { headers: HEADERS }).then(r => r.text());
    out['channel:views'] = num((a.match(/"viewCountText":"([\d,]+) views"/) || [])[1]);
    out['channel:subs'] = abbr((a.match(/"subscriberCountText":"([^"]+?) subscribers"/) || [])[1] || '');
    out['channel:videos'] = num((a.match(/"videoCountText":"([\d,]+) videos?"/) || [])[1]);
  } catch (e) { console.log('Channel page failed:', e.message); }
  for (const id of videoIds) {
    try {
      const w = await fetch(`https://www.youtube.com/watch?v=${id}`, { headers: HEADERS }).then(r => r.text());
      out['video:' + id] = num((w.match(/"viewCount":"(\d+)"/) || [])[1]);
    } catch (e) { console.log(`Video ${id} failed:`, e.message); }
    await new Promise(r => setTimeout(r, 800));
  }
  return out;
}

const raw = KEY ? await viaApi().catch(e => (console.log('API failed, using pages:', e.message), viaPages())) : await viaPages();
console.log('Fetched:', JSON.stringify(raw));

const fmt = {
  'channel:views': n => `${Math.floor(n / 1000)}K+`,
  'channel:subs': n => n >= 1000 ? `${(Math.floor(n / 100) / 10).toFixed(1).replace(/\.0$/, '')}K` : String(n),
  'channel:videos': n => n.toLocaleString('en-US'),
};
const value = k => { const n = raw[k]; if (!n) return null; return (fmt[k] || (x => x.toLocaleString('en-US')))(n); };
const asof = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'America/Chicago' });

let changed = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const keys = [...src.matchAll(MARK)].map(m => m[2]).filter(k => k !== 'asof');
  const complete = keys.every(k => value(k));
  const out = src.replace(MARK, (all, open, k, cur, close) => {
    if (k === 'asof') return complete ? open + asof + close : all;
    const v = value(k); return v ? open + v + close : all;
  });
  if (out !== src) { fs.writeFileSync(f, out); changed++; console.log(`Updated ${f}${complete ? '' : ' (some figures missing; kept the old "as of" date)'}`); }
}
console.log(`${files.length} page(s) checked, ${changed} updated.`);
