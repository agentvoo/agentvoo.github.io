// Hippo Raft Rush admin panel. A static site: it talks straight to Firestore, signed in with Google.
// What it may do is decided by firestore.rules (admins/{auth uid}), not by anything in this file.
// Everything players typed (names, answers, comments) is put on the page as text, never as HTML.
import * as fb from './firebase.js';

const PROJECT = 'fart2-d0d9f';
const CONFIG_KEY = 'hippoAdmin.firebase';
const ID_RE = /^[1-9][0-9]{7}$/;
const MAX_GIFT = 100000, MAX_LEVEL = 100, MAX_TITLE = 60, MAX_MESSAGE = 1200, MAX_PUSH = 140;
const QUESTIONS = [
  'What must every river have before it can be published?',
  'Which kind of river do you most want to make?',
  'What names and words can you give your rivers?',
  'What makes a river fun to race?',
  "Can you publish a copy of someone else's river?",
];
const MODES = ['BASIC', '1V1', '2V2'];
const emulator = location.hostname === '127.0.0.1' && new URLSearchParams(location.search).has('emu');

let auth, db, me;
const root = document.getElementById('app');

// ------------------------------------------------------------------ small tools
const ICONS = {
  home: 'M3 11l9-8 9 8v10a1 1 0 01-1 1h-5v-7H9v7H4a1 1 0 01-1-1z',
  gift: 'M3 9h18v4H3zM5 13h14v9H5zM12 9v13M12 9S10 3 7 4s0 5 5 5zm0 0s2-6 5-5 0 5-5 5z',
  bell: 'M6 9a6 6 0 1112 0c0 7 3 8 3 8H3s3-1 3-8zM10 21h4',
  form: 'M6 2h9l5 5v15H6zM14 2v6h6M9 13h8M9 17h8',
  star: 'M12 2l3 7 7 .6-5.3 4.7 1.6 7.2L12 18l-6.3 3.5 1.6-7.2L2 9.6 9 9z',
  crown: 'M3 7l5 5 4-8 4 8 5-5-2 13H5z',
  users: 'M9 11a4 4 0 100-8 4 4 0 000 8zM2 21c0-4 3-7 7-7s7 3 7 7M16 3.5a4 4 0 010 7.5M18 14c2.5 1 4 3.6 4 7',
  river: 'M2 7c3-3 6-3 10 0s7 3 10 0M2 13c3-3 6-3 10 0s7 3 10 0M2 19c3-3 6-3 10 0s7 3 10 0',
  flag: 'M5 22V3M5 4h13l-3 4 3 4H5',
  mail: 'M3 5h18v14H3zM3 6l9 7 9-7',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1-2-4-2 1-2-1-1-3H10L9 7 7 8 5 7l-2 4 2 1v2l-2 1 2 4 2-1 2 1 1 3h4l1-3 2-1 2 1 2-4-2-1z',
  log: 'M12 7v5l3 3M12 22a10 10 0 110-20 10 10 0 010 20z',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2', pulse: 'M2 12h4l3-8 4 16 3-8h6', help: 'M3 14v-2a9 9 0 0118 0v2M3 14a2 2 0 012-2h1v7H5a2 2 0 01-2-2zM21 14a2 2 0 00-2-2h-1v7h1a2 2 0 002-2zM18 19c0 2-2 3-5 3', menu: 'M3 6h18M3 12h18M3 18h18', copy: 'M9 9h12v12H9zM5 15H3V3h12v2', trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14',
};
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', ICONS[name] || ''); svg.append(p);
  return svg;
}
/** Builds an element. Strings always become text, so player words can't turn into code. */
function h(tag, attrs, ...kids) {
  const [name, ...classes] = tag.split('.');
  const e = document.createElement(name || 'div');
  if (classes.length) e.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className += (e.className ? ' ' : '') + v;
    else if (k === 'value') e.value = v;
    else if (k === 'disabled' || k === 'checked') e[k] = !!v;
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false) e.append(kid instanceof Node ? kid : String(kid));
  return e;
}
function toast(text, bad) {
  const t = h('div.toast', { class: bad ? 'err' : '' }, text);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), bad ? 7000 : 3800);
}
function friendly(e) {
  const c = e && e.code || '';
  if (c.includes('permission-denied')) return 'Permission nahi mili. firestore.rules deploy hue hain? (SETUP guide step 4)';
  if (c.includes('unavailable') || c.includes('network')) return 'Internet ya Firebase se connection nahi hua. Dobara try karo.';
  if (c.includes('popup-closed') || c.includes('cancelled-popup')) return 'Login window band ho gayi.';
  if (c.includes('popup-blocked')) return 'Browser ne login popup rok diya. Popups allow karo.';
  if (c.includes('unauthorized-domain')) return 'Ye website Firebase Auth me allow nahi hai (SETUP guide step 3).';
  if (c.includes('operation-not-allowed')) return 'Firebase Auth me Google sign-in ON nahi hai (SETUP guide step 2).';
  if (c.includes('api-key')) return 'Firebase config galat hai. Dobara paste karo.';
  return (e && e.message) || 'Kuch galat ho gaya.';
}
/** Runs a click's work: the button waits, and any failure is said in plain words. */
function act(fn) {
  return async ev => {
    const b = ev && ev.currentTarget;
    if (b) b.disabled = true;
    try { await fn(ev); } catch (e) { console.error(e); toast(friendly(e), true); }
    if (b && b.isConnected) b.disabled = false;
  };
}
function ask({ title, body, yes = 'Yes', danger, word }) {
  return new Promise(done => {
    const close = v => { back.remove(); document.removeEventListener('keydown', esc); done(v); };
    const esc = e => { if (e.key === 'Escape') close(false); };
    const typed = word ? h('input', { placeholder: word, 'aria-label': `Type ${word}`, autocomplete: 'off', oninput: () => { ok.disabled = typed.value.trim().toUpperCase() !== word; } }) : null;
    const ok = h(`button.btn.${danger ? 'bad' : 'go'}`, { disabled: !!word, onclick: () => close(true) }, yes);
    const back = h('div.modalback', { onclick: e => { if (e.target === back) close(false); } },
      h('div.modal', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('h2', {}, title), body ? h('p', {}, body) : null,
        word ? h('label.f', {}, h('span', {}, `Pakka karne ke liye ${word} likho`), typed) : null,
        h('div.row', { style: 'justify-content:flex-end' }, h('button.btn.ghost', { onclick: () => close(false) }, 'Cancel'), ok)));
    document.body.append(back); document.addEventListener('keydown', esc); (typed || ok).focus();
  });
}
function sheet(title, content) {
  const close = () => { back.remove(); document.removeEventListener('keydown', esc); };
  const esc = e => { if (e.key === 'Escape') close(); };
  const back = h('div.modalback', { onclick: e => { if (e.target === back) close(); } },
    h('div.modal.wide', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('div.row.between', {}, h('h2', {}, title), h('button.btn.small.ghost', { onclick: close }, 'Close')), content));
  document.body.append(back); document.addEventListener('keydown', esc);
  return close;
}
const showId = id => String(id).replace(/^(\d{4})(\d{4})$/, '$1 $2');
function whenText(v) {
  let d = null;
  if (v && v.toDate) d = v.toDate();
  else if (/^\d{13}$/.test(String(v))) d = new Date(Number(v));
  else if (/^\d{9,11}$/.test(String(v))) d = new Date(Number(v) * 1000);
  else if (v) { const x = new Date(v); if (!isNaN(x)) d = x; }
  return d ? d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '-';
}
function agoText(sec) {
  const n = Number(sec); if (!n) return 'never';
  const s = Date.now() / 1000 - n;
  if (s < 120) return 'online now'; if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} hours ago`;
  return `${Math.floor(s / 86400)} days ago`;
}
const pic = base64 => typeof base64 === 'string' && base64.length > 20 && /^[A-Za-z0-9+/=]+$/.test(base64) ? `data:image/jpeg;base64,${base64}` : null;
const avatar = (name, photo) => { const src = pic(photo); return src ? h('img.ava', { src, alt: '' }) : h('div.ava', {}, String(name || '?').trim().charAt(0).toUpperCase() || '?'); };
const col = name => fb.collection(db, name);
const ref = (...path) => fb.doc(db, ...path);
const docs = async q => (await fb.getDocs(q)).docs.map(d => ({ id: d.id, ...d.data() }));
const count = async q => { try { return (await fb.getCountFromServer(q)).data().count; } catch (e) { console.warn(e); return null; } };
async function logDo(action, detail) {
  try { await fb.addDoc(col('admin_log'), { action, detail: String(detail).slice(0, 300), by: me.email || me.uid, at: fb.serverTimestamp() }); } catch (e) { console.warn('log', e); }
}
/** Pulls 8-digit ids out of what was typed: "1234 5678, 87654321" and one per line both work. */
function parseIds(text) {
  const ids = new Set(), bad = [];
  for (const part of String(text).split(/[,;\n]+/)) {
    const digits = part.replace(/[\s-]/g, '');
    if (!digits) continue;
    if (/^\d+$/.test(digits) && digits.length % 8 === 0) {
      for (let i = 0; i < digits.length; i += 8) { const id = digits.slice(i, i + 8); (ID_RE.test(id) ? ids : { add: x => bad.push(x) }).add(id); }
    } else bad.push(part.trim());
  }
  return { ids: [...ids], bad };
}
async function names(ids) {
  const map = {};
  await Promise.all([...new Set(ids)].slice(0, 200).map(async id => { try { const s = await fb.getDoc(ref('users', id)); if (s.exists()) map[id] = s.data(); } catch { /* shown as unknown */ } }));
  return map;
}
async function inBatches(list, each) {
  for (let i = 0; i < list.length; i += 400) {
    const b = fb.writeBatch(db);
    list.slice(i, i + 400).forEach(x => each(b, x));
    await b.commit();
  }
}
const head = (title, line, right) => h('div.head', {}, h('div', {}, h('h1', {}, title), line ? h('p', {}, line) : null), right || null);
const loading = () => h('div.loading', {}, 'Loading...');
const empty = text => h('div.empty', {}, text);
function field(label, input, hint) { return h('label.f', {}, h('span', {}, label, hint ? h('small', {}, `  ${hint}`) : null), input); }

// ------------------------------------------------------------------ first run, login, not an admin
function readConfig() { try { const c = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null'); return c && c.projectId === PROJECT && c.apiKey ? c : null; } catch { return null; } }
function parseConfig(text) {
  const get = k => (String(text).match(new RegExp(`["']?${k}["']?\\s*:\\s*["']([^"']+)["']`)) || [])[1];
  const c = { apiKey: get('apiKey'), authDomain: get('authDomain'), projectId: get('projectId'), storageBucket: get('storageBucket'), messagingSenderId: get('messagingSenderId'), appId: get('appId') };
  if (!c.apiKey || !c.projectId) throw new Error('Isme apiKey aur projectId nahi mile. Poora firebaseConfig paste karo.');
  if (c.projectId !== PROJECT) throw new Error(`Ye config "${c.projectId}" project ka hai. Game ka project ${PROJECT} hai.`);
  c.authDomain = c.authDomain || `${PROJECT}.firebaseapp.com`;
  return c;
}
function setupScreen() {
  const box = h('textarea', { rows: 8, placeholder: 'const firebaseConfig = {\n  apiKey: "...",\n  authDomain: "...",\n  projectId: "fart2-d0d9f",\n  ...\n};', 'aria-label': 'Firebase config' });
  root.replaceChildren(h('div.center', {}, h('div.auth', {},
    h('img', { src: 'assets/logo.png', alt: 'Hippo Raft Rush' }), h('h1', {}, 'Pehli baar setup'),
    h('ol.steps', {},
      h('li', {}, 'Firebase console me ', h('b', {}, 'Project settings'), ' kholo.'),
      h('li', {}, 'Neeche ', h('b', {}, 'Your apps'), ' me ', h('b', {}, 'Web </>'), ' app banao (naam: Admin Panel).'),
      h('li', {}, 'Jo ', h('b', {}, 'firebaseConfig'), ' dikhe, poora copy karke yahan paste karo.')),
    box, h('button.btn.go.big', { onclick: () => { try { localStorage.setItem(CONFIG_KEY, JSON.stringify(parseConfig(box.value))); start(); } catch (e) { toast(e.message, true); } } }, 'SAVE'),
    h('p.faint', {}, 'Ye sirf is browser me save hota hai. Is config me koi password nahi hota.'))));
}
function loginScreen() {
  root.replaceChildren(h('div.center', {}, h('div.auth', {},
    h('img', { src: 'assets/logo.png', alt: 'Hippo Raft Rush' }), h('h1', {}, 'Admin Panel'),
    h('p.muted', { style: 'text-align:center' }, 'Apne Google account se login karo.'),
    h('button.btn.gold.big', { onclick: act(async () => {
      const provider = new fb.GoogleAuthProvider(); provider.setCustomParameters({ prompt: 'select_account' });
      await fb.signInWithPopup(auth, provider);
    }) }, 'LOGIN WITH GOOGLE'),
    emulator ? h('button.btn', { id: 'emuLogin', onclick: act(() => fb.signInWithCredential(auth, fb.GoogleAuthProvider.credential(JSON.stringify({ sub: new URLSearchParams(location.search).get('emu') || 'admin1', email: `${new URLSearchParams(location.search).get('emu') || 'admin1'}@example.com`, email_verified: true })))) }, 'Emulator login') : null,
    h('button.btn.small.ghost', { onclick: async () => { if (await ask({ title: 'Firebase config badlein?', yes: 'Change' })) { localStorage.removeItem(CONFIG_KEY); location.reload(); } } }, 'Change Firebase config'))));
}
function notAdminScreen() {
  const copy = h('button.btn.small', { onclick: act(async () => { await navigator.clipboard.writeText(me.uid); toast('Copied!'); }) }, icon('copy'), 'Copy');
  root.replaceChildren(h('div.center', {}, h('div.auth', {},
    h('img', { src: 'assets/logo.png', alt: 'Hippo Raft Rush' }), h('h1', {}, 'Bas ek last step'),
    h('p.muted', {}, 'Ye Google account abhi admin nahi hai. Ye kaam Firebase me sirf EK BAAR karna hai:'),
    h('div.code', {}, h('code', {}, me.uid), copy),
    h('ol.steps', {},
      h('li', {}, 'Firebase console > ', h('b', {}, 'Firestore Database'), ' kholo.'),
      h('li', {}, h('b', {}, '+ Start collection'), ' dabao. Collection ID: ', h('b', {}, 'admins')),
      h('li', {}, 'Document ID me upar wala code paste karo.'),
      h('li', {}, 'Field: ', h('b', {}, 'role'), ' (string) = ', h('b', {}, 'owner'), '. Save.')),
    h('button.btn.go.big', { onclick: () => location.reload() }, 'HO GAYA, CHECK KARO'),
    h('button.btn.ghost', { onclick: () => fb.signOut(auth) }, 'Dusra account'))));
}

// ------------------------------------------------------------------ the frame
const NAV = [
  ['', [['dashboard', 'Dashboard', 'home'], ['live', 'Live Board', 'pulse'], ['analytics', 'Analytics', 'chart'], ['support', 'Help & Support', 'help']]],
  ['BHEJO', [['gift', 'Send Gift / Mail', 'gift'], ['notify', 'Notification', 'bell'], ['history', 'Sent Mail', 'mail']]],
  ['LOG', [['forms', 'Creator Forms', 'form'], ['creators', 'Creators', 'star'], ['partners', 'Partners', 'crown'], ['players', 'Players', 'users']]],
  ['GAME', [['rivers', 'Rivers', 'river'], ['reports', 'Reports', 'flag'], ['settings', 'Game Settings', 'gear'], ['log', 'Activity Log', 'log']]],
];
const PAGES = { dashboard, live: liveBoard, analytics, support, gift: v => composer(v, false), notify: v => composer(v, true), history, forms, creators: v => people(v, 'creators'), partners: v => people(v, 'partners'), players, rivers, reports, settings, log: activity };
let view, side, pendingBadge, supportBadge, prefill = null, leaveWork = [];
function go(page, data) { prefill = data || null; if (location.hash.slice(1) === page) route(); else location.hash = page; }
function shell() {
  view = h('main.main', { id: 'main' });
  pendingBadge = h('span.count', { hidden: true });
  supportBadge = h('span.count', { hidden: true });
  const menu = h('nav', { 'aria-label': 'Main' }, NAV.map(([group, items]) => [group ? h('div.navgroup', {}, group) : null, items.map(([id, label, ic]) =>
    h('button.navbtn', { 'data-page': id, onclick: () => { side.classList.remove('open'); document.querySelector('.scrim')?.remove(); go(id); } }, icon(ic), label, id === 'forms' ? pendingBadge : id === 'support' ? supportBadge : null))]));
  side = h('aside.side', {}, h('div.brand', {}, h('img', { src: 'assets/logo.png', alt: 'Hippo Raft Rush' }), h('span', {}, 'ADMIN')), menu,
    h('div.who', {}, me.photoURL ? h('img', { src: me.photoURL, alt: '', referrerpolicy: 'no-referrer' }) : null, h('div', {}, h('b', {}, me.displayName || me.email || 'Admin')), h('button.btn.small.ghost', { onclick: () => fb.signOut(auth) }, 'Logout')));
  const top = h('header.top', {}, h('img', { src: 'assets/logo.png', alt: 'Hippo Raft Rush' }), h('b', {}, 'ADMIN'), h('button.btn.small', { 'aria-label': 'Menu', onclick: () => { side.classList.add('open'); const s = h('div.scrim', { onclick: () => { side.classList.remove('open'); s.remove(); } }); document.body.append(s); } }, icon('menu')));
  root.replaceChildren(top, h('div.shell', {}, side, view));
  window.onhashchange = route;
  route(); refreshBadge();
  setInterval(() => { if (!document.hidden && me) refreshBadge(); }, 60000);   // the menu's waiting counts stay current
}
async function refreshBadge() {
  const n = await count(fb.query(col('wow_apply'), fb.where('status', '==', 'pending')));
  if (pendingBadge) { pendingBadge.hidden = !n; pendingBadge.textContent = n || ''; }
  const s = await count(fb.query(col('support'), fb.where('status', '==', 'open')));
  if (supportBadge) { supportBadge.hidden = !s; supportBadge.textContent = s || ''; }
}
let routeToken = 0;
async function route() {
  const page = PAGES[location.hash.slice(1)] ? location.hash.slice(1) : 'dashboard';
  document.querySelectorAll('.navbtn').forEach(b => b.classList.toggle('on', b.dataset.page === page));
  leaveWork.splice(0).forEach(stop => { try { stop(); } catch (e) { console.warn(e); } });
  const token = ++routeToken, holder = h('div', {}, loading());
  view.replaceChildren(holder); scrollTo(0, 0);
  try { await PAGES[page](holder, () => token === routeToken, stop => { if (token === routeToken) leaveWork.push(stop); else stop(); }); }
  catch (e) { console.error(e); if (token === routeToken) holder.replaceChildren(h('div.note.danger', {}, friendly(e))); }
}

// ------------------------------------------------------------------ dashboard
async function dashboard(v, live, onLeave) {
  // Live: the waiting forms and the last actions come by listener; the counts are re-counted on the server every 30 s.
  const stats = h('div.stats'), formsBox = h('div.card.stack', {}, loading()), logsBox = h('div.card.stack', {}, loading());
  v.replaceChildren(head('Dashboard', 'Game ka sab kuch ek jagah.', h('span.livepill', {}, h('i'), 'LIVE')), stats,
    h('div.two', {}, formsBox, h('div.stack', {},
      h('div.card.stack', {}, h('h2', {}, 'Quick actions'), h('div.row', {}, h('button.btn.gold', { onclick: () => go('gift') }, icon('gift'), 'Send gift'), h('button.btn', { onclick: () => go('notify') }, icon('bell'), 'Notification'), h('button.btn', { onclick: () => go('analytics') }, icon('chart'), 'Analytics'), h('button.btn', { onclick: () => go('support') }, icon('help'), 'Support'), h('button.btn', { onclick: () => go('partners') }, icon('crown'), 'Add partner'))),
      logsBox)));
  const stat = (n, label, page, c, alert) => h('button.stat', { class: alert ? 'alert' : '', style: `--c:${c}`, onclick: () => go(page) }, h('b', {}, n === null ? '-' : n.toLocaleString('en-IN')), h('span', {}, label));
  async function counts() {
    const nowS = Math.floor(Date.now() / 1000);
    const [pending, creators, partners, players_, rivers_, mails, rr, pr, onlineNow, openSupport] = await Promise.all([
      count(fb.query(col('wow_apply'), fb.where('status', '==', 'pending'))), count(col('wow_creators')), count(col('partners')), count(col('users')),
      count(col('wow_rivers')), count(col('mail')), count(col('wow_reports')), count(col('photo_reports')), count(fb.query(col('users'), fb.where('seen', '>=', String(nowS - 100)))), count(fb.query(col('support'), fb.where('status', '==', 'open')))]);
    if (!live()) return;
    stats.replaceChildren(stat(onlineNow, 'Online now', 'analytics', 'var(--green)'), stat(pending, 'Forms waiting', 'forms', 'var(--gold)', pending > 0), stat(openSupport, 'Support waiting', 'support', 'var(--blue)', openSupport > 0), stat(players_, 'Players', 'players', 'var(--blue)'), stat(creators, 'Creators', 'creators', 'var(--pink)'), stat(partners, 'Partners', 'partners', 'var(--gold)'),
      stat(rivers_, 'Creator rivers', 'rivers', '#5ce0d8'), stat(mails, 'Mails sent', 'history', 'var(--green)'), stat((rr || 0) + (pr || 0), 'Reports', 'reports', 'var(--red)', (rr || 0) + (pr || 0) > 0));
  }
  const stops = [];
  stops.push(fb.onSnapshot(fb.query(col('wow_apply'), fb.where('status', '==', 'pending'), fb.limit(5)), snap => {
    if (!live()) return;
    const recent = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    formsBox.replaceChildren(h('div.row.between', {}, h('h2', {}, 'Forms waiting'), h('button.btn.small', { onclick: () => go('forms') }, 'See all')),
      recent.length ? h('div.list', {}, recent.map(a => h('div.item', {}, avatar(a.name), h('div.grow', {}, h('div.name', {}, a.name || 'Player'), h('div.faint.mono', {}, showId(a.id))), h('span.tag.y', {}, 'pending')))) : empty('Koi form pending nahi hai.'));
    counts().catch(console.warn);
  }, e => formsBox.replaceChildren(h('div.note.danger', {}, friendly(e)))));
  stops.push(fb.onSnapshot(fb.query(col('admin_log'), fb.orderBy('at', 'desc'), fb.limit(6)), snap => {
    if (!live()) return;
    const logs = snap.docs.map(d => d.data());
    logsBox.replaceChildren(h('h2', {}, 'Last actions'), logs.length ? h('div.list', {}, logs.map(l => h('div.item', {}, h('div.grow', {}, h('div.name', {}, l.action), h('div.faint', {}, whenText(l.at)))))) : h('p.faint', {}, 'Abhi kuch nahi.'));
  }, e => logsBox.replaceChildren(h('div.note.danger', {}, friendly(e)))));
  await counts();
  const timer = setInterval(() => { if (live() && !document.hidden) counts().catch(console.warn); }, 30000);
  onLeave(() => { clearInterval(timer); stops.forEach(s => s()); });
}

// ------------------------------------------------------------------ gift, mail and notification
function composer(v, pushOnly) {
  const given = prefill || {}; prefill = null;
  const s = { to: given.id ? 'ids' : 'ids', checked: {} };
  const ids = h('textarea', { rows: 2, value: given.id || '', placeholder: '12345678, 87654321\nEk ya bohot saari IDs', 'aria-label': 'Player IDs', oninput: () => { s.checked = {}; paint(); } });
  const title = h('input', { maxlength: MAX_TITLE, placeholder: pushOnly ? 'New update is here!' : 'Thank you, Creator!', oninput: () => paint() });
  const message = h('textarea', { maxlength: MAX_MESSAGE, placeholder: 'Mail ke andar ka message...', oninput: () => paint() });
  const push = h('input', { maxlength: MAX_PUSH, placeholder: pushOnly ? 'Double Bubbles weekend starts now!' : 'Khali chhodo to: Check your mail! A surprise is waiting', oninput: () => paint() });
  const num = ph => h('input', { type: 'number', min: 0, inputmode: 'numeric', placeholder: ph, oninput: () => paint() });
  const pearls = num('0'), bubbles = num('0'), level = num('-'), rp = num('-');
  const seg = h('div.seg', { role: 'group', 'aria-label': 'Kisko bhejna hai' });
  const idsBox = h('div.stack', {}, field('Player IDs', ids, 'space ke saath bhi chalega'));
  const chips = h('div.chips'), preview = h('div'), warn = h('div');
  const AUD = [['ids', 'Player ID'], ['creators', 'All Creators'], ['partners', 'All Partners'], ['all', 'Everyone']];
  const amount = el => Math.round(Number(el.value) || 0);
  function paint() {
    seg.replaceChildren(...AUD.map(([k, l]) => h('button', { class: s.to === k ? 'on' : '', 'aria-pressed': String(s.to === k), onclick: () => { s.to = k; paint(); } }, l)));
    idsBox.hidden = s.to !== 'ids';
    const { ids: list, bad } = parseIds(ids.value);
    chips.replaceChildren(...list.map(id => { const c = s.checked[id]; return h('span.chip', { class: c === undefined ? '' : c ? 'ok' : 'no' }, c ? `${c} · ${showId(id)}` : c === false ? `${showId(id)} nahi mila` : showId(id)); }), ...bad.map(x => h('span.chip.no', {}, `${x} galat ID`)));
    const gifts = [[amount(pearls), 'Pearls'], [amount(bubbles), 'Bubbles'], [amount(level), 'Level'], [amount(rp), 'RP']].filter(g => g[0] > 0);
    const headText = title.value.trim() || (pushOnly && push.value.trim()) || (gifts.length ? 'A gift for you!' : 'Message');
    preview.replaceChildren(h('div.lab', { style: 'margin-bottom:6px' }, 'Player ko aisa dikhega'),
      h('div.preview', {}, h('div.from', {}, 'Hippo Raft Rush Official'), h('h3', {}, headText), h('div.msg', {}, message.value || (pushOnly ? push.value : '') || '...'), gifts.length ? h('div.gifts', {}, gifts.map(([n, l]) => h('span.gift', {}, `${l === 'Level' ? 'Level ' + n : '+' + n.toLocaleString('en-IN') + ' ' + l}`))) : null),
      h('div.phone', {}, h('b', {}, 'Hippo Raft Rush Official'), h('span', {}, push.value.trim() || 'Check your mail! A surprise is waiting for you')));
    warn.replaceChildren(...(s.to === 'all' && gifts.length ? [h('div.note.danger', {}, 'Ye gift SAB players ko milega. Bhejne se pehle amount dobara dekh lo.')] : []));
  }
  async function send() {
    const t = title.value.trim(), m = message.value.trim(), p = push.value.trim();
    if (pushOnly && !p) return toast('Notification ka text likho.', true);
    if (!pushOnly && !t) return toast('Title likho.', true);
    for (const [el, most, label] of [[pearls, MAX_GIFT, 'Pearls'], [bubbles, MAX_GIFT, 'Bubbles'], [level, MAX_LEVEL, 'Level'], [rp, MAX_GIFT, 'RP']]) {
      const n = Number(el.value || 0);
      if (!Number.isInteger(n) || n < 0 || n > most) return toast(`${label} 0 se ${most.toLocaleString('en-IN')} ke beech pura number hona chahiye.`, true);
    }
    let targets = [s.to], who = { creators: 'sab Creators', partners: 'sab Partners', all: 'SAB players' }[s.to];
    if (s.to === 'ids') {
      const { ids: list, bad } = parseIds(ids.value);
      if (bad.length) return toast(`Galat ID: ${bad[0]}`, true);
      if (!list.length) return toast('Kam se kam ek Player ID daalo.', true);
      if (list.length > 200) return toast('Ek baar me 200 IDs tak.', true);
      const found = await names(list);
      list.forEach(id => { s.checked[id] = found[id] ? (found[id].name || 'Player') : false; });
      paint();
      const missing = list.filter(id => !found[id]);
      if (missing.length) return toast(`Ye ID game me nahi mili: ${showId(missing[0])}`, true);
      targets = list; who = list.length === 1 ? `${found[list[0]].name || 'Player'} (${showId(list[0])})` : `${list.length} players`;
    }
    const gift = { pearls: amount(pearls), bubbles: amount(bubbles), level: amount(level), rp: amount(rp) };
    const has = Object.values(gift).some(Boolean);
    const summary = [gift.pearls && `${gift.pearls} Pearls`, gift.bubbles && `${gift.bubbles} Bubbles`, gift.level && `Level ${gift.level}`, gift.rp && `${gift.rp} RP`].filter(Boolean).join(', ');
    const okay = await ask({ title: pushOnly ? 'Notification bhejein?' : 'Mail bhejein?', body: `Kisko: ${who}\n${has ? `Gift: ${summary}\n` : ''}\nEk baar player ne collect kar liya to wapas nahi hoga.`, yes: 'SEND', danger: s.to === 'all', word: s.to === 'all' ? 'SEND' : null });
    if (!okay) return;
    const heading = (t || (pushOnly ? p : '')).slice(0, MAX_TITLE), body = (m || (pushOnly ? p : '')).slice(0, MAX_MESSAGE);
    await inBatches(targets, (b, to) => {
      const data = { to, title: heading, message: body, sentAt: fb.serverTimestamp(), sentBy: 'admin' };
      for (const [k, n] of Object.entries(gift)) if (n > 0) data[k] = n;
      if (p) data.push = p;
      b.set(fb.doc(col('mail')), data);
    });
    await logDo(pushOnly ? 'Notification sent' : 'Mail sent', `${who}${has ? ': ' + summary : ''} - ${heading}`);
    toast(`Bhej diya: ${who}`);
    [title, message, push, pearls, bubbles, level, rp].forEach(el => { el.value = ''; }); if (s.to === 'ids') ids.value = ''; s.checked = {}; paint();
  }
  v.replaceChildren(
    head(pushOnly ? 'Notification' : 'Send Gift / Mail', pushOnly ? 'Players ke phone pe notification, aur wahi message unke MAIL me.' : 'Pearls, Bubbles, Level ya Rank seedha player ke MAIL me.'),
    h('div.two', {},
      h('div.card.stack', {}, h('div.stack', {}, h('div.lab', {}, 'Kisko bhejna hai?'), seg), idsBox, chips, warn,
        pushOnly ? field('Notification text', push, `${MAX_PUSH} letters tak`) : null,
        field('Title', title, pushOnly ? 'optional' : ''), field('Message', message, pushOnly ? 'optional' : ''),
        pushOnly ? null : h('div.fields', {}, field('Pearls', pearls), field('Bubbles', bubbles), field('Level', level, '1-100'), field('Rank Points', rp)),
        pushOnly ? null : h('div.chips', {}, [[100, 500], [500, 5000], [1000, 10000]].map(([a, b]) => h('button.chip', { onclick: () => { pearls.value = a; bubbles.value = b; paint(); } }, `${a} Pearls + ${b.toLocaleString('en-IN')} Bubbles`))),
        pushOnly ? null : field('Notification text', push, 'optional'),
        h('button.btn.go.big', { onclick: act(send) }, icon(pushOnly ? 'bell' : 'gift'), pushOnly ? 'SEND NOTIFICATION' : 'SEND')),
      h('div.stack', {}, h('div.card', {}, preview),
        h('div.note', {}, 'Notification 1 se 15 minute me aata hai. Player ne game ek baar khola ho aur notifications allow ki hon tabhi milega. Game khula ho to MAIL button pe red number aata hai.'),
        s.to ? h('div.note', {}, 'All Creators / Partners / Everyone wala mail sirf unhe milta hai jo bhejte waqt us group me the.') : null)));
  paint();
}

async function history(v, live) {
  const rows = await docs(fb.query(col('mail'), fb.limit(300)));
  if (!live()) return;
  rows.sort((a, b) => (b.sentAt?.seconds || 0) - (a.sentAt?.seconds || 0));
  const list = h('div.list');
  const toLabel = to => ({ all: 'Everyone', creators: 'Creators', partners: 'Partners' }[to] || `ID ${showId(to)}`);
  list.append(...rows.map(m => {
    const got = h('span.tag', {}, '...');
    const row = h('div.item', {}, h('div.grow', {}, h('div.name', {}, m.title || '(no title)'), h('div.faint', {}, `${toLabel(m.to)} · ${m.sentAt ? whenText(m.sentAt) : 'purana mail'}`)),
      h('div.chips', {}, m.pearls ? h('span.tag.p', {}, `${m.pearls} Pearls`) : null, m.bubbles ? h('span.tag.b', {}, `${m.bubbles} Bubbles`) : null, m.level ? h('span.tag.g', {}, `Lv ${m.level}`) : null, m.rp ? h('span.tag.y', {}, `${m.rp} RP`) : null, m.push ? h('span.tag', {}, 'push') : null, m.pearls || m.bubbles || m.level || m.rp ? got : null),
      h('button.btn.small.bad', { 'aria-label': 'Delete mail', onclick: act(async () => {
        if (!await ask({ title: 'Mail delete karein?', body: 'Jisne abhi tak collect nahi kiya unko ab nahi milega. Jo le chuke hain unka gift rahega.', yes: 'Delete', danger: true })) return;
        await fb.deleteDoc(ref('mail', m.id)); await logDo('Mail deleted', `${toLabel(m.to)} - ${m.title || ''}`); row.remove(); toast('Delete ho gaya');
      }) }, icon('trash')));
    if (m.pearls || m.bubbles || m.level || m.rp) count(fb.query(col('mail_claims'), fb.where(fb.documentId(), '>=', `${m.id}_`), fb.where(fb.documentId(), '<', `${m.id}\``))).then(n => { got.textContent = n === null ? '-' : `${n} collected`; });
    return row;
  }));
  v.replaceChildren(head('Sent Mail', 'Jo bheja, kisko bheja, kitno ne collect kiya.', h('button.btn.gold', { onclick: () => go('gift') }, icon('gift'), 'New mail')), h('div.card', {}, rows.length ? list : empty('Abhi tak koi mail nahi bheja.')));
}

// ------------------------------------------------------------------ creators, partners
async function grant(kind, id) {
  const since = new Date().toISOString().slice(0, 10);
  const applied = kind === 'creators' ? await fb.getDoc(ref('wow_apply', id)) : null;
  const b = fb.writeBatch(db);
  b.set(ref(kind === 'creators' ? 'wow_creators' : 'partners', id), { since, by: 'admin' });
  if (applied && applied.exists()) b.update(ref('wow_apply', id), { status: 'approved' });
  await b.commit();
  await logDo(kind === 'creators' ? 'Creator added' : 'Partner title given', showId(id));
}
async function revoke(kind, id) {
  const applied = kind === 'creators' ? await fb.getDoc(ref('wow_apply', id)) : null;
  const b = fb.writeBatch(db);
  b.delete(ref(kind === 'creators' ? 'wow_creators' : 'partners', id));
  if (applied && applied.exists()) b.update(ref('wow_apply', id), { status: 'denied' });
  await b.commit();
  await logDo(kind === 'creators' ? 'Creator removed' : 'Partner title removed', showId(id));
}
async function people(v, kind) {
  const live = () => true;
  const creators = kind === 'creators', coll = creators ? 'wow_creators' : 'partners', word = creators ? 'Creator' : 'Partner';
  const rows = await docs(fb.query(col(coll), fb.limit(500)));
  const info = await names(rows.map(r => r.id));
  const input = h('input', { placeholder: 'Player ID, jaise 1234 5678', 'aria-label': 'Player ID', inputmode: 'numeric' });
  const search = h('input', { placeholder: 'Naam ya ID se dhoondo', 'aria-label': 'Search', oninput: () => draw() });
  const list = h('div.list');
  const reload = () => route();
  function draw() {
    const q = search.value.trim().toLowerCase().replace(/\s/g, '');
    const shown = rows.filter(r => !q || r.id.includes(q) || String(info[r.id]?.name || '').toLowerCase().replace(/\s/g, '').includes(q));
    list.replaceChildren(...(shown.length ? shown.map(r => { const u = info[r.id] || {}; return h('div.item', {}, avatar(u.name), h('div.grow', {}, h('div.name', {}, u.name || 'Unknown player'), h('div.faint.mono', {}, `${showId(r.id)} · since ${r.since || '-'}`)),
      h('span.tag', {}, `Lv ${u.level || '-'}`), h('span.faint', {}, agoText(u.seen)),
      h('button.btn.small.gold', { onclick: () => go('gift', { id: r.id }) }, 'Gift'),
      h('button.btn.small.bad', { onclick: act(async () => { if (!await ask({ title: `${word} hatana hai?`, body: `${u.name || showId(r.id)} se ${word} ${creators ? 'access' : 'title'} wapas le lenge.${creators ? ' Uski published rivers rahengi.' : ''}`, yes: 'Remove', danger: true })) return; await revoke(kind, r.id); toast('Hata diya'); reload(); }) }, 'Remove')); }) : [empty(`Koi ${word} nahi mila.`)]));
  }
  const add = act(async () => {
    const { ids, bad } = parseIds(input.value);
    if (bad.length || ids.length !== 1) return toast('Ek sahi 8 number ki Player ID daalo.', true);
    const id = ids[0], snap = await fb.getDoc(ref('users', id));
    if (!snap.exists()) return toast(`ID ${showId(id)} game me nahi mili.`, true);
    if (rows.some(r => r.id === id)) return toast('Ye pehle se hai.', true);
    if (!await ask({ title: `${word} banayein?`, body: `${snap.data().name || 'Player'} (${showId(id)})`, yes: 'Yes, add' })) return;
    await grant(kind, id); toast(`${snap.data().name || 'Player'} ab ${word} hai`); reload();
  });
  if (!live()) return;
  draw();
  v.replaceChildren(head(creators ? 'Creators' : 'Partners', creators ? 'Jinko river banane ka access hai. Golden Rivers Creator title apne aap milta hai.' : 'Jinke paas "Hippo Raft Rush Official Partner" title hai.'),
    h('div.card.stack', { style: 'margin-bottom:14px' }, h('h2', {}, `New ${word}`), h('div.row', {}, h('div.grow', {}, input), h('button.btn.go', { onclick: add }, `Add ${word}`))),
    h('div.card.stack', {}, h('div.row.between', {}, h('h2', {}, `${rows.length} ${word}${rows.length === 1 ? '' : 's'}`), h('div', { style: 'width:min(300px,100%)' }, search)), list));
}

// ------------------------------------------------------------------ creator forms
async function forms(v, live) {
  const [apps, cr] = await Promise.all([docs(fb.query(col('wow_apply'), fb.limit(500))), docs(fb.query(col('wow_creators'), fb.limit(500)))]);
  if (!live()) return;
  const isCreator = new Set(cr.map(c => c.id));
  const state = a => isCreator.has(a.id) ? 'approved' : a.status === 'denied' ? 'denied' : 'pending';
  apps.sort((a, b) => Number(b.at || 0) - Number(a.at || 0));
  let tab = 'pending';
  const tabs = h('div.tabs'), grid = h('div.grid', { style: 'grid-template-columns:repeat(auto-fill,minmax(330px,1fr))' });
  function draw() {
    const n = k => apps.filter(a => k === 'all' || state(a) === k).length;
    tabs.replaceChildren(...[['pending', 'Pending'], ['approved', 'Approved'], ['denied', 'Denied'], ['all', 'All']].map(([k, l]) => h('button.tab', { class: tab === k ? 'on' : '', onclick: () => { tab = k; draw(); } }, `${l} (${n(k)})`)));
    const shown = apps.filter(a => tab === 'all' || state(a) === tab);
    grid.replaceChildren(...(shown.length ? shown.map(card) : [h('div.card', { style: 'grid-column:1/-1' }, empty(tab === 'pending' ? 'Sab forms ho gaye. Koi pending nahi.' : 'Yahan kuch nahi.'))]));
  }
  function card(a) {
    const st = state(a);
    const yes = h('button.btn.go', { onclick: act(async () => { await grant('creators', a.id); isCreator.add(a.id); a.status = 'approved'; toast(`${a.name || 'Player'} ab Creator hai`); draw(); refreshBadge(); }) }, 'APPROVE');
    const no = h('button.btn.bad', { onclick: act(async () => { if (!await ask({ title: 'Form deny karein?', body: `${a.name || 'Player'} ko game me "Not this time" dikhega.`, yes: 'Deny', danger: true })) return; await fb.updateDoc(ref('wow_apply', a.id), { status: 'denied' }); await logDo('Creator form denied', showId(a.id)); a.status = 'denied'; toast('Deny kar diya'); draw(); refreshBadge(); }) }, 'DENY');
    const again = h('button.btn.small', { onclick: act(async () => { if (!await ask({ title: 'Dobara apply karne dein?', body: 'Ye form hat jayega aur player phir se form bhar sakega.', yes: 'Allow' })) return; await fb.deleteDoc(ref('wow_apply', a.id)); await logDo('Creator form reset', showId(a.id)); apps.splice(apps.indexOf(a), 1); toast('Ab dobara apply kar sakta hai'); draw(); refreshBadge(); }) }, 'Allow re-apply');
    const remove = h('button.btn.small.bad', { onclick: act(async () => { if (!await ask({ title: 'Creator access hatana hai?', yes: 'Remove', danger: true })) return; await revoke('creators', a.id); isCreator.delete(a.id); a.status = 'denied'; toast('Hata diya'); draw(); }) }, 'Remove access');
    return h('div.card.stack', {}, h('div.row', {}, avatar(a.name), h('div.grow', {}, h('div.name', {}, a.name || 'Player'), h('div.faint.mono', {}, `${showId(a.id)} · ${whenText(a.at)}`)), h('span.tag', { class: { pending: 'y', approved: 'g', denied: 'r' }[st] }, st)),
      h('ul.answers', {}, QUESTIONS.map((q, i) => h('li', {}, h('small', {}, q), h('b', {}, a[`q${i + 1}`] || '-')))),
      st === 'pending' ? h('div.row', {}, h('div.grow', { style: 'display:grid' }, yes), h('div.grow', { style: 'display:grid' }, no)) : h('div.row', {}, st === 'approved' ? remove : yes, st === 'denied' ? again : null));
  }
  draw();
  v.replaceChildren(head('Creator Forms', 'Kisne form bhara, kya jawab diye. Approve dabate hi usko Creator mode mil jata hai aur notification jata hai.'), tabs, grid);
}

// ------------------------------------------------------------------ players
async function players(v, live, onLeave) {
  let stopView = [];   // the listeners of what is on screen: the recent list, or one player
  const stopAll = () => { stopView.forEach(x => x()); stopView = []; };
  onLeave(stopAll);
  const input = h('input', { placeholder: 'Player ID ya naam', 'aria-label': 'Search player', onkeydown: e => { if (e.key === 'Enter') find(); } });
  const out = h('div', {}, loading());
  const find = act(async () => {
    const text = input.value.trim(); if (!text) return showRecent();
    out.replaceChildren(loading());
    const digits = text.replace(/\s/g, '');
    if (/^\d+$/.test(digits)) {
      if (!ID_RE.test(digits)) { out.replaceChildren(h('div.note.warn', {}, 'Player ID 8 number ki hoti hai.')); return; }
      const s = await fb.getDoc(ref('users', digits));
      if (!s.exists()) { out.replaceChildren(h('div.card', {}, empty('Is ID ka koi player nahi mila.'))); return; }
      return open({ id: s.id, ...s.data() });
    }
    const rows = await docs(fb.query(col('users'), fb.orderBy('name'), fb.startAt(text), fb.endAt(`${text}`), fb.limit(30)));
    out.replaceChildren(h('div.card', {}, rows.length ? listOf(rows) : empty('Is naam se koi nahi mila. Naam capital/small letters sahit same likho.')));
  });
  const onlineNow = u => u.state !== 'off' && Math.floor(Date.now() / 1000) - Number(u.seen || 0) <= 100;
  const listOf = rows => h('div.list', {}, rows.map(u => h('div.item', {}, h('span.dot', { class: onlineNow(u) ? 'on' : '' }), avatar(u.name), h('div.grow', {}, h('div.name', {}, u.name || 'Player'), h('div.faint.mono', {}, showId(u.id))), h('span.tag', {}, `Lv ${u.level || '-'}`), onlineNow(u) ? h('span.tag.g', {}, u.state === 'race' ? 'racing' : 'online') : h('span.faint', {}, seenText(u.seen)), h('button.btn.small', { onclick: act(() => open(u)) }, 'Open'))));
  async function showRecent() {
    stopAll();
    let rows = [];
    const draw = () => { if (live()) out.replaceChildren(h('div.card.stack', {}, h('div.row.between', {}, h('h2', {}, 'Recently active'), h('span.livepill.small', {}, h('i'), 'LIVE')), rows.length ? listOf(rows) : empty('Abhi koi player nahi.'))); };
    stopView.push(fb.onSnapshot(fb.query(col('users'), fb.orderBy('seen', 'desc'), fb.limit(40)), snap => { rows = snap.docs.map(d => ({ id: d.id, ...d.data() })); draw(); }, e => out.replaceChildren(h('div.note.danger', {}, friendly(e)))));
    const tick = setInterval(draw, 5000); stopView.push(() => clearInterval(tick));
  }
  async function open(u) {
    stopAll();
    const [c, p, ban, photo] = await Promise.all([fb.getDoc(ref('wow_creators', u.id)), fb.getDoc(ref('partners', u.id)), fb.getDoc(ref('photo_bans', u.id)), fb.getDoc(ref('photos', u.id))]);
    const isC = c.exists(), isP = p.exists(), banned = ban.exists(), image = photo.exists() ? photo.data().pic : '';
    const again = () => open(u);
    const stat = (k, val) => h('div', {}, h('div.faint', {}, k), h('div.name', {}, val));
    // live: the heartbeat (level, last seen, home or racing) and the game's stats report, as they change
    const liveFields = h('div.fields'), statsBox = h('div.fields');
    const drawLiveFields = () => { if (!live()) return; const on = onlineNow(u); liveFields.replaceChildren(stat('Level', u.level || '-'), stat('Rank Points', Number(u.rp) >= 0 ? u.rp : 'Not ranked'), stat('Last seen', on ? 'online now' : seenText(u.seen)), stat('Now', !on ? 'Offline' : u.state === 'race' ? `Racing ${u.river || ''}` : 'Home')); };
    drawLiveFields();
    stopView.push(fb.onSnapshot(ref('users', u.id), snap => { if (snap.exists()) { Object.assign(u, snap.data()); drawLiveFields(); } }, console.warn));
    stopView.push(fb.onSnapshot(ref('stats_players', u.id), snap => {
      if (!live()) return;
      if (!snap.exists()) { statsBox.replaceChildren(h('p.faint', {}, 'Is player ka game stats abhi nahi aaya (purana game version).')); return; }
      const x = snap.data();
      statsBox.replaceChildren(stat('Country', `${flag(x.country)} ${countryName(x.country)}`), stat('Time played', hours(x.seconds)), stat('Races', num(x.races || 0)), stat('Sessions', num(x.sessions || 0)),
        stat('Ads seen', `${num(x.ads || 0)} (R ${num(x.rewarded || 0)} · I ${num(x.interstitial || 0)} · B ${num(x.banner || 0)} · N ${num(x.native || 0)})`), stat('Game version', x.version ? `v${x.version}` : '-'),
        stat('First day', x.firstDay ? dayLabel(String(x.firstDay)) : '-'), stat('Last report', seenText(x.lastAt)));
    }, console.warn));
    const tick = setInterval(drawLiveFields, 5000); stopView.push(() => clearInterval(tick));
    out.replaceChildren(h('div.card.stack', {},
      h('div.row', {}, avatar(u.name, image), h('div.grow', {}, h('h2', {}, u.name || 'Player'), h('div.faint.mono', {}, `ID ${showId(u.id)}`)), isC ? h('span.tag.p', {}, 'Creator') : null, isP ? h('span.tag.y', {}, 'Partner') : null, banned ? h('span.tag.r', {}, 'Photo banned') : null),
      liveFields, statsBox,
      h('div.row', {},
        h('button.btn.gold', { onclick: () => go('gift', { id: u.id }) }, icon('gift'), 'Send gift'),
        h(`button.btn.${isC ? 'bad' : 'go'}`, { onclick: act(async () => { if (!await ask({ title: isC ? 'Creator hatana hai?' : 'Creator banayein?', body: u.name || showId(u.id), danger: isC })) return; await (isC ? revoke : grant)('creators', u.id); toast('Done'); await again(); }) }, isC ? 'Remove Creator' : 'Make Creator'),
        h(`button.btn.${isP ? 'bad' : 'go'}`, { onclick: act(async () => { if (!await ask({ title: isP ? 'Partner title hatana hai?' : 'Partner title dein?', body: u.name || showId(u.id), danger: isP })) return; await (isP ? revoke : grant)('partners', u.id); toast('Done'); await again(); }) }, isP ? 'Remove Partner' : 'Give Partner title'),
        image ? h('button.btn', { onclick: act(async () => { if (!await ask({ title: 'Profile photo hatayein?', yes: 'Remove', danger: true })) return; await removePhoto(u.id); toast('Photo hat gayi'); await again(); }) }, 'Remove photo') : null,
        h('button.btn', { onclick: act(async () => { if (!await ask({ title: banned ? 'Photo ban hatayein?' : 'Photo ban karein?', body: banned ? '' : 'Ye player nayi profile photo nahi laga payega.', danger: !banned })) return; await setPhotoBan(u.id, !banned); toast('Done'); await again(); }) }, banned ? 'Unban photo' : 'Ban photo')),
      h('button.btn.small.ghost', { style: 'justify-self:start', onclick: act(showRecent) }, 'Back to list')));
  }
  v.replaceChildren(head('Players', 'ID ya naam se koi bhi player dhoondo.'), h('div.card', { style: 'margin-bottom:14px' }, h('div.row', {}, h('div.grow', {}, input), h('button.btn.gold', { onclick: find }, 'Search'))), out);
  const wanted = prefill && prefill.id; prefill = null;
  if (wanted) { input.value = wanted; await find(); } else await showRecent();
}
async function removePhoto(id) {
  await fb.setDoc(ref('photos', id), { pic: '', at: String(Math.floor(Date.now() / 1000)) });
  await logDo('Photo removed', showId(id));
}
async function setPhotoBan(id, on) {
  if (on) await fb.setDoc(ref('photo_bans', id), { at: String(Math.floor(Date.now() / 1000)) }); else await fb.deleteDoc(ref('photo_bans', id));
  await logDo(on ? 'Photo banned' : 'Photo unbanned', showId(id));
}

// ------------------------------------------------------------------ rivers
const riverMode = ver => { const m = String(ver || '').match(/m(\d)/); return MODES[m ? Number(m[1]) : 0] || 'BASIC'; };
async function deleteRiver(r) {
  const [cm, rt] = await Promise.all([docs(col(`wow_rivers/${r.id}/comments`)), docs(col(`wow_rivers/${r.id}/ratings`))]);
  await inBatches([...cm.map(x => ref('wow_rivers', r.id, 'comments', x.id)), ...rt.map(x => ref('wow_rivers', r.id, 'ratings', x.id))], (b, x) => b.delete(x));
  const b = fb.writeBatch(db); b.delete(ref('wow_maps', r.id)); b.delete(ref('wow_rivers', r.id)); await b.commit();
  await logDo('River deleted', `${r.title || r.id} (${r.id})`);
}
async function rivers(v, live) {
  const rows = await docs(fb.query(col('wow_rivers'), fb.limit(300)));
  if (!live()) return;
  rows.sort((a, b) => Number(b.plays || 0) - Number(a.plays || 0));
  const search = h('input', { placeholder: 'River ya creator ka naam', 'aria-label': 'Search rivers', oninput: () => draw() });
  const grid = h('div.grid');
  async function comments(r) {
    const box = h('div', {}, loading()); sheet(`Comments: ${r.title || r.id}`, box);
    const c = await docs(col(`wow_rivers/${r.id}/comments`));
    box.replaceChildren(c.length ? h('div.list', {}, c.map(x => { const row = h('div.item', {}, h('div.grow', {}, h('div.name', {}, x.name || 'Player'), h('div.muted', { style: 'overflow-wrap:anywhere' }, x.text || '')), h('button.btn.small.bad', { onclick: act(async () => { await fb.deleteDoc(ref('wow_rivers', r.id, 'comments', x.id)); await logDo('Comment deleted', `${r.title}: ${x.text}`); row.remove(); toast('Comment hat gaya'); }) }, 'Delete')); return row; })) : empty('Koi comment nahi.'));
  }
  function draw() {
    const q = search.value.trim().toLowerCase();
    const shown = rows.filter(r => !q || `${r.title} ${r.creator}`.toLowerCase().includes(q));
    grid.replaceChildren(...(shown.length ? shown.map(r => {
      const src = pic(r.thumb), rating = Number(r.rcount) ? (Number(r.rsum) / Number(r.rcount)).toFixed(1) : '-';
      return h('div.card.river', {}, src ? h('img.thumb', { src, alt: '', loading: 'lazy' }) : h('div.thumb'),
        h('div.row.between', {}, h('h3', { style: 'overflow-wrap:anywhere' }, r.title || r.id), h('span.tag.p', {}, riverMode(r.ver))),
        h('div.faint', {}, `by ${r.creator || 'Player'} · ${Number(r.plays || 0)} plays · ${rating} stars`),
        h('div.row', {}, h('button.btn.small', { onclick: act(() => comments(r)) }, 'Comments'), h('button.btn.small.bad', { onclick: act(async () => { if (!await ask({ title: 'River delete karein?', body: `"${r.title}" sabke liye hamesha ke liye hat jayegi, plays, stars aur comments ke saath.`, yes: 'Delete forever', danger: true, word: 'DELETE' })) return; await deleteRiver(r); rows.splice(rows.indexOf(r), 1); toast('River delete ho gayi'); draw(); }) }, 'Delete')));
    }) : [h('div.card', { style: 'grid-column:1/-1' }, empty('Koi river nahi mili.'))]));
  }
  draw();
  v.replaceChildren(head('Rivers', 'Players ki banayi hui rivers.', h('div', { style: 'width:min(300px,100%)' }, search)), grid);
}

// ------------------------------------------------------------------ reports
async function reports(v, live) {
  const [rr, pr] = await Promise.all([docs(fb.query(col('wow_reports'), fb.limit(200))), docs(fb.query(col('photo_reports'), fb.limit(200)))]);
  if (!live()) return;
  const riverCache = {};
  const river = async id => { if (!(id in riverCache)) { const s = await fb.getDoc(ref('wow_rivers', id)); riverCache[id] = s.exists() ? { id, ...s.data() } : null; } return riverCache[id]; };
  let tab = 'rivers';
  const tabs = h('div.tabs'), box = h('div.card');
  const dropRiverReport = async r => { await fb.deleteDoc(ref('wow_reports', r.id)); rr.splice(rr.indexOf(r), 1); };
  async function draw() {
    tabs.replaceChildren(h('button.tab', { class: tab === 'rivers' ? 'on' : '', onclick: () => { tab = 'rivers'; draw(); } }, `Rivers & comments (${rr.length})`), h('button.tab', { class: tab === 'photos' ? 'on' : '', onclick: () => { tab = 'photos'; draw(); } }, `Photos (${pr.length})`));
    box.replaceChildren(loading());
    if (tab === 'rivers') {
      const rows = await Promise.all(rr.map(async r => {
        const rv = await river(r.rid); let cm = null;
        if (r.cid && rv) { const s = await fb.getDoc(ref('wow_rivers', r.rid, 'comments', r.cid)); cm = s.exists() ? s.data() : null; }
        return h('div.item', {}, h('div.grow', {}, h('div.row', {}, h('span.tag.r', {}, r.cid ? 'comment' : 'river'), h('span.name', {}, rv ? rv.title : `${r.rid} (already deleted)`)), r.cid ? h('div.muted', { style: 'overflow-wrap:anywhere' }, cm ? `${cm.name || 'Player'}: ${cm.text}` : 'Comment already deleted') : null, h('div.faint', {}, `reported by ${showId(r.uid || '-')}`)),
          r.cid && cm ? h('button.btn.small.bad', { onclick: act(async () => { await fb.deleteDoc(ref('wow_rivers', r.rid, 'comments', r.cid)); await dropRiverReport(r); await logDo('Reported comment deleted', cm.text); toast('Comment hat gaya'); draw(); }) }, 'Delete comment') : null,
          !r.cid && rv ? h('button.btn.small.bad', { onclick: act(async () => { if (!await ask({ title: 'River delete karein?', body: `"${rv.title}" hamesha ke liye hat jayegi.`, yes: 'Delete forever', danger: true, word: 'DELETE' })) return; await deleteRiver(rv); riverCache[r.rid] = null; await dropRiverReport(r); toast('River delete ho gayi'); draw(); }) }, 'Delete river') : null,
          h('button.btn.small', { onclick: act(async () => { await dropRiverReport(r); await logDo('Report dismissed', r.rid); toast('Report hata di'); draw(); }) }, 'Ignore'));
      }));
      box.replaceChildren(rows.length ? h('div.list', {}, rows) : empty('Koi report nahi. Sab sahi hai.'));
    } else {
      const byTarget = {}; pr.forEach(r => { (byTarget[r.target] ||= []).push(r); });
      const clear = async t => { await inBatches(byTarget[t], (b, x) => b.delete(ref('photo_reports', x.id))); byTarget[t].forEach(x => pr.splice(pr.indexOf(x), 1)); };
      const rows = await Promise.all(Object.keys(byTarget).map(async t => {
        const [p, u] = await Promise.all([fb.getDoc(ref('photos', t)), fb.getDoc(ref('users', t))]);
        const image = p.exists() ? p.data().pic : '', name = u.exists() ? u.data().name : 'Player';
        return h('div.item', {}, avatar(name, image), h('div.grow', {}, h('div.name', {}, name), h('div.faint.mono', {}, `${showId(t)} · ${byTarget[t].length} report${byTarget[t].length > 1 ? 's' : ''}`), image ? null : h('div.faint', {}, 'Photo already removed')),
          image ? h('button.btn.small', { onclick: () => sheet(`Photo: ${name}`, h('img', { src: pic(image), alt: '', style: 'max-width:100%;border-radius:12px' })) }, 'View') : null,
          h('button.btn.small.bad', { onclick: act(async () => { if (!await ask({ title: 'Photo hatao aur ban karo?', body: `${name} nayi photo nahi laga payega.`, yes: 'Remove + Ban', danger: true })) return; await removePhoto(t); await setPhotoBan(t, true); await clear(t); toast('Done'); draw(); }) }, 'Remove + Ban'),
          h('button.btn.small', { onclick: act(async () => { await removePhoto(t); await clear(t); toast('Photo hat gayi'); draw(); }) }, 'Remove'),
          h('button.btn.small', { onclick: act(async () => { await clear(t); await logDo('Photo report dismissed', showId(t)); toast('Report hata di'); draw(); }) }, 'Ignore'));
      }));
      box.replaceChildren(rows.length ? h('div.list', {}, rows) : empty('Koi photo report nahi.'));
    }
  }
  v.replaceChildren(head('Reports', 'Players ne jo report kiya.'), tabs, box);
  await draw();
}

// ------------------------------------------------------------------ game settings
async function settings(v, live) {
  const [appS, seasonS] = await Promise.all([fb.getDoc(ref('config', 'app')), fb.getDoc(ref('config', 'season'))]);
  if (!live()) return;
  const app = appS.exists() ? appS.data() : {}, season = seasonS.exists() ? seasonS.data() : {};
  const input = (val, ph) => h('input', { value: val || '', placeholder: ph || '' });
  const min = input(app.minVersion, 'Khali = koi force update nahi'), latest = input(app.latestVersion, '1.50'), f = [1, 2, 3].map(i => input(app[`feature${i}`], `Feature ${i}`));
  const toLocal = sec => { const d = new Date(Number(sec) * 1000); return isNaN(d) ? '' : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
  const start = h('input', { type: 'datetime-local', value: season.start ? toLocal(season.start) : '', 'aria-label': 'Season start' });
  const saveApp = act(async () => {
    const m = min.value.trim(), l = latest.value.trim();
    if (m && !/^\d+(\.\d+)*$/.test(m)) return toast('Version aisa likho: 1.50', true);
    if (l && !/^\d+(\.\d+)*$/.test(l)) return toast('Version aisa likho: 1.50', true);
    if (m !== (app.minVersion || '') && m) { if (!await ask({ title: 'Force update lagayein?', body: `Jinke paas version ${m} se purana game hai wo tab tak khel NAHI payenge jab tak update na karein.\n\nPehle pakka karo ki ${m} Google Play pe live hai.`, yes: 'Force update', danger: true, word: 'UPDATE' })) return; }
    const data = { minVersion: m, latestVersion: l, feature1: f[0].value.trim(), feature2: f[1].value.trim(), feature3: f[2].value.trim() };
    await fb.setDoc(ref('config', 'app'), data, { merge: true }); Object.assign(app, data); await logDo('Update settings saved', `min ${m || 'none'}, latest ${l || '-'}`); toast('Save ho gaya');
  });
  const saveSeason = act(async () => {
    const d = new Date(start.value); if (isNaN(d)) return toast('Date chuno.', true);
    if (!await ask({ title: 'Season ki date badlein?', body: 'Isse sabka season number aur bache hue din badal jayenge. Galat date se ranking gadbad ho sakti hai.', yes: 'Change', danger: true, word: 'SEASON' })) return;
    const sec = String(Math.floor(d.getTime() / 1000)); await fb.setDoc(ref('config', 'season'), { start: sec }, { merge: true }); await logDo('Season start changed', whenText(sec)); toast('Save ho gaya');
  });
  v.replaceChildren(head('Game Settings', 'Force update aur ranked season.'), h('div.two', {},
    h('div.card.stack', {}, h('h2', {}, 'App update'), h('div.note.warn', {}, 'Minimum version ko galat set kiya to players game nahi khol payenge. Version game jaisa hi likho: 1.50 (1.5 alag hota hai).'),
      h('div.fields', { style: 'grid-template-columns:repeat(auto-fit,minmax(180px,1fr))' }, field('Minimum version (force update)', min), field('Latest version', latest)), f.map((x, i) => field(`What's new ${i + 1}`, x)), h('button.btn.go', { onclick: saveApp }, 'Save')),
    h('div.card.stack', {}, h('h2', {}, 'Ranked season'), h('p.muted', {}, 'Season 1 kab shuru hua. Har season 60 din ka hai.'), field('Season 1 start', start), h('button.btn.bad', { onclick: saveSeason }, 'Change date'))));
}

async function activity(v, live, onLeave) {
  const box = h('div.card', {}, loading());
  v.replaceChildren(head('Activity Log', 'Panel se jo bhi hua, sab yahan likha rehta hai.', h('span.livepill', {}, h('i'), 'LIVE')), box);
  onLeave(fb.onSnapshot(fb.query(col('admin_log'), fb.orderBy('at', 'desc'), fb.limit(150)), snap => {
    if (!live()) return;
    const rows = snap.docs.map(d => d.data());
    box.replaceChildren(rows.length ? h('div.list', {}, rows.map(l => h('div.item', {}, h('div.grow', {}, h('div.name', {}, l.action), h('div.muted', { style: 'overflow-wrap:anywhere' }, l.detail || '')), h('span.faint', {}, whenText(l.at))))) : empty('Abhi kuch nahi hua.'));
  }, e => box.replaceChildren(h('div.note.danger', {}, friendly(e)))));
}

// ------------------------------------------------------------------ analytics
// A day runs on India time, the same as in the game. Finished days never change, so they are kept in this browser.
const IST = 330 * 60000;
const istDate = (back = 0) => new Date(Date.now() + IST - back * 86400000);
const dayKey = (back = 0) => { const d = istDate(back); return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`; };
const dayLabel = key => new Date(Date.UTC(+key.slice(0, 4), +key.slice(4, 6) - 1, +key.slice(6))).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const num = n => n === null || n === undefined ? '-' : Number(n).toLocaleString('en-IN');
function hours(sec) {
  const s = Number(sec) || 0; if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h}h ${m}m` : `${m}m`;
}
const EMPTY_DAY = { players: 0, seconds: 0, sessions: 0, races: 0, fresh: 0, rewarded: 0, interstitial: 0, banner: 0, native: 0 };
// One measure per query: several sums in one query would need a custom Firestore index for every combination.
const SUMS = { seconds: 'seconds', sessions: 'sessions', races: 'races', fresh: 'new', rewarded: 'rewarded', interstitial: 'interstitial', banner: 'banner', native: 'native' };
async function totals(path) {
  const c = col(path), players = (await fb.getCountFromServer(c)).data().count;
  if (!players) return { ...EMPTY_DAY };   // nobody that day: one read instead of nine
  const got = await Promise.all(Object.entries(SUMS).map(async ([key, field]) => [key, (await fb.getAggregateFromServer(c, { v: fb.sum(field) })).data().v || 0]));
  return { ...EMPTY_DAY, players, ...Object.fromEntries(got) };
}
async function dayTotals(key, today) {
  const cacheKey = `hippoAdmin.day.${key}`;
  if (!today) { try { const c = JSON.parse(localStorage.getItem(cacheKey) || 'null'); if (c) return c; } catch { /* read it again */ } }
  const t = await totals(`stats_days/${key}/players`);
  if (key < dayKey(1)) { try { localStorage.setItem(cacheKey, JSON.stringify(t)); } catch { /* full */ } }
  return t;
}
const addUp = list => list.reduce((s, d) => { for (const k of Object.keys(EMPTY_DAY)) s[k] += d[k] || 0; return s; }, { ...EMPTY_DAY });
const adsOf = d => (d.rewarded || 0) + (d.interstitial || 0) + (d.banner || 0) + (d.native || 0);
const regionNames = (() => { try { return new Intl.DisplayNames(['en'], { type: 'region' }); } catch { return null; } })();
const countryName = c => { if (!c || c === 'XX') return 'Unknown'; try { return regionNames ? regionNames.of(c) : c; } catch { return c; } };
const flag = c => !c || c === 'XX' || !/^[A-Z]{2}$/.test(c) ? '🌍' : String.fromCodePoint(...[...c].map(x => 127397 + x.charCodeAt(0)));

/** One measure over the last 30 days: bars from a common zero, the value on hover or tap, and the same numbers as a table. */
function dayChart(days, metric) {
  const value = d => metric.get(d.t), most = Math.max(1, ...days.map(value));
  const top = (() => { const want = most / 4, p = 10 ** Math.floor(Math.log10(want)); for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= want) return (metric.whole ? Math.max(Math.ceil(m * p), 1) : m * p) * 4; return most; })();
  const tip = h('div.tip', { hidden: true, role: 'status' });
  const plot = h('div.plot', {}, [4, 3, 2, 1, 0].map(i => h('div.gridline', { style: `bottom:${i * 25}%` }, h('span', {}, metric.axis(top * i / 4)))),
    h('div.bars', {}, days.map(d => {
      const v = value(d), show = () => { tip.hidden = false; tip.replaceChildren(h('b', {}, metric.text(v)), h('span', {}, `${metric.name} · ${dayLabel(d.key)}`)); };
      return h('button.barhit', { 'aria-label': `${dayLabel(d.key)}: ${metric.text(v)} ${metric.name}`, onmouseenter: show, onfocus: show, onclick: show, onmouseleave: () => { tip.hidden = true; } },
        h('i', { style: `height:${v ? Math.max(v / top * 100, 1.5) : 0}%` }));
    })));
  const axis = h('div.xaxis', {}, days.map((d, i) => h('span', {}, i % 5 === 4 || i === days.length - 1 ? dayLabel(d.key) : '')));
  const table = h('details.datatable', {}, h('summary', {}, 'Show as table'), h('div.scroll', {}, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Day'), h('th.n', {}, metric.name))),
    h('tbody', {}, [...days].reverse().map(d => h('tr', {}, h('td', {}, dayLabel(d.key)), h('td.n', {}, metric.text(value(d)))))))));
  return h('div.chart', {}, h('div.tipwrap', {}, tip), plot, axis, table);
}

