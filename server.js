import express from 'express';
import cookieParser from 'cookie-parser';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// ---------- Constantes ----------
const THEMES = new Set(['blue', 'purple', 'green', 'red', 'orange', 'yellow', 'black']);
const DICE_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'];
const GAME_ID_ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const GAME_ID_LEN = 11;
const MAX_DICE = 12;
const HISTORY_LIMIT = 20;
const SESSION_MS = 1000 * 60 * 60 * 24 * 30;

// ---------- Firebase Admin (optionnel) ----------
let firebaseAuth = null;
const saPath = path.join(__dirname, 'firebase-admin-key.json');
if (fs.existsSync(saPath)) {
  try {
    const { initializeApp, cert } = await import('firebase-admin/app');
    const { getAuth } = await import('firebase-admin/auth');
    initializeApp({ credential: cert(JSON.parse(fs.readFileSync(saPath, 'utf8'))) });
    firebaseAuth = getAuth();
    console.log('firebase-admin initialisé');
  } catch (e) {
    console.warn('firebase-admin échec :', e.message);
  }
} else {
  console.log('firebase-admin : clé absente, mode démo seulement');
}

// ---------- SQLite ----------
const db = new DatabaseSync(path.join(__dirname, 'colordice.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    uid         TEXT PRIMARY KEY,
    game_id     TEXT UNIQUE NOT NULL,
    display_name TEXT,
    counter     INTEGER NOT NULL DEFAULT 0,
    anti_awk    INTEGER NOT NULL DEFAULT 0,
    theme       TEXT NOT NULL DEFAULT 'blue',
    created_at  INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS rolls (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    uid       TEXT NOT NULL,
    dice      TEXT NOT NULL,
    dice_count INTEGER NOT NULL,
    at        INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_rolls_uid_at ON rolls(uid, at DESC);

  CREATE TABLE IF NOT EXISTS predictions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    target_uid  TEXT NOT NULL,
    target_gid  TEXT NOT NULL,
    dice_count  INTEGER NOT NULL,
    predicted   TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    resolved_at INTEGER,
    roll_id     INTEGER,
    actual      TEXT,
    exact       INTEGER,
    matches     INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_pred_target ON predictions(target_uid, resolved_at);
  CREATE INDEX IF NOT EXISTS idx_pred_time ON predictions(created_at DESC);

  CREATE TABLE IF NOT EXISTS security_events (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    kind   TEXT NOT NULL,
    uid    TEXT,
    ip     TEXT,
    detail TEXT,
    at     INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sec_at ON security_events(at DESC);

  CREATE TABLE IF NOT EXISTS forced_rolls (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    target_uid  TEXT NOT NULL,
    target_gid  TEXT NOT NULL,
    dice_count  INTEGER NOT NULL,
    dice        TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    consumed_at INTEGER,
    roll_id     INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_force_target ON forced_rolls(target_uid, consumed_at);
  CREATE INDEX IF NOT EXISTS idx_force_time ON forced_rolls(created_at DESC);
`);
try { db.exec('ALTER TABLE users ADD COLUMN last_seen_at INTEGER'); } catch {}
try { db.exec('ALTER TABLE rolls ADD COLUMN forced INTEGER NOT NULL DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN email TEXT'); } catch {}

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
function isAdminEmail(email) {
  return !!(email && ADMIN_EMAILS.includes(String(email).toLowerCase()));
}

const q = {
  userByUid:    db.prepare('SELECT * FROM users WHERE uid = ?'),
  userByGameId: db.prepare('SELECT uid FROM users WHERE game_id = ?'),
  insertUser:   db.prepare('INSERT INTO users (uid, game_id, display_name, email, created_at) VALUES (?, ?, ?, ?, ?)'),
  updateName:   db.prepare('UPDATE users SET display_name = ? WHERE uid = ? AND (display_name IS NULL OR display_name = \'\')'),
  updateEmail:  db.prepare('UPDATE users SET email = ? WHERE uid = ?'),
  updCounter:   db.prepare('UPDATE users SET counter = ? WHERE uid = ?'),
  updTheme:     db.prepare('UPDATE users SET theme = ? WHERE uid = ?'),
  updAntiAwk:   db.prepare('UPDATE users SET anti_awk = ? WHERE uid = ?'),
  insertRoll:   db.prepare('INSERT INTO rolls (uid, dice, dice_count, at, forced) VALUES (?, ?, ?, ?, ?)'),
  pruneRolls:   db.prepare('DELETE FROM rolls WHERE uid = ? AND id NOT IN (SELECT id FROM rolls WHERE uid = ? ORDER BY at DESC LIMIT ?)'),
  historyUid:   db.prepare('SELECT dice, dice_count, at, forced FROM rolls WHERE uid = ? ORDER BY at DESC LIMIT ?'),
  lastRoll:     db.prepare('SELECT dice, dice_count, at, forced FROM rolls WHERE uid = ? ORDER BY at DESC LIMIT 1'),
  touchSeen:    db.prepare('UPDATE users SET last_seen_at = ? WHERE uid = ?'),
};

const qa = {
  userByGid:    db.prepare('SELECT uid, game_id, display_name, counter, anti_awk, theme, created_at, last_seen_at FROM users WHERE game_id = ?'),
  historyFull:  db.prepare('SELECT id, dice, dice_count, at, forced FROM rolls WHERE uid = ? ORDER BY at DESC LIMIT ?'),
  insertPred:   db.prepare('INSERT INTO predictions (target_uid, target_gid, dice_count, predicted, created_at) VALUES (?, ?, ?, ?, ?)'),
  pendingPred:  db.prepare('SELECT * FROM predictions WHERE target_uid = ? AND dice_count = ? AND resolved_at IS NULL ORDER BY created_at ASC LIMIT 1'),
  resolvePred:  db.prepare('UPDATE predictions SET resolved_at = ?, roll_id = ?, actual = ?, exact = ?, matches = ? WHERE id = ?'),
  predsByTarget:db.prepare('SELECT * FROM predictions WHERE target_uid = ? ORDER BY created_at DESC LIMIT ?'),
  predsAll:     db.prepare('SELECT * FROM predictions ORDER BY created_at DESC LIMIT ?'),
  deletePred:   db.prepare('DELETE FROM predictions WHERE id = ? AND resolved_at IS NULL'),
  insertEvent:  db.prepare('INSERT INTO security_events (kind, uid, ip, detail, at) VALUES (?, ?, ?, ?, ?)'),
  events:       db.prepare('SELECT * FROM security_events ORDER BY at DESC LIMIT ?'),
  insertForced: db.prepare('INSERT INTO forced_rolls (target_uid, target_gid, dice_count, dice, created_at) VALUES (?, ?, ?, ?, ?)'),
  pendingForced:db.prepare('SELECT * FROM forced_rolls WHERE target_uid = ? AND dice_count = ? AND consumed_at IS NULL ORDER BY created_at ASC LIMIT 1'),
  consumeForced:db.prepare('UPDATE forced_rolls SET consumed_at = ?, roll_id = ? WHERE id = ?'),
  forcedAll:    db.prepare('SELECT * FROM forced_rolls ORDER BY created_at DESC LIMIT ?'),
  deleteForced: db.prepare('DELETE FROM forced_rolls WHERE id = ? AND consumed_at IS NULL'),
};
function logEvent(kind, uid, ip, detail) {
  try { qa.insertEvent.run(kind, uid || null, ip || null, detail || null, Date.now()); }
  catch (e) { console.warn('logEvent', e); }
}

function newGameId() {
  const bytes = crypto.randomBytes(GAME_ID_LEN);
  let out = '';
  for (let i = 0; i < GAME_ID_LEN; i++) out += GAME_ID_ALPH[bytes[i] % GAME_ID_ALPH.length];
  return out;
}
function uniqueGameId() {
  for (let i = 0; i < 25; i++) {
    const id = newGameId();
    if (!q.userByGameId.get(id)) return id;
  }
  throw new Error('impossible de générer un Game ID unique');
}
function ensureUser(uid, displayName, email) {
  let u = q.userByUid.get(uid);
  if (!u) {
    const gid = uniqueGameId();
    q.insertUser.run(uid, gid, displayName || null, email || null, Date.now());
    u = q.userByUid.get(uid);
  } else {
    if (displayName && !u.display_name) {
      q.updateName.run(displayName, uid);
      u.display_name = displayName;
    }
    if (email && u.email !== email) {
      q.updateEmail.run(email, uid);
      u.email = email;
    }
  }
  return u;
}

// ---------- Admin token ----------
const ADMIN_TOKEN = (() => {
  const envTok = process.env.ADMIN_TOKEN;
  const filePath = path.join(__dirname, 'admin-token.txt');
  if (envTok) return envTok;
  if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf8').trim();
  const t = crypto.randomBytes(12).toString('hex');
  fs.writeFileSync(filePath, t);
  console.log(`\n== Admin token généré (voir admin-token.txt) : ${t} ==\n`);
  return t;
})();
const adminSessions = new Map(); // asid -> exp

// ---------- Sessions en mémoire ----------
const sessions = new Map(); // sid -> { uid, exp }
function newSid() { return crypto.randomBytes(24).toString('hex'); }
function createSession(uid) {
  const sid = newSid();
  sessions.set(sid, { uid, exp: Date.now() + SESSION_MS });
  return sid;
}
function readSession(req) {
  const sid = req.cookies?.sid;
  if (!sid) return null;
  const s = sessions.get(sid);
  if (!s || s.exp < Date.now()) { sessions.delete(sid); return null; }
  return { sid, uid: s.uid };
}
const IS_PROD = process.env.NODE_ENV === 'production';
const COOKIE_SECURE = IS_PROD || !!process.env.COOKIE_SECURE;
function setSessionCookie(res, sid) {
  res.cookie('sid', sid, {
    httpOnly: true, sameSite: 'lax', maxAge: SESSION_MS,
    secure: COOKIE_SECURE,
  });
}
function readSessionFromHeader(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  const sid = auth.slice(7).trim();
  if (!sid) return null;
  const s = sessions.get(sid);
  if (!s || s.exp < Date.now()) { sessions.delete(sid); return null; }
  return { sid, uid: s.uid };
}

function authed(req, res, next) {
  const s = readSession(req) || readSessionFromHeader(req);
  if (!s) return res.status(401).json({ error: 'non authentifié' });
  req.uid = s.uid;
  next();
}

function adminAuthed(req, res, next) {
  const asid = req.cookies?.asid;
  const exp = asid && adminSessions.get(asid);
  if (!exp || exp < Date.now()) {
    if (asid) adminSessions.delete(asid);
    logEvent('admin_denied', null, req.ip, req.path);
    return res.status(401).json({ error: 'admin requis' });
  }
  next();
}

// ---------- Rate limiting ----------
const rateMap = new Map(); // key -> { ts, count }
function allow(key, max, windowMs) {
  const now = Date.now();
  const r = rateMap.get(key);
  if (!r || now - r.ts > windowMs) { rateMap.set(key, { ts: now, count: 1 }); return true; }
  r.count++;
  return r.count <= max;
}
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [k, r] of rateMap) if (r.ts < cutoff) rateMap.delete(k);
  for (const [sid, s] of sessions) if (s.exp < Date.now()) sessions.delete(sid);
}, 5 * 60 * 1000).unref();

// ---------- App ----------
const app = express();
app.set('trust proxy', 1);
app.use(cookieParser());
app.use(express.json({ limit: '4kb' }));
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: res => res.setHeader('Cache-Control', 'no-store'),
}));

// ---------- Auth ----------
app.get('/api/auth/mode', (_req, res) => {
  res.json({ firebase: !!firebaseAuth });
});

app.post('/api/auth/firebase', async (req, res) => {
  if (!firebaseAuth) return res.status(503).json({ error: 'firebase-admin indisponible' });
  const ip = req.ip;
  if (!allow('fblogin:' + ip, 20, 60_000)) return res.status(429).json({ error: 'trop de tentatives' });
  const idToken = req.body?.idToken;
  if (typeof idToken !== 'string' || idToken.length < 20) return res.status(400).json({ error: 'token manquant' });
  try {
    const decoded = await firebaseAuth.verifyIdToken(idToken);
    const uid = 'g:' + decoded.uid;
    ensureUser(uid, decoded.name || decoded.email || null, decoded.email || null);
    const sid = createSession(uid);
    setSessionCookie(res, sid);
    const isAdmin = isAdminEmail(decoded.email);
    if (isAdmin) {
      const asid = crypto.randomBytes(24).toString('hex');
      adminSessions.set(asid, Date.now() + SESSION_MS);
      res.cookie('asid', asid, {
        httpOnly: true, sameSite: 'lax', maxAge: SESSION_MS,
        secure: COOKIE_SECURE,
      });
      logEvent('admin_login_ok_via_google', uid, req.ip, decoded.email);
    }
    res.json({ ok: true, admin: isAdmin, token: sid });
  } catch (e) {
    res.status(401).json({ error: 'token invalide' });
  }
});

app.post('/api/auth/demo', (req, res) => {
  const ip = req.ip;
  if (!allow('demo:' + ip, 10, 60_000)) return res.status(429).json({ error: 'trop de tentatives' });
  let uid = req.cookies?.demo_uid;
  if (!uid || !/^demo:[a-f0-9]{16}$/.test(uid)) {
    uid = 'demo:' + crypto.randomBytes(8).toString('hex');
    res.cookie('demo_uid', uid, { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 365 });
  }
  ensureUser(uid, 'Invité (démo)');
  const sid = createSession(uid);
  setSessionCookie(res, sid);
  res.json({ ok: true, demo: true, token: sid });
});

app.post('/api/auth/logout', (req, res) => {
  const sid = req.cookies?.sid;
  if (sid) sessions.delete(sid);
  res.clearCookie('sid');
  res.json({ ok: true });
});

// ---------- Profil / état ----------
app.get('/api/me', authed, (req, res) => {
  const u = q.userByUid.get(req.uid);
  if (!u) return res.status(404).json({ error: 'profil absent' });
  try { q.touchSeen.run(Date.now(), req.uid); } catch {}
  res.json({
    game_id: u.game_id,
    display_name: u.display_name,
    counter: u.counter,
    anti_awk: !!u.anti_awk,
    theme: u.theme,
    is_demo: u.uid.startsWith('demo:'),
    is_admin_candidate: isAdminEmail(u.email),
  });
});

app.post('/api/settings', authed, (req, res) => {
  const { theme, anti_awk } = req.body || {};
  if (theme !== undefined) {
    if (!THEMES.has(theme)) return res.status(400).json({ error: 'thème invalide' });
    q.updTheme.run(theme, req.uid);
  }
  if (anti_awk !== undefined) {
    q.updAntiAwk.run(anti_awk ? 1 : 0, req.uid);
  }
  res.json({ ok: true });
});

app.post('/api/counter', authed, (req, res) => {
  const v = Number(req.body?.value);
  if (!Number.isFinite(v) || v < -1e9 || v > 1e9) return res.status(400).json({ error: 'valeur invalide' });
  q.updCounter.run(Math.trunc(v), req.uid);
  res.json({ ok: true, value: Math.trunc(v) });
});

// ---------- Lancers ----------
app.post('/api/roll', authed, (req, res) => {
  if (!allow('roll:' + req.uid, 30, 10_000)) {
    logEvent('rate_limit_roll', req.uid, req.ip, null);
    return res.status(429).json({ error: 'trop rapide' });
  }
  const n = Math.max(1, Math.min(MAX_DICE, parseInt(req.body?.count, 10) || 1));

  // Priorité 1 : un lancer forcé admin pour ce joueur + ce nombre de dés
  let dice = null;
  let forcedRow = null;
  try {
    forcedRow = qa.pendingForced.get(req.uid, n);
    if (forcedRow) dice = JSON.parse(forcedRow.dice);
  } catch (e) { console.warn('pending forced', e); }

  // Sinon tirage crypto aléatoire côté serveur
  if (!dice) {
    dice = [];
    for (let i = 0; i < n; i++) dice.push(DICE_COLORS[crypto.randomInt(DICE_COLORS.length)]);
  }

  const at = Date.now();
  const isForced = forcedRow ? 1 : 0;
  const ins = q.insertRoll.run(req.uid, JSON.stringify(dice), n, at, isForced);
  q.pruneRolls.run(req.uid, req.uid, HISTORY_LIMIT);
  try { q.touchSeen.run(at, req.uid); } catch {}

  if (forcedRow) {
    try {
      qa.consumeForced.run(at, ins.lastInsertRowid, forcedRow.id);
      logEvent('forced_roll_applied', req.uid, req.ip, `forced_id=${forcedRow.id}`);
    } catch (e) { console.warn('consume forced', e); }
  }

  // Résout une éventuelle prédiction admin en attente (même pour un forced roll).
  try {
    const pending = qa.pendingPred.get(req.uid, n);
    if (pending) {
      const predicted = JSON.parse(pending.predicted);
      let matches = 0;
      for (let i = 0; i < dice.length; i++) if (predicted[i] === dice[i]) matches++;
      const exact = matches === dice.length ? 1 : 0;
      qa.resolvePred.run(at, ins.lastInsertRowid, JSON.stringify(dice), exact, matches, pending.id);
    }
  } catch (e) { console.warn('resolve pred', e); }

  res.json({ dice, count: n, at, forced: !!forcedRow });
});

app.get('/api/history', authed, (req, res) => {
  const rows = q.historyUid.all(req.uid, HISTORY_LIMIT);
  res.json({ rolls: rows.map(r => ({
    dice: JSON.parse(r.dice), count: r.dice_count, at: r.at, forced: !!r.forced,
  })) });
});

// ---------- Lookup public ----------
app.get('/api/lookup/:gid', (req, res) => {
  if (!allow('lookup:' + req.ip, 30, 60_000)) return res.status(429).json({ error: 'trop de requêtes' });
  const gid = (req.params.gid || '').trim();
  if (!/^[A-Za-z0-9]{6,32}$/.test(gid)) return res.status(400).json({ error: 'game id mal formé' });
  const u = q.userByGameId.get(gid);
  if (!u) return res.status(404).json({ error: 'aucun joueur pour ce game id' });
  const last = q.lastRoll.get(u.uid);
  res.json({
    game_id: gid,
    last: last ? { dice: JSON.parse(last.dice), count: last.dice_count, at: last.at } : null,
  });
});

// ---------- Admin ----------
function parsePred(p) {
  return {
    id: p.id,
    target_uid: p.target_uid,
    target_gid: p.target_gid,
    dice_count: p.dice_count,
    predicted: JSON.parse(p.predicted),
    created_at: p.created_at,
    resolved_at: p.resolved_at,
    roll_id: p.roll_id,
    actual: p.actual ? JSON.parse(p.actual) : null,
    exact: p.exact === null ? null : !!p.exact,
    matches: p.matches,
  };
}

app.get('/api/admin/check', (req, res) => {
  const asid = req.cookies?.asid;
  const exp = asid && adminSessions.get(asid);
  res.json({ admin: !!(exp && exp > Date.now()) });
});

app.post('/api/admin/login', (req, res) => {
  if (!allow('alogin:' + req.ip, 8, 60_000)) {
    logEvent('rate_limit_admin_login', null, req.ip, null);
    return res.status(429).json({ error: 'trop de tentatives' });
  }
  const token = String(req.body?.token || '');
  const expected = ADMIN_TOKEN;
  const ok = token.length === expected.length &&
             crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  if (!ok) {
    logEvent('admin_login_fail', null, req.ip, null);
    return res.status(401).json({ error: 'token incorrect' });
  }
  const asid = crypto.randomBytes(24).toString('hex');
  adminSessions.set(asid, Date.now() + SESSION_MS);
  res.cookie('asid', asid, {
    httpOnly: true, sameSite: 'lax', maxAge: SESSION_MS,
    secure: COOKIE_SECURE,
  });
  logEvent('admin_login_ok', null, req.ip, null);
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  const asid = req.cookies?.asid;
  if (asid) adminSessions.delete(asid);
  res.clearCookie('asid');
  res.json({ ok: true });
});

app.get('/api/admin/player/:gid', adminAuthed, (req, res) => {
  const gid = (req.params.gid || '').trim();
  if (!/^[A-Za-z0-9]{6,32}$/.test(gid)) return res.status(400).json({ error: 'game id mal formé' });
  const u = qa.userByGid.get(gid);
  if (!u) return res.status(404).json({ error: 'joueur inconnu' });
  const rolls = qa.historyFull.all(u.uid, HISTORY_LIMIT).map(r => ({
    id: r.id, dice: JSON.parse(r.dice), count: r.dice_count, at: r.at,
  }));
  const online = u.last_seen_at && (Date.now() - u.last_seen_at < 2 * 60_000);
  let commonCount = null;
  if (rolls.length) {
    const c = {};
    for (const r of rolls) c[r.count] = (c[r.count] || 0) + 1;
    commonCount = +Object.entries(c).sort((a, b) => b[1] - a[1])[0][0];
  }
  const preds = qa.predsByTarget.all(u.uid, 50).map(parsePred);
  res.json({
    uid: u.uid, game_id: u.game_id, display_name: u.display_name,
    counter: u.counter, theme: u.theme, anti_awk: !!u.anti_awk,
    created_at: u.created_at, last_seen_at: u.last_seen_at, online,
    common_count: commonCount,
    last_roll: rolls[0] || null,
    history: rolls,
    predictions: preds,
  });
});

app.post('/api/admin/prediction', adminAuthed, (req, res) => {
  const { gid, dice } = req.body || {};
  if (!Array.isArray(dice) || dice.length < 1 || dice.length > MAX_DICE) {
    return res.status(400).json({ error: 'dés invalides' });
  }
  for (const c of dice) if (!DICE_COLORS.includes(c)) return res.status(400).json({ error: 'couleur invalide: ' + c });
  const u = qa.userByGid.get(String(gid || ''));
  if (!u) return res.status(404).json({ error: 'joueur inconnu' });
  const r = qa.insertPred.run(u.uid, u.game_id, dice.length, JSON.stringify(dice), Date.now());
  res.json({ id: r.lastInsertRowid, target_gid: u.game_id, dice, count: dice.length });
});

app.delete('/api/admin/prediction/:id', adminAuthed, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id invalide' });
  const r = qa.deletePred.run(id);
  if (!r.changes) return res.status(400).json({ error: 'déjà résolue ou introuvable' });
  res.json({ ok: true });
});

app.get('/api/admin/predictions', adminAuthed, (_req, res) => {
  res.json({ predictions: qa.predsAll.all(100).map(parsePred) });
});

app.get('/api/admin/alerts', adminAuthed, (_req, res) => {
  res.json({ events: qa.events.all(100) });
});

// Lancer forcé (mode contrôlé par l'administrateur)
app.post('/api/admin/force', adminAuthed, (req, res) => {
  const { gid, dice } = req.body || {};
  if (!Array.isArray(dice) || dice.length < 1 || dice.length > MAX_DICE) {
    return res.status(400).json({ error: 'dés invalides' });
  }
  for (const c of dice) if (!DICE_COLORS.includes(c)) return res.status(400).json({ error: 'couleur invalide: ' + c });
  const u = qa.userByGid.get(String(gid || ''));
  if (!u) return res.status(404).json({ error: 'joueur inconnu' });
  const r = qa.insertForced.run(u.uid, u.game_id, dice.length, JSON.stringify(dice), Date.now());
  logEvent('forced_roll_scheduled', u.uid, req.ip, `forced_id=${r.lastInsertRowid}`);
  res.json({ id: r.lastInsertRowid, target_gid: u.game_id, dice, count: dice.length });
});

app.delete('/api/admin/force/:id', adminAuthed, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id invalide' });
  const r = qa.deleteForced.run(id);
  if (!r.changes) return res.status(400).json({ error: 'déjà consommé ou introuvable' });
  res.json({ ok: true });
});

app.get('/api/admin/forced', adminAuthed, (_req, res) => {
  const rows = qa.forcedAll.all(100).map(r => ({
    id: r.id, target_uid: r.target_uid, target_gid: r.target_gid,
    dice_count: r.dice_count, dice: JSON.parse(r.dice),
    created_at: r.created_at, consumed_at: r.consumed_at, roll_id: r.roll_id,
  }));
  res.json({ forced: rows });
});

app.listen(PORT, () => console.log(`color-dice on http://localhost:${PORT}`));
