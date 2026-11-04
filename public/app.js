// ---------- Constantes ----------
const COLOR_LABEL = {
  red: 'Rouge', orange: 'Orange', yellow: 'Jaune',
  green: 'Vert', blue: 'Bleu', purple: 'Violet',
};
const COLOR_HEX = {
  red: '#ff5555', orange: '#ffa64d', yellow: '#ffe14d',
  green: '#5ee89a', blue: '#5aa9ff', purple: '#c38bff',
};
const THEMES = ['blue', 'purple', 'green', 'red', 'orange', 'black'];
const MAX_DICE = 12;

// ---------- DOM ----------
const $ = sel => document.querySelector(sel);
const body = document.body;
const diceArea = $('#diceArea');
const rollBtn = $('#rollBtn');
const colorSelect = $('#colorSelect');
const countSelect = $('#countSelect');
const gidValue = $('#gidValue');
const gidSub = $('#gidSub');
const copyGidBtn = $('#copyGidBtn');
const counterValueEl = $('#counterValue');
const antiAwkToggle = $('#antiAwkToggle');
const historyBtn = $('#historyBtn');
const historyModal = $('#historyModal');
const historyList = $('#historyList');
const closeHistoryBtn = $('#closeHistoryBtn');
const signInBtn = $('#signInBtn');
const signOutBtn = $('#signOutBtn');
const userBadge = $('#userBadge');
const userAvatar = $('#userAvatar');
const userName = $('#userName');
const modeBanner = $('#modeBanner');
const toastEl = $('#toast');
const lookupForm = $('#lookupForm');
const lookupInput = $('#lookupInput');
const lookupResult = $('#lookupResult');

// init countSelect (hidden) + menu custom
const countMenu = document.getElementById('countMenu');
const countTriggerLabel = document.getElementById('countTriggerLabel');
for (let i = 1; i <= MAX_DICE; i++) {
  const label = i === 1 ? '1 DÉ' : `${i} DÉS`;
  const o = document.createElement('option');
  o.value = String(i);
  o.textContent = label;
  countSelect.appendChild(o);
  const li = document.createElement('li');
  li.setAttribute('role', 'option');
  li.dataset.value = String(i);
  li.textContent = label;
  countMenu.appendChild(li);
}
countSelect.value = '3';
countTriggerLabel.textContent = '3 DÉS';
function syncCountActive() {
  const v = countSelect.value;
  countMenu.querySelectorAll('li').forEach(li => {
    li.classList.toggle('active', li.dataset.value === v);
  });
  const li = countMenu.querySelector(`li[data-value="${v}"]`);
  if (li) countTriggerLabel.textContent = li.textContent;
}
syncCountActive();

// ---------- State ----------
const state = {
  signedIn: false,
  isDemo: false,
  gameId: null,
  counter: 0,
  antiAwk: false,
  theme: 'blue',
  currentDice: [],
  serverHasFirebase: false,
};

// ---------- Utils ----------
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toastEl.classList.add('hidden'), 1800);
}
function fmtDate(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}
async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch {}
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function applyTheme(theme) {
  if (!THEMES.includes(theme)) theme = 'blue';
  state.theme = theme;
  body.dataset.theme = theme;
  if (colorSelect.value !== theme) colorSelect.value = theme;
  const menu = document.getElementById('colorMenu');
  const label = document.getElementById('colorTriggerLabel');
  if (menu && label) {
    const li = menu.querySelector(`li[data-value="${theme}"]`);
    if (li) {
      label.textContent = li.textContent;
      label.style.color = li.style.color;
      menu.querySelectorAll('li').forEach(x => x.classList.toggle('active', x === li));
    }
  }
}

// ---------- Rendu dés ----------
const forcedBanner = document.getElementById('forcedBanner');
function renderDice(colors, { hidden, animate = true, forced = false }) {
  diceArea.innerHTML = '';
  const row = document.createElement('div');
  row.className = 'dice-row';
  colors.forEach((c, idx) => {
    const d = document.createElement('div');
    d.className = 'die';
    d.dataset.color = c;
    d.dataset.idx = idx;
    const pip = document.createElement('div');
    pip.className = 'pip';
    d.appendChild(pip);

    if (animate && !hidden) {
      const perDur = 1500 + Math.random() * 600;
      d.style.setProperty('--shake-dur', perDur + 'ms');
      d.classList.add('shaking');
      setTimeout(() => d.classList.remove('shaking'), perDur);
    }
    if (hidden) {
      d.classList.add('blurred');
      d.title = 'Appuie pour révéler';
      d.addEventListener('click', () => d.classList.remove('blurred'), { once: true });
    }
    row.appendChild(d);
  });
  diceArea.appendChild(row);
  if (forcedBanner) forcedBanner.hidden = !forced;
}

