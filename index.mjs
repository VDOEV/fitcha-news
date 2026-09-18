// Парсер v2: Telegram-каналы (превью t.me/s/) + Reddit (JSON) + RSS-ленты
// → кластеризация заголовков → скоринг (пересечение источников + популярность + свежесть)
// → дайджест в TG-бота + digest.md
// Расписание: GitHub Actions Ср/Пт/Вс 08:30 МСК (cron 30 5 * * 3,5,0)

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const CFG = JSON.parse(readFileSync(join(DIR, 'sources.json'), 'utf8'));
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) NewsParser/2.0' };

const STOP = new Set(('и в на с о а но что как для от по у же из за до при это их его её не нет все весь еще ещё уже там так то бы ли или либо если когда который которые которая чтобы кто где куда зачем почему вышла вышли новый новые новая анонс ' +
  'the a an of to in for on with and or is are be been was were this that its it as at by from new news how why what').split(' '));

const decodeEnt = s => s
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&#x([0-9a-f]+);/gi, (_, d) => String.fromCodePoint(parseInt(d, 16)))
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function stem(w) {
  if (/[а-яё]/.test(w) && w.length > 4) return w.replace(/(ами|ями|ов|ев|ий|ые|ое|ая|ей|ой|ом|ам|ах|ух|ых|им|ем|ого|его|ому|ему|ыми|ими|ья|ье|ьи|у|ю|а|я|ы|и|е|о)$/u, '');
  if (/[a-z]/.test(w) && w.length > 4) return w.replace(/(ing|ed|es|s)$/, '');
  return w;
}
const tokens = t => [...new Set(t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/)
  .filter(w => w.length > 2 && !STOP.has(w)).map(stem))];
const jaccard = (a, b) => {
  const uni = new Set([...a, ...b]).size;
  return uni ? a.filter(x => b.includes(x)).length / uni : 0;
};
const pv = v => !v ? 0 : (/^([\d.,]+)\s*([KkMМ])/.test(v.trim())
  ? Math.round(parseFloat(v.replace(',', '.')) * (/M/i.test(v) ? 1e6 : 1e3))
  : parseInt(v.replace(/[\s\u00a0]/g, ''), 10) || 0);