// Everything on this page is live: Firestore listeners push each change the moment the game sends it, instead of the page
// asking again on a timer. Every listener reads a bounded number of documents and the big totals are counted and summed on
// the server, so the page costs the same with a hundred players or a million.
const nowSec = () => Math.floor(Date.now() / 1000);
const LIVE_SECONDS = 100;      // the game beats every 40 s: two missed beats and the player has gone
const PRESENCE_CAP = 1000;     // players the live list holds; past this the live number is counted on the server
const TOP_SIZES = [25, 50, 100];
function seenText(sec) {
  const n = Number(sec); if (!n) return 'never';
  const s = Math.max(0, nowSec() - n);
  if (s < 10) return 'just now'; if (s < 60) return `${s}s ago`; if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`; return `${Math.floor(s / 86400)} days ago`;
}
const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));
function csv(rows) {
  const cell = x => { const s = String(x ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const blob = new Blob([rows.map(r => r.map(cell).join(',')).join('\n')], { type: 'text/csv' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `hippo-top-players-${dayKey()}.csv` }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ------------------------------------------------------------------ time played, to the second
// The game adds each player's seconds to the server every minute (an older game every three) and beats its heartbeat every
// 40 s. A player who is online has also played the time since their own last report. The server's sum plus that, player
// by player, moves every second and lands on the server's number as each report comes in: nothing counted twice, nothing
// lost, and when a player stops, their part stops with them.
const UNREPORTED_MOST = 200;   // one report's worth and a little: past this a player's time waits for their next report
const PLAY_MEM = 'hippoAdmin.play.v1';   // who is playing since when: shared by the pages, so a refresh or a page change carries on
function playClock(listen, liveNow, userOf, onLeave) {
  const reports = new Map();   // id -> the game's time of their last report, for everyone who reported in the last 15 min
  const covered = new Map();   // the same, as of the last time the server added up: the time before it is in the sums
  const sighted = new Map();   // id -> when they were seen to start playing (their time before it is not counted)
  const playing = new Map();   // id -> 0 while playing, else when they stopped (kept until their last report is in the sums)
  let stop = null, gotReports = false, gotPresence = false, wake = null, ticks = 0;
  const ready = new Promise(r => { wake = r; });
  const check = () => { if (gotReports && gotPresence) wake(); };
  function watch() {
    if (stop) stop();
    stop = listen(fb.query(col('stats_players'), fb.where('lastAt', '>=', nowSec() - 900), fb.orderBy('lastAt', 'desc'), fb.limit(PRESENCE_CAP)), snap => {
      reports.clear(); snap.docs.forEach(d => reports.set(d.id, Number(d.data().lastAt) || 0));
      gotReports = true; check();
    });
  }
  // A player's time counts from their last report, but never from before they were seen playing: a player back after a
  // break has not reported this session yet. One already playing when the panel opened counts from that moment, and their
  // next report (within a minute) brings what came before. So it never shows more than was really played.
  const start = (id, at) => Math.max(at, sighted.get(id) || 0);
  /** Seconds this player has played that the server does not have yet, counted from `at`, their report the caller holds. */
  function extra(id, at) {
    const left = playing.get(id);
    if (left === undefined) return 0;
    return Math.min(Math.max((left || nowSec()) - start(id, Number(at) || 0), 0), UNREPORTED_MOST);
  }
  /** Once a second: who is playing now, and all they have played that the last server sum does not have. */
  function tick() {
    const now = nowSec(), here = new Set();
    for (const u of liveNow()) {
      here.add(u.id);
      if (playing.get(u.id) === 0) continue;
      sighted.set(u.id, now); playing.set(u.id, 0);
    }
    for (const [id, left] of playing) {
      if (!left) {
        if (here.has(id) || !gotPresence) continue;
        const u = userOf(id), seen = Number(u && u.seen) || now;
        playing.set(id, Math.min(now, u && u.state === 'off' ? seen : seen + 40));   // the heartbeat stopped: they played until about then
      } else if ((covered.get(id) || 0) >= left - 5 || now - left > 600) { playing.delete(id); sighted.delete(id); }
    }
    let sum = 0;
    for (const id of playing.keys()) sum += extra(id, covered.get(id) || 0);
    if (++ticks % 3 === 0) save();
    return sum;
  }
  function save() { try { localStorage.setItem(PLAY_MEM, JSON.stringify({ at: nowSec(), p: [...playing].map(([id, left]) => [id, left, start(id, covered.get(id) || 0)]) })); } catch { /* full or blocked */ } }
  try {   // carry on from the last page, if it was only a moment ago
    const o = JSON.parse(localStorage.getItem(PLAY_MEM) || 'null');
    if (o && Array.isArray(o.p) && nowSec() - o.at < 180) for (const [id, left, from] of o.p) { playing.set(id, left || 0); sighted.set(id, from); }
  } catch { /* start fresh */ }
  addEventListener('pagehide', save); onLeave(() => { save(); removeEventListener('pagehide', save); });
  return {
    watch, tick, extra, ready,
    /** Call as the server's sums come in: from now on everything before each player's last report is in them. */
    synced() { covered.clear(); reports.forEach((at, id) => covered.set(id, at)); },
    presenceIn() { if (!gotPresence) { gotPresence = true; check(); } },
    reportAt: id => reports.get(id) || 0,
    isPlaying: id => playing.get(id) === 0,
    playingCount() { let n = 0; for (const left of playing.values()) if (!left) n++; return n; },
  };
}
/** Runs `fn` once each new second. Checked four times a second: a browser that delays timers (energy saver, a busy tab)
 *  can stretch a plain one-second timer to two, and the counters would visibly skip. */
function eachSecond(every, fn) { let last = 0; every(250, () => { const s = nowSec(); if (s !== last) { last = s; fn(); } }); }
/** Waits for a promise, but never longer than `ms`. */
const atMost = (p, ms) => Promise.race([p, new Promise(r => setTimeout(r, ms))]);

async function analytics(v, live, onLeave) {
  const startDay = dayKey();
  const stops = [], timers = [];
  onLeave(() => { stops.splice(0).forEach(s => { try { s(); } catch { /* gone */ } }); timers.splice(0).forEach(clearInterval); });
  let lastPush = Date.now(), healthy = true;
  const status = h('span.livepill', {}, h('i'), 'LIVE'), stamp = h('span.faint', {}, 'Connecting...');
  function setHealthy(ok) {
    if (ok === healthy) return; healthy = ok;
    status.className = ok ? 'livepill' : 'livepill off';
    status.replaceChildren(h('i'), ok ? 'LIVE' : 'RECONNECTING');
  }
  /** A Firestore listener that stops when the page is left. Returns its own stop. */
  function listen(q, next) {
    const stop = fb.onSnapshot(q, { includeMetadataChanges: true }, snap => {
      if (!live()) return;
      setHealthy(!snap.metadata.fromCache || navigator.onLine);
      if (snap.metadata.hasPendingWrites) return;
      lastPush = Date.now(); stamp.textContent = 'Updated just now'; next(snap);
    }, e => { console.warn(e); setHealthy(false); stamp.textContent = friendly(e); });
    stops.push(stop);
    return () => { stop(); const i = stops.indexOf(stop); if (i >= 0) stops.splice(i, 1); };
  }
  const every = (ms, fn) => timers.push(setInterval(() => { if (live()) fn(); }, ms));

  const tiles = h('div.stats'), adsBox = h('div.card.stack'), trend = h('div.card.stack'), geo = h('div.card.stack'), top = h('div.card.stack'),
    health = h('div.card.stack'), now = h('div.card.stack'), feed = h('div.card.stack');
  v.replaceChildren(head('Analytics', 'Game ka poora data, live: har change turant yahan aata hai.', h('div.row', {}, status, stamp)),
    tiles, h('div.two', { style: 'margin-bottom:16px' }, now, feed), top, h('div.two', { style: 'margin:16px 0' }, trend, adsBox), h('div.two', {}, geo, health));
  [now, feed, top, trend, adsBox, geo, health].forEach(c => c.append(loading()));

  // ---------------------------------------------------------------- who is in the game right now
  // users/{id}.seen is the game's heartbeat (every 40 s, and at once when a race starts or ends). One listener over the
  // last few minutes of beats; the window slides forward every two minutes, and players drop out of it on this clock.
  const online = new Map();
  let presenceCapped = false, serverLive = null, stopPresence = null;
  function watchPresence() {
    if (stopPresence) stopPresence();
    const since = String(nowSec() - 180);
    stopPresence = listen(fb.query(col('users'), fb.where('seen', '>=', since), fb.orderBy('seen', 'desc'), fb.limit(PRESENCE_CAP)), snap => {
      online.clear(); snap.docs.forEach(d => online.set(d.id, { id: d.id, ...d.data() }));
      presenceCapped = snap.size >= PRESENCE_CAP;
      play.presenceIn(); drawLive(); drawTopSoon();
    });
  }
  const isLive = u => u && u.state !== 'off' && nowSec() - Number(u.seen || 0) <= LIVE_SECONDS;
  const livePlayers = () => [...online.values()].filter(isLive).sort((a, b) => (b.state === 'race') - (a.state === 'race') || Number(b.seen) - Number(a.seen));
  const play = playClock(listen, livePlayers, id => online.get(id) || presence.get(id), onLeave);
  function drawLive() {
    const list = livePlayers(), racing = list.filter(u => u.state === 'race').length;
    const shown = presenceCapped && serverLive !== null ? serverLive : list.length;
    liveTile.b.textContent = presenceCapped && serverLive !== null ? num(serverLive) : num(list.length) + (presenceCapped ? '+' : '');
    liveTile.small.textContent = `${num(racing)} racing · ${num(Math.max(0, list.length - racing))} on home`;
    now.replaceChildren(h('div.row.between', {}, h('h2', {}, 'Playing now'), h('span.tag.g', {}, `${num(shown)} online`)),
      list.length ? h('div.list.livelist', {}, list.slice(0, 60).map(u => h('button.item.linkrow', { onclick: () => go('players', { id: u.id }) }, h('span.dot.on', { 'aria-hidden': 'true' }), avatar(u.name),
        h('div.grow', {}, h('div.name', {}, u.name || 'Player'), h('div.faint', {}, u.state === 'race' ? `Racing ${u.river || ''}`.trim() : 'On home screen', ` · Lv ${u.level || '-'}`)),
        h('span.tag', { class: u.state === 'race' ? 'g' : 'b' }, u.state === 'race' ? 'race' : 'home'), h('span.faint.mono', {}, seenText(u.seen))))) : empty('Abhi koi online nahi.'),
      ...(list.length > 60 ? [h('p.faint', {}, `+${num(list.length - 60)} aur players online`)] : []));
  }

  // ---------------------------------------------------------------- the totals (counted and summed on the server)
  const tile = (label, c) => { const b = h('b', {}, '-'), small = h('small', {}, ''); return { b, small, el: h('div.stat.flat', { style: `--c:${c}` }, b, h('span', {}, label), small) }; };
  const liveTile = tile('Live now', 'var(--green)'), T = {
    today: tile('Played today', 'var(--blue)'), month: tile('Played this month', 'var(--pink)'), fresh: tile('New today', '#5ce0d8'), users: tile('Total players', 'var(--gold)'),
    avg: tile('Avg time today', 'var(--gold)'), races: tile('Races today', 'var(--blue)'), ads: tile('Ads today', 'var(--green)'), hours: tile('Hours today (sab players)', 'var(--pink)'),
    allHours: tile('Hours all time (sab players)', 'var(--pink)'),
  };
  T.hours.b.classList.add('mono', 'tick'); T.allHours.b.classList.add('mono', 'tick');
  tiles.replaceChildren(liveTile.el, ...Object.values(T).map(t => t.el));
  let days = [], held = null, totalsBusy = false, totalsAgain = false, lastTotals = 0, todayShown = 0, allShown = 0;
  const setTile = (t, text, sub) => { if (t.b.textContent !== text && t.b.textContent !== '-') { t.el.classList.remove('flash'); void t.el.offsetWidth; t.el.classList.add('flash'); } t.b.textContent = text; t.small.textContent = sub || ''; };
  async function readTotals() {
    if (totalsBusy) { totalsAgain = true; return; }
    totalsBusy = true; lastTotals = Date.now();
    try {
      if (!held) await atMost(play.ready, 6000);   // the first sums wait for who is playing, so the hours start from the right place
      const [today, all, month, users] = await Promise.all([dayTotals(dayKey(), true), totals('stats_players'), count(col(`stats_months/${dayKey().slice(0, 6)}/players`)), count(col('users'))]);
      if (presenceCapped) serverLive = await count(fb.query(col('users'), fb.where('seen', '>=', String(nowSec() - LIVE_SECONDS))));
      if (!live()) return;
      play.synced();
      held = { today, all, month, users }; tickPlay();
      if (days.length) days[days.length - 1].t = today;
      drawTotals();
    } catch (e) { console.warn(e); } finally { totalsBusy = false; if (totalsAgain) { totalsAgain = false; setTimeout(readTotals, 3000); } }
  }
  // New data from the game: the totals follow within seconds, but at most once every 10 s however busy it gets.
  let totalsSoon = null;
  function totalsChanged() {
    if (totalsSoon) return;
    totalsSoon = setTimeout(() => { totalsSoon = null; if (live()) readTotals(); }, Math.max(1500, 10000 - (Date.now() - lastTotals)));
  }
  onLeave(() => clearTimeout(totalsSoon));
  function drawTotals() {
    if (!held) return;
    const { today, all, month, users } = held;
    setTile(T.today, num(today.players)); setTile(T.month, num(month)); setTile(T.fresh, num(today.fresh)); setTile(T.users, num(users));
    setTile(T.avg, hours(today.players ? Math.round(today.seconds / today.players) : 0), 'per player'); setTile(T.races, num(today.races));
    setTile(T.ads, num(adsOf(today)), today.players ? `${(adsOf(today) / today.players).toFixed(1)} per player` : '');
    const yesterday = days.length > 1 ? days[days.length - 2].t : EMPTY_DAY, week = addUp(days.slice(-7).map(d => d.t)), thisMonth = addUp(days.filter(d => d.key.slice(0, 6) === dayKey().slice(0, 6)).map(d => d.t));
    const cols = [today, yesterday, week, thisMonth, all];
    adsBox.replaceChildren(h('h2', {}, 'Ads seen'), h('div.scroll', {}, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Type'), ['Today', 'Yesterday', '7 days', 'Month', 'All time'].map(x => h('th.n', {}, x)))),
      h('tbody', {}, [['Rewarded', 'rewarded'], ['Interstitial', 'interstitial'], ['Banner', 'banner'], ['Native Advanced', 'native']].map(([l, k]) => h('tr', {}, h('td', {}, l), cols.map(c => h('td.n.mono', {}, num(c[k] || 0))))), h('tr.total', {}, h('td', {}, 'Total'), cols.map(c => h('td.n.mono', {}, num(adsOf(c)))))))),
      h('p.faint', {}, 'Game me ad dikhne par count hota hai. Earnings ke liye AdMob hi sahi number hai.'));
    drawTrend();
  }

  // ---------------------------------------------------------------- 30 days
  let metricId = 'players';
  const METRICS = {
    players: { name: 'Players', whole: true, get: d => d.players, text: num, axis: x => num(Math.round(x)) },
    fresh: { name: 'New players', whole: true, get: d => d.fresh, text: num, axis: x => num(Math.round(x)) },
    ads: { name: 'Ads seen', whole: true, get: adsOf, text: num, axis: x => num(Math.round(x)) },
    hours: { name: 'Hours played', get: d => d.seconds / 3600, text: x => x.toFixed(1), axis: x => (x < 10 ? x.toFixed(1) : num(Math.round(x))) },
    races: { name: 'Races', whole: true, get: d => d.races, text: num, axis: x => num(Math.round(x)) },
  };
  function drawTrend() {
    trend.replaceChildren(h('div.row.between', {}, h('h2', {}, 'Last 30 days'), h('span.faint', {}, 'aaj ka bar live hai')),
      h('div.tabs', { style: 'margin:0' }, Object.entries(METRICS).map(([k, m]) => h('button.tab', { class: metricId === k ? 'on' : '', onclick: () => { metricId = k; drawTrend(); } }, m.name))), days.length ? dayChart(days.slice(-30), METRICS[metricId]) : loading());
  }

  // ---------------------------------------------------------------- live activity: every report the game sends, as it lands
  // stats_players ordered by lastAt: the newest reports. Each change shows what that player added since their last one.
  const was = new Map(), events = [];
  let feedReady = false;
  listen(fb.query(col('stats_players'), fb.orderBy('lastAt', 'desc'), fb.limit(40)), snap => {
    for (const ch of snap.docChanges()) {
      if (ch.type === 'removed') continue;
      const u = { id: ch.doc.id, ...ch.doc.data() }, before = was.get(u.id);
      was.set(u.id, u);
      if (!feedReady) { events.push({ u, d: null, at: Number(u.lastAt) || 0 }); continue; }
      const d = before ? { seconds: (u.seconds || 0) - (before.seconds || 0), ads: (u.ads || 0) - (before.ads || 0), races: (u.races || 0) - (before.races || 0) } : null;
      events.unshift({ u, d, at: Number(u.lastAt) || nowSec(), fresh: true });
    }
    events.sort((a, b) => b.at - a.at); events.splice(40);
    if (feedReady) totalsChanged();
    feedReady = true; drawFeed();
  });
  function drawFeed() {
    const what = e => {
      if (!e.d) return `${hours(e.u.seconds)} played · ${num(e.u.ads || 0)} ads · ${num(e.u.races || 0)} races`;
      const bits = [e.d.seconds > 0 ? `+${hours(e.d.seconds)} played` : null, e.d.races > 0 ? `+${e.d.races} race${e.d.races > 1 ? 's' : ''}` : null, e.d.ads > 0 ? `+${e.d.ads} ad${e.d.ads > 1 ? 's' : ''}` : null].filter(Boolean);
      return bits.length ? bits.join(' · ') : 'came back';
    };
    feed.replaceChildren(h('div.row.between', {}, h('h2', {}, 'Live activity'), h('span.faint', {}, 'game ke reports, aate hi')),
      events.length ? h('div.list.livelist', {}, events.slice(0, 25).map(e => h('button.item.linkrow', { class: e.fresh ? 'flash' : '', onclick: () => go('players', { id: e.u.id }) }, avatar(e.u.name),
        h('div.grow', {}, h('div.name', {}, e.u.name || 'Player', ' ', h('span.faint', {}, `${flag(e.u.country)} Lv ${e.u.level || '-'}`)), h('div.faint', {}, what(e))), h('span.faint.mono', {}, seenText(e.at))))) : empty('Abhi data nahi aaya.'));
    events.forEach(e => { e.fresh = false; });
  }

  // ---------------------------------------------------------------- top players, live
  // The tabs and the search box are built once; only the rows change, so typing and scrolling are never interrupted.
  // Hours tick every second for a player who is playing: their last report plus the time since it, never going back.
  let sortBy = 'seconds', period = 'all', topN = 25, search = '', topRows = [], stopTop = null, rankWas = new Map(), valuesWas = new Map();
  const presence = new Map();   // the heartbeat of each player in the table: last seen to the second, online or not, racing where
  let presenceIds = '', presenceStops = [];
  const COLS = [['seconds', 'Hours', u => hours(u.seconds)], ['ads', 'Ads', u => num(u.ads || 0)], ['races', 'Races', u => num(u.races || 0)], ['sessions', 'Sessions', u => num(u.sessions || 0)], ['level', 'Level', u => u.level || '-']];
  const searchBox = h('input', { type: 'search', placeholder: 'Naam ya ID se dhoondo', 'aria-label': 'Search top players', oninput: e => { search = e.target.value.trim().toLowerCase(); drawTop(); } });
  const topInfo = h('p.faint', {}, ''), topScroll = h('div.scroll.tall');
  const shownRow = new Map(), grewAt = new Map();   // what each row's hours have shown (never back) / when its seconds last grew
  let hourCells = [];
  const onNow = id => isLive(presence.get(id)) || isLive(online.get(id));
  function watchTop() {
    if (stopTop) stopTop();
    if (period === 'today' && sortBy === 'level') sortBy = 'seconds';
    const path = period === 'today' ? `stats_days/${dayKey()}/players` : 'stats_players';
    topRows = null; grewAt.clear(); drawTopFrame();
    stopTop = listen(fb.query(col(path), fb.orderBy(sortBy, 'desc'), fb.limit(topN)), snap => {
      const before = new Map((topRows || []).map(r => [r.id, r.seconds]));
      topRows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      for (const r of topRows) if (before.has(r.id) && before.get(r.id) !== r.seconds) grewAt.set(r.id, nowSec());
      watchPresenceOf(topRows.map(r => r.id));
      drawTop(true);
    });
  }
  function watchPresenceOf(ids) {
    const key = [...ids].sort().join(',');
    if (key === presenceIds) return;
    presenceIds = key; presenceStops.forEach(s => s()); presenceStops = [];
    for (const part of chunks(ids, 30)) presenceStops.push(listen(fb.query(col('users'), fb.where(fb.documentId(), 'in', part)), snap => { snap.docs.forEach(d => presence.set(d.id, { id: d.id, ...d.data() })); drawTopSoon(); }));
  }
  onLeave(() => presenceStops.forEach(s => s()));
  /** A row's hours now. A day's row has no report time of its own: the player's last report, or when this row last grew. */
  function rowSeconds(u) {
    const at = period === 'today' ? Math.max(play.reportAt(u.id), (grewAt.get(u.id) || 0) - 3) : Number(u.lastAt) || 0;
    const key = `${period}.${u.id}`, v = Math.max(shownRow.get(key) || 0, (u.seconds || 0) + play.extra(u.id, at));
    shownRow.set(key, v);
    return v;
  }
  const rowHours = u => clockText(rowSeconds(u));   // to the second for everyone, so a player who stops never looks like they went back
  function tickRows() { for (const c of hourCells) { const t = rowHours(c.u); if (c.td.textContent !== t) c.td.textContent = t; } }
  function drawTopFrame() {
    const head2 = h('div.row.between', {}, h('div.row', {}, h('h2', {}, 'Top players'), h('span.livepill.small', {}, h('i'), 'LIVE')),
      h('div.row', {}, h('div.tabs', { style: 'margin:0' }, [['all', 'All time'], ['today', 'Today']].map(([k, l]) => h('button.tab', { class: period === k ? 'on' : '', onclick: () => { period = k; watchTop(); } }, l))),
        h('div.tabs', { style: 'margin:0' }, TOP_SIZES.map(n => h('button.tab', { class: topN === n ? 'on' : '', onclick: () => { topN = n; watchTop(); } }, `Top ${n}`)))));
    const tabs = h('div.row.between', {}, h('div.tabs', { style: 'margin:0' }, COLS.filter(([k]) => !(period === 'today' && k === 'level')).map(([k, l]) => h('button.tab', { class: sortBy === k ? 'on' : '', onclick: () => { sortBy = k; watchTop(); } }, `Most ${l.toLowerCase()}`))),
      h('div.row', {}, h('div', { style: 'width:min(240px,100%)' }, searchBox), h('button.btn.small', { onclick: () => {
        if (!topRows || !topRows.length) return toast('Abhi data nahi aaya.', true);
        csv([['Rank', 'Player', 'ID', 'Country', 'Hours', 'Ads', 'Races', 'Sessions', 'Level', 'Last seen', 'Online'], ...topRows.map((u, i) => { const p = presence.get(u.id) || {}; return [i + 1, u.name || p.name || 'Player', u.id, countryName(u.country), (rowSeconds(u) / 3600).toFixed(2), u.ads || 0, u.races || 0, u.sessions || 0, u.level || p.level || '', whenText(Math.max(Number(p.seen) || 0, Number(u.lastAt) || 0)), onNow(u.id) ? 'yes' : 'no']; })]);
      } }, 'Export CSV')));
    top.replaceChildren(head2, tabs, topInfo, topScroll);
    drawTop();
  }
  let topSoon = null, topFresh = false;
  function drawTopSoon(fresh) {   // heartbeats arrive all the time with many players: one redraw for each quarter second at most
    topFresh = topFresh || !!fresh;
    if (!topSoon) topSoon = setTimeout(() => { topSoon = null; const f = topFresh; topFresh = false; if (live()) drawTop(f); }, 250);
  }
  onLeave(() => clearTimeout(topSoon));
  function drawTop(fresh) {
    hourCells = [];
    if (!topRows) { topInfo.textContent = ''; topScroll.replaceChildren(loading()); return; }
    const shown = topRows.map((u, i) => ({ u, rank: i + 1 })).filter(({ u }) => { const p = presence.get(u.id); return !search || `${u.name || p?.name || ''} ${u.id}`.toLowerCase().includes(search.replace(/\s/g, '')) || String(u.name || p?.name || '').toLowerCase().includes(search); });
    const onlineCount = topRows.filter(u => onNow(u.id)).length;
    topInfo.textContent = `${num(onlineCount)} of these ${num(topRows.length)} players are online now · ${period === 'today' ? 'aaj ka data' : 'all time'} · online players ke hours har second badhte hain, ads aur races game ki report aate hi`;
    if (!topRows.length) { topScroll.replaceChildren(empty('Abhi data nahi aaya.')); return; }
    const body = shown.map(({ u, rank }) => {
      const p = presence.get(u.id) || online.get(u.id) || {}, on = onNow(u.id), seen = Math.max(Number(p.seen) || 0, Number(u.lastAt) || 0);
      const prevRank = rankWas.get(u.id), move = fresh && prevRank && prevRank !== rank ? (prevRank > rank ? h('span.up', { title: `was #${prevRank}` }, '▲') : h('span.down', { title: `was #${prevRank}` }, '▼')) : null;
      const prev = valuesWas.get(u.id), changed = k => fresh && prev && prev[k] !== u[k];
      const cells = COLS.map(([k, , show]) => {
        const td = h('td.n.mono', { class: changed(k) ? 'flash' : '' }, k === 'level' ? (u.level || p.level || '-') : k === 'seconds' ? rowHours(u) : show(u));
        if (k === 'seconds') hourCells.push({ td, u });
        return td;
      });
      return h('tr.link', { tabindex: 0, onclick: () => go('players', { id: u.id }), onkeydown: e => { if (e.key === 'Enter') go('players', { id: u.id }); } },
        h('td.mono', {}, rank, ' ', move), h('td', {}, h('div.row', { style: 'gap:8px;flex-wrap:nowrap' }, h('span.dot', { class: on ? 'on' : '', title: on ? 'online' : 'offline' }), h('div', {}, h('div.name', {}, u.name || p.name || 'Player'), h('div.faint.mono', {}, showId(u.id))))),
        h('td', {}, `${flag(u.country)} ${countryName(u.country)}`), cells,
        h('td', {}, on ? h('span.tag.g', {}, p.state === 'race' ? `LIVE · racing ${p.river || ''}`.trim() : 'LIVE · home') : h('span.faint', {}, seenText(seen))));
    });
    if (fresh) { rankWas = new Map(topRows.map((u, i) => [u.id, i + 1])); valuesWas = new Map(topRows.map(u => [u.id, { ...u }])); }
    const st = topScroll.scrollTop, sl = topScroll.scrollLeft;
    topScroll.replaceChildren(h('table', {}, h('thead', {}, h('tr', {}, ['#', 'Player', 'Country'].map(x => h('th', {}, x)), COLS.map(([k, l]) => h('th.n', { class: sortBy === k ? 'sorted' : '' }, l)), h('th', {}, 'Last seen'))),
      h('tbody', {}, body.length ? body : h('tr', {}, h('td', { colspan: 9 }, empty('Is naam se koi nahi.'))))));
    topScroll.scrollTop = st; topScroll.scrollLeft = sl;
  }

  /** Once a second: the hours of everyone playing, in the tiles and the table. */
  function tickPlay() {
    const extra = play.tick();
    tickRows();
    if (!held) return;
    todayShown = Math.max(todayShown, held.today.seconds + extra); allShown = Math.max(allShown, held.all.seconds + extra);
    T.hours.b.textContent = clockText(todayShown); T.allHours.b.textContent = clockText(allShown);
    const n = play.playingCount(), sub = n ? `${num(n)} abhi khel rahe` : 'abhi koi nahi khel raha';
    T.hours.small.textContent = sub; T.allHours.small.textContent = `${num(Math.floor(allShown / 3600))} ghante · shuru se ab tak`;
  }

  // ---------------------------------------------------------------- countries and game versions, live
  let geoTab = 'today', geoRows = [], stopGeo = null, versions = [];
  function watchGeo() {
    if (stopGeo) stopGeo();
    const path = { today: `stats_days/${dayKey()}/dims`, month: `stats_months/${dayKey().slice(0, 6)}/dims`, all: 'stats_all' }[geoTab];
    stopGeo = listen(fb.query(col(path), fb.limit(300)), snap => {
      geoRows = snap.docs.filter(d => d.id.startsWith('c_')).map(d => ({ c: d.id.slice(2), n: d.data().n || 0 })).sort((a, b) => b.n - a.n);
      drawGeo();
    });
  }
  function drawGeo() {
    const sum = geoRows.reduce((s, r) => s + r.n, 0), big = geoRows[0]?.n || 1;
    geo.replaceChildren(h('div.row.between', {}, h('h2', {}, 'Countries'), h('span.faint', {}, `${num(geoRows.length)} countries`)),
      h('div.tabs', { style: 'margin:0' }, [['today', 'Today'], ['month', 'This month'], ['all', 'All time']].map(([k, l]) => h('button.tab', { class: geoTab === k ? 'on' : '', onclick: () => { geoTab = k; watchGeo(); } }, l))),
      geoRows.length ? h('div.meters', {}, geoRows.slice(0, 20).map(r => h('div.meter', {}, h('span.mflag', { 'aria-hidden': 'true' }, flag(r.c)), h('span.mname', {}, countryName(r.c)), h('span.track', {}, h('i', { style: `width:${Math.max(r.n / big * 100, 2)}%` })), h('b.mono', {}, num(r.n)), h('span.faint.mono.pct', {}, `${Math.round(r.n / sum * 100)}%`)))) : empty('Abhi data nahi aaya.'));
  }
  listen(fb.query(col(`stats_days/${dayKey()}/dims`), fb.limit(300)), snap => {
    versions = snap.docs.filter(d => d.id.startsWith('v_')).map(d => ({ v: d.id.slice(2), n: d.data().n || 0 })).sort((a, b) => b.n - a.n);
    drawHealth();
  });

  // ---------------------------------------------------------------- players coming back (changes slowly: every 5 minutes)
  let back = { d1: null, d7: null };
  async function readHealth() {
    const rate = async ago => {
      const start = dayKey(ago), base = await dayTotals(start, ago <= 1).catch(() => null);
      if (!base || !base.fresh) return null;
      const n = await count(fb.query(col(`stats_days/${dayKey(0)}/players`), fb.where('firstDay', '==', Number(start))));
      return n === null ? null : Math.round(n / base.fresh * 100);
    };
    const [d1, d7] = await Promise.all([rate(1), rate(7)]);
    if (!live()) return;
    back = { d1, d7 }; drawHealth();
  }
  function drawHealth() {
    health.replaceChildren(h('h2', {}, 'Players coming back'), h('div.fields', { style: 'grid-template-columns:1fr 1fr' },
      h('div.mini-stat', {}, h('b', {}, back.d1 === null ? '-' : `${back.d1}%`), h('span', {}, 'Day 1'), h('small', {}, 'kal ke naye players aaj wapas aaye')), h('div.mini-stat', {}, h('b', {}, back.d7 === null ? '-' : `${back.d7}%`), h('span', {}, 'Day 7'), h('small', {}, '7 din pehle ke naye players aaj aaye'))),
      h('div.lab', {}, 'Game versions today (live)'), versions.length ? h('div.chips', {}, versions.slice(0, 8).map(x => h('span.tag.p', {}, `v${x.v}: ${num(x.n)}`))) : h('p.faint', {}, 'Abhi data nahi aaya.'));
  }

  // ---------------------------------------------------------------- start everything
  watchPresence(); play.watch(); watchTop(); watchGeo(); drawHealth(); drawTrend();
  const keys = Array.from({ length: 31 }, (_, i) => dayKey(30 - i));   // a whole month, whatever the date; finished days come from this browser's cache
  await readTotals();
  if (!live()) return;
  const past = await Promise.all(keys.map(k => k === dayKey() ? held.today : dayTotals(k, k >= dayKey(1)).catch(() => ({ ...EMPTY_DAY }))));
  if (!live()) return;
  days = keys.map((key, i) => ({ key, t: past[i] }));
  drawTotals(); readHealth();

  every(5000, () => {   // the clock: who has dropped off, "x seconds ago", and a new day at midnight (India time)
    if (dayKey() !== startDay) { route(); return; }
    drawLive(); drawTopSoon();
    const ago = Math.round((Date.now() - lastPush) / 1000);
    stamp.textContent = ago < 5 ? 'Updated just now' : `Last change ${seenText(nowSec() - ago)}`;
    if (!navigator.onLine) setHealthy(false);
  });
  eachSecond(every, tickPlay);                                   // the hours of everyone playing tick each second
  every(120000, () => { watchPresence(); play.watch(); });     // slide the live windows forward
  every(60000, () => { if (Date.now() - lastTotals > 55000) readTotals(); });   // quiet times still refresh once a minute
  every(300000, readHealth);
}

