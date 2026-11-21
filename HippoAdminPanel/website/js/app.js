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
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2', help: 'M3 14v-2a9 9 0 0118 0v2M3 14a2 2 0 012-2h1v7H5a2 2 0 01-2-2zM21 14a2 2 0 00-2-2h-1v7h1a2 2 0 002-2zM18 19c0 2-2 3-5 3', menu: 'M3 6h18M3 12h18M3 18h18', copy: 'M9 9h12v12H9zM5 15H3V3h12v2', trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14',
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
  ['', [['dashboard', 'Dashboard', 'home'], ['analytics', 'Analytics', 'chart'], ['support', 'Help & Support', 'help']]],
  ['BHEJO', [['gift', 'Send Gift / Mail', 'gift'], ['notify', 'Notification', 'bell'], ['history', 'Sent Mail', 'mail']]],
  ['LOG', [['forms', 'Creator Forms', 'form'], ['creators', 'Creators', 'star'], ['partners', 'Partners', 'crown'], ['players', 'Players', 'users']]],
  ['GAME', [['rivers', 'Rivers', 'river'], ['reports', 'Reports', 'flag'], ['settings', 'Game Settings', 'gear'], ['log', 'Activity Log', 'log']]],
];
const PAGES = { dashboard, analytics, support, gift: v => composer(v, false), notify: v => composer(v, true), history, forms, creators: v => people(v, 'creators'), partners: v => people(v, 'partners'), players, rivers, reports, settings, log: activity };
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
async function dashboard(v, live) {
  const [pending, creators, partners, players_, rivers_, mails, rr, pr] = await Promise.all([
    count(fb.query(col('wow_apply'), fb.where('status', '==', 'pending'))), count(col('wow_creators')), count(col('partners')), count(col('users')),
    count(col('wow_rivers')), count(col('mail')), count(col('wow_reports')), count(col('photo_reports'))]);
  if (!live()) return;
  const stat = (n, label, page, c, alert) => h('button.stat', { class: alert ? 'alert' : '', style: `--c:${c}`, onclick: () => go(page) }, h('b', {}, n === null ? '-' : n.toLocaleString('en-IN')), h('span', {}, label));
  const recent = await docs(fb.query(col('wow_apply'), fb.where('status', '==', 'pending'), fb.limit(5))).catch(() => []);
  const logs = await docs(fb.query(col('admin_log'), fb.orderBy('at', 'desc'), fb.limit(6))).catch(() => []);
  if (!live()) return;
  v.replaceChildren(head('Dashboard', 'Game ka sab kuch ek jagah.'),
    h('div.stats', {}, stat(pending, 'Forms waiting', 'forms', 'var(--gold)', pending > 0), stat(players_, 'Players', 'players', 'var(--blue)'), stat(creators, 'Creators', 'creators', 'var(--pink)'), stat(partners, 'Partners', 'partners', 'var(--gold)'),
      stat(rivers_, 'Creator rivers', 'rivers', '#5ce0d8'), stat(mails, 'Mails sent', 'history', 'var(--green)'), stat((rr || 0) + (pr || 0), 'Reports', 'reports', 'var(--red)', (rr || 0) + (pr || 0) > 0)),
    h('div.two', {},
      h('div.card.stack', {}, h('div.row.between', {}, h('h2', {}, 'Forms waiting'), h('button.btn.small', { onclick: () => go('forms') }, 'See all')),
        recent.length ? h('div.list', {}, recent.map(a => h('div.item', {}, avatar(a.name), h('div.grow', {}, h('div.name', {}, a.name || 'Player'), h('div.faint.mono', {}, showId(a.id))), h('span.tag.y', {}, 'pending')))) : empty('Koi form pending nahi hai.')),
      h('div.stack', {},
        h('div.card.stack', {}, h('h2', {}, 'Quick actions'), h('div.row', {}, h('button.btn.gold', { onclick: () => go('gift') }, icon('gift'), 'Send gift'), h('button.btn', { onclick: () => go('notify') }, icon('bell'), 'Notification'), h('button.btn', { onclick: () => go('analytics') }, icon('chart'), 'Analytics'), h('button.btn', { onclick: () => go('support') }, icon('help'), 'Support'), h('button.btn', { onclick: () => go('partners') }, icon('crown'), 'Add partner'))),
        h('div.card.stack', {}, h('h2', {}, 'Last actions'), logs.length ? h('div.list', {}, logs.map(l => h('div.item', {}, h('div.grow', {}, h('div.name', {}, l.action), h('div.faint', {}, whenText(l.at)))))) : h('p.faint', {}, 'Abhi kuch nahi.')))));
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
async function players(v, live) {
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
  const listOf = rows => h('div.list', {}, rows.map(u => h('div.item', {}, avatar(u.name), h('div.grow', {}, h('div.name', {}, u.name || 'Player'), h('div.faint.mono', {}, showId(u.id))), h('span.tag', {}, `Lv ${u.level || '-'}`), h('span.faint', {}, agoText(u.seen)), h('button.btn.small', { onclick: act(() => open(u)) }, 'Open'))));
  async function showRecent() {
    const rows = await docs(fb.query(col('users'), fb.orderBy('seen', 'desc'), fb.limit(25)));
    if (live()) out.replaceChildren(h('div.card.stack', {}, h('h2', {}, 'Recently active'), rows.length ? listOf(rows) : empty('Abhi koi player nahi.')));
  }
  async function open(u) {
    const [c, p, ban, photo] = await Promise.all([fb.getDoc(ref('wow_creators', u.id)), fb.getDoc(ref('partners', u.id)), fb.getDoc(ref('photo_bans', u.id)), fb.getDoc(ref('photos', u.id))]);
    const isC = c.exists(), isP = p.exists(), banned = ban.exists(), image = photo.exists() ? photo.data().pic : '';
    const again = () => open(u);
    const stat = (k, val) => h('div', {}, h('div.faint', {}, k), h('div.name', {}, val));
    out.replaceChildren(h('div.card.stack', {},
      h('div.row', {}, avatar(u.name, image), h('div.grow', {}, h('h2', {}, u.name || 'Player'), h('div.faint.mono', {}, `ID ${showId(u.id)}`)), isC ? h('span.tag.p', {}, 'Creator') : null, isP ? h('span.tag.y', {}, 'Partner') : null, banned ? h('span.tag.r', {}, 'Photo banned') : null),
      h('div.fields', {}, stat('Level', u.level || '-'), stat('Rank Points', Number(u.rp) >= 0 ? u.rp : 'Not ranked'), stat('Last seen', agoText(u.seen)), stat('Now', u.state === 'race' ? `Racing ${u.river || ''}` : 'Home')),
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

async function activity(v, live) {
  const rows = await docs(fb.query(col('admin_log'), fb.orderBy('at', 'desc'), fb.limit(150)));
  if (!live()) return;
  v.replaceChildren(head('Activity Log', 'Panel se jo bhi hua, sab yahan likha rehta hai.'), h('div.card', {}, rows.length ? h('div.list', {}, rows.map(l => h('div.item', {}, h('div.grow', {}, h('div.name', {}, l.action), h('div.muted', { style: 'overflow-wrap:anywhere' }, l.detail || '')), h('span.faint', {}, whenText(l.at))))) : empty('Abhi kuch nahi hua.')));
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
async function totals(path) {
  const c = col(path);
  const [a, b] = await Promise.all([
    fb.getAggregateFromServer(c, { players: fb.count(), seconds: fb.sum('seconds'), sessions: fb.sum('sessions'), races: fb.sum('races'), fresh: fb.sum('new') }),
    fb.getAggregateFromServer(c, { rewarded: fb.sum('rewarded'), interstitial: fb.sum('interstitial'), banner: fb.sum('banner'), native: fb.sum('native') })]);
  return { ...a.data(), ...b.data() };
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

async function analytics(v, live, onLeave) {
  const stamp = h('span.faint', {}, 'Updating...');
  const tiles = h('div.stats'), adsBox = h('div.card.stack'), trend = h('div.card.stack'), geo = h('div.card.stack'), top = h('div.card.stack'), health = h('div.card.stack'), now = h('div.card.stack');
  v.replaceChildren(head('Analytics', 'Game ka poora data, live.', h('div.row', {}, h('span.livepill', {}, h('i'), 'LIVE'), stamp)),
    h('div.note', { style: 'margin-bottom:14px' }, 'Ads, time, country aur top players ka data naye game update se aana shuru hoga. Din India time se chalta hai.'),
    tiles, h('div.two', { style: 'margin-bottom:16px' }, trend, adsBox), h('div.two', { style: 'margin-bottom:16px' }, geo, h('div.stack', {}, health, now)), top);

  let days = [], metricId = 'players', geoTab = 'today', sortBy = 'seconds';
  const METRICS = {
    players: { name: 'Players', whole: true, get: d => d.players, text: num, axis: x => num(Math.round(x)) },
    fresh: { name: 'New players', whole: true, get: d => d.fresh, text: num, axis: x => num(Math.round(x)) },
    ads: { name: 'Ads seen', whole: true, get: adsOf, text: num, axis: x => num(Math.round(x)) },
    hours: { name: 'Hours played', get: d => d.seconds / 3600, text: x => x.toFixed(1), axis: x => (x < 10 ? x.toFixed(1) : num(Math.round(x))) },
    races: { name: 'Races', whole: true, get: d => d.races, text: num, axis: x => num(Math.round(x)) },
  };
  function drawTrend() {
    trend.replaceChildren(h('h2', {}, 'Last 30 days'), h('div.tabs', { style: 'margin:0' }, Object.entries(METRICS).map(([k, m]) => h('button.tab', { class: metricId === k ? 'on' : '', onclick: () => { metricId = k; drawTrend(); } }, m.name))), days.length ? dayChart(days.slice(-30), METRICS[metricId]) : loading());
  }
  async function drawGeo() {
    const path = { today: `stats_days/${dayKey()}/dims`, month: `stats_months/${dayKey().slice(0, 6)}/dims`, all: 'stats_all' }[geoTab];
    const rows = (await docs(fb.query(col(path), fb.limit(260)))).filter(x => x.id.startsWith('c_')).map(x => ({ c: x.id.slice(2), n: x.n || 0 })).sort((a, b) => b.n - a.n);
    if (!live()) return;
    const sum = rows.reduce((s, r) => s + r.n, 0), big = rows[0]?.n || 1;
    geo.replaceChildren(h('h2', {}, 'Countries'), h('div.tabs', { style: 'margin:0' }, [['today', 'Today'], ['month', 'This month'], ['all', 'All time']].map(([k, l]) => h('button.tab', { class: geoTab === k ? 'on' : '', onclick: act(async () => { geoTab = k; await drawGeo(); }) }, l))),
      rows.length ? h('div.meters', {}, rows.slice(0, 15).map(r => h('div.meter', {}, h('span.mflag', { 'aria-hidden': 'true' }, flag(r.c)), h('span.mname', {}, countryName(r.c)), h('span.track', {}, h('i', { style: `width:${Math.max(r.n / big * 100, 2)}%` })), h('b.mono', {}, num(r.n)), h('span.faint.mono.pct', {}, `${Math.round(r.n / sum * 100)}%`)))) : empty('Abhi data nahi aaya.'));
  }
  async function drawTop() {
    const rows = await docs(fb.query(col('stats_players'), fb.orderBy(sortBy, 'desc'), fb.limit(25)));
    if (!live()) return;
    top.replaceChildren(h('div.row.between', {}, h('h2', {}, 'Top players'), h('div.tabs', { style: 'margin:0' }, [['seconds', 'Most hours'], ['ads', 'Most ads'], ['races', 'Most races']].map(([k, l]) => h('button.tab', { class: sortBy === k ? 'on' : '', onclick: act(async () => { sortBy = k; await drawTop(); }) }, l)))),
      rows.length ? h('div.scroll', {}, h('table', {}, h('thead', {}, h('tr', {}, ['#', 'Player', 'Country'].map(x => h('th', {}, x)), ['Hours', 'Ads', 'Races', 'Sessions', 'Level'].map(x => h('th.n', {}, x)), h('th', {}, 'Last seen'))),
        h('tbody', {}, rows.map((u, i) => h('tr.link', { tabindex: 0, onclick: () => go('players', { id: u.id }), onkeydown: e => { if (e.key === 'Enter') go('players', { id: u.id }); } },
          h('td.mono', {}, i + 1), h('td', {}, h('div.name', {}, u.name || 'Player'), h('div.faint.mono', {}, showId(u.id))), h('td', {}, `${flag(u.country)} ${countryName(u.country)}`),
          h('td.n.mono', {}, hours(u.seconds)), h('td.n.mono', {}, num(u.ads || 0)), h('td.n.mono', {}, num(u.races || 0)), h('td.n.mono', {}, num(u.sessions || 0)), h('td.n.mono', {}, u.level || '-'), h('td.faint', {}, agoText(u.lastAt))))))) : empty('Abhi data nahi aaya.'));
  }
  async function drawNow() {
    const since = String(Math.floor(Date.now() / 1000) - 100);
    const rows = await docs(fb.query(col('users'), fb.where('seen', '>=', since), fb.orderBy('seen', 'desc'), fb.limit(12)));
    if (!live()) return;
    const on = rows.filter(u => u.state !== 'off');
    now.replaceChildren(h('h2', {}, 'Playing now'), on.length ? h('div.list', {}, on.map(u => h('div.item', {}, avatar(u.name), h('div.grow', {}, h('div.name', {}, u.name || 'Player'), h('div.faint', {}, u.state === 'race' ? `Racing ${u.river || ''}` : 'On home screen')), h('span.tag', { class: u.state === 'race' ? 'g' : 'b' }, u.state === 'race' ? 'race' : 'home')))) : empty('Abhi koi online nahi.'));
  }
  async function refresh(full) {
    const nowSec = Math.floor(Date.now() / 1000);
    const [liveCount, today, all, month, users] = await Promise.all([
      count(fb.query(col('users'), fb.where('seen', '>=', String(nowSec - 100)))), dayTotals(dayKey(), true), totals('stats_players'),
      count(col(`stats_months/${dayKey().slice(0, 6)}/players`)), count(col('users'))]);
    if (!live()) return;
    if (full) {
      const keys = Array.from({ length: 31 }, (_, i) => dayKey(30 - i));   // a whole month, whatever the date
      const got = await Promise.all(keys.map(k => k === dayKey() ? today : dayTotals(k, k >= dayKey(1)).catch(() => ({ ...EMPTY_DAY }))));
      days = keys.map((key, i) => ({ key, t: got[i] }));
    } else if (days.length) days[days.length - 1].t = today;
    if (!live()) return;
    const tile = (n, label, c, sub) => h('div.stat.flat', { style: `--c:${c}` }, h('b', {}, n), h('span', {}, label), sub ? h('small', {}, sub) : null);
    tiles.replaceChildren(tile(num(liveCount), 'Live now', 'var(--green)', 'last 100 seconds'), tile(num(today.players), 'Played today', 'var(--blue)'), tile(num(month), 'Played this month', 'var(--pink)'), tile(num(today.fresh), 'New today', '#5ce0d8'),
      tile(num(users), 'Total players', 'var(--gold)'), tile(hours(today.players ? today.seconds / today.players : 0), 'Avg time today', 'var(--gold)', 'per player'), tile(num(today.races), 'Races today', 'var(--blue)'), tile(num(adsOf(today)), 'Ads today', 'var(--green)', today.players ? `${(adsOf(today) / today.players).toFixed(1)} per player` : ''));
    const yesterday = days.length > 1 ? days[days.length - 2].t : EMPTY_DAY, week = addUp(days.slice(-7).map(d => d.t)), thisMonth = addUp(days.filter(d => d.key.slice(0, 6) === dayKey().slice(0, 6)).map(d => d.t));
    const cols = [today, yesterday, week, thisMonth, all];
    adsBox.replaceChildren(h('h2', {}, 'Ads seen'), h('div.scroll', {}, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Type'), ['Today', 'Yesterday', '7 days', 'Month', 'All time'].map(x => h('th.n', {}, x)))),
      h('tbody', {}, [['Rewarded', 'rewarded'], ['Interstitial', 'interstitial'], ['Banner', 'banner'], ['Native Advanced', 'native']].map(([l, k]) => h('tr', {}, h('td', {}, l), cols.map(c => h('td.n.mono', {}, num(c[k] || 0))))), h('tr.total', {}, h('td', {}, 'Total'), cols.map(c => h('td.n.mono', {}, num(adsOf(c)))))))),
      h('p.faint', {}, 'Game me ad dikhne par count hota hai. Earnings ke liye AdMob hi sahi number hai.'));
    drawTrend();
    stamp.textContent = `Updated ${new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`;
  }
  async function drawHealth() {
    const rate = async back => {
      const start = dayKey(back), base = await dayTotals(start, back <= 1).catch(() => null);
      if (!base || !base.fresh) return null;
      const n = await count(fb.query(col(`stats_days/${dayKey(0)}/players`), fb.where('firstDay', '==', Number(start))));
      return n === null ? null : Math.round(n / base.fresh * 100);
    };
    const [d1, d7, versions] = await Promise.all([rate(1), rate(7), docs(fb.query(col(`stats_days/${dayKey()}/dims`), fb.limit(260))).catch(() => [])]);
    if (!live()) return;
    const vs = versions.filter(x => x.id.startsWith('v_')).map(x => ({ v: x.id.slice(2), n: x.n || 0 })).sort((a, b) => b.n - a.n);
    health.replaceChildren(h('h2', {}, 'Players coming back'), h('div.fields', { style: 'grid-template-columns:1fr 1fr' },
      h('div.mini-stat', {}, h('b', {}, d1 === null ? '-' : `${d1}%`), h('span', {}, 'Day 1'), h('small', {}, 'kal ke naye players aaj wapas aaye')), h('div.mini-stat', {}, h('b', {}, d7 === null ? '-' : `${d7}%`), h('span', {}, 'Day 7'), h('small', {}, '7 din pehle ke naye players aaj aaye'))),
      h('div.lab', {}, 'Game versions today'), vs.length ? h('div.chips', {}, vs.slice(0, 6).map(x => h('span.tag.p', {}, `v${x.v}: ${num(x.n)}`))) : h('p.faint', {}, 'Abhi data nahi aaya.'));
  }
  await refresh(true);
  await Promise.all([drawGeo(), drawTop(), drawNow(), drawHealth()]);
  let tick = 0, busy = false;
  const timer = setInterval(async () => {
    if (document.hidden || busy || !live()) return;
    busy = true; tick++;
    try { await refresh(false); if (tick % 3 === 0) await drawNow(); if (tick % 15 === 0) await Promise.all([drawGeo(), drawTop(), drawHealth()]); } catch (e) { console.warn(e); stamp.textContent = 'Connection lost, retrying...'; }
    busy = false;
  }, 20000);
  onLeave(() => clearInterval(timer));
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