// ---------- адаптеры ----------
async function fetchTg(handle) {
  try {
    const res = await fetch(`https://t.me/s/${handle}`, { headers: UA, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const html = await res.text();
    const out = [];
    for (const chunk of html.split('data-post="').slice(1)) {
      const id = chunk.slice(0, chunk.indexOf('"'));
      const tm = chunk.match(/<time datetime="([^"]+)"/);
      const vw = chunk.match(/class="tgme_widget_message_views">([^<]+)</);
      const tx = chunk.match(/class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
      if (!tm) continue;
      const text = tx ? decodeEnt(tx[1].replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '')).trim() : '';
      if (!text || text === 'Channel created') continue;
      out.push({
        title: text.split('\n').find(l => l.trim().length > 10)?.slice(0, 170) || text.slice(0, 170),
        link: `https://t.me/${id}`,
        source: '@' + handle,
        ts: new Date(tm[1]).getTime(),
        views: pv(vw && vw[1]),
      });
    }
    return out;
  } catch (e) { console.error(`  [skip] tg @${handle}: ${e.message}`); return []; }
}

async function fetchReddit(sub) {
  try {
    const res = await fetch(`https://www.reddit.com/r/${sub}/top.json?t=day&limit=25`, { headers: UA, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    return (json?.data?.children || []).map(c => {
      const d = c.data;
      return { title: d.title, link: 'https://www.reddit.com' + d.permalink, source: 'r/' + sub, ts: (d.created_utc || 0) * 1000, score: d.ups || 0 };
    });
  } catch (e) { console.error(`  [skip] reddit r/${sub}: ${e.message}`); return []; }
}

async function fetchFeed(src) {
  try {
    const res = await fetch(src.url, { headers: UA, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const xml = await res.text();
    const out = [];
    for (const b of xml.matchAll(/<(?:item|entry)[\s\S]*?<\/(?:item|entry)>/gi)) {
      const x = b[0];
      const title = x.match(/<title(?:\s[^>]*)?(?:><!\[CDATA\[([\s\S]*?)\]\]><\/title>|>([^<]*)<\/title>)/i);
      const link = x.match(/<link[^>]*href="([^"]+)"/i) || x.match(/<link>([^<]+)<\/link>/i) || x.match(/<guid[^>]*>([^<]+)<\/guid>/i);
      const date = x.match(/<pubDate>([^<]+)<\/pubDate>/i) || x.match(/<(?:updated|published)>([^<]+)<\/(?:updated|published)>/i);
      const t = title ? decodeEnt(title[1] ?? title[2] ?? '').trim() : '';
      if (!t) continue;
      out.push({ title: t, link: link ? decodeEnt(link[1]) : '', source: src.name, ts: date ? new Date(date[1]).getTime() || Date.now() : Date.now() });
    }
    return out;
  } catch (e) { console.error(`  [skip] feed ${src.name}: ${e.message}`); return []; }
}

// ---------- сбор ----------
const now = Date.now(), fresh = [];
console.log('TG-каналы:');
for (const h of CFG.tgChannels) { const it = await fetchTg(h); console.log(`  @${h}: ${it.length}`); fresh.push(...it); }
console.log('Reddit:');
for (const s of CFG.redditSubs) { const it = await fetchReddit(s); console.log(`  r/${s}: ${it.length}`); fresh.push(...it); }
console.log('RSS:');
for (const f of CFG.feeds) { const it = await fetchFeed(f); console.log(`  ${f.name}: ${it.length}`); fresh.push(...it); }

const windowed = fresh.filter(i => now - i.ts <= CFG.hoursWindow * 3600e3 && now - i.ts >= -3600e3);
console.log(`\nВсего: ${fresh.length}, свежих (${CFG.hoursWindow}ч): ${windowed.length}`);

// ---------- кластеризация (union-find) ----------
const toks = windowed.map(i => tokens(i.title));
const parent = windowed.map((_, i) => i);
const find = x => (parent[x] === x ? x : (parent[x] = find(parent[x])));
for (let i = 0; i < windowed.length; i++)
  for (let j = i + 1; j < windowed.length; j++)
    if (jaccard(toks[i], toks[j]) >= CFG.minJaccard) parent[find(i)] = find(j);

const map = new Map();
windowed.forEach((item, i) => {
  const r = find(i);
  if (!map.has(r)) map.set(r, []);
  map.get(r).push(item);
});

// ---------- скоринг: пересечение источников + популярность + свежесть ----------
const clusters = [...map.values()].map(items => {
  const sources = [...new Set(items.map(i => i.source))];
  const newest = Math.max(...items.map(i => i.ts));
  const ageH = (now - newest) / 3600e3;
  const pop = items.reduce((s, i) => s + (i.views ? Math.log10(1 + i.views) * 6 : i.score ? Math.log10(1 + i.score) * 6 : 2), 0);
  const freshBonus = Math.max(0, (CFG.hoursWindow - ageH) / CFG.hoursWindow) * 20;
  return { items, sources, newest, score: (sources.length - 1) * 60 + Math.min(pop, 50) + freshBonus + items.length * 2 };
}).sort((a, b) => b.score - a.score);

const multi = clusters.filter(c => c.sources.length >= 2);
const singles = clusters.filter(c => c.sources.length === 1);

// ---------- дайджест ----------
let text = `⚡️ Главная новость за ${CFG.hoursWindow}ч — пишут все:\n`;
const pick = (multi.length ? multi : clusters).slice(0, CFG.topClusters);
if (pick.length) {
  const top1 = pick[0];
  const shortest = a => a.items.reduce((x, y) => (y.title.length < x.title.length ? y : x));
  const t1 = shortest(top1);
  text += `\n🔥 ${t1.title}\n   ист: ${top1.sources.join(', ')}\n`;
  if (t1.link) text += `   ${t1.link}\n`;
  if (pick.length > 1) {
    text += `\n📋 Также в топе:\n`;
    pick.slice(1).forEach(c => {
      const it = shortest(c);
      text += `\n${c.sources.length >= 2 ? '🔥' : '•'} ${it.title}\n   ист: ${c.sources.join(', ')}${it.link ? '\n   ' + it.link : ''}\n`;
    });
  }
  const rest = singles.filter(c => !pick.includes(c)).slice(0, 3);
  if (rest.length) {
    text += `\n📄 Ещё свежее (один источник):\n`;
    rest.forEach(c => { const it = c.items[0]; text += `• ${it.title} (${it.source})\n`; });
  }
} else text += '\nЗа окно новостей не набралось.\n';
text += `\n— ${new Date().toLocaleString('ru-RU')}, ${windowed.length} записей из ${new Set(windowed.map(i => i.source)).size} источников —`;
if (text.length > 3900) text = text.slice(0, 3900) + '\n…';

writeFileSync(join(DIR, 'digest.md'), text, 'utf8');
console.log('\n' + text);

const botToken = process.env.TELEGRAM_BOT_TOKEN || CFG.telegram?.botToken;
const chatId = process.env.TELEGRAM_CHAT_ID || CFG.telegram?.chatId;
if (botToken && chatId) {
  for (let i = 0; i < text.length; i += 3800) {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(i, i + 3800) })
    });
    if (!res.ok) console.error('TG send error:', res.status, await res.text());
  }
  console.log('✓ Отправлено в Telegram');
} else console.log('ℹ Токен не задан — дайджест в digest.md и консоль (env TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID или sources.json)');

const maxToken = process.env.MAX_BOT_TOKEN || CFG.max?.accessToken;
const maxChat = process.env.MAX_CHAT_ID || CFG.max?.chatId;
if (maxToken && maxChat) {
  for (let i = 0; i < text.length; i += 3500) {
    const res = await fetch('https://platform-api2.max.ru/messages', {
      method: 'POST',
      headers: { 'Authorization': maxToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.slice(i, i + 3500), recipient: { chat_id: Number(maxChat) } })
    });
    if (!res.ok) console.error('MAX send error:', res.status, (await res.text()).slice(0, 200));
  }
  console.log('✓ Отправлено в MAX');
} else console.log('ℹ MAX-токен не задан — отправка в MAX пропущена (env MAX_BOT_TOKEN / MAX_CHAT_ID или sources.json → max)');