// ------------------------------------------------------------------ live board
// One screen to leave open (or put on a TV): what is happening in the game right now, as pictures. Everything moves on
// its own: listeners bring each change, the hours tick every second for the players who are online, and the graphs
// grow from the moment the board is opened.
const SVG_NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs, ...kids) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v !== undefined && v !== null) e.setAttribute(k, String(v));
  for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false) e.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return e;
}
const niceTop = most => { if (most <= 4) return 4; const p = 10 ** Math.floor(Math.log10(most)); for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= most) return Math.ceil(m * p); return most; };
const legend = items => h('div.legend', {}, items.map(([color, label]) => h('span', {}, h('i', { style: `background:${color}` }), label)));

/** Stacked area over time: points [{t, a, b}] (a under b). The newest point is on the right. */
function areaChart(points, colors, minutes) {
  const W = 720, H = 220, L = 34, B = 24, T = 10, R = 8;
  const tot = p => p.a + p.b + (p.c || 0);
  const top = niceTop(Math.max(1, ...points.map(tot)));
  const end = Date.now(), start = end - minutes * 60000;
  const x = t => L + (Math.max(t, start) - start) / (end - start) * (W - L - R), y = v => T + (1 - v / top) * (H - T - B);
  const grid = [0, 0.25, 0.5, 0.75, 1].map(f => [svg('line', { x1: L, x2: W - R, y1: y(top * f), y2: y(top * f), class: 'gl' }), svg('text', { x: L - 6, y: y(top * f) + 4, 'text-anchor': 'end' }, Math.round(top * f))]);
  const step = minutes <= 6 ? 1 : minutes <= 15 ? 3 : minutes <= 30 ? 5 : minutes <= 60 ? 10 : 20;
  const ticks = Array.from({ length: Math.floor(minutes / step) + 1 }, (_, i) => i * step).map(m => svg('text', { x: x(end - m * 60000), y: H - 6, 'text-anchor': m === 0 ? 'end' : m === minutes ? 'start' : 'middle' }, m === 0 ? 'abhi' : m >= 60 && m % 60 === 0 ? `${m / 60}h` : m > 60 ? `${Math.floor(m / 60)}h${m % 60}m` : `${m}m`));
  if (points.length < 2) return svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chartsvg', role: 'img', 'aria-label': 'Online players over time' }, grid, ticks, svg('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'wait' }, 'Graph ban raha hai...'));
  const path = (lo, hi) => {
    const up = points.map(p => `${x(p.t).toFixed(1)},${y(hi(p)).toFixed(1)}`), down = [...points].reverse().map(p => `${x(p.t).toFixed(1)},${y(lo(p)).toFixed(1)}`);
    return `M${up.join('L')}L${down.join('L')}Z`;
  };
  const line = f => `M${points.map(p => `${x(p.t).toFixed(1)},${y(f(p)).toFixed(1)}`).join('L')}`;
  const last = points[points.length - 1];
  return svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chartsvg', role: 'img', 'aria-label': `Online players: ${tot(last)} now` }, grid, ticks,
    svg('path', { d: path(() => 0, p => p.a), fill: colors[0], 'fill-opacity': 0.55 }), svg('path', { d: path(p => p.a, p => p.a + p.b), fill: colors[1], 'fill-opacity': 0.4 }),
    svg('path', { d: path(p => p.a + p.b, tot), fill: colors[2] || '#8c5cff', 'fill-opacity': 0.45 }),
    svg('path', { d: line(tot), fill: 'none', stroke: '#fff', 'stroke-width': 2, 'stroke-linejoin': 'round' }),
    svg('circle', { cx: x(last.t), cy: y(tot(last)), r: 5, class: 'nowdot' }));
}