// ---------- Flow utilisateur ----------
function formatCounter(v) { return v > 0 ? '+' + v : String(v); }

async function loadProfile() {
  try {
    const me = await api('/api/me');
    state.signedIn = true;
    state.isDemo = me.is_demo;
    state.gameId = me.game_id;
    state.counter = me.counter;
    state.antiAwk = me.anti_awk;
    state.isAdminCandidate = !!me.is_admin_candidate;
    adminFab.classList.toggle('hidden', !state.isAdminCandidate);
    gidValue.textContent = me.game_id;
    gidSub.textContent = me.is_demo
      ? 'Session démo locale au serveur (Google indispo).'
      : 'Tes tirages sont enregistrés côté serveur sur ton compte.';
    gidSub.classList.add('ok');
    counterValueEl.textContent = formatCounter(me.counter);
    antiAwkToggle.checked = me.anti_awk;
    applyAntiAwkClass();
    applyTheme(me.theme);
    signInBtn.classList.add('hidden');
    userBadge.classList.remove('hidden');
    userName.textContent = me.display_name || (me.is_demo ? 'Invité' : 'Joueur');
    const initial = (userName.textContent || '?')[0].toUpperCase();
    userAvatar.src = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><rect width='24' height='24' rx='12' fill='%230b5fff'/><text x='12' y='17' text-anchor='middle' font-size='14' font-family='sans-serif' fill='white' font-weight='bold'>${initial}</text></svg>`;
    return true;
  } catch {
    showSignedOut();
    return false;
  }
}

function showSignedOut() {
  state.signedIn = false;
  state.gameId = null;
  state.isAdminCandidate = false;
  adminFab.classList.add('hidden');
  gidValue.textContent = '— — — — — —';
  gidSub.textContent = 'Connecte-toi avec Google pour obtenir ton Game ID.';
  gidSub.classList.remove('ok');
  signInBtn.classList.remove('hidden');
  userBadge.classList.add('hidden');
}

async function signInDemo() {
  await api('/api/auth/demo', { method: 'POST' });
  await loadProfile();
}

async function signInGoogle() {
  if (!state.serverHasFirebase) {
    toast('Firebase non configuré côté serveur.');
    return;
  }
  try {
    const cfg = await import('/firebase-config.js');
    if (!cfg.isConfigured) { toast('firebase-config.js : clés manquantes.'); return; }
    const [{ initializeApp }, auth] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js'),
    ]);
    const app = initializeApp(cfg.firebaseConfig);
    const authInst = auth.getAuth(app);
    const provider = new auth.GoogleAuthProvider();
    const { user } = await auth.signInWithPopup(authInst, provider);
    const idToken = await user.getIdToken();
    await api('/api/auth/firebase', { method: 'POST', body: JSON.stringify({ idToken }) });
    await loadProfile();
  } catch (e) {
    toast('Connexion annulée : ' + e.message);
  }
}

async function signOut() {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
  showSignedOut();
}

// ---------- Rolls ----------
async function roll() {
  if (!state.signedIn) { toast('Session manquante, retente.'); return; }
  const n = parseInt(countSelect.value, 10) || 1;
  try {
    const { dice, forced } = await api('/api/roll', { method: 'POST', body: JSON.stringify({ count: n }) });
    state.currentDice = dice;
    state.currentForced = !!forced;
    renderDice(dice, { hidden: state.antiAwk, forced: !!forced });
  } catch (e) {
    toast('Lancer refusé : ' + e.message);
  }
}

// ---------- Counter ----------
let counterTimer = null;
function bumpCounter(delta) {
  state.counter += delta;
  counterValueEl.textContent = formatCounter(state.counter);
  if (!state.signedIn) return;
  clearTimeout(counterTimer);
  counterTimer = setTimeout(async () => {
    try { await api('/api/counter', { method: 'POST', body: JSON.stringify({ value: state.counter }) }); }
    catch (e) { console.warn('counter save:', e); }
  }, 250);
}

// ---------- History modal ----------
async function openHistory() {
  if (!state.signedIn) { toast('Connecte-toi pour voir ton historique.'); return; }
  historyList.innerHTML = '<p class="history-empty">Chargement…</p>';
  historyModal.showModal();
  try {
    const { rolls } = await api('/api/history');
    if (!rolls.length) {
      historyList.innerHTML = '<p class="history-empty">Aucun lancer pour le moment.</p>';
      return;
    }
    historyList.innerHTML = '';
    for (const r of rolls) {
      const item = document.createElement('div');
      item.className = 'history-item';
      const head = document.createElement('div');
      head.className = 'history-head';
      const forcedTag = r.forced ? '<span class="forced-tag">CONTRÔLÉ</span>' : '';
      head.innerHTML = `<span>${fmtDate(r.at)}${forcedTag}</span><span>${r.count} dé${r.count > 1 ? 's' : ''}</span>`;
      const dots = document.createElement('div');
      dots.className = 'history-dice';
      for (const c of r.dice) {
        const dot = document.createElement('div');
        dot.className = 'history-dot' + (state.antiAwk ? ' blurred' : '');
        dot.style.background = COLOR_HEX[c] || '#888';
        dot.title = state.antiAwk ? 'Appuie pour révéler' : (COLOR_LABEL[c] || c);
        if (state.antiAwk) {
          dot.addEventListener('click', () => dot.classList.remove('blurred'), { once: true });
        }
        dots.appendChild(dot);
      }
      item.appendChild(head);
      item.appendChild(dots);
      historyList.appendChild(item);
    }
  } catch (e) {
    historyList.innerHTML = `<p class="history-empty">Erreur : ${e.message}</p>`;
  }
}

// ---------- Lookup public ----------
async function lookup(gid) {
  gid = (gid || '').trim();
  if (!/^[A-Za-z0-9]{6,32}$/.test(gid)) {
    lookupResult.innerHTML = `<p class="lookup-msg err">Game ID mal formé (6–32 caractères alphanumériques).</p>`;
    return;
  }
  lookupResult.innerHTML = `<p class="lookup-msg">Recherche…</p>`;
  try {
    const data = await api(`/api/lookup/${encodeURIComponent(gid)}`);
    renderLookup(data);
  } catch (e) {
    lookupResult.innerHTML = `<p class="lookup-msg err">${e.message}</p>`;
  }
}
function renderLookup(data) {
  const { game_id, last } = data;
  if (!last) {
    lookupResult.innerHTML = `
      <div class="lookup-card">
        <div class="lookup-gid">${game_id}</div>
        <p class="lookup-msg">Aucun lancer officiel enregistré pour ce joueur.</p>
      </div>`;
    return;
  }
  const dots = last.dice.map(c => {
    const label = (COLOR_LABEL[c] || c).toUpperCase();
    return `<div class="lookup-die" style="background:${COLOR_HEX[c] || '#888'}" title="${label}"><div class="pip"></div></div>`;
  }).join('');
  lookupResult.innerHTML = `
    <div class="lookup-card">
      <div class="lookup-gid">${game_id}</div>
      <div class="lookup-dice">${dots}</div>
      <div class="lookup-meta">${last.count} dé${last.count > 1 ? 's' : ''} · ${fmtDate(last.at)}</div>
    </div>`;
}

// ---------- Wiring ----------
rollBtn.addEventListener('click', roll);

colorSelect.addEventListener('change', async () => {
  applyTheme(colorSelect.value);
  if (state.signedIn) {
    try { await api('/api/settings', { method: 'POST', body: JSON.stringify({ theme: state.theme }) }); }
    catch (e) { console.warn('theme save:', e); }
  }
});

document.querySelectorAll('.counter-btn').forEach(b => {
  b.addEventListener('click', () => bumpCounter(parseInt(b.dataset.delta, 10)));
});

antiAwkToggle.addEventListener('change', async () => {
  state.antiAwk = antiAwkToggle.checked;
  if (state.signedIn) {
    try { await api('/api/settings', { method: 'POST', body: JSON.stringify({ anti_awk: state.antiAwk }) }); }
    catch (e) { console.warn('antiAwk save:', e); }
  }
  if (state.currentDice.length) {
    renderDice(state.currentDice, { hidden: state.antiAwk, animate: false });
  }
});

copyGidBtn.addEventListener('click', async () => {
  const id = gidValue.textContent.trim();
  if (!id || id.includes('—')) { toast('Pas de Game ID actuel.'); return; }
  try {
    await navigator.clipboard.writeText(id);
    toast('Game ID copié : ' + id);
  } catch { toast('Impossible de copier automatiquement.'); }
});

historyBtn.addEventListener('click', openHistory);
closeHistoryBtn.addEventListener('click', () => historyModal.close());

signInBtn.addEventListener('click', signInGoogle);
signOutBtn.addEventListener('click', signOut);

if (lookupForm) {
  lookupForm.addEventListener('submit', e => {
    e.preventDefault();
    lookup(lookupInput.value);
  });
}

// ---------- Custom listbox ----------
function initPillMenu({ triggerId, menuId, selectEl, onSelect }) {
  const trigger = document.getElementById(triggerId);
  const menu = document.getElementById(menuId);
  if (!trigger || !menu) return;
  function close() { menu.hidden = true; trigger.setAttribute('aria-expanded', 'false'); }
  function open() {
    document.querySelectorAll('.pill-menu').forEach(m => { if (m !== menu) m.hidden = true; });
    document.querySelectorAll('.pill-trigger').forEach(t => { if (t !== trigger) t.setAttribute('aria-expanded', 'false'); });
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
  }
  trigger.addEventListener('click', e => { e.stopPropagation(); menu.hidden ? open() : close(); });
  menu.addEventListener('click', e => {
    const li = e.target.closest('li[role="option"]');
    if (!li) return;
    selectEl.value = li.dataset.value;
    selectEl.dispatchEvent(new Event('change'));
    if (onSelect) onSelect(li);
    close();
  });
  document.addEventListener('click', e => {
    if (!trigger.contains(e.target) && !menu.contains(e.target)) close();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) close(); });
}
initPillMenu({ triggerId: 'colorTrigger', menuId: 'colorMenu', selectEl: colorSelect });
initPillMenu({
  triggerId: 'countTrigger', menuId: 'countMenu',
  selectEl: countSelect, onSelect: syncCountActive,
});
countSelect.addEventListener('change', syncCountActive);

// ---------- Admin panel ----------
const adminFab = $('#adminFab');
const adminLoginDialog = $('#adminLogin');
const adminLoginForm = $('#adminLoginForm');
const adminTokenInput = $('#adminTokenInput');
const adminLoginMsg = $('#adminLoginMsg');
const adminLoginCancel = $('#adminLoginCancel');
const adminPanelDialog = $('#adminPanel');
const adminPanelClose = $('#adminPanelClose');
const adminLogoutBtn = $('#adminLogoutBtn');
const adminSearchForm = $('#adminSearchForm');
const adminSearchInput = $('#adminSearchInput');
const adminPlayer = $('#adminPlayer');
const adminPredictSection = $('#adminPredictSection');
const adminPredCount = $('#adminPredCount');
const adminPredDice = $('#adminPredDice');
const adminSavePrediction = $('#adminSavePrediction');
const adminPredMsg = $('#adminPredMsg');
const adminPredictions = $('#adminPredictions');
const adminAlerts = $('#adminAlerts');
const adminForceRoll = $('#adminForceRoll');
const adminForced = $('#adminForced');

const PRED_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'];
let adminCurrentGid = null;
let adminIsLogged = false;

for (let i = 1; i <= MAX_DICE; i++) {
  const o = document.createElement('option');
  o.value = String(i);
  o.textContent = i === 1 ? '1 dé' : `${i} dés`;
  adminPredCount.appendChild(o);
}
adminPredCount.value = '3';

function fmtDateShort(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}
function dotRow(colors) {
  return colors.map(c =>
    `<div class="ap-dot" style="background:${COLOR_HEX[c] || '#888'}" title="${COLOR_LABEL[c] || c}"></div>`
  ).join('');
}

async function adminCheck() {
  try {
    const r = await api('/api/admin/check');
    adminIsLogged = !!r.admin;
  } catch { adminIsLogged = false; }
  adminFab.classList.toggle('admin-on', adminIsLogged);
}

adminFab.addEventListener('click', () => {
  if (adminIsLogged) openAdminPanel();
  else { adminTokenInput.value = ''; adminLoginMsg.textContent = ''; adminLoginDialog.showModal(); }
});
adminLoginCancel.addEventListener('click', () => adminLoginDialog.close());

adminLoginForm.addEventListener('submit', async e => {
  e.preventDefault();
  adminLoginMsg.textContent = 'Vérification…';
  adminLoginMsg.classList.remove('ok');
  try {
    await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ token: adminTokenInput.value }) });
    adminLoginDialog.close();
    adminIsLogged = true;
    adminFab.classList.add('admin-on');
    openAdminPanel();
  } catch (e) {
    adminLoginMsg.textContent = e.message;
  }
});

adminPanelClose.addEventListener('click', () => adminPanelDialog.close());
adminLogoutBtn.addEventListener('click', async () => {
  try { await api('/api/admin/logout', { method: 'POST' }); } catch {}
  adminIsLogged = false;
  adminFab.classList.remove('admin-on');
  adminPanelDialog.close();
});

async function openAdminPanel() {
  adminPanelDialog.showModal();
  adminPlayer.innerHTML = '';
  adminPredictSection.hidden = true;
  await Promise.all([loadPredictions(), loadAlerts(), loadForced()]);
}

async function loadForced() {
  try {
    const { forced } = await api('/api/admin/forced');
    if (!forced.length) { adminForced.innerHTML = ''; return; }
    adminForced.innerHTML = forced.map(renderForcedItem).join('');
    adminForced.querySelectorAll('.ai-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Supprimer ce lancer forcé non encore consommé ?')) return;
        try { await api(`/api/admin/force/${btn.dataset.id}`, { method: 'DELETE' }); loadForced(); }
        catch (e) { toast(e.message); }
      });
    });
  } catch (e) {
    adminForced.innerHTML = `<p style="color:#ffd0d0">${e.message}</p>`;
  }
}

function renderForcedItem(f) {
  const consumed = f.consumed_at !== null;
  const badge = consumed
    ? `<span class="ai-badge consumed">CONSOMMÉ</span>`
    : `<span class="ai-badge forced">EN ATTENTE</span>`;
  const delBtn = consumed ? '' : `<button class="ai-del" data-id="${f.id}">Supprimer</button>`;
  return `
    <div class="admin-item">
      <div class="ai-head">
        <span>${f.target_gid}</span>
        ${badge}
      </div>
      <div class="ai-vs">RÉSULTAT PROGRAMMÉ (${f.dice_count} dés)</div>
      <div class="ai-dots">${dotRow(f.dice)}</div>
      <div class="ai-vs" style="margin-top:8px">${fmtDateShort(f.created_at)}${consumed ? ' · consommé ' + fmtDateShort(f.consumed_at) : ''}</div>
      ${delBtn ? `<div style="margin-top:6px">${delBtn}</div>` : ''}
    </div>`;
}

adminForceRoll.addEventListener('click', async () => {
  // Fallback : si pas de search validé, prend le gid tel que tapé dans l'input
  const gid = adminCurrentGid || adminSearchInput.value.trim();
  if (!gid) { adminPredMsg.textContent = 'Entre un Game ID avant de forcer.'; return; }
  const dice = Array.from(adminPredDice.querySelectorAll('select')).map(s => s.value);
  adminPredMsg.textContent = 'Programmation…';
  adminPredMsg.classList.remove('ok');
  try {
    const r = await api('/api/admin/force', { method: 'POST', body: JSON.stringify({ gid, dice }) });
    adminPredMsg.textContent = `✓ Lancer forcé #${r.id} armé pour ${r.target_gid} : ${r.dice.join(' / ')} (${r.count} dés). Le joueur DOIT relancer avec exactement ${r.count} dés pour le déclencher.`;
    adminPredMsg.classList.add('ok');
    adminCurrentGid = r.target_gid;
    loadForced();
  } catch (e) {
    adminPredMsg.textContent = 'Erreur : ' + e.message;
  }
});

