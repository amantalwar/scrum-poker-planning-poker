(() => {
'use strict';

/* ---------- helpers ---------- */
const PEER_PREFIX = 'aman-planning-poker-';
const COLORS = ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#00acc1', '#1e88e5', '#5e35b1', '#d81b60'];
const LS_GAMES = 'pp_games_v1', LS_ME = 'pp_me_v1';
/* STUN finds each player's public address; TURN relays traffic when a direct link is blocked (mobile data, office networks). */
const PEER_OPTS = { config: { iceServers: [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'turn:eu-0.turn.peerjs.com:3478', username: 'peerjs', credential: 'peerjsp' },
  { urls: 'turn:us-0.turn.peerjs.com:3478', username: 'peerjs', credential: 'peerjsp' },
  { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turns:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' }
] }, debug: 1 };
const JOIN_TIMEOUT_MS = 20000;
const ALPHABET ='ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } };
const uid = () => Math.random().toString(36).slice(2, 10);
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), b => ALPHABET[b % ALPHABET.length]).join('');
const num = v => (v !== null && v !== '' && !isNaN(Number(v))) ? Number(v) : null;

function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'value') e.value = v;
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  kids.flat(Infinity).forEach(c => { if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c))); });
  return e;
}

/* Small, safe Markdown: input is HTML-escaped first, then a few patterns are converted. */
function markdown(src) {
  const esc = String(src || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const inline = s => s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\*([^*]+)\*/g, '<i>$1</i>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  const out = []; let inList = false;
  for (const line of esc.split('\n')) {
    const li = line.match(/^\s*[-*]\s+(.*)/);
    if (li) { if (!inList) { out.push('<ul>'); inList = true; } out.push('<li>' + inline(li[1]) + '</li>'); continue; }
    if (inList) { out.push('</ul>'); inList = false; }
    out.push(line.trim() ? '<p>' + inline(line) + '</p>' : '');
  }
  if (inList) out.push('</ul>');
  const d = h('div', { class: 'md' }); d.innerHTML = out.join(''); return d;
}

function resizeImage(file, max = 900) {
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = h('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Not an image')); };
    img.src = url;
  });
}

const isDark = i => i % COLORS.length === 2; // yellow needs dark text
const color = i => COLORS[i % COLORS.length];

/* ---------- state ---------- */
const root = document.getElementById('app');
let me = load(LS_ME, null) || { pid: uid(), name: '' };
let games = load(LS_GAMES, []);
let session = null; // { role, peer, conns, game, state, players, view, ui, conn }
const saveMe = () => save(LS_ME, me);
const saveGames = () => save(LS_GAMES, games);

/* ---------- home ---------- */
function panel(title, ...body) { return h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, title), body); }

function renderHome() {
  closeSession();
  const joinInput = h('input', { type: 'text', placeholder: 'Game code', maxlength: '8', 'aria-label': 'Game code', style: 'max-width:160px;text-transform:uppercase' });
  const list = games.length
    ? games.map(g => h('div', { class: 'game-row' },
        h('span', { class: 'name' }, g.name),
        h('span', { class: 'meta' }, `${g.items.length} item${g.items.length === 1 ? '' : 's'} · scale ${g.scale.join(', ')}`),
        h('button', { class: 'green small', onclick: () => startHost(g) }, 'Open'),
        h('button', { class: 'red small', onclick: () => { if (confirm(`Delete "${g.name}"?`)) { games = games.filter(x => x !== g); saveGames(); renderHome(); } } }, 'Delete')))
    : h('div', { class: 'empty' }, 'Click above button to create a new game.');
  root.replaceChildren(
    h('h1', { class: 'brand' }, 'Scrum Poker, Planning Poker'),
    panel('Your Games',
      h('div', { class: 'panel-bar' },
        h('span', { class: 'grow' }, 'Have a code?'), joinInput,
        h('button', { class: 'orange', onclick: () => { const c = joinInput.value.trim().toUpperCase(); if (c) renderJoin(c); } }, 'Join Game'),
        h('button', { onclick: openNewGame }, 'New Game')),
      h('div', { class: 'panel-body' }, list)),
    h('p', { class: 'footer' }, 'Free Scrum Poker, Planning Poker by ', h('a', { href: 'https://amantalwar.com' }, 'Aman Talwar'), '. Games are saved in this browser only.'));
}

