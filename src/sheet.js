const SHEET_ID = process.env.GUILD_SHEET_ID || '1qj7-m6y_YvH7YMmLWWj81gbQZjKDPDYeQPfKUIzmiwc';
const TABS = ['Overview', 'Members', 'Treasury', 'Auction', 'Raids'];
const CACHE_TTL_MS = 60 * 1000;

let cache = { at: 0, data: null };

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim());
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    if (rows[r].length === 1 && rows[r][0] === '') continue;
    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = (rows[r][c] !== undefined ? rows[r][c] : '').trim();
    }
    out.push(obj);
  }
  return out;
}

async function fetchTab(tab) {
  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(SHEET_ID)}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Sheet fetch failed for ${tab}: HTTP ${res.status}`);
  const text = await res.text();
  if (/^\s*<(!DOCTYPE|html)/i.test(text)) {
    throw new Error(`Sheet "${tab}" is not readable — enable "Anyone with the link: Viewer" sharing`);
  }
  return parseCSV(text);
}

async function getGuildData(force) {
  const now = Date.now();
  if (!force && cache.data && now - cache.at < CACHE_TTL_MS) return cache.data;
  const results = await Promise.all(TABS.map(fetchTab));
  const data = {};
  TABS.forEach((tab, i) => { data[tab] = results[i]; });
  cache = { at: now, data };
  return data;
}

module.exports = { getGuildData, SHEET_ID };