adminSearchForm.addEventListener('submit', async e => {
  e.preventDefault();
  const gid = adminSearchInput.value.trim();
  if (!gid) return;
  adminPlayer.innerHTML = '<p style="opacity:.7">Chargement…</p>';
  try {
    const data = await api(`/api/admin/player/${encodeURIComponent(gid)}`);
    renderAdminPlayer(data);
    adminCurrentGid = data.game_id;
    adminPredictSection.hidden = false;
    adminPredCount.value = String(data.common_count || data.last_roll?.count || 3);
    rebuildPredDice();
  } catch (e) {
    adminPlayer.innerHTML = `<p style="color:#ffd0d0">${e.message}</p>`;
    adminPredictSection.hidden = true;
  }
});

function renderAdminPlayer(p) {
  const last = p.last_roll
    ? `<div class="ap-row"><span class="ap-date">${fmtDateShort(p.last_roll.at)}</span><div class="ap-dots">${dotRow(p.last_roll.dice)}</div></div>`
    : `<p style="opacity:.6">Aucun lancer.</p>`;
  const hist = p.history.slice(0, 20).map(r => `
    <div class="ap-row">
      <span class="ap-date">${fmtDateShort(r.at)}</span>
      <div class="ap-dots">${dotRow(r.dice)}</div>
    </div>`).join('');
  adminPlayer.innerHTML = `
    <div class="ap-head">
      <div class="ap-gid">${p.game_id}</div>
      <span class="ap-online ${p.online ? 'on' : 'off'}">${p.online ? 'EN LIGNE' : 'HORS LIGNE'}</span>
    </div>
    <div class="ap-grid">
      <div><b>Pseudo</b>${p.display_name || '—'}</div>
      <div><b>Thème</b>${p.theme}</div>
      <div><b>Compteur</b>${p.counter}</div>
      <div><b>Dés habituels</b>${p.common_count ?? '—'}</div>
      <div><b>Créé le</b>${fmtDateShort(p.created_at)}</div>
      <div><b>Vu à</b>${fmtDateShort(p.last_seen_at)}</div>
    </div>
    <h4 style="margin:10px 0 6px;font-size:12px;letter-spacing:1px;opacity:.75;text-transform:uppercase">Dernier lancer</h4>
    ${last}
    <h4 style="margin:10px 0 6px;font-size:12px;letter-spacing:1px;opacity:.75;text-transform:uppercase">20 derniers lancers</h4>
    <div class="ap-history">${hist || '<p style="opacity:.6">—</p>'}</div>
  `;
}