function modal(title, body) {
  const back = h('div', { class: 'modal-back', onmousedown: e => { if (e.target === back) back.remove(); } },
    h('div', { class: 'modal', role: 'dialog', 'aria-label': title }, h('div', { class: 'panel-head' }, title), body));
  document.body.append(back); return back;
}

function openNewGame() {
  const name = h('input', { type: 'text', 'aria-label': 'Game name' });
  const scale = h('input', { type: 'text', value: '?,0,1,2,3,5,8,13,20,40,100', 'aria-label': 'Item estimate scale' });
  const timer = h('select', { 'aria-label': 'Per-item timer' }, [['0', 'Disabled'], ['60', '60 seconds'], ['90', '90 seconds'], ['120', '120 seconds']].map(([v, t]) => h('option', { value: v }, t)));
  const auto = h('input', { type: 'checkbox', checked: true });
  const radio = (v, t, on) => h('label', null, h('input', { type: 'radio', name: 'tri', value: v, checked: on }), t);
  const err = h('div', { class: 'hint', style: 'color:#c62828' });
  const m = modal('New Game', h('div', { class: 'panel-body' },
    h('div', { class: 'field' }, h('label', null, 'Game Name'), name, h('div', { class: 'hint' }, 'Enter a descriptive name that helps identify this game.')),
    h('div', { class: 'section-title' }, 'Game Play'),
    h('div', { class: 'row' },
      h('div', { class: 'field' }, h('label', null, 'Item Estimate Scale'), scale, h('div', { class: 'hint' }, 'Separate your choices with commas.')),
      h('div', { class: 'field' }, h('label', null, 'Per-Item Timer'), timer, h('div', { class: 'hint' }, 'An optional timer counting down while estimating.'))),
    h('div', { class: 'field' }, h('label', { class: 'switch' }, auto, h('span', { class: 'track' }), 'Allow Auto-Triangulation')),
    h('div', { class: 'field radios' }, h('b', null, 'Triangulate From Items'), radio('fav', 'In Favorites', true), radio('current', 'Current Game'), radio('both', 'Favorites + Current Game')),
    h('p', { class: 'center' }, 'You will be able to invite players and add or import items after you start.'), err,
    h('div', { style: 'display:flex;gap:10px' },
      h('button', {
        onclick: () => {
          const vals = [...new Set(scale.value.split(',').map(s => s.trim()).filter(Boolean))];
          if (!name.value.trim()) { err.textContent = 'Please enter a game name.'; name.focus(); return; }
          if (vals.length < 2) { err.textContent = 'Enter at least two estimate values, separated by commas.'; return; }
          const g = { id: uid(), code: newCode(), name: name.value.trim(), scale: vals, timer: Number(timer.value), autoTri: auto.checked,
            triFrom: m.querySelector('input[name=tri]:checked').value, items: [], created: Date.now() };
          games.unshift(g); saveGames(); m.remove(); startHost(g);
        }
      }, 'Save'),
      h('button', { class: 'grey', onclick: () => m.remove() }, 'Cancel'))));
  name.focus();
}

/* ---------- join screen (guest) ---------- */
function renderJoin(code) {
  closeSession();
  const name = h('input', { type: 'text', value: me.name, maxlength: '30', 'aria-label': 'Your display name' });
  const go = () => { if (!name.value.trim()) { name.focus(); return; } me.name = name.value.trim(); saveMe(); startGuest(code); };
  name.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  root.replaceChildren(panel('Join Game', h('div', { class: 'panel-body' },
    h('p', null, 'Game code: ', h('b', null, code)),
    h('div', { class: 'field' }, h('label', null, 'Your display name'), name),
    h('div', { style: 'display:flex;gap:10px' }, h('button', { class: 'green', onclick: go }, 'Join'), h('button', { class: 'grey', onclick: () => { history.replaceState(null, '', location.pathname); renderHome(); } }, 'Cancel')))));
  name.focus();
}

/* ---------- networking ---------- */
function closeSession() {
  if (!session) return;
  clearInterval(session.tick);
  try { session.peer && session.peer.destroy(); } catch { /* already closed */ }
  session = null;
}

