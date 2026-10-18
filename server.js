// La Liste Infernale — serveur : sert la page, relaie les salons de jeu (WebSocket)
// et garde les statistiques des réponses (pour le bonus des réponses rares).
// Toute la logique de jeu tourne dans le navigateur de l'hôte.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const PAGE = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));
const ROOM_RE = /^[a-z0-9][a-z0-9_.-]{0,47}$/;
const THEME_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const KEY_RE = /^[a-z0-9+#]{1,80}$/;
const MAX_PEERS = 16;           // joueurs + spectateurs par salon
const MAX_PRESENCE = 16 * 1024; // octets par joueur

/* ---------- statistiques ----------
   Par thème : nombre de manches jouées + nombre de manches où chaque réponse a été trouvée.
   Stockage : Upstash Redis si UPSTASH_REDIS_REST_URL et UPSTASH_REDIS_REST_TOKEN sont définis
   (gratuit, survit aux redémarrages), sinon un fichier JSON local (STATS_FILE). */
const UP_URL = process.env.UPSTASH_REDIS_REST_URL, UP_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const STATS_FILE = process.env.STATS_FILE || path.join(__dirname, 'stats.json');
let fileStats = {};
if (!UP_URL) { try { fileStats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')); } catch { fileStats = {}; } }
let saveTimer = null;
const saveFile = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => fs.writeFile(STATS_FILE, JSON.stringify(fileStats), () => {}), 1000); };
async function upstash(cmds) {
  const r = await fetch(UP_URL.replace(/\/$/, '') + '/pipeline', { method: 'POST', headers: { Authorization: 'Bearer ' + UP_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(cmds) });
  if (!r.ok) throw new Error('upstash ' + r.status);
  return r.json();
}
async function getStats(t) {
  if (UP_URL) {
    const [res] = await upstash([['HGETALL', 'li:stats:' + t]]);
    const arr = res.result || []; const c = {}; let plays = 0;
    for (let i = 0; i < arr.length; i += 2) { if (arr[i] === '__plays') plays = +arr[i + 1]; else c[arr[i]] = +arr[i + 1]; }
    return { plays, c };
  }
  const s = fileStats[t] || { plays: 0, c: {} };
  return { plays: s.plays, c: s.c };
}
async function recordStats(t, keys) {
  if (UP_URL) {
    const k = 'li:stats:' + t;
    await upstash([['HINCRBY', k, '__plays', 1], ...keys.map(x => ['HINCRBY', k, x, 1])]);
    return;
  }
  const s = fileStats[t] = fileStats[t] || { plays: 0, c: {} };
  s.plays++; for (const x of keys) s.c[x] = (s.c[x] || 0) + 1;
  saveFile();
}
const recent = new Map(); // limite : 1 enregistrement par IP et par thème toutes les 20 s
function readBody(req, max = 20000) {
  return new Promise((res, rej) => { let b = ''; req.on('data', d => { b += d; if (b.length > max) { rej(new Error('too big')); req.destroy(); } }); req.on('end', () => res(b)); req.on('error', rej); });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') { res.writeHead(200); return res.end('ok'); }
  if (url.pathname === '/api/stats') {
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
    try {
      if (req.method === 'GET') {
        const t = url.searchParams.get('t') || '';
        if (!THEME_RE.test(t)) { res.writeHead(400); return res.end('{}'); }
        return res.end(JSON.stringify(await getStats(t)));
      }
      if (req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        const t = String(body.t || ''); const keys = [...new Set((Array.isArray(body.k) ? body.k : []).map(String))].filter(k => KEY_RE.test(k) && k !== '__plays').slice(0, 200);
        if (!THEME_RE.test(t)) { res.writeHead(400); return res.end('{}'); }
        const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
        const rk = ip + '|' + t; const last = recent.get(rk) || 0;
        if (Date.now() - last < 20000) { res.writeHead(429); return res.end('{}'); }
        recent.set(rk, Date.now()); if (recent.size > 5000) recent.clear();
        await recordStats(t, keys);
        return res.end('{"ok":true}');
      }
      res.writeHead(405); return res.end('{}');
    } catch (e) { console.error('stats', e.message); res.writeHead(500); return res.end('{}'); }
  }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(PAGE);
  }
  res.writeHead(404); res.end('Not found');
});

/* ---------- salons de jeu ---------- */
const rooms = new Map(); // nom -> Map(peerId -> { ws, presence })
function broadcast(name) {
  const room = rooms.get(name);
  if (!room) return;
  const msg = JSON.stringify({ t: 'peers', room: name, peers: [...room].map(([peer, p]) => ({ peer, presence: p.presence })) });
  for (const p of room.values()) if (p.ws.readyState === 1) p.ws.send(msg);
}
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
wss.on('connection', ws => {
  const mine = new Map(); // salon -> peerId
  let budget = 60, last = Date.now();
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', raw => {
    const t = Date.now(); budget = Math.min(60, budget + (t - last) / 25); last = t; // ~40 msg/s
    if (budget < 1) return; budget--;
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.room !== 'string' || !ROOM_RE.test(m.room)) return;
    if (m.t === 'join') {
      if (typeof m.peer !== 'string' || m.peer.length > 40) return;
      let room = rooms.get(m.room);
      if (!room) { room = new Map(); rooms.set(m.room, room); }
      if (room.size >= MAX_PEERS && !room.has(m.peer)) return ws.send(JSON.stringify({ t: 'full', room: m.room }));
      room.set(m.peer, { ws, presence: (room.get(m.peer) || {}).presence || {} });
      mine.set(m.room, m.peer);
      broadcast(m.room);
    } else if (m.t === 'presence') {
      const peer = mine.get(m.room); const room = rooms.get(m.room);
      if (!peer || !room || !room.has(peer) || !m.patch || typeof m.patch !== 'object') return;
      const entry = room.get(peer);
      const next = m.full ? {} : { ...entry.presence };
      for (const k of Object.keys(m.patch)) { if (m.patch[k] === null) delete next[k]; else next[k] = m.patch[k]; }
      if (JSON.stringify(next).length > MAX_PRESENCE) return;
      entry.presence = next;
      broadcast(m.room);
    } else if (m.t === 'leave') {
      const peer = mine.get(m.room); const room = rooms.get(m.room);
      if (peer && room) { room.delete(peer); mine.delete(m.room); if (!room.size) rooms.delete(m.room); else broadcast(m.room); }
    }
  });
  ws.on('close', () => {
    for (const [name, peer] of mine) {
      const room = rooms.get(name);
      if (room && room.get(peer) && room.get(peer).ws === ws) { room.delete(peer); if (!room.size) rooms.delete(name); else broadcast(name); }
    }
  });
});
setInterval(() => { for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); } }, 20000);

server.listen(PORT, () => console.log(`La Liste Infernale en ligne sur le port ${PORT}` + (UP_URL ? ' (stats : Upstash)' : ' (stats : fichier local)')));