function rebuildPredDice() {
  const n = parseInt(adminPredCount.value, 10) || 1;
  adminPredDice.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const wrap = document.createElement('div');
    wrap.className = 'pred-die';
    const swatch = document.createElement('div');
    swatch.className = 'pred-swatch';
    const sel = document.createElement('select');
    for (const c of PRED_COLORS) {
      const o = document.createElement('option');
      o.value = c;
      o.textContent = COLOR_LABEL[c];
      sel.appendChild(o);
    }
    sel.value = PRED_COLORS[i % PRED_COLORS.length];
    swatch.style.background = COLOR_HEX[sel.value];
    sel.addEventListener('change', () => { swatch.style.background = COLOR_HEX[sel.value]; });
    wrap.appendChild(swatch);
    wrap.appendChild(sel);
    adminPredDice.appendChild(wrap);
  }
}
adminPredCount.addEventListener('change', rebuildPredDice);

adminSavePrediction.addEventListener('click', async () => {
  const gid = adminCurrentGid || adminSearchInput.value.trim();
  if (!gid) { adminPredMsg.textContent = 'Entre un Game ID avant d\'enregistrer.'; return; }
  const dice = Array.from(adminPredDice.querySelectorAll('select')).map(s => s.value);
  adminPredMsg.textContent = 'Enregistrement…';
  adminPredMsg.classList.remove('ok');
  try {
    const r = await api('/api/admin/prediction', { method: 'POST', body: JSON.stringify({ gid, dice }) });
    adminPredMsg.textContent = `Prédiction #${r.id} enregistrée pour ${r.target_gid} (${r.count} dés). Elle se résoudra quand ${r.target_gid} relancera avec ${r.count} dés.`;
    adminPredMsg.classList.add('ok');
    adminCurrentGid = r.target_gid;
    loadPredictions();
  } catch (e) {
    adminPredMsg.textContent = 'Erreur : ' + e.message;
  }
});