function startHost(game) {
  closeSession();
  if (!me.name) { const n = prompt('Your display name?', ''); if (!n || !n.trim()) return; me.name = n.trim().slice(0, 30); saveMe(); }
  session = { role: 'host', game, conns: new Map(), players: new Map(), state: { revealed: false, currentId: null, timerEnd: null }, status: 'Connecting…' };
  session.players.set(me.pid, { name: me.name, vote: null, online: true });
  buildRoom();
  const peer = new Peer(PEER_PREFIX + game.code, PEER_OPTS);
  session.peer = peer;
  peer.on('open', () => { session.status = ''; broadcast(); });
  // If the link to the signalling server drops, players can no longer find this game until we reconnect.
  peer.on('disconnected', () => { if (session && session.peer === peer && !peer.destroyed) { session.status = 'Reconnecting…'; updateRoom(); setTimeout(() => { try { peer.reconnect(); } catch { /* destroyed */ } }, 1000); } });
  peer.on('connection', conn => {
    conn.on('data', m => onHostMessage(conn, m));
    conn.on('close', () => { if (conn.pid && session.conns.get(conn.pid) === conn) { session.conns.delete(conn.pid); const p = session.players.get(conn.pid); if (p) p.online = false; broadcast(); } });
  });
  peer.on('error', e => {
    session.status = e.type === 'unavailable-id' ? 'This game is already open in another tab or window. Close that one first, then reopen the game.'
      : 'Connection problem (' + e.type + '). Players may not be able to join. Check your network and reopen the game.';
    updateRoom();
  });
  session.tick = setInterval(tick, 250);
}

function onHostMessage(conn, m) {
  if (!m || typeof m !== 'object') return;
  if (m.type === 'join') {
    const pid = String(m.pid || '').slice(0, 20), name = String(m.name || 'Guest').slice(0, 30);
    if (!pid) return;
    conn.pid = pid; session.conns.set(pid, conn);
    const old = session.players.get(pid);
    session.players.set(pid, { name, vote: old ? old.vote : null, online: true });
    broadcast();
  } else if (m.type === 'vote' && conn.pid) {
    const p = session.players.get(conn.pid), v = m.value === null ? null : String(m.value);
    if (p && session.state.currentId && !session.state.revealed && (v === null || session.game.scale.includes(v))) { p.vote = v; broadcast(); }
  }
}

function viewFor(pid) {
  const { game, state, players } = session;
  const cur = game.items.find(i => i.id === state.currentId) || null;
  return {
    name: game.name, scale: game.scale, code: game.code, revealed: state.revealed, hostPid: me.pid,
    timerLeft: state.timerEnd && !state.revealed ? Math.max(0, state.timerEnd - Date.now()) : null,
    items: game.items.map(i => ({ id: i.id, title: i.title, estimate: i.estimate, fav: !!i.fav })),
    current: cur ? { id: cur.id, title: cur.title, details: cur.details || '', images: cur.images || [] } : null,
    players: [...players].map(([id, p]) => ({ id, name: p.name, online: p.online, voted: p.vote != null,
      vote: (state.revealed || id === pid) ? p.vote : undefined })),
    tri: state.revealed ? triangulate() : []
  };
}

function broadcast() {
  if (session.role !== 'host') return;
  session.view = viewFor(me.pid); session.viewAt = Date.now();
  for (const [pid, c] of session.conns) { try { if (c.open) c.send({ type: 'state', view: viewFor(pid) }); } catch { /* peer gone */ } }
  updateRoom();
}

function startGuest(code) {
  closeSession();
  session = { role: 'guest', code, status: 'Connecting to game…', view: null };
  buildRoom();
  const peer = new Peer(PEER_OPTS);
  session.peer = peer;
  const fail = msg => { if (session && session.peer === peer && !(session.view)) { session.status = msg; session.failed = true; updateRoom(); } };
  const timeout = setTimeout(() => fail('Could not connect to the host. Make sure the host still has the game open in their browser. If you are on a work network or VPN, try mobile data or another network.'), JOIN_TIMEOUT_MS);
  peer.on('open', () => {
    const conn = peer.connect(PEER_PREFIX + code, { reliable: true });
    session.conn = conn;
    conn.on('error', e => fail('Connection problem (' + (e.type || e) + ').'));
    conn.on('open', () => { clearTimeout(timeout); session.status = 'Joined, waiting for the host…'; session.failed = false; updateRoom(); conn.send({ type: 'join', pid: me.pid, name: me.name }); });
    conn.on('data', m => { if (m && m.type === 'state' && m.view) { session.view = m.view; session.viewAt = Date.now(); session.status = ''; updateRoom(); } });
    conn.on('close', () => { session.status = 'Disconnected: the host has left or lost connection.'; updateRoom(); });
  });
  peer.on('error', e => {
    session.status = e.type === 'peer-unavailable' ? 'Game not found. The host needs to have the game open, and the code must be correct.' : 'Connection problem (' + e.type + ').';
    updateRoom();
  });
  session.tick = setInterval(tick, 250);
}