/** A ring cut into parts [{label, value, color}], the total (or a word) in the middle. */
function donut(parts, middle, sub) {
  const total = parts.reduce((s, p) => s + p.value, 0), r = 70, c = 2 * Math.PI * r;
  let at = 0;
  const rings = total ? parts.filter(p => p.value > 0).map(p => { const len = p.value / total * c, seg = svg('circle', { cx: 90, cy: 90, r, fill: 'none', stroke: p.color, 'stroke-width': 26, 'stroke-dasharray': `${Math.max(len - 2, 0.5)} ${c}`, 'stroke-dashoffset': -at, transform: 'rotate(-90 90 90)' }); at += len; return seg; })
    : [svg('circle', { cx: 90, cy: 90, r, fill: 'none', stroke: '#3a2670', 'stroke-width': 26 })];
  return h('div.donutwrap', {}, svg('svg', { viewBox: '0 0 180 180', class: 'donut', role: 'img', 'aria-label': parts.map(p => `${p.label} ${p.value}`).join(', ') }, rings,
    svg('text', { x: 90, y: 92, 'text-anchor': 'middle', class: 'dbig' }, middle), svg('text', { x: 90, y: 114, 'text-anchor': 'middle', class: 'dsmall' }, sub || '')),
  h('div.dlegend', {}, parts.map(p => h('div', {}, h('i', { style: `background:${p.color}` }), h('span', {}, p.label), h('b.mono', {}, num(p.value)), h('small', {}, total ? `${Math.round(p.value / total * 100)}%` : '')))));
}