// Auto-refresh tant que le panel admin est ouvert : prédictions + alertes
let adminRefreshTimer = null;
const _origOpenAdminPanel = openAdminPanel;
openAdminPanel = async function () {
  await _origOpenAdminPanel();
  clearInterval(adminRefreshTimer);
  adminRefreshTimer = setInterval(() => {
    if (!adminPanelDialog.open) { clearInterval(adminRefreshTimer); return; }
    loadPredictions();
    loadAlerts();
    loadForced();
  }, 4000);
};
adminPanelDialog.addEventListener('close', () => clearInterval(adminRefreshTimer));

async function loadPredictions() {
  try {
    const { predictions } = await api('/api/admin/predictions');
    if (!predictions.length) { adminPredictions.innerHTML = ''; return; }
    adminPredictions.innerHTML = predictions.map(renderPredItem).join('');
    adminPredictions.querySelectorAll('.ai-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Supprimer cette prédiction en attente ?')) return;
        try { await api(`/api/admin/prediction/${btn.dataset.id}`, { method: 'DELETE' }); loadPredictions(); }
        catch (e) { toast(e.message); }
      });
    });
  } catch (e) {
    adminPredictions.innerHTML = `<p style="color:#ffd0d0">${e.message}</p>`;
  }
}

function renderPredItem(p) {
  let badge, badgeClass;
  if (p.resolved_at === null) { badge = 'EN ATTENTE'; badgeClass = 'pending'; }
  else if (p.exact) { badge = 'EXACTE'; badgeClass = 'exact'; }
  else if (p.matches > 0) { badge = `${p.matches}/${p.dice_count}`; badgeClass = 'partial'; }
  else { badge = 'RATÉE'; badgeClass = 'miss'; }
  const actualRow = p.actual
    ? `<div class="ai-vs">RÉSULTAT OFFICIEL</div><div class="ai-dots">${dotRow(p.actual)}</div>`
    : '';
  const delBtn = p.resolved_at === null
    ? `<button class="ai-del" data-id="${p.id}">Supprimer</button>`
    : '';
  return `
    <div class="admin-item">
      <div class="ai-head">
        <span>${p.target_gid}</span>
        <span class="ai-badge ${badgeClass}">${badge}</span>
      </div>
      <div class="ai-vs">MA PRÉDICTION</div>
      <div class="ai-dots">${dotRow(p.predicted)}</div>
      ${actualRow}
      <div class="ai-vs" style="margin-top:8px">${fmtDateShort(p.created_at)}${p.resolved_at ? ' · résolue ' + fmtDateShort(p.resolved_at) : ''}</div>
      ${delBtn ? `<div style="margin-top:6px">${delBtn}</div>` : ''}
    </div>`;
}

async function loadAlerts() {
  try {
    const { events } = await api('/api/admin/alerts');
    if (!events.length) { adminAlerts.innerHTML = ''; return; }
    adminAlerts.innerHTML = events.map(e => `
      <div class="admin-item">
        <div class="ai-head">
          <span>${e.kind}</span>
          <span class="ai-vs">${fmtDateShort(e.at)}</span>
        </div>
        <div style="opacity:.85;font-size:12.5px">
          ${e.uid ? `<span><b>uid</b> ${e.uid}</span>  ` : ''}
          ${e.ip ? `<span><b>ip</b> ${e.ip}</span>  ` : ''}
          ${e.detail ? `<span><b>détail</b> ${e.detail}</span>` : ''}
        </div>
      </div>`).join('');
  } catch (e) {
    adminAlerts.innerHTML = `<p style="color:#ffd0d0">${e.message}</p>`;
  }
}

adminCheck();

// ---------- Boot ----------
(async () => {
  try {
    const mode = await api('/api/auth/mode');
    state.serverHasFirebase = !!mode.firebase;
  } catch {}
  await loadProfile();
})();