/* ---------- host actions ---------- */
const hostOnly = f => (...a) => { if (session && session.role === 'host') f(...a); };
const persist = () => { saveGames(); broadcast(); };

const act = {
  select: hostOnly(id => {
    const { game, state, players } = session;
    state.currentId = id; state.revealed = false; state.timerEnd = game.timer ? Date.now() + game.timer * 1000 : null;
    players.forEach(p => { p.vote = null; }); broadcast();
  }),
  reveal: hostOnly(() => { if (session.state.currentId) { session.state.revealed = true; session.state.timerEnd = null; broadcast(); } }),
  revote: hostOnly(() => act.select(session.state.currentId)),
  estimate: hostOnly(v => {
    const it = session.game.items.find(i => i.id === session.state.currentId);
    if (it) { it.estimate = v; it.estimatedAt = Date.now(); persist(); }
  }),
  saveItem: hostOnly((item) => {
    const items = session.game.items, i = items.findIndex(x => x.id === item.id);
    if (i >= 0) items[i] = { ...items[i], ...item }; else items.push(item);
    persist();
  }),
  removeItem: hostOnly(id => {
    session.game.items = session.game.items.filter(i => i.id !== id);
    if (session.state.currentId === id) { session.state.currentId = null; session.state.revealed = false; session.state.timerEnd = null; }
    persist();
  }),
  fav: hostOnly(id => { const it = session.game.items.find(i => i.id === id); if (it) { it.fav = !it.fav; persist(); } })
};

function castVote(v) {
  if (!session || !session.view || !session.view.current || session.view.revealed) return;
  const mine = session.view.players.find(p => p.id === me.pid);
  const value = mine && mine.vote === v ? null : v;
  if (session.role === 'host') hostVote(value);
  else if (session.conn && session.conn.open) session.conn.send({ type: 'vote', value });
}
function hostVote(value) {
  const p = session.players.get(me.pid);
  if (p && session.state.currentId && !session.state.revealed) { p.vote = value; broadcast(); }
}

function allGameItems() { return games.flatMap(g => g.items.map(i => ({ ...i, game: g.name }))); }

function triangulate() {
  const { game, state, players } = session;
  if (!game.autoTri) return [];
  const nums = [...players.values()].map(p => num(p.vote)).filter(n => n !== null);
  if (!nums.length) return [];
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
  const pool = new Map();
  if (game.triFrom !== 'current') allGameItems().filter(i => i.fav).forEach(i => pool.set(i.id, i));
  if (game.triFrom !== 'fav') game.items.forEach(i => pool.set(i.id, i));
  return [...pool.values()].filter(i => i.id !== state.currentId && num(i.estimate) !== null)
    .sort((a, b) => Math.abs(num(a.estimate) - avg) - Math.abs(num(b.estimate) - avg))
    .slice(0, 4).map(i => ({ title: i.title, estimate: i.estimate }));
}

/* ---------- timer ---------- */
function tick() {
  if (!session || !session.view || !session.ui) return;
  const v = session.view, el = session.ui.timer;
  if (v.timerLeft != null && !v.revealed) {
    const left = Math.max(0, Math.ceil((v.timerLeft - (Date.now() - session.viewAt)) / 1000));
    el.textContent = '⏱ ' + left + 's';
    if (left === 0 && session.role === 'host') act.reveal();
  } else el.textContent = '';
}

