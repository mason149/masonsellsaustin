// Weekly listings refresh for masonsellsaustin.com
//
// Reads Mason's homes.com agent profile, then each property page, and rebuilds
// the "Active Listings" and "Recently Sold" grids inside index.html.
//
// SAFETY NET: if homes.com can't be read or no active listings are found, the
// script exits WITHOUT changing index.html. It never publishes an empty or
// half-broken listings section.

import { readFileSync, writeFileSync } from "node:fs";

const PROFILE = "https://www.homes.com/real-estate-agents/mason-bleasdell/hjb1rs3/";
const BASE = "https://www.homes.com";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const MONTHS = {
  JAN: "Jan", FEB: "Feb", MAR: "Mar", APR: "Apr", MAY: "May", JUN: "Jun",
  JUL: "Jul", AUG: "Aug", SEP: "Sep", OCT: "Oct", NOV: "Nov", DEC: "Dec",
};

function decode(s) {
  return (s || "")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function get(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

function meta(html, prop) {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${prop}["'][^>]*>`,
    "i"
  );
  const tag = html.match(re);
  if (!tag) return "";
  const c = tag[0].match(/content=["']([^"']*)["']/i);
  return c ? decode(c[1]) : "";
}

function textOf(html) {
  return decode(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " "));
}

function money(n) {
  const num = Number(String(n).replace(/[^0-9.]/g, ""));
  if (!num) return "";
  return "$" + num.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

// Pull the unique property page URLs Mason is attached to from the profile page.
function propertyUrls(html) {
  const out = [];
  const seen = new Set();
  const re = /\/property\/[a-z0-9-]+\/[a-z0-9]+\//gi;
  let m;
  while ((m = re.exec(html))) {
    const url = BASE + m[0];
    if (!seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}

// Parse one property page into a listing object (or null if it can't be read).
async function parseProperty(url) {
  let html;
  try {
    html = await get(url);
  } catch {
    return null;
  }
  const title = meta(html, "og:title"); // "604 Navigator Dr, Austin, TX 78717 - For Sale"
  const img = meta(html, "og:image");
  const desc = meta(html, "og:description");
  if (!title || !img) return null;

  const cleanTitle = title.replace(/\s*-\s*(For Sale|For Rent)\s*$/i, "");
  const parts = cleanTitle.split(",");
  const addr = decode(parts[0] || "");
  const city = decode(parts[1] || "");
  const state = decode((parts[2] || "").trim().split(" ")[0] || "");
  const cityState = state ? `${city}, ${state}` : city;

  const body = textOf(html);
  const bedsM = body.match(/([\d.]+)\s*Beds/i);
  const bathsM = body.match(/([\d.]+)\s*Baths/i);
  const sqftM = body.match(/([\d,]+)\s*Sq\s*Ft/i);
  const acresM = body.match(/([\d.]+)\s*Acres/i);
  const isLand = !bedsM && /\bLand\b/i.test(body) && !!acresM;

  const soldM = body.match(/\$([\d,]+)\s*SOLD\s+([A-Z]{3})\s+\d{1,2},\s*(\d{4})/i);
  const isActive = /-\s*For Sale\s*$/i.test(title) || /^Listed for sale/i.test(desc);

  let price = "";
  if (isActive) {
    const pm = desc.match(/\$?([\d,]+)/);
    if (pm) price = money(pm[1]);
  }
  if (!price && soldM) price = money(soldM[1]);
  if (!price) {
    const pm = body.match(/\$[\d,]{4,}/);
    if (pm) price = money(pm[0]);
  }

  const listing = {
    url,
    addr,
    city: cityState,
    img,
    price,
    land: isLand,
    beds: bedsM ? bedsM[1] : "",
    baths: bathsM ? bathsM[1] : "",
    sqft: sqftM ? sqftM[1] : "",
    acres: acresM ? acresM[1] : "",
    sold: null,
  };

  if (!isActive && soldM) {
    const mon = MONTHS[soldM[2].toUpperCase()] || soldM[2];
    listing.sold = { label: `Sold ${mon} ${soldM[3]}`, sortYear: +soldM[3], monthIdx: Object.keys(MONTHS).indexOf(soldM[2].toUpperCase()) };
  } else if (isActive) {
    listing.active = true;
  }
  return listing;
}

function specs(p) {
  if (p.land) {
    let s = "<span><b>Land</b></span>";
    if (p.acres) s += `<span><b>${p.acres}</b> Acres</span>`;
    return s;
  }
  let s = "";
  if (p.beds) s += `<span><b>${p.beds}</b> Beds</span>`;
  if (p.baths) s += `<span><b>${p.baths}</b> Baths</span>`;
  if (p.sqft) s += `<span><b>${p.sqft}</b> SqFt</span>`;
  return s;
}

function card(p, isSold) {
  const badge = isSold
    ? '<div class="badge sold">Sold</div>'
    : '<div class="badge">For Sale</div>';
  const img =
    `<img src="${p.img}" alt="${p.addr}" referrerpolicy="no-referrer" loading="lazy" ` +
    `onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />` +
    `<div class="card-fallback" style="display:none"><div class="fa">${p.addr}</div>` +
    `<div class="fc">${p.city}</div></div>`;
  const price = isSold
    ? `<div class="card-price"><span class="sold-lbl">${p.sold.label}</span>${p.price}</div>`
    : `<div class="card-price">${p.price}</div>`;
  return (
    `        <a class="card" href="${p.url}" target="_blank" rel="noopener">` +
    `<div class="card-img">${badge}${img}</div>` +
    `<div class="card-body">${price}<div class="card-addr">${p.addr}</div>` +
    `<div class="card-city">${p.city}</div><div class="card-specs">${specs(p)}</div>` +
    `<div class="card-link">View on Homes.com &rarr;</div></div></a>`
  );
}

function replaceGrid(html, startMarker, endMarker, inner) {
  const s = html.indexOf(startMarker);
  if (s === -1) return null;
  const e = html.indexOf(endMarker, s);
  if (e === -1) return null;
  return html.slice(0, s) + `<div class="grid">${inner}</div>\n    ` + html.slice(e);
}

async function main() {
  let profile;
  try {
    profile = await get(PROFILE);
  } catch (err) {
    console.error("Could not load profile page:", err.message);
    process.exit(0); // safety net: leave site untouched
  }

  const urls = propertyUrls(profile);
  if (urls.length === 0) {
    console.error("No property links found on profile — leaving site untouched.");
    process.exit(0);
  }

  const listings = [];
  for (const url of urls) {
    const p = await parseProperty(url);
    if (p && p.price && (p.active || p.sold)) listings.push(p);
  }

  const active = listings
    .filter((p) => p.active)
    .sort((a, b) => Number(b.price.replace(/[^0-9]/g, "")) - Number(a.price.replace(/[^0-9]/g, "")));
  const sold = listings
    .filter((p) => p.sold)
    .sort((a, b) => b.sold.sortYear - a.sold.sortYear || b.sold.monthIdx - a.sold.monthIdx)
    .slice(0, 9);

  // SAFETY NET: never publish an empty active list.
  if (active.length < 1) {
    console.error("Parsed 0 active listings — leaving site untouched.");
    process.exit(0);
  }

  let html = readFileSync("index.html", "utf8");
  const activeInner = "\n" + active.map((p) => card(p, false)).join("\n") + "\n      ";
  const soldInner = "\n" + sold.map((p) => card(p, true)).join("\n") + "\n      ";

  let next = replaceGrid(html, '<div class="grid">', '<div class="listings-foot">', activeInner);
  if (!next) {
    console.error("Could not find active grid markers — leaving site untouched.");
    process.exit(0);
  }
  // Second grid (sold) lives between the next <div class="grid"> and the AWARDS comment.
  const afterActive = next.indexOf('<div class="listings-foot">');
  const soldStart = next.indexOf('<div class="grid">', afterActive);
  const soldEnd = next.indexOf("<!-- AWARDS", soldStart);
  if (soldStart === -1 || soldEnd === -1) {
    console.error("Could not find sold grid markers — leaving site untouched.");
    process.exit(0);
  }
  next =
    next.slice(0, soldStart) +
    `<div class="grid">${soldInner}</div>\n  </div>\n</section>\n\n  ` +
    next.slice(soldEnd);

  writeFileSync("index.html", next);
  console.log(`Updated: ${active.length} active, ${sold.length} sold.`);
}

main();