/** Horizontal bars [{label, value, note}] longest first. */
function hbars(rows, color, emptyText) {
  if (!rows.length) return empty(emptyText);
  const most = Math.max(1, ...rows.map(r => r.value));
  return h('div.hbars', {}, rows.map(r => h('div.hbar', {}, h('span.hlabel', {}, r.label), h('span.htrack', {}, h('i', { style: `width:${Math.max(r.value / most * 100, 3)}%;background:${r.color || color}` })), h('b.mono', {}, num(r.value)), r.note ? h('small.faint', {}, r.note) : null)));
}

/** Bars per minute, two kinds side by side: buckets [{label, a, b}]. */
function minuteBars(buckets, colors, names) {
  const W = 720, H = 200, L = 30, B = 24, T = 10, R = 6, n = buckets.length, slot = (W - L - R) / n;
  const top = niceTop(Math.max(1, ...buckets.map(k => Math.max(k.a, k.b)))), y = v => T + (1 - v / top) * (H - T - B);
  const grid = [0, 0.5, 1].map(f => [svg('line', { x1: L, x2: W - R, y1: y(top * f), y2: y(top * f), class: 'gl' }), svg('text', { x: L - 6, y: y(top * f) + 4, 'text-anchor': 'end' }, Math.round(top * f))]);
  const bars = buckets.map((k, i) => {
    const bw = Math.max(slot * 0.36, 1.5), x0 = L + i * slot + slot * 0.12;
    return svg('g', {}, svg('title', {}, `${k.label}: ${k.a} ${names[0]}, ${k.b} ${names[1]}`),
      k.a ? svg('rect', { x: x0, y: y(k.a), width: bw, height: H - B - y(k.a), rx: 2, fill: colors[0] }) : null,
      k.b ? svg('rect', { x: x0 + bw + 1, y: y(k.b), width: bw, height: H - B - y(k.b), rx: 2, fill: colors[1] }) : null,
      (n - 1 - i) % (n > 60 ? 15 : n > 15 ? 5 : 2) === 0 ? svg('text', { x: x0 + bw, y: H - 6, 'text-anchor': i === n - 1 ? 'end' : 'middle' }, k.label) : null);
  });
  return svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chartsvg', role: 'img', 'aria-label': `Per minute: ${names.join(' and ')}` }, grid, bars);
}