/* ---------- room UI ---------- */
function buildRoom() {
  const isHost = session.role === 'host';
  const ui = session.ui = {
    status: h('div', { class: 'notice', role: 'status' }),
    title: h('div'), timer: h('div', { class: 'timer', 'aria-live': 'off' }), cards: h('div', { class: 'cards' }), results: h('div'),
    players: h('ul', { class: 'players' }), items: h('ul', { class: 'items' }), invite: h('div'), head: h('div', { class: 'panel-head' }, 'Scrum Poker, Planning Poker')
  };
  const itemsBar = isHost ? h('div', { class: 'panel-bar' }, h('button', { class: 'small', onclick: openItemsModal }, 'Manage Items')) : null;
  root.replaceChildren(
    h('div', { class: 'room' },
      h('div', { class: 'stack' },
        h('section', { class: 'panel' }, ui.head, h('div', { class: 'panel-body' }, ui.status, ui.title, ui.timer, ui.cards, ui.results)),
        isHost ? h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, 'Invite Players'), h('div', { class: 'panel-body' }, ui.invite)) : null),
      h('div', { class: 'stack' },
        h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, 'Players'), h('div', { class: 'panel-body' }, ui.players)),
        h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, 'Items'), itemsBar, h('div', { class: 'panel-body' }, ui.items)))),
    h('p', { style: 'text-align:center' }, h('button', { class: 'grey', onclick: () => { history.replaceState(null, '', location.pathname); renderHome(); } }, '← Leave game')));
  if (isHost) {
    const link = location.href.split('#')[0] + '#join=' + session.game.code;
    const inp = h('input', { type: 'text', readonly: true, value: link, 'aria-label': 'Invite link', onfocus: e => e.target.select() });
    ui.invite.append(h('p', null, 'Share this link, or give players the code ', h('b', null, session.game.code), '. Keep this tab open while you play: you are the host.'),
      h('div', { class: 'invite' }, inp, h('button', { class: 'green', onclick: async e => {
        try { await navigator.clipboard.writeText(link); e.target.textContent = 'Copied!'; } catch { inp.select(); e.target.textContent = 'Press Ctrl+C'; }
        setTimeout(() => { e.target.textContent = 'Copy link'; }, 2000);
      } }, 'Copy link')));
  }
  updateRoom();
}

function updateRoom() {
  if (!session || !session.ui) return;
  const ui = session.ui, v = session.view, isHost = session.role === 'host';
  ui.status.style.display = session.status ? '' : 'none'; ui.status.textContent = session.status || '';
  if (session.failed && session.role === 'guest') ui.status.append(' ', h('button', { class: 'small', onclick: () => startGuest(session.code) }, 'Try again'));
  if (!v) { ui.title.replaceChildren(); ui.cards.replaceChildren(); return; }
  ui.head.textContent = v.name;

  const cur = v.current;
  ui.title.replaceChildren(cur
    ? h('div', null, h('h2', { class: 'cur-title' }, cur.title), cur.details ? markdown(cur.details) : null,
        cur.images.length ? h('div', { class: 'imgs' }, cur.images.map(src => h('img', { src, alt: 'Related image for ' + cur.title }))) : null)
    : h('div', { class: 'empty' }, isHost ? 'Add items with "Manage Items", then press Vote on one to start estimating.' : 'Waiting for the host to pick an item to estimate…'));

  const mine = v.players.find(p => p.id === me.pid);
  ui.cards.replaceChildren(...(cur ? v.scale.map((s, i) => h('button', {
    class: 'card' + (mine && mine.vote === s ? ' sel' : '') + (isDark(i) ? ' dark' : ''), style: 'background:' + color(i),
    disabled: v.revealed, 'aria-pressed': mine && mine.vote === s ? 'true' : 'false', 'aria-label': 'Vote ' + s, onclick: () => castVote(s)
  }, s)) : []));

  // players
  ui.players.replaceChildren(...v.players.map(p => {
    const idx = v.scale.indexOf(p.vote);
    const face = p.vote !== undefined && p.vote !== null && v.revealed ? h('span', { class: 'mini' + (isDark(idx) ? ' dark' : ''), style: 'background:' + color(idx) }, p.vote)
      : p.voted ? h('span', { class: 'mini done', title: 'Voted' }, p.id === me.pid && p.vote ? p.vote : '✓')
      : h('span', { class: 'mini wait', title: 'Waiting' }, cur ? '…' : '');
    return h('li', { class: p.online ? '' : 'off' }, face, h('span', { class: 'pname' }, p.name + (p.id === me.pid ? ' (you)' : '') + (p.id === v.hostPid ? ' ★host' : '') + (p.online ? '' : ' – offline')));
  }));

  // items
  ui.items.replaceChildren(...(v.items.length ? v.items.map(i => h('li', { class: cur && cur.id === i.id ? 'active' : '' },
    h('span', { class: 'ititle' }, i.title),
    i.estimate != null ? h('span', { class: 'badge' }, i.estimate) : null,
    isHost ? h('button', { class: 'small green', onclick: () => act.select(i.id) }, 'Vote') : null))
    : [h('li', null, h('span', { class: 'hint' }, 'No items yet.'))]));

  renderResults(v, cur, isHost);
  tick();
}

function renderResults(v, cur, isHost) {
  const box = session.ui.results; box.replaceChildren();
  if (!cur) return;
  const votes = v.players.filter(p => p.online || p.voted);
  const voted = v.players.filter(p => p.voted).length;
  if (!v.revealed) {
    box.append(h('p', null, `${voted} of ${votes.length} voted.`));
    if (isHost) box.append(h('button', { class: 'orange', onclick: act.reveal }, 'Reveal votes'));
    return;
  }
  const cast = v.players.map(p => p.vote).filter(x => x != null);
  const nums = cast.map(num).filter(n => n !== null).sort((a, b) => a - b);
  const avg = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
  const med = nums.length ? (nums.length % 2 ? nums[(nums.length - 1) / 2] : (nums[nums.length / 2 - 1] + nums[nums.length / 2]) / 2) : null;
  const fmt = n => n == null ? '–' : (Math.round(n * 10) / 10).toString();
  const consensus = cast.length > 1 && new Set(cast).size === 1;
  box.append(h('div', { class: 'stats' },
    h('div', { class: 'stat' }, h('b', null, fmt(avg)), 'Average'), h('div', { class: 'stat' }, h('b', null, fmt(med)), 'Median'),
    h('div', { class: 'stat' }, h('b', null, fmt(nums[0])), 'Low'), h('div', { class: 'stat' }, h('b', null, fmt(nums[nums.length - 1])), 'High')));
  if (consensus) box.append(h('p', null, '🎉 Consensus!'));
  const counts = new Map(); cast.forEach(c => counts.set(c, (counts.get(c) || 0) + 1));
  const max = Math.max(1, ...counts.values());
  box.append(h('div', { class: 'bars' }, v.scale.filter(s => counts.has(s)).map(s => h('div', { class: 'bar' },
    h('span', { class: 'lab' }, s), h('span', { class: 'fill', style: `width:${counts.get(s) / max * 60}%;background:${color(v.scale.indexOf(s))}` }), counts.get(s) + (counts.get(s) === 1 ? ' vote' : ' votes')))));
  if (v.tri.length) box.append(h('div', { class: 'tri' }, h('b', null, 'Triangulation: similar-sized items'), h('ul', null, v.tri.map(t => h('li', null, `${t.title} (${t.estimate})`)))));
  const item = v.items.find(i => i.id === cur.id);
  if (isHost) {
    box.append(h('p', { style: 'margin-top:14px' }, h('b', null, 'Save final estimate' + (item && item.estimate != null ? ` (currently ${item.estimate})` : ':'))),
      h('div', { class: 'chips' }, v.scale.map((s, i) => h('button', { class: 'small' + (item && item.estimate === s ? ' selchip' : ''), style: `background:${color(i)};${isDark(i) ? 'color:#222' : ''}`, onclick: () => act.estimate(s) }, s))),
      h('p', null, h('button', { class: 'violet', onclick: act.revote }, 'Revote')));
  } else if (item && item.estimate != null) box.append(h('p', null, 'Final estimate: ', h('span', { class: 'badge' }, item.estimate)));
}