/** A number that rolls to its new value instead of jumping. */
function rollTo(el, value, format) {
  const from = Number(el.dataset.v || 0), to = Number(value) || 0;
  el.dataset.v = to;
  if (from === to || !el.isConnected) { el.textContent = format(to); return; }
  const t0 = performance.now(), dur = 700;
  const step = t => { const k = Math.min(1, (t - t0) / dur), e = 1 - (1 - k) ** 3; el.textContent = format(from + (to - from) * e); if (k < 1 && Number(el.dataset.v) === to) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
const clockText = sec => { const s = Math.max(0, Math.floor(sec)), hh = Math.floor(s / 3600), mm = Math.floor(s % 3600 / 60), ss = s % 60; return `${num(hh)}h ${String(mm).padStart(2, '0')}m ${String(ss).padStart(2, '0')}s`; };

async function liveBoard(v, live, onLeave) {
  const startDay = dayKey(), openedAt = Date.now();
  const stops = [], timers = [];
  onLeave(() => { stops.splice(0).forEach(s => { try { s(); } catch { /* gone */ } }); timers.splice(0).forEach(clearInterval); });
  const listen = (q, next) => { const stop = fb.onSnapshot(q, snap => { if (live()) next(snap); }, e => { console.warn(e); pill.className = 'livepill off'; pill.replaceChildren(h('i'), 'RECONNECTING'); }); stops.push(stop); return () => { stop(); const i = stops.indexOf(stop); if (i >= 0) stops.splice(i, 1); }; };
  const every = (ms, fn) => timers.push(setInterval(() => { if (live()) fn(); }, ms));

  const pill = h('span.livepill', {}, h('i'), 'LIVE'), clock = h('b.clock.mono', {}, '');
  const board = h('div.board');
  const tvBtn = h('button.btn.small', { onclick: () => { if (document.fullscreenElement) document.exitFullscreen(); else board.requestFullscreen?.().catch(() => toast('Is browser me full screen nahi chala.', true)); } }, 'TV mode');
  v.replaceChildren(head('Live Board', 'Game me abhi kya ho raha hai, graph me. Ye page khula chhod do: sab khud update hota hai.', h('div.row', {}, pill, clock, tvBtn)), board);

  // the cards
  const card = (cls, title, why) => { const body = h('div.cbody'); const el = h(`div.card.lcard${cls ? `.${cls}` : ''}`, {}, h('div.ctitle', {}, h('h2', {}, title), why ? h('p.why', {}, why) : null), body); return { el, body }; };
  const heroNum = h('b.heronum', { 'data-v': 0 }, '0'), heroSub = h('div.herosub', {}, '');
  const hero = card('hero', 'Players online now', 'Line jitni upar, utne zyada log game me. Green = race me, blue = home screen. Purple = jab ye board band tha, game ke minute data se.');
  hero.el.insertBefore(h('div.herotop', {}, heroNum, heroSub), hero.body);
  const doing = card('', 'Abhi kya kar rahe hain', 'Online players me se kitne race me hain aur kitne menu me.');
  const counters = h('div.counters');
  const perMin = card('wide', 'Har minute kya hua', 'Har bar ek minute hai. Blue = races shuru hui, gold = ads dekhe. Refresh karne par bhi graph rehta hai.');
  const rivers = card('', 'Kaunsi river pe race chal rahi', 'Abhi jo race kar rahe hain, wo kis river pe hain.');
  const levels = card('', 'Online players ke level', 'Abhi online players kis level pe hain: naye (1-10) ya purane.');
  const ads = card('', 'Aaj ke ads, type ke hisaab se', 'Rewarded aur Interstitial se sabse zyada kamai hoti hai.');
  const countries = card('', 'Aaj kahan se khel rahe', 'Aaj ke players kis desh se hain.');
  const versions = card('', 'Game versions (aaj)', 'Kitne players naya version chala rahe hain. Purana zyada ho to update ka notification bhejo.');
  const ticker = card('wide', 'Abhi abhi', 'Game se aane wali har report, sabse nayi upar.');
  const played = card('wide.played', 'Sab players ne milke kitna khela', 'Har player ka time jod ke: ek ne 1 ghanta khela, dusre ne 2, to total 3 ghante. Har second badhta hai.');
  board.replaceChildren(h('div.boardrow.r1', {}, hero.el, doing.el), played.el, counters, perMin.el, h('div.boardrow.r3', {}, rivers.el, levels.el, ads.el), h('div.boardrow.r3', {}, countries.el, versions.el, ticker.el));

  // ---------------------------------------------------------------- presence: who is online, racing where, at what level
  const online = new Map();
  let stopPresence = null;
  const watchPresence = () => {
    if (stopPresence) stopPresence();
    stopPresence = listen(fb.query(col('users'), fb.where('seen', '>=', String(nowSec() - 180)), fb.orderBy('seen', 'desc'), fb.limit(PRESENCE_CAP)), snap => {
      online.clear(); snap.docs.forEach(d => online.set(d.id, { id: d.id, ...d.data() }));
      if (!presenceReady) { presenceReady = true; sample(); }
      play.presenceIn(); drawPresence();
    });
  };
  let presenceReady = false;   // no sample until the first answer: an empty list before it is not 'nobody online'
  const liveList = () => [...online.values()].filter(u => u.state !== 'off' && nowSec() - Number(u.seen || 0) <= LIVE_SECONDS);
  const play = playClock(listen, liveList, id => online.get(id), onLeave);
  // What the graphs have seen is kept in this browser, so a refresh or another page and back carries on where it was.
  // The game's per-minute history (stats_minutes) fills in the time this board was closed, on any device.
  const KEEP_MS = 2 * 3600000, MEM = 'hippoAdmin.board.v1';
  let series = [], windowMin = 30, savedPlayed = 0, savedAll = 0;
  const minutes = new Map(), server = new Map();   // minute start (ms) -> {races, ads} seen here / {players, races, ads} from the game
  try {
    const m = JSON.parse(localStorage.getItem(MEM) || 'null');
    if (m && m.day === startDay) {
      series = (m.series || []).map(([t, a, b]) => ({ t, a, b })).filter(p => p.t > Date.now() - KEEP_MS);
      (m.minutes || []).forEach(([t, r, a]) => { if (t > Date.now() - KEEP_MS) minutes.set(t, { races: r, ads: a }); });
      windowMin = m.window || 30;
      if (m.played && Date.now() - m.played.at < 30 * 60000) savedPlayed = m.played.s;   // the 'played today' counter carries on, never back
      if (m.all && Date.now() - m.all.at < 30 * 60000) savedAll = m.all.s;
    }
  } catch { /* start fresh */ }
  const remember = () => { try { localStorage.setItem(MEM, JSON.stringify({ day: startDay, window: windowMin, series: series.map(p => [p.t, p.a, p.b]), minutes: [...minutes].map(([t, k]) => [t, k.races, k.ads]), played: { s: shownSeconds, at: Date.now() }, all: { s: allShown, at: Date.now() } })); } catch { /* full or blocked */ } };
  const keep = () => remember();   // a refresh or a closed tab keeps the very last second too
  addEventListener('pagehide', keep); onLeave(() => { remember(); removeEventListener('pagehide', keep); });
  function sample() { if (!presenceReady) return; const l = liveList(), racing = l.filter(u => u.state === 'race').length; series.push({ t: Date.now(), a: racing, b: l.length - racing }); while (series.length && series[0].t < Date.now() - KEEP_MS) series.shift(); remember(); }
  // India-time minute keys, as the game writes them: 202611242131
  const minuteKey = ms => { const d = new Date(ms + IST); return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}`; };
  const keyMs = k => Date.UTC(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6, 8), +k.slice(8, 10), +k.slice(10, 12)) - IST;
  let stopHistory = null;
  function watchHistory() {
    if (stopHistory) stopHistory();
    stopHistory = listen(fb.query(col('stats_minutes'), fb.where(fb.documentId(), '>=', `${minuteKey(Date.now() - KEEP_MS)}_0`), fb.orderBy(fb.documentId()), fb.limit(1500)), snap => {
      server.clear();
      snap.docs.forEach(d => { const t = keyMs(d.id.slice(0, 12)), x = d.data(), k = server.get(t) || { players: 0, races: 0, ads: 0 }; k.players += x.players || 0; k.races += x.races || 0; k.ads += x.ads || 0; server.set(t, k); });
      drawPresence(); drawMinutes();
    });
  }
  // The online line: this board's own 5-second samples where it has them, the game's minute counts for the rest (purple).
  function onlinePoints() {
    const start = Date.now() - windowMin * 60000, mine = series.filter(p => p.t >= start), covered = new Set(mine.map(p => Math.floor(p.t / 60000) * 60000));
    const past = [...server].filter(([t]) => t >= start && t < Date.now() - 60000 && !covered.has(t)).map(([t, k]) => ({ t: t + 30000, a: 0, b: 0, c: k.players }));
    return [...past, ...mine].sort((a, b) => a.t - b.t);
  }
  const windowTabs = () => h('div.tabs', { style: 'margin:0' }, [[30, '30 min'], [120, '2 ghante']].map(([m, l]) => h('button.tab', { class: windowMin === m ? 'on' : '', onclick: () => { windowMin = m; remember(); drawPresence(); drawMinutes(); } }, l)));
  function drawPresence() {
    const l = liveList(), racing = l.filter(u => u.state === 'race'), home = l.length - racing.length;
    rollTo(heroNum, l.length, x => num(Math.round(x)) + (online.size >= PRESENCE_CAP ? '+' : ''));
    const pts = onlinePoints(), peak = pts.length ? Math.max(...pts.map(p => p.a + p.b + (p.c || 0))) : 0;
    heroSub.replaceChildren(h('span.tag.g', {}, `${num(racing.length)} racing`), h('span.tag.b', {}, `${num(home)} home`), h('span.faint', {}, pts.length > 1 ? `${windowMin === 30 ? '30 min' : '2 ghante'} me sabse zyada: ${num(peak)}` : ''));
    // with no history yet, zoom to what there is; with the game's history, the whole window
    const span = server.size ? windowMin : pts.length ? Math.min(windowMin, Math.max(2, Math.ceil((Date.now() - pts[0].t) / 60000))) : 2;
    hero.body.replaceChildren(windowTabs(), areaChart(pts, ['#4fd65c', '#42a9ff', '#8c5cff'], span), legend([['#4fd65c', 'Race me'], ['#42a9ff', 'Home screen'], ['#8c5cff', 'Pehle ka (game ka minute data)']]));
    doing.body.replaceChildren(donut([{ label: 'Race me', value: racing.length, color: '#4fd65c' }, { label: 'Home screen', value: home, color: '#42a9ff' }], num(l.length), 'online'));
    const byRiver = {}; racing.forEach(u => { const r = u.river || 'Unknown'; byRiver[r] = (byRiver[r] || 0) + 1; });
    rivers.body.replaceChildren(hbars(Object.entries(byRiver).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 8), '#4fd65c', 'Abhi koi race nahi kar raha.'));
    const bands = [['1-10', 1, 10, '#5ce0d8'], ['11-20', 11, 20, '#42a9ff'], ['21-40', 21, 40, '#8c5cff'], ['41-60', 41, 60, '#ff7ac6'], ['61-100', 61, 100, '#ffd23f']];
    levels.body.replaceChildren(l.length ? hbars(bands.map(([label, lo, hi, color]) => ({ label: `Lv ${label}`, value: l.filter(u => { const x = Number(u.level) || 1; return x >= lo && x <= hi; }).length, color })), '#8c5cff', '') : empty('Abhi koi online nahi.'));
  }

  // ---------------------------------------------------------------- today's totals, with the hours ticking for everyone online
  const C = {};
  const counter = (key, label, color, sub) => { const b = h('b.cnum.mono', { 'data-v': 0 }, '0'), s = h('small', {}, sub || ''), bar = h('i'); C[key] = { b, s, bar }; return h('div.counter', { style: `--c:${color}` }, h('span.clabel', {}, label), b, h('div.vs', {}, h('span.vstrack', {}, bar), s)); };
  counters.replaceChildren(counter('hours', 'Aaj kitna khela (sab players)', 'var(--pink)'), counter('players', 'Aaj kitne players aaye', 'var(--blue)'), counter('races', 'Aaj kitni races', '#5ce0d8'), counter('ads', 'Aaj kitne ads dekhe', 'var(--gold)'), counter('fresh', 'Aaj naye players', 'var(--green)'));
  let today = { ...EMPTY_DAY }, yesterday = null, shownSeconds = savedPlayed, busy = false, again = false, lastRead = 0, soon = null, firstTotals = true;
  async function readTotals() {
    if (busy) { again = true; return; }
    busy = true; lastRead = Date.now();
    try {
      if (firstTotals) await atMost(play.ready, 6000);   // the first sums wait for who is playing, so the hours start from the right place
      const [t, all] = await Promise.all([dayTotals(dayKey(), true), fb.getAggregateFromServer(col('stats_players'), { v: fb.sum('seconds') }).then(r => r.data().v || 0).catch(e => { console.warn(e); return null; })]);
      if (!live()) return;
      play.synced();
      if (all !== null) { allSeconds = all; allError = false; } else if (allSeconds === null) allError = true;
      today = t;
      if (firstTotals) {   // what this browser remembered is kept only while it agrees with the server
        firstTotals = false;
        const extra = play.tick();
        if (shownSeconds > t.seconds + extra + 60) shownSeconds = 0;
        if (allSeconds !== null && allShown > allSeconds + extra + 60) allShown = 0;
      }
      tickHours(); drawTotals();
      if (playDays.length) { playDays[playDays.length - 1].t = t; drawPlayed(); }
      ads.body.replaceChildren(donut([{ label: 'Rewarded', value: t.rewarded, color: '#4fd65c' }, { label: 'Interstitial', value: t.interstitial, color: '#ffd23f' }, { label: 'Banner', value: t.banner, color: '#42a9ff' }, { label: 'Native', value: t.native, color: '#ff7ac6' }], num(adsOf(t)), 'ads aaj'));
    } catch (e) { console.warn(e); } finally { busy = false; if (again) { again = false; setTimeout(readTotals, 3000); } }
  }
  const totalsChanged = () => { if (!soon) soon = setTimeout(() => { soon = null; if (live()) readTotals(); }, Math.max(1500, 8000 - (Date.now() - lastRead))); };
  onLeave(() => clearTimeout(soon));
  const vsYesterday = (key, now) => {
    const c = C[key];
    if (!yesterday) { c.s.textContent = ''; c.bar.style.width = '0'; return; }
    const was = key === 'hours' ? yesterday.seconds : key === 'ads' ? adsOf(yesterday) : yesterday[key] || 0, pct = was ? Math.round(now / was * 100) : 0;
    c.bar.style.width = `${Math.min(pct, 100)}%`;
    c.s.textContent = was ? `kal ka ${pct}% (kal: ${key === 'hours' ? hours(was) : num(was)})` : 'kal ka data nahi';
  };
  function drawTotals() {
    rollTo(C.players.b, today.players, x => num(Math.round(x))); vsYesterday('players', today.players);
    rollTo(C.races.b, today.races, x => num(Math.round(x))); vsYesterday('races', today.races);
    rollTo(C.ads.b, adsOf(today), x => num(Math.round(x))); vsYesterday('ads', adsOf(today));
    rollTo(C.fresh.b, today.fresh, x => num(Math.round(x))); vsYesterday('fresh', today.fresh);
  }

  // ---------------------------------------------------------------- all players together, and day by day
  // Built once: the numbers tick in place, the bars redraw now and then, and the date list keeps its scroll and its open state.
  let allSeconds = null, allError = false, allShown = savedAll, playDays = [], playRange = 30, playSort = 'new', todayCell = null;
  const dateText = key => new Date(Date.UTC(+key.slice(0, 4), +key.slice(4, 6) - 1, +key.slice(6))).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const hrs = sec => (sec / 3600).toFixed(sec < 36000 ? 1 : 0);
  const allNum = h('b.allnum.mono', {}, '-'), allSub = h('small.faint', {}, 'Server se jod raha hai...'), liveLine = h('div.playlive', {}, '');
  const nToday = h('b.mono', {}, '-'), nMonth = h('b.mono', {}, '-'), nRangeLbl = h('span', {}, 'Pichhle 30 din'), nRange = h('b.mono', {}, '-'), nBest = h('b', {}, '-'), nBestSub = h('small', {}, '');
  const rangeTabs = h('div.tabs', { style: 'margin:0' }), sortTabs = h('div.tabs', { style: 'margin:0' }), chartBox = h('div', {}, loading()), listScroll = h('div.scroll.daylist');
  played.body.replaceChildren(
    h('div.playtop', {},
      h('div.allbox', {}, h('span.clabel', {}, 'Shuru se ab tak, sab players ka total'), allNum, allSub, liveLine),
      h('div.minis', {},
        h('div.mini', {}, h('span', {}, 'Aaj'), nToday),
        h('div.mini', {}, h('span', {}, 'Is mahine'), nMonth),
        h('div.mini', {}, nRangeLbl, nRange),
        h('div.mini.best', {}, h('span', {}, 'Sabse zyada kis din'), nBest, nBestSub))),
    h('div.row.between', {}, h('h3', { style: 'margin:0' }, 'Din ke hisaab se'), rangeTabs),
    chartBox,
    legend([['#ffd23f', 'Sabse zyada khela'], ['#4fd65c', 'Aaj (live)'], ['#ff7ac6', 'Baaki din']]),
    h('details.datatable', { open: true }, h('summary', {}, 'Date wise list'), h('div.row', { style: 'margin:8px 0' }, sortTabs), listScroll));
  async function readPlayDays() {
    const keys = Array.from({ length: 30 }, (_, i) => dayKey(29 - i));   // finished days come from this browser's cache after the first time
    const got = await Promise.all(keys.map(k => k === dayKey() ? Promise.resolve(today) : dayTotals(k, k >= dayKey(1)).catch(() => ({ ...EMPTY_DAY }))));
    if (!live()) return;
    playDays = keys.map((key, i) => ({ key, t: got[i] }));
    drawPlayed();
  }
  const secsOf = d => d.key === dayKey() ? shownSeconds : d.t.seconds;
  const bestOf = list => list.reduce((b, d) => (secsOf(d) > (b ? secsOf(b) : 0) ? d : b), null);
  /** One bar a day, the busiest one in gold with its hours written on it. */
  function playBars(list) {
    const W = 720, H = 230, L = 40, B = 34, T = 22, R = 6, n = list.length, slot = (W - L - R) / n;
    const val = d => secsOf(d) / 3600;
    const most = Math.max(...list.map(val)), top = niceTop(Math.max(1, most)), y = v => T + (1 - v / top) * (H - T - B);
    const grid = [0, 0.5, 1].map(f => [svg('line', { x1: L, x2: W - R, y1: y(top * f), y2: y(top * f), class: 'gl' }), svg('text', { x: L - 6, y: y(top * f) + 4, 'text-anchor': 'end' }, `${Math.round(top * f)}h`)]);
    const bestAt = most > 0 ? list.findIndex(d => val(d) === most) : -1;
    const bars = list.map((d, i) => {
      const v = val(d), best = i === bestAt, today_ = d.key === dayKey(), bw = slot * 0.7, x0 = L + i * slot + slot * 0.15;
      const label = new Date(Date.UTC(+d.key.slice(0, 4), +d.key.slice(4, 6) - 1, +d.key.slice(6))).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
      return svg('g', {}, svg('title', {}, `${dateText(d.key)}: ${hours(Math.round(v * 3600))} · ${num(d.t.players)} players`),
        v > 0 ? svg('rect', { x: x0, y: y(v), width: bw, height: H - B - y(v), rx: 3, fill: best ? '#ffd23f' : today_ ? '#4fd65c' : '#ff7ac6', 'fill-opacity': best || today_ ? 1 : 0.75 }) : null,
        best || (n <= 7 && v > 0) ? svg('text', { x: x0 + bw / 2, y: y(v) - 6, 'text-anchor': 'middle', class: best ? 'bestlbl' : '' }, `${hrs(v * 3600)}h`) : null,
        best || n <= 7 || (i % 3 === (n - 1) % 3 && Math.abs(i - bestAt) > 1) ? svg('text', { x: x0 + bw / 2, y: H - B + 15, 'text-anchor': 'middle', class: best ? 'bestlbl' : '' }, today_ ? 'Aaj' : label) : null);
    });
    return svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chartsvg', role: 'img', 'aria-label': 'Hours played each day' }, grid, bars);
  }
  const tabsInto = (box, items, now, set) => box.replaceChildren(...items.map(([k, l]) => h('button.tab', { class: now === k ? 'on' : '', onclick: () => { set(k); drawPlayed(); } }, l)));
  /** The numbers only: every second. */
  function drawPlayedNums() {
    if (allSeconds === null) { allNum.textContent = '-'; allSub.textContent = allError ? 'Server se total nahi mila. Internet check karo, thodi der me khud try karega.' : 'Server se jod raha hai...'; }
    else { allNum.textContent = clockText(allShown); allSub.textContent = `${num(Math.floor(allShown / 3600))} ghante · har player ka time jod ke`; }
    const n = play.playingCount();
    liveLine.className = n ? 'playlive on' : 'playlive';
    liveLine.textContent = n ? `${num(n)} ${n === 1 ? 'player' : 'players'} abhi khel ${n === 1 ? 'raha hai' : 'rahe hain'} · total har second +${num(n)} sec badh raha hai` : 'Abhi koi nahi khel raha, isliye total ruka hai. Koi game kholega to turant badhne lagega.';
    nToday.textContent = firstTotals ? '-' : clockText(shownSeconds);
    if (!playDays.length) return;
    const list = playDays.slice(-playRange), best = bestOf(list);
    nMonth.textContent = hours(playDays.filter(d => d.key.slice(0, 6) === dayKey().slice(0, 6)).reduce((s, d) => s + secsOf(d), 0));
    nRangeLbl.textContent = `Pichhle ${playRange} din`; nRange.textContent = hours(list.reduce((s, d) => s + secsOf(d), 0));
    nBest.textContent = best ? (best.key === dayKey() ? 'Aaj' : dateText(best.key)) : '-';
    nBestSub.textContent = best ? `${hours(secsOf(best))} · ${num(best.t.players)} players` : '';
    if (todayCell) todayCell.textContent = hours(shownSeconds);
  }
  /** The bars and the date list: when a report lands, and the bars every half minute so today's grows. */
  function drawPlayed() {
    tabsInto(rangeTabs, [[7, '7 din'], [30, '30 din']], playRange, k => { playRange = k; });
    tabsInto(sortTabs, [['new', 'Nayi date pehle'], ['most', 'Sabse zyada pehle']], playSort, k => { playSort = k; });
    if (playDays.length) {
      const list = playDays.slice(-playRange), best = bestOf(list), rows = [...list].sort((a, b) => playSort === 'most' ? secsOf(b) - secsOf(a) : b.key.localeCompare(a.key));
      chartBox.replaceChildren(playBars(list));
      todayCell = null;
      const st = listScroll.scrollTop;
      listScroll.replaceChildren(h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Date'), h('th.n', {}, 'Total khela'), h('th.n', {}, 'Players'), h('th.n', {}, 'Ek player avg'), h('th.n', {}, 'Races'))),
        h('tbody', {}, rows.map(d => {
          const total = h('td.n.mono', {}, hours(secsOf(d)));
          if (d.key === dayKey()) todayCell = total;
          return h('tr', { class: d === best ? 'besttr' : '' }, h('td', {}, d.key === dayKey() ? `Aaj · ${dateText(d.key)}` : dateText(d.key)), total, h('td.n.mono', {}, num(d.t.players)), h('td.n.mono', {}, hours(d.t.players ? Math.round(secsOf(d) / d.t.players) : 0)), h('td.n.mono', {}, num(d.t.races)));
        }))));
      listScroll.scrollTop = st;
    }
    drawPlayedNums();
  }

  /** Once a second: the server's sums plus what everyone playing has played since their own last report. Never goes back. */
  function tickHours() {
    const extra = play.tick();
    if (!firstTotals) {
      shownSeconds = Math.max(shownSeconds, today.seconds + extra);
      C.hours.b.textContent = clockText(shownSeconds); vsYesterday('hours', shownSeconds);
      if (allSeconds !== null) allShown = Math.max(allShown, allSeconds + extra);
    }
    drawPlayedNums();
  }

  // ---------------------------------------------------------------- every report as it lands: the per-minute bars and the ticker
  const was = new Map(), events = [];
  let ready = false;
  listen(fb.query(col('stats_players'), fb.orderBy('lastAt', 'desc'), fb.limit(60)), snap => {
    for (const ch of snap.docChanges()) {
      if (ch.type === 'removed') continue;
      const u = { id: ch.doc.id, ...ch.doc.data() }, before = was.get(u.id); was.set(u.id, u);
      if (!ready) { events.push({ u, at: Number(u.lastAt) || 0 }); continue; }
      const d = before ? { seconds: Math.max(0, (u.seconds || 0) - (before.seconds || 0)), ads: Math.max(0, (u.ads || 0) - (before.ads || 0)), races: Math.max(0, (u.races || 0) - (before.races || 0)) } : null;
      events.unshift({ u, d, at: nowSec(), fresh: true });
      if (d) { const m = Math.floor(Date.now() / 60000) * 60000, k = minutes.get(m) || { races: 0, ads: 0 }; k.races += d.races; k.ads += d.ads; minutes.set(m, k); remember(); }
    }
    events.sort((a, b) => b.at - a.at); events.splice(30);
    if (ready) totalsChanged();
    ready = true; drawTicker(); drawMinutes();
  });
  function drawMinutes() {
    const nowM = Math.floor(Date.now() / 60000) * 60000;
    // the game's own count of each minute when it has one (it has every player), else what this board saw
    const firstSeen = Math.min(openedAt, ...[...minutes.keys()], ...(server.size ? [...server.keys()] : []));
    const n = server.size ? windowMin : Math.min(windowMin, Math.max(10, Math.ceil((Date.now() - firstSeen) / 60000) + 1));
    const buckets = Array.from({ length: n }, (_, i) => { const m = nowM - (n - 1 - i) * 60000, k = server.get(m) || minutes.get(m) || { races: 0, ads: 0 }; return { label: i === n - 1 ? 'abhi' : n - 1 - i >= 60 ? `${Math.floor((n - 1 - i) / 60)}h${(n - 1 - i) % 60 ? (n - 1 - i) % 60 + 'm' : ''}` : `${n - 1 - i}m`, a: k.races, b: k.ads }; });
    for (const m of minutes.keys()) if (m < nowM - KEEP_MS) minutes.delete(m);
    const tot = buckets.reduce((s, k) => ({ a: s.a + k.a, b: s.b + k.b }), { a: 0, b: 0 });
    perMin.body.replaceChildren(h('div.row', { style: 'gap:18px;margin-bottom:6px' }, h('span.kpi', {}, h('b', { style: 'color:#42a9ff' }, num(tot.a)), ' races'), h('span.kpi', {}, h('b', { style: 'color:#ffd23f' }, num(tot.b)), ' ads'), h('span.faint', {}, `pichhle ${n >= 60 ? `${n / 60} ghante` : `${n} minute`} me`), h('div', { style: 'margin-left:auto' }, windowTabs())),
      minuteBars(buckets, ['#42a9ff', '#ffd23f'], ['races', 'ads']), legend([['#42a9ff', 'Races'], ['#ffd23f', 'Ads']]));
  }
  function drawTicker() {
    const what = e => !e.d ? `${hours(e.u.seconds)} total khela` : [e.d.seconds > 0 ? `+${hours(e.d.seconds)} khela` : null, e.d.races > 0 ? `+${e.d.races} race` : null, e.d.ads > 0 ? `+${e.d.ads} ad` : null].filter(Boolean).join(' · ') || 'wapas aaya';
    ticker.body.replaceChildren(events.length ? h('div.list.ticker', {}, events.slice(0, 12).map(e => h('button.item.linkrow', { class: e.fresh ? 'flash' : '', onclick: () => go('players', { id: e.u.id }) }, avatar(e.u.name), h('div.grow', {}, h('div.name', {}, e.u.name || 'Player', ' ', h('span.faint', {}, flag(e.u.country))), h('div.faint', {}, what(e))), h('span.faint.mono', {}, seenText(e.at))))) : empty('Abhi data nahi aaya.'));
    events.forEach(e => { e.fresh = false; });
  }

  // ---------------------------------------------------------------- countries and versions today
  listen(fb.query(col(`stats_days/${dayKey()}/dims`), fb.limit(300)), snap => {
    const rows = snap.docs.map(d => ({ id: d.id, n: d.data().n || 0 }));
    countries.body.replaceChildren(hbars(rows.filter(r => r.id.startsWith('c_')).sort((a, b) => b.n - a.n).slice(0, 8).map(r => ({ label: `${flag(r.id.slice(2))} ${countryName(r.id.slice(2))}`, value: r.n })), '#ff7ac6', 'Abhi data nahi aaya.'));
    const vs = rows.filter(r => r.id.startsWith('v_')).sort((a, b) => b.n - a.n), palette = ['#4fd65c', '#42a9ff', '#ffd23f', '#ff7ac6', '#8c5cff', '#5ce0d8'];
    const parts = vs.slice(0, 5).map((r, i) => ({ label: `v${r.id.slice(2)}`, value: r.n, color: palette[i] }));
    if (vs.length > 5) parts.push({ label: 'Baaki', value: vs.slice(5).reduce((s, r) => s + r.n, 0), color: '#7a6aa8' });
    versions.body.replaceChildren(vs.length ? donut(parts, vs[0] ? `v${vs[0].id.slice(2)}` : '-', 'sabse zyada') : empty('Abhi data nahi aaya.'));
  });

  // ---------------------------------------------------------------- go
  const tickClock = () => { clock.textContent = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', second: '2-digit' }) + ' IST'; };
  tickClock(); watchPresence(); play.watch(); watchHistory(); sample(); drawPresence(); drawMinutes(); drawTicker(); drawPlayed();
  await readTotals();
  yesterday = await dayTotals(dayKey(1), true).catch(() => null);
  readPlayDays();
  if (!live()) return;
  drawTotals();
  eachSecond(every, () => { tickClock(); tickHours(); });
  every(5000, () => { if (dayKey() !== startDay) { route(); return; } sample(); drawPresence(); drawMinutes(); });   // the day list redraws when a report lands, so its scroll stays put
  every(30000, () => { if (playDays.length) chartBox.replaceChildren(playBars(playDays.slice(-playRange))); });   // today's bar grows
  every(120000, () => { watchPresence(); play.watch(); });
  every(600000, watchHistory);   // slide the two-hour window forward
  every(60000, () => { if (Date.now() - lastRead > 55000) readTotals(); });
}

// ------------------------------------------------------------------ help and support
const TOPIC_TAG = { BUG: 'r', PAYMENT: 'y', ADS: 'b', ACCOUNT: 'p', IDEA: 'g', OTHER: '' };
async function support(v, live, onLeave) {
  let rows = [], tab = 'open', topic = 'ALL', firstLoad = true;
  const replies = {};
  const tabs = h('div.tabs'), topics = h('div.chips', { style: 'margin-bottom:14px' }), grid = h('div.grid', { style: 'grid-template-columns:repeat(auto-fill,minmax(min(100%,400px),1fr))' });
  v.replaceChildren(head('Help & Support', 'Players ke messages seedha yahan aate hain. Reply unke game MAIL me jata hai.', h('span.livepill', {}, h('i'), 'LIVE')), tabs, topics, grid);
  function card(t) {
    const box = h('textarea', { id: `reply-${t.id}`, rows: 3, maxlength: MAX_MESSAGE, placeholder: 'Apna reply likho...', value: replies[t.id] || '', 'aria-label': 'Reply', oninput: e => { replies[t.id] = e.target.value; } });
    const info = [['Player ID', showId(t.uid)], ['Country', `${flag(t.country)} ${countryName(t.country)}`], ['Level', t.level || '-'], ['Game', `v${t.version || '-'}`], ['Phone', t.device || '-'], ['System', t.os || '-'], ['Language', t.language || '-'], ['Hippo Pass', t.pass || '-'], ['Screen', t.screen || '-']];
    const send = act(async () => {
      const words = box.value.trim(); if (!words) return toast('Reply likho.', true);
      const b = fb.writeBatch(db);
      b.set(fb.doc(col('mail')), { to: t.uid, title: 'Reply from Support', message: words.slice(0, MAX_MESSAGE), push: 'Support replied to your message. Open MAIL!', sentAt: fb.serverTimestamp(), sentBy: 'admin' });
      b.update(ref('support', t.id), { status: 'replied', reply: words.slice(0, MAX_MESSAGE), repliedAt: fb.serverTimestamp() });
      await b.commit(); await logDo('Support reply sent', `${t.name || 'Player'} (${showId(t.uid)})`); delete replies[t.id]; toast('Reply player ke MAIL me chala gaya');
    });
    const setStatus = (status, msg) => act(async () => { await fb.updateDoc(ref('support', t.id), { status }); await logDo(`Support ${status}`, showId(t.uid)); toast(msg); });
    return h('div.card.stack', {}, h('div.row', {}, avatar(t.name), h('div.grow', {}, h('div.name', {}, t.name || 'Player'), h('div.faint', {}, whenText(t.at))), h('span.tag', { class: TOPIC_TAG[t.topic] || '' }, t.topic || 'OTHER'), h('span.tag', { class: { open: 'y', replied: 'g', closed: '' }[t.status] }, t.status)),
      h('div.ticket', {}, t.message || ''), h('dl.details', {}, info.map(([k, x]) => h('div', {}, h('dt', {}, k), h('dd', {}, x)))),
      t.reply ? h('div.note', {}, h('b', {}, 'Your reply: '), t.reply) : null, t.status !== 'closed' ? box : null,
      h('div.row', {}, t.status !== 'closed' ? h('button.btn.go', { onclick: send }, t.reply ? 'Send again' : 'Send reply') : null, t.status !== 'closed' ? h('button.btn', { onclick: setStatus('closed', 'Close ho gaya') }, 'Close') : h('button.btn', { onclick: setStatus('open', 'Dobara open') }, 'Reopen'), h('button.btn.small.ghost', { onclick: () => go('players', { id: t.uid }) }, 'Open player'),
        h('button.btn.small.bad', { 'aria-label': 'Delete message', onclick: act(async () => { if (!await ask({ title: 'Message delete karein?', yes: 'Delete', danger: true })) return; await fb.deleteDoc(ref('support', t.id)); await logDo('Support deleted', showId(t.uid)); toast('Delete ho gaya'); }) }, icon('trash'))));
  }
  function draw() {
    const n = k => rows.filter(t => k === 'all' || t.status === k).length;
    tabs.replaceChildren(...[['open', 'New'], ['replied', 'Replied'], ['closed', 'Closed'], ['all', 'All']].map(([k, l]) => h('button.tab', { class: tab === k ? 'on' : '', onclick: () => { tab = k; draw(); } }, `${l} (${n(k)})`)));
    topics.replaceChildren(...['ALL', 'BUG', 'PAYMENT', 'ADS', 'ACCOUNT', 'IDEA', 'OTHER'].map(k => h('button.chip', { class: topic === k ? 'ok' : '', onclick: () => { topic = k; draw(); } }, k)));
    const shown = rows.filter(t => (tab === 'all' || t.status === tab) && (topic === 'ALL' || t.topic === topic));
    const focusId = document.activeElement?.id;
    grid.replaceChildren(...(shown.length ? shown.map(card) : [h('div.card', { style: 'grid-column:1/-1' }, empty(tab === 'open' ? 'Koi naya message nahi.' : 'Yahan kuch nahi.'))]));
    if (focusId) document.getElementById(focusId)?.focus();
  }
  grid.replaceChildren(loading());
  const stop = fb.onSnapshot(fb.query(col('support'), fb.orderBy('at', 'desc'), fb.limit(300)), snap => {
    if (!live()) return;
    const added = snap.docChanges().filter(c => c.type === 'added').length;
    rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!firstLoad && added) toast('Naya support message aaya!');
    firstLoad = false; draw(); refreshBadge();
  }, e => { console.error(e); grid.replaceChildren(h('div.note.danger', {}, friendly(e))); });
  onLeave(stop);
}

// ------------------------------------------------------------------ start
function start() {
  const config = emulator ? { apiKey: 'demo-key', authDomain: 'localhost', projectId: new URLSearchParams(location.search).get('project') || 'demo-raft' } : readConfig();
  if (!config) return setupScreen();
  try {
    const app = fb.initializeApp(config);
    auth = fb.getAuth(app); db = fb.getFirestore(app);
    if (emulator) { fb.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true }); fb.connectFirestoreEmulator(db, '127.0.0.1', 8080); }
  } catch (e) { localStorage.removeItem(CONFIG_KEY); toast(friendly(e), true); return setupScreen(); }
  fb.onAuthStateChanged(auth, async user => {
    me = user;
    if (!user) { leaveWork.splice(0).forEach(stop => stop()); routeToken++; window.onhashchange = null; return loginScreen(); }
    try {
      const s = await fb.getDoc(ref('admins', user.uid));
      if (s.exists()) shell(); else notAdminScreen();
    } catch (e) { console.error(e); if (String(e.code).includes('permission-denied')) notAdminScreen(); else { toast(friendly(e), true); loginScreen(); } }
  });
}
start();