/* ---------- items modal (host) ---------- */
function openItemsModal() {
  let tab = 'manage';
  const body = h('div'), tabs = h('div', { class: 'tabs', role: 'tablist' });
  const plus = h('button', { class: 'plus', 'aria-label': 'Add item', onclick: () => openItemForm() }, '+');
  const m = modal('Items', h('div', null, h('div', { class: 'panel-bar tabbar' }, tabs, plus), body,
    h('div', { class: 'panel-bar', style: 'justify-content:flex-start;border-top:1px solid var(--line);border-bottom:0' }, h('button', { class: 'grey', onclick: () => m.remove() }, 'Close'))));
  const draw = () => {
    tabs.replaceChildren(...[['fav', 'Favorites'], ['recent', 'Recently Estimated'], ['manage', 'Manage Items']].map(([k, t]) =>
      h('button', { class: 'tab' + (tab === k ? ' on' : ''), role: 'tab', 'aria-selected': tab === k, onclick: () => { tab = k; draw(); } }, t)));
    plus.style.visibility = tab === 'manage' ? '' : 'hidden';
    const cur = session.game.items;
    const row = (i, actions) => h('div', { class: 'game-row' }, h('span', { class: 'name' }, i.title, i.game ? h('span', { class: 'meta' }, ' · ' + i.game) : null),
      i.estimate != null ? h('span', { class: 'badge' }, i.estimate) : null, actions);
    let rows;
    if (tab === 'manage') rows = cur.map(i => row(i, [
      h('button', { class: 'star' + (i.fav ? ' on' : ''), 'aria-label': i.fav ? 'Remove favorite' : 'Add favorite', onclick: () => { act.fav(i.id); draw(); } }, '★'),
      h('button', { class: 'small', onclick: () => openItemForm(i) }, 'Edit'),
      h('button', { class: 'small red', onclick: () => { if (confirm('Remove this item?')) { act.removeItem(i.id); draw(); } } }, 'Remove')]));
    else if (tab === 'fav') rows = allGameItems().filter(i => i.fav).map(i => row(i));
    else rows = allGameItems().filter(i => i.estimate != null).sort((a, b) => (b.estimatedAt || 0) - (a.estimatedAt || 0)).slice(0, 30).map(i => row(i));
    body.replaceChildren(h('div', { class: 'panel-body' }, rows.length ? rows : h('div', { class: 'empty' },
      tab === 'manage' ? 'Click + above to add a new item.' : tab === 'fav' ? 'Star items in Manage Items to use them for triangulation.' : 'Items you estimate will show up here.')));
  };
  m.redraw = draw; session.itemsModal = m; draw();
}

function openItemForm(existing) {
  const images = existing ? [...(existing.images || [])] : [];
  const title = h('textarea', { 'aria-label': 'Item title' }, existing ? existing.title : '');
  const details = h('textarea', { 'aria-label': 'Item details' }, existing ? existing.details || '' : '');
  const thumbs = h('div', { class: 'imgs' });
  const err = h('div', { class: 'hint', style: 'color:#c62828' });
  const drawThumbs = () => thumbs.replaceChildren(...images.map((src, i) => h('span', { class: 'thumb' }, h('img', { src, alt: 'Attached image ' + (i + 1) }),
    h('button', { class: 'small red', onclick: () => { images.splice(i, 1); drawThumbs(); } }, 'Remove'))));
  drawThumbs();
  const file = h('input', { type: 'file', accept: 'image/*', multiple: true, onchange: async () => {
    for (const f of file.files) { try { if (images.length < 4) images.push(await resizeImage(f)); } catch { err.textContent = 'Could not read ' + f.name; } }
    file.value = ''; drawThumbs();
  } });
  const hintMd = h('div', { class: 'hint' }, 'You can use Markdown (**bold**, *italic*, - lists, [links](https://…)) to format your text.');
  const m = modal('Item Details', h('div', { class: 'panel-body' },
    h('div', { class: 'field' }, h('label', null, 'Item Title'), title, h('div', { class: 'hint' }, 'i.e. "As a user, I would like to add an item, so that I can use it in the game."')),
    h('div', { class: 'field' }, h('label', null, 'Item Details'), details, hintMd),
    h('div', { class: 'field' }, h('label', null, 'Related Images (up to 4):'), file, thumbs), err,
    h('div', { style: 'display:flex;gap:10px;align-items:center' },
      h('button', { onclick: () => {
        const t = title.value.trim();
        if (!t) { err.textContent = 'Please enter a title.'; title.focus(); return; }
        act.saveItem({ id: existing ? existing.id : uid(), title: t, details: details.value.trim(), images, ...(existing ? {} : { estimate: null, fav: false }) });
        m.remove(); if (session.itemsModal && session.itemsModal.isConnected) session.itemsModal.redraw();
      } }, 'Save'), 'or', h('button', { class: 'grey', onclick: () => m.remove() }, 'Cancel'))));
  title.focus();
}

/* ---------- boot ---------- */
function route() {
  const m = location.hash.match(/^#join=([A-Za-z0-9]{4,8})$/);
  if (m) renderJoin(m[1].toUpperCase()); else renderHome();
}
window.addEventListener('hashchange', route);
route();
})();
