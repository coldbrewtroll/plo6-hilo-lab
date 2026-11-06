(function () {
'use strict';
const E = ENGINE();
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const POS = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
const SYM = { s: '♠', h: '♥', d: '♦', c: '♣' };
const P = (x, d = 1) => (x * 100).toFixed(d) + '%';
const rnd = n => Math.floor(Math.random() * n);
const pick = a => a[rnd(a.length)];
const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
};

function cardHTML(c, cls = '') {
  const r = E.RANKS[c >> 2], s = E.SUITS[c & 3];
  return `<span class="card su-${s} ${cls}" data-c="${c}"><b>${r}</b><i>${SYM[s]}</i></span>`;
}
const handHTML = (cs, cls = '') => cs.map(c => cardHTML(c, cls)).join('');
const sortHand = cs => cs.slice().sort((a, b) => (b >> 2) - (a >> 2) || (a & 3) - (b & 3));
const handStr = cs => cs.map(E.cardStr).join('');
function deal(n, exclude = []) {
  const used = new Set(exclude), d = [];
  for (let c = 0; c < 52; c++) if (!used.has(c)) d.push(c);
  for (let i = 0; i < n; i++) { const j = i + rnd(d.length - i); [d[i], d[j]] = [d[j], d[i]]; }
  return d.slice(0, n);
}

// ---------- background runners (Web Worker with main-thread fallback) ----------
const WORKER_SRC = 'const API=(' + ENGINE.toString() + ')();onmessage=e=>API.handleMessage(e.data,m=>postMessage(m));';
const REAL_BYTES = (() => { try { if (typeof PLO6_REALPOOL === 'undefined' || !PLO6_REALPOOL) return null; const bin = atob(PLO6_REALPOOL), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; } catch (e) { return null; } })();
if (REAL_BYTES) E.setRealPool(REAL_BYTES);
class Runner {
  constructor() { this.seq = 0; this.pending = new Map(); this.broken = false; this.spawn(); }
  spawn() {
    this.w = null;
    if (this.broken || typeof Worker === 'undefined') return;
    try {
      this.w = new Worker(URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' })));
      this.w.onmessage = e => this.onmsg(e.data);
      if (REAL_BYTES) this.w.postMessage({ cmd: 'setReal', bytes: REAL_BYTES });
      this.w.onerror = () => { this.broken = true; this.w = null; for (const [id, p] of this.pending) this.local(p.msg); };
    } catch (e) { this.broken = true; this.w = null; }
  }
  onmsg(m) {
    const p = this.pending.get(m.id); if (!p) return;
    if (m.type === 'progress') { if (p.onProgress) p.onProgress(m); return; }
    this.pending.delete(m.id);
    if (m.type === 'error') p.reject(new Error(m.error)); else p.resolve(m.result);
  }
  run(msg, onProgress) {
    const id = ++this.seq; msg = Object.assign({}, msg, { id });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress, msg });
      if (this.w) this.w.postMessage(msg); else this.local(msg);
    });
  }
  local(msg) {
    const p = this.pending.get(msg.id); if (!p) return;
    let job;
    try { job = msg.cmd === 'equity' ? E.createEquityJob(msg) : E.createCalibrateJob(msg); }
    catch (e) { this.pending.delete(msg.id); p.reject(e); return; }
    const tick = () => {
      if (this.pending.get(msg.id) !== p) return;
      const t = performance.now(); let fin = false;
      while (performance.now() - t < 25 && !(fin = job.step(msg.cmd === 'equity' ? 800 : 5)));
      if (fin) { this.pending.delete(msg.id); p.resolve(job.result()); }
      else { if (p.onProgress) p.onProgress(msg.cmd === 'equity' ? { result: job.result() } : { progress: job.progress }); setTimeout(tick, 0); }
    };
    setTimeout(tick, 0);
  }
  cancel() {
    for (const p of this.pending.values()) p.reject(new Error('cancelled'));
    this.pending.clear();
    if (this.w) { this.w.terminate(); this.spawn(); }
  }
}
const simRunner = new Runner(), anRunner = new Runner(), trainRunner = new Runner();

// ---------- tabs ----------
$$('.tab').forEach(b => b.onclick = () => {
  $$('.tab').forEach(x => x.classList.toggle('on', x === b));
  $$('main > .page').forEach(p => p.classList.toggle('on', p.id === 'page-' + b.dataset.tab));
  store.set('plo6hl_tab', b.dataset.tab);
});
$$('.subtabs').forEach(bar => $$('.subtab', bar).forEach(b => b.onclick = () => {
  $$('.subtab', bar).forEach(x => x.classList.toggle('on', x === b));
  const page = bar.parentElement;
  $$(':scope > .page', page).forEach(p => p.classList.toggle('on', p.id === b.dataset.sub));
  if (b.dataset.sub === 'tr-stats') renderStats();
}));
const activeSub = () => { const pg = $('main > .page.on'); const s = pg && $(':scope > .page.on', pg); return s ? s.id : ''; };
$('#fourColor').onchange = e => { document.body.classList.toggle('twocolor', !e.target.checked); store.set('plo6hl_4c', e.target.checked); };
if (store.get('plo6hl_4c', true) === false) { $('#fourColor').checked = false; document.body.classList.add('twocolor'); }
if (store.get('plo6hl_tab', 'sim') === 'train') $('.tab[data-tab=train]').click();

/*STRATEGY*/

function featureChips(h) {
  const f = E.feats(h), out = [];
  const rc = new Array(13).fill(0), sc = [0, 0, 0, 0]; h.forEach(c => { rc[c >> 2]++; sc[c & 3]++; });
  const A = rc[12];
  if (f[1]) out.push(['A2 — nut-low draw', 'pos']);
  else if (f[2]) out.push(['A3 — 2nd-nut low draw', 'pos']);
  else if (f[3]) out.push(['A + 4/5 — weak low draw', '']);
  if (f[1] && rc[1]) out.push(['A23 — counterfeit protection', 'pos']);
  if (f[4]) out.push(['23 without ace', '']);
  if (A >= 2) out.push(['Pair of aces', 'pos']);
  if (rc[11] >= 2) out.push(['Pair of kings', '']);
  if (f[14]) out.push(['Suited ace (nut-flush draw)', 'pos']);
  else if (f[16]) out.push(['Suited king', '']);
  const ns = sc.filter(x => x >= 2).length;
  if (ns >= 3) out.push(['Triple-suited', 'pos']); else if (ns === 2) out.push(['Double-suited', 'pos']); else if (ns === 0) out.push(['Rainbow', 'neg']);
  if (f[18]) out.push(['4+ cards of one suit', 'neg']);
  out.push([f[5] + ' distinct low cards', f[5] >= 3 ? 'pos' : f[5] <= 1 ? 'neg' : '']);
  if (f[9] >= 3) out.push([f[9] + ' broadway ranks', 'pos']);
  if (f[13]) out.push(['Trips / quads in hand', 'neg']);
  if (!A) out.push(['No ace', 'neg']);
  if (f[21] >= 2 && f[5] <= 2) out.push(['Middle cards (9-T-J), little low', 'neg']);
  return out.map(([t, c]) => `<span class="chip ${c}">${t}</span>`).join('');
}

// =====================================================================
// SIMULATOR — 6-MAX TABLE
// =====================================================================
const sim = {
  seats: POS.map(() => ({ cards: [], on: false })),
  board: [], dead: [], target: { k: 'seat', i: 0 }, res: null, map: null, running: false,
};
(function initDefaults() {
  const saved = store.get('plo6hl_sim', null);
  if (saved && saved.seats && saved.seats.length === 6) {
    saved.seats.forEach((s, i) => { sim.seats[i].cards = s.cards || []; sim.seats[i].on = !!s.on; });
    sim.board = saved.board || []; sim.dead = saved.dead || [];
    return;
  }
  sim.seats[0] = { cards: E.parseCards('As2s3dKdQh9c').cards, on: true };
  sim.seats[3] = { cards: E.parseCards('Ah4h5c6cJdTd').cards, on: true };
  sim.seats[5] = { cards: [], on: true };
})();
const saveSim = () => store.set('plo6hl_sim', { seats: sim.seats, board: sim.board, dead: sim.dead });

function ownerMap(skip) {
  const m = new Map();
  sim.seats.forEach((s, i) => { if (skip !== 'seat' + i) s.cards.forEach(c => m.set(c, POS[i])); });
  if (skip !== 'board') sim.board.forEach(c => m.set(c, 'board'));
  if (skip !== 'dead') sim.dead.forEach(c => m.set(c, 'dead'));
  return m;
}
function buildSeats() {
  sim.seats.forEach((s, i) => {
    const el = $('#seat-' + i);
    el.className = 'seat';
    el.innerHTML = `<div class="seat-head"><span class="pos">${POS[i]}</span>
      <label title="Include this seat in the hand"><input type="checkbox" class="on"> in</label>
      <span class="spacer"></span>
      <button class="btn sm rnd" title="Random 6-card hand">🎲</button><button class="btn sm clr" title="Clear">✕</button></div>
      <div class="seat-cards"></div>
      <input type="text" placeholder="e.g. As2s3dKh9c4c (blank = random)">
      <div class="seat-res"></div>`;
    el.addEventListener('click', e => { if (e.target.closest('button,input')) return; sim.target = { k: 'seat', i }; renderSim(); });
    $('.on', el).onchange = e => { s.on = e.target.checked; changed(); };
    $('.rnd', el).onclick = () => { s.on = true; s.cards = deal(6, [...ownerMap('seat' + i).keys()]); changed(); };
    $('.clr', el).onclick = () => { s.cards = []; changed(); };
    const inp = $('input[type=text]', el);
    inp.addEventListener('input', () => parseInto(inp, 'seat' + i, 6, cs => { s.cards = cs; if (cs.length) s.on = true; changed(false); }));
    inp.addEventListener('focus', () => { sim.target = { k: 'seat', i }; renderTargets(); });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') runSim(); });
    $('.seat-cards', el).addEventListener('click', e => {
      const c = e.target.closest('.card[data-c]'); if (!c) return;
      s.cards = s.cards.filter(x => x !== +c.dataset.c); changed();
    });
  });
}
function parseInto(inp, owner, max, apply) {
  const { cards, error } = E.parseCards(inp.value);
  const own = ownerMap(owner);
  let err = error;
  if (!err && cards.length > max) err = `Max ${max} cards`;
  if (!err) { const seen = new Set(); for (const c of cards) { if (seen.has(c)) { err = E.cardStr(c) + ' listed twice'; break; } seen.add(c); if (own.has(c)) { err = E.cardStr(c) + ' already used by ' + own.get(c); break; } } }
  inp.classList.toggle('err', !!err);
  $('#simErr').textContent = err ? err : '';
  if (!err) apply(cards);
}
function renderTargets() {
  sim.seats.forEach((s, i) => $('#seat-' + i).classList.toggle('target', sim.target.k === 'seat' && sim.target.i === i));
  $('#boardCards').classList.toggle('target', sim.target.k === 'board');
  $('#pickTarget').textContent = '→ ' + (sim.target.k === 'seat' ? POS[sim.target.i] : sim.target.k);
}
function renderSim(syncInputs = true) {
  sim.seats.forEach((s, i) => {
    const el = $('#seat-' + i);
    el.classList.toggle('off', !s.on);
    $('.on', el).checked = s.on;
    let html = handHTML(s.cards, 'click');
    for (let k = s.cards.length; k < 6; k++) html += `<span class="card slot">${s.on ? '?' : ''}</span>`;
    $('.seat-cards', el).innerHTML = html;
    const inp = $('input[type=text]', el);
    if (syncInputs && document.activeElement !== inp) { inp.value = handStr(s.cards); inp.classList.remove('err'); }
    const r = sim.res && sim.map ? sim.map.indexOf(i) : -1;
    const res = $('.seat-res', el);
    if (r >= 0 && s.on) {
      const p = sim.res.players[r];
      res.innerHTML = `<div class="eqline"><span class="eqbig">${P(p.eq)}</span>${p.ci ? `<span class="eqsub">±${(p.ci * 100).toFixed(2)}</span>` : ''}
        <span class="eqsub">Hi ${P(p.hi, 0)} · Lo ${P(p.lo, 0)} · Scoop ${P(p.scoop, 0)}</span></div>
        <div class="bar"><span style="width:${(p.eq * 100).toFixed(2)}%"></span></div>`;
    } else res.innerHTML = s.on ? '' : '<span class="muted" style="font-size:12px">Not in hand</span>';
  });
  let b = handHTML(sim.board, 'lg click');
  for (let k = sim.board.length; k < 5; k++) b += `<span class="card lg slot">${['F', 'F', 'F', 'T', 'R'][k]}</span>`;
  $('#boardCards').innerHTML = b;
  if (syncInputs) {
    if (document.activeElement !== $('#boardInput')) $('#boardInput').value = handStr(sim.board);
    if (document.activeElement !== $('#deadInput')) $('#deadInput').value = handStr(sim.dead);
  }
  renderTargets();
  renderPicker();
  renderSimTable();
}
function renderPicker() {
  const own = ownerMap();
  let h = '';
  for (let s = 0; s < 4; s++) for (let r = 12; r >= 0; r--) { const c = r * 4 + s; h += cardHTML(c, 'sm' + (own.has(c) ? ' taken' : '')); }
  $('#picker').innerHTML = h;
}
$('#picker').addEventListener('click', e => {
  const el = e.target.closest('.card'); if (!el || el.classList.contains('taken')) return;
  const c = +el.dataset.c, t = sim.target;
  if (t.k === 'seat') {
    const s = sim.seats[t.i]; if (s.cards.length >= 6) { $('#simErr').textContent = POS[t.i] + ' already has 6 cards'; return; }
    s.cards.push(c); s.on = true;
    if (s.cards.length === 6) { // advance to next active seat that still needs cards
      for (let k = 1; k <= 6; k++) { const j = (t.i + k) % 6; if (sim.seats[j].on && sim.seats[j].cards.length < 6) { sim.target = { k: 'seat', i: j }; break; } }
    }
  } else if (t.k === 'board') { if (sim.board.length >= 5) return; sim.board.push(c); }
  else { sim.dead.push(c); }
  $('#simErr').textContent = '';
  changed();
});
$('#boardCards').addEventListener('click', e => {
  const c = e.target.closest('.card[data-c]');
  if (c) sim.board = sim.board.filter(x => x !== +c.dataset.c);
  sim.target = { k: 'board' }; changed();
});
$('#boardInput').addEventListener('input', e => parseInto(e.target, 'board', 5, cs => { sim.board = cs; changed(false); }));
$('#boardInput').addEventListener('focus', () => { sim.target = { k: 'board' }; renderTargets(); });
$('#deadInput').addEventListener('input', e => parseInto(e.target, 'dead', 40, cs => { sim.dead = cs; changed(false); }));
$('#deadInput').addEventListener('focus', () => { sim.target = { k: 'dead' }; renderTargets(); });
['#boardInput', '#deadInput'].forEach(s => $(s).addEventListener('keydown', e => { if (e.key === 'Enter') runSim(); }));
function dealStreet(n) {
  const want = n === 3 ? 3 : n === 4 ? 4 : 5;
  if (sim.board.length >= want) sim.board = sim.board.slice(0, want - (n === 3 ? 3 : 1));
  const need = want - sim.board.length;
  sim.board = sim.board.concat(deal(need, [...ownerMap().keys()]));
  changed();
}
$('#dealFlop').onclick = () => dealStreet(3);
$('#dealTurn').onclick = () => { if (sim.board.length < 3) dealStreet(3); dealStreet(4); };
$('#dealRiver').onclick = () => { if (sim.board.length < 4) dealStreet(4); dealStreet(5); };
$('#clearBoard').onclick = () => { sim.board = []; changed(); };
$('#randAll').onclick = () => {
  sim.seats.forEach(s => { if (s.on) s.cards = []; });
  sim.seats.forEach((s, i) => { if (s.on) s.cards = deal(6, [...ownerMap().keys()]); });
  changed();
};
$('#allIn').onclick = () => { sim.seats.forEach(s => s.on = true); changed(); };
$('#heroVsField').onclick = () => {
  const hero = sim.seats[0].cards.length === 6 ? sim.seats[0].cards : deal(6, [...sim.board, ...sim.dead]);
  sim.seats.forEach((s, i) => { s.on = true; s.cards = i === 0 ? hero : []; });
  changed();
};
$('#clearAll').onclick = () => { sim.seats.forEach(s => { s.cards = []; s.on = false; }); sim.seats[0].on = sim.seats[5].on = true; sim.board = []; sim.dead = []; sim.res = null; changed(); };
$('#runSim').onclick = () => runSim();
['#simMode', '#simTrials'].forEach(x => $(x).addEventListener('change', () => { if ($('#autoRun').checked) runSim(true); }));
$('#convBands').onchange = $('#convView').onchange = () => drawConvergence();
window.addEventListener('resize', () => drawConvergence());
$('#stopSim').onclick = () => { simRunner.cancel(); sim.running = false; $('#simSummary').textContent += ' (stopped)'; };

let autoTimer = null;
function changed(sync = true) {
  sim.res = null; saveSim(); renderSim(sync);
  clearTimeout(autoTimer);
  if ($('#autoRun').checked) autoTimer = setTimeout(() => runSim(true), 250);
}
function runSim(quiet) {
  const map = []; const players = [];
  sim.seats.forEach((s, i) => { if (s.on) { map.push(i); players.push({ cards: s.cards.slice() }); } });
  if (players.length < 2) { if (!quiet) $('#simErr').textContent = 'Put at least 2 seats in the hand.'; $('#simSummary').textContent = 'Need at least 2 active seats'; return; }
  if (sim.board.length > 0 && sim.board.length < 3) { $('#simSummary').textContent = 'Board needs 0, 3, 4 or 5 cards'; return; }
  if ($$('#tableWrap input.err').length) { $('#simSummary').textContent = 'Fix the highlighted input first'; return; }
  simRunner.cancel();
  const stopV = $('#simTrials').value, isCI = stopV.startsWith('ci:'), target = isCI ? +stopV.slice(3) : 0;
  const mode = $('#simMode').value;
  const trials = isCI ? 5000000 : +stopV;
  const t0 = performance.now();
  sim.running = true; sim.map = map;
  $('#simErr').textContent = '';
  const show = (r, fin) => {
    sim.res = r; renderSim(false);
    let frac = r.done / r.total;
    if (!r.exact && isCI && r.maxCI > 0) frac = Math.max(frac, Math.min(1, (target / r.maxCI) ** 2));
    $('#simProg').style.width = (100 * (fin ? 1 : frac)).toFixed(1) + '%';
    const secs = (performance.now() - t0) / 1000;
    let txt;
    if (r.exact) txt = `Exact enumeration: ${r.done.toLocaleString()} / ${r.total.toLocaleString()} boards`;
    else {
      txt = `Monte Carlo: ${r.done.toLocaleString()} trials · ±${(r.maxCI * 100).toFixed(2)}% (95% CI)` + (isCI ? ` → target ±${(target * 100).toFixed(2)}%` : '') +
        ` · ${Math.round(r.done / Math.max(secs, 1e-3)).toLocaleString()} trials/s`;
      if (mode === 'exact') txt += r.exactPossible ? ' · too many runouts to enumerate' : ' · exact needs every hand fully known';
    }
    $('#simSummary').textContent = txt + ` · ${secs.toFixed(2)}s · low possible ${P(r.boardLow)}` + (fin ? '' : ' …');
    drawConvergence();
  };
  simRunner.run({ cmd: 'equity', players, board: sim.board, dead: sim.dead, trials, mode, targetCI: target }, m => show(m.result, false))
    .then(r => { sim.running = false; show(r, true); })
    .catch(e => { if (e.message !== 'cancelled') $('#simErr').textContent = e.message; });
}
// ---- Monte Carlo convergence chart (one line per seat; color follows the seat) ----
const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300'];
const fmtN = n => n >= 1e6 ? +(n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? +(n / 1e3).toFixed(1) + 'k' : String(n);
function drawConvergence() {
  const box = $('#convChart'), leg = $('#convLegend'), r = sim.res;
  if (!box) return;
  if (!r || r.exact || !r.history || r.history.length < 2) {
    box.innerHTML = `<div class="muted" style="padding:20px 0">${r && r.exact ? 'This run was an exact enumeration: there is no sampling error, so nothing to converge. Set Method to Monte Carlo to watch the estimate converge.' : 'Run a Monte Carlo simulation to see each seat\'s equity estimate converge as trials accumulate.'}</div>`;
    leg.innerHTML = ''; return;
  }
  const H = r.history, seats = sim.map, W = Math.max(320, box.clientWidth || 800), Ht = 260;
  const m = { l: 46, r: seats.length <= 4 ? 92 : 14, t: 10, b: 26 };
  const x0 = Math.log10(H[0].n), x1 = Math.log10(H[H.length - 1].n);
  const bands = $('#convBands').checked, dev = $('#convView').value === 'dev';
  const fin = H[H.length - 1].eq, V = (h, k) => dev ? h.eq[k] - fin[k] : h.eq[k];
  const funnel = H.map(h => Math.max(...h.ci));
  let lo = dev ? 0 : 1, hi = dev ? 0 : 0;
  // y-range: skip the first few very noisy points so the converged part stays readable
  const from = Math.min(H.length - 1, Math.floor(H.length * 0.04));
  H.forEach((h, i) => { if (i < from) return; h.eq.forEach((_, k) => { const c = bands ? h.ci[k] : 0, v = V(h, k); lo = Math.min(lo, v - c); hi = Math.max(hi, v + c); }); if (dev) { lo = Math.min(lo, -funnel[i]); hi = Math.max(hi, funnel[i]); } });
  if (dev) { const a = Math.max(-lo, hi, 0.0025) * 1.1; lo = -a; hi = a; }
  else { const pad = Math.max(0.01, (hi - lo) * 0.08); lo = Math.max(0, lo - pad); hi = Math.min(1, hi + pad); }
  const X = n => m.l + (x1 > x0 ? (Math.log10(n) - x0) / (x1 - x0) : 0) * (W - m.l - m.r);
  const Y = v => m.t + (1 - (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * (Ht - m.t - m.b);
  const span = (hi - lo) * 100, step = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 20].find(x => span / x <= 6) || 25;
  let g = '<g class="grid">';
  for (let v = Math.ceil(lo * 100 / step) * step; v <= hi * 100 + 1e-9; v += step) {
    const y = Y(v / 100).toFixed(1);
    g += `<line x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}"/><text x="${m.l - 6}" y="${+y + 4}" text-anchor="end">${dev && v > 1e-9 ? '+' : ''}${+v.toFixed(2)}${dev ? '' : '%'}</text>`;
  }
  for (let e = Math.floor(x0); e <= Math.ceil(x1); e++) for (const k of [1, 2, 5]) {
    const n = k * 10 ** e, ln = Math.log10(n); if (ln < x0 - 1e-9 || ln > x1 + 1e-9) continue;
    const x = X(n).toFixed(1);
    g += `<text x="${x}" y="${Ht - 6}" text-anchor="middle">${fmtN(n)}</text>`;
    if (k === 1) g += `<line x1="${x}" x2="${x}" y1="${m.t}" y2="${Ht - m.b}"/>`;
  }
  g += '</g>';
  let body = '';
  if (dev) {
    const up = H.map((h, i) => `${X(h.n).toFixed(1)},${Y(funnel[i]).toFixed(1)}`), dn = H.map((h, i) => `${X(h.n).toFixed(1)},${Y(-funnel[i]).toFixed(1)}`).reverse();
    body += `<polygon points="${up.concat(dn).join(' ')}" fill="rgba(255,255,255,.07)" stroke="rgba(255,255,255,.18)" stroke-dasharray="3 3"/>`;
    body += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(0)}" y2="${Y(0)}" stroke="rgba(255,255,255,.3)"/>`;
    body += `<text x="${m.l + 6}" y="${m.t + 12}">pts from final · shaded = widest ±95% CI</text>`;
  }
  seats.forEach((si, k) => {
    const col = SERIES[si];
    if (bands) {
      const up = H.map(h => `${X(h.n).toFixed(1)},${Y(V(h, k) + h.ci[k]).toFixed(1)}`), dn = H.map(h => `${X(h.n).toFixed(1)},${Y(V(h, k) - h.ci[k]).toFixed(1)}`).reverse();
      body += `<polygon points="${up.concat(dn).join(' ')}" fill="${col}" opacity="0.15"/>`;
    }
    body += `<polyline points="${H.map(h => `${X(h.n).toFixed(1)},${Y(V(h, k)).toFixed(1)}`).join(' ')}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  });
  if (seats.length <= 4) {
    const last = H[H.length - 1];
    const lab = seats.map((si, k) => ({ y: Y(V(last, k)), t: `${POS[si]} ${P(last.eq[k])}` })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < lab.length; i++) if (lab[i].y - lab[i - 1].y < 14) lab[i].y = lab[i - 1].y + 14;
    lab.forEach(l => body += `<text class="dlabel" x="${W - m.r + 8}" y="${(l.y + 4).toFixed(1)}">${l.t}</text>`);
  }
  box.innerHTML = `<svg viewBox="0 0 ${W} ${Ht}" height="${Ht}">${g}${body}<line class="xh" y1="${m.t}" y2="${Ht - m.b}" style="display:none"/><g class="dots"></g>
    <rect class="hit" x="${m.l}" y="0" width="${W - m.l - m.r}" height="${Ht}" fill="transparent"/></svg><div class="tip"></div>`;
  leg.innerHTML = seats.map(si => `<span><span class="sw" style="background:${SERIES[si]}"></span>${POS[si]}</span>`).join('');
  const svg = $('svg', box), xh = $('.xh', box), dots = $('.dots', box), tip = $('.tip', box);
  $('.hit', box).addEventListener('mousemove', e => {
    const rect = svg.getBoundingClientRect(), px = (e.clientX - rect.left) * (W / rect.width);
    let bi = 0, bd = Infinity; H.forEach((h, i) => { const d = Math.abs(X(h.n) - px); if (d < bd) { bd = d; bi = i; } });
    const h = H[bi], x = X(h.n);
    xh.setAttribute('x1', x); xh.setAttribute('x2', x); xh.style.display = '';
    dots.innerHTML = seats.map((si, k) => `<circle cx="${x}" cy="${Y(V(h, k))}" r="4.5" fill="${SERIES[si]}" stroke="#171d24" stroke-width="2"/>`).join('');
    tip.innerHTML = `<div class="muted" style="margin-bottom:4px">${h.n.toLocaleString()} trials</div>` + seats.map((si, k) =>
      `<div class="r"><span class="sw" style="background:${SERIES[si]}"></span>${POS[si]}<span>${P(h.eq[k], 2)} ±${(h.ci[k] * 100).toFixed(2)}</span></div>`).join('');
    tip.style.display = 'block';
    const sx = x * rect.width / W;
    tip.style.left = (sx > rect.width / 2 ? sx - tip.offsetWidth - 12 : sx + 12) + 'px'; tip.style.top = '8px';
  });
  $('.hit', box).addEventListener('mouseleave', () => { xh.style.display = 'none'; dots.innerHTML = ''; tip.style.display = 'none'; });
}
function renderSimTable() {
  const t = $('#simTable');
  let h = '<tr><th>Seat</th><th class="l">Hand</th><th>Equity</th><th>Hi win</th><th>Lo win</th><th>Scoop</th><th>Low made</th></tr>';
  if (!sim.res) { t.innerHTML = h + '<tr><td colspan="7" class="muted" style="text-align:left">No results yet — press Run.</td></tr>'; return; }
  sim.map.forEach((i, r) => {
    const p = sim.res.players[r], s = sim.seats[i];
    h += `<tr><td><b>${POS[i]}</b></td><td class="l">${s.cards.length ? handHTML(s.cards, 'sm') : ''}${s.cards.length < 6 ? `<span class="muted"> ${s.cards.length ? '+ ' + (6 - s.cards.length) + ' random' : 'random hand'}</span>` : ''}</td>
      <td><b>${P(p.eq, 2)}</b>${p.ci ? `<span class="muted"> ±${(p.ci * 100).toFixed(2)}</span>` : ''}</td><td>${P(p.hi)}</td><td>${P(p.lo)}</td><td>${P(p.scoop)}</td><td>${P(p.lowMade)}</td></tr>`;
  });
  t.innerHTML = h;
}
document.addEventListener('keydown', e => {
  if (activeSub() === 'sim-table' && e.key === 'Enter' && !e.target.closest('input,select,button')) runSim();
});
buildSeats(); renderSim(); runSim(true);

// =====================================================================
// SIMULATOR — HAND ANALYZER
// =====================================================================
function readAnalyzer() {
  const h = E.parseCards($('#anHand').value), b = E.parseCards($('#anBoard').value);
  let err = h.error || b.error;
  if (!err && h.cards.length !== 6) err = 'Hero hand needs exactly 6 cards';
  if (!err && b.cards.length && (b.cards.length < 3 || b.cards.length > 5)) err = 'Board needs 3–5 cards';
  if (!err && new Set([...h.cards, ...b.cards]).size !== h.cards.length + b.cards.length) err = 'Duplicate card';
  $('#anErr').textContent = err || '';
  $('#anHandView').innerHTML = handHTML(h.cards, 'lg') + (b.cards.length ? '<span style="width:24px"></span>' + handHTML(b.cards) : '');
  return err ? null : { hand: h.cards, board: b.cards };
}
$('#anHand').addEventListener('input', readAnalyzer);
$('#anBoard').addEventListener('input', readAnalyzer);
[$('#anHand'), $('#anBoard')].forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') runAnalyzer(); }));
$('#anRand').onclick = () => { $('#anHand').value = handStr(sortHand(deal(6))); $('#anBoard').value = ''; runAnalyzer(); };
$('#anRun').onclick = () => runAnalyzer();
let anToken = 0;
async function runAnalyzer() {
  const inp = readAnalyzer(); if (!inp) return;
  const tok = ++anToken;
  anRunner.cancel();
  const trials = +$('#anTrials').value;
  const rows = [];
  const draw = () => {
    let h = '<tr><th>Opps</th><th>Players</th><th>Equity</th><th>Fair</th><th>× fair</th><th>Hi win</th><th>Lo win</th><th>Scoop</th><th>Low made</th></tr>';
    for (let n = 1; n <= 5; n++) {
      const r = rows[n];
      if (!r) { h += `<tr><td>${n}</td><td>${n + 1}</td><td colspan="7" class="muted" style="text-align:left">${n === rows.length ? 'running…' : ''}</td></tr>`; continue; }
      const p = r.players[0], fair = 1 / (n + 1);
      h += `<tr><td>${n}</td><td>${n + 1}</td><td><b>${P(p.eq)}</b><span class="muted"> ±${(p.ci * 100).toFixed(1)}</span></td><td>${P(fair)}</td><td>${(p.eq / fair).toFixed(2)}×</td><td>${P(p.hi)}</td><td>${P(p.lo)}</td><td>${P(p.scoop)}</td><td>${P(p.lowMade)}</td></tr>`;
    }
    $('#anTable').innerHTML = h;
  };
  rows.length = 1; draw();
  $('#anFeat').innerHTML = featureChips(inp.hand);
  renderVerdict(inp.hand, inp.board, tok);
  for (let n = 1; n <= 5; n++) {
    const players = [{ cards: inp.hand }]; for (let k = 0; k < n; k++) players.push({ cards: [] });
    let r;
    try { r = await anRunner.run({ cmd: 'equity', players, board: inp.board, trials, heroStats: n === 1 }); }
    catch (e) { return; }
    if (tok !== anToken) return;
    rows[n] = r; rows.length = n + 1; draw();
    if (n === 1) drawCats(r);
  }
}
function drawCats(r) {
  const max = Math.max(...r.heroCats);
  $('#anCats').innerHTML = E.CATS.map((c, i) => {
    const v = r.heroCats[i];
    return `<div class="hbar" title="${c}: ${P(v, 2)} of runouts"><span>${c}</span><div class="track"><div class="fill" style="width:${max ? (v / max * 100).toFixed(1) : 0}%"></div></div><span class="v">${P(v)}</span></div>`;
  }).join('');
  const p = r.players[0];
  $('#anLow').innerHTML = `<div><b>${P(p.lowMade)}</b><span class="muted">makes a low</span></div><div><b>${P(r.heroNutLow)}</b><span class="muted">makes the nut low</span></div><div><b>${P(r.boardLow)}</b><span class="muted">board allows a low</span></div>`;
}
async function renderVerdict(hand, board, tok) {
  $('#anVerdict').innerHTML = '<span class="muted">Simulating hand rank…</span>';
  let rk; try { rk = await simRank(hand); } catch (e) { return; }
  if (tok !== anToken) return;
  const spots = [];
  ['UTG', 'HJ', 'CO', 'BTN', 'SB'].forEach(p => spots.push({ type: 'rfi', hero: p, label: p + ' first in' }));
  [['BTN', 'CO'], ['BTN', 'UTG'], ['SB', 'BTN'], ['BB', 'BTN'], ['BB', 'CO'], ['BB', 'UTG'], ['BB', 'SB']].forEach(([h, o]) => spots.push({ type: 'vsopen', hero: h, opener: o, label: `${h} vs ${o} open` }));
  [['CO', 'BTN'], ['BTN', 'BB'], ['UTG', 'BTN']].forEach(([h, v]) => spots.push({ type: 'vs3', hero: h, villain: v, label: `${h} open, ${v} 3-bets` }));
  let h = `<div style="margin-bottom:8px"><span class="big">Better than ${rk.better.toFixed(1)}%</span> <span class="muted">of 6-card hands · top ${rk.top.toFixed(1)}%</span>
    <div class="note" style="margin-top:2px">Simulated: ${P(rk.eq)} pot share 3-way vs 2 hands from the top ${MODEL.play}%, ranked against ${MODEL.hands.toLocaleString()} simulated hands.</div></div>`;
  if (board.length) h += '<div class="note">Preflop verdict ignores the board.</div>';
  h += '<table class="data"><tr><th>Spot</th><th>Action</th><th>Range boundaries</th></tr>';
  for (const s of spots) {
    if (s.type === 'vs3' && rk.top > CFG.rfi[s.hero]) { h += `<tr><td>${s.label}</td><td class="muted">not in open range</td><td></td></tr>`; continue; }
    const g = gradeRange(s, rk.top);
    const lab = [...g.ok].map(a => g.acts.find(x => x.a === a).label).join(' / ');
    h += `<tr><td>${s.label}</td><td><b>${lab}</b>${g.mixed ? ' <span class="muted">(mixed)</span>' : ''}</td><td class="muted">${g.acts.slice(0, -1).filter(x => x.top >= 0.05).map(x => x.label + ' top ' + x.top.toFixed(1) + '%').join(' · ') || 'never'}</td></tr>`;
  }
  $('#anVerdict').innerHTML = h + '</table><div class="note">Uses the trainer\'s range settings (Trainer → Preflop → Ranges &amp; EV model).</div>';
}
readAnalyzer();

// =====================================================================
// TRAINER — STATS STORE
// =====================================================================
const STATS_KEY = 'plo6hl_stats_v1';
const freshStats = () => ({ pre: { n: 0, ok: 0, byPos: {}, byType: {}, best: 0, mist: [] }, eq: { n: 0, err: 0, pts: 0, within5: 0 }, sd: { n: 0, ok: 0, hiOk: 0, loOk: 0 } });
let ST = Object.assign(freshStats(), store.get(STATS_KEY, {}));
const saveStats = () => store.set(STATS_KEY, ST);
const sess = { pre: { n: 0, ok: 0, streak: 0, pl: 0, hands: 0 }, post: { n: 0, ok: 0 }, eq: { n: 0, err: 0, pts: 0 }, sd: { n: 0, ok: 0, streak: 0 } };
const bump = (o, k, ok) => { o[k] = o[k] || { n: 0, ok: 0 }; o[k].n++; if (ok) o[k].ok++; };

// =====================================================================
// TRAINER — PREFLOP
// =====================================================================
const TYPE_NAMES = { rfi: 'Raise first in', vsopen: 'Facing an open', vs3: 'Facing a 3-bet' };
$('#prePosF').innerHTML = POS.map(p => `<label><input type="checkbox" class="prePos" value="${p}" checked> ${p}</label>`).join('');
let pre = null;
function genSpot() {
  const types = $$('.preType:checked').map(x => x.value);
  const poss = new Set($$('.prePos:checked').map(x => x.value));
  const cands = [];
  for (const ty of (types.length ? types : ['rfi'])) {
    if (ty === 'rfi') ['UTG', 'HJ', 'CO', 'BTN', 'SB'].forEach(h => cands.push({ type: 'rfi', hero: h }));
    if (ty === 'vsopen') ['UTG', 'HJ', 'CO', 'BTN', 'SB'].forEach((o, oi) => POS.slice(oi + 1).forEach(h => cands.push({ type: 'vsopen', opener: o, hero: h })));
    if (ty === 'vs3') ['UTG', 'HJ', 'CO', 'BTN', 'SB'].forEach((h, hi) => POS.slice(hi + 1).forEach(v => cands.push({ type: 'vs3', hero: h, villain: v })));
  }
  let pool = cands.filter(c => poss.has(c.hero));
  if (!pool.length) pool = cands;
  const byType = {}; pool.forEach(c => (byType[c.type] = byType[c.type] || []).push(c));
  return pick(byType[pick(Object.keys(byType))]);
}
function genHand(spot) {
  // fast model rank is only used to pick candidate hands; grading uses a fresh simulation
  const acts = spotActions(spot);
  const maxTop = spot.type === 'vs3' ? CFG.rfi[spot.hero] : 100;
  const border = $('#preBorder').checked && Math.random() < 0.7;
  const bounds = acts.slice(0, -1).map(a => a.top).filter(b => b <= maxTop + 1e-9);
  const B = bounds.length ? pick(bounds) : null;
  if (E.hasReal()) { // pick by real-equity rank directly
    const lo = border && B != null ? Math.max(0, B - Math.max(1.5, B * 0.3)) : 0, hi = border && B != null ? Math.min(maxTop, B + Math.max(1.5, B * 0.3)) : maxTop;
    const r = E.sampleReal(lo, Math.max(lo + 0.05, hi), []); if (r) return sortHand(r.cards);
  }
  for (let tries = 0; tries < 8000; tries++) {
    const h = deal(6), t = modelTop(h);
    if (t > maxTop) continue;
    if (border && B != null && Math.abs(t - B) > Math.max(1.5, B * 0.3)) continue;
    return sortHand(h);
  }
  return sortHand(deal(6));
}
/*TABLE*/
function drawPreSession() {
  const s = sess.pre;
  const po = sess.post, pl = s.pl;
  $('#preSession').innerHTML = `<div><b>${s.n ? Math.round(100 * s.ok / s.n) : 0}%</b><span class="muted">preflop (${s.ok}/${s.n})</span></div>
    <div><b>${po.n ? Math.round(100 * po.ok / po.n) + '%' : '–'}</b><span class="muted">later streets (${po.ok}/${po.n})</span></div>
    <div><b style="color:${Math.round(pl * 10) > 0 ? '#7fd9a6' : Math.round(pl * 10) < 0 ? '#f2a19c' : 'inherit'}">${Math.round(pl * 10) >= 0 ? '+' : '−'}${Math.abs(pl).toFixed(1)}</b><span class="muted">bb over ${s.hands} hands</span></div>
    <div><b>${s.streak}</b><span class="muted">streak (best ${ST.pre.best})</span></div>`;
}
// ---------- range & EV settings form ----------
const CFG_FIELDS = [
  ['Opening ranges (% of all hands)'],
  ['rfi.UTG', 'UTG open', 1, 60, 0.5], ['rfi.HJ', 'HJ open', 1, 60, 0.5], ['rfi.CO', 'CO open', 1, 70, 0.5], ['rfi.BTN', 'BTN open', 1, 80, 0.5],
  ['rfi.SB', 'SB raise', 1, 80, 0.5], ['sbComplete', 'SB raise + complete', 1, 100, 0.5],
  ['Facing an open / a 3-bet (scale the solved tables)'],
  ['tbScale', '3-bet range ×', 0, 3, 0.05], ['callScale', 'Flat-call range ×', 0, 3, 0.05], ['fbScale', '4-bet range ×', 0, 3, 0.05], ['call3Scale', 'Call-a-3-bet range ×', 0, 3, 0.05],
  ['EV model'],
  ['realIP', 'Equity realized in position', 0.3, 1.3, 0.05], ['realOOP', 'Equity realized out of position', 0.3, 1.3, 0.05], ['realOOP3', 'Realized out of position in 3-bet pots', 0.3, 1.3, 0.05],
  ['playSpread', 'Playability spread (best vs worst hands)', 0, 1, 0.05],
  ['rakePct', 'Rake % (pots that see a flop)', 0, 10, 0.5], ['rakeCap', 'Rake cap (bb)', 0, 10, 0.5],
  ['bbIso', 'BB raises vs SB limp (%)', 0, 60, 1], ['foldTo4', 'Villain folds to a 4-bet (share of 3-bet range)', 0, 1, 0.05],
];
const cfgGet = k => k.split('.').reduce((o, x) => o[x], CFG);
const cfgSet = (k, v) => { const ks = k.split('.'); const last = ks.pop(); ks.reduce((o, x) => o[x], CFG)[last] = v; };
function buildCfgForm() {
  $('#cfgForm').innerHTML = CFG_FIELDS.map(f => f.length === 1 ? `<h4>${f[0]}</h4>` :
    `<label class="cfg"><span>${f[1]}</span><input type="number" data-k="${f[0]}" min="${f[2]}" max="${f[3]}" step="${f[4]}" value="${cfgGet(f[0])}"></label>`).join('') +
    '<div class="row section"><button class="btn sm" id="cfgReset">Reset to defaults</button></div>';
  $$('#cfgForm input').forEach(i => i.onchange = () => {
    const f = CFG_FIELDS.find(x => x[0] === i.dataset.k), v = Math.max(f[2], Math.min(f[3], +i.value || 0));
    i.value = v; cfgSet(i.dataset.k, v); saveCfg(); nextPre();
  });
  $('#cfgReset').onclick = () => { CFG = JSON.parse(JSON.stringify(CFG_DEFAULT)); store.set(CFG_KEY, {}); buildCfgForm(); $('#gradeBy').value = CFG.gradeBy; nextPre(); };
}
buildCfgForm();
$('#adjType').checked = CFG.adjustForType !== false;
$('#adjType').onchange = e => { CFG.adjustForType = e.target.checked; saveCfg(); nextPre(); };
$('#gradeBy').value = CFG.gradeBy;
$('#gradeBy').onchange = e => { CFG.gradeBy = e.target.value; saveCfg(); nextPre(); };
$$('.preType, .prePos').forEach(x => x.onchange = () => nextPre());
drawPreSession();

// =====================================================================
// TRAINER — STATS & CHARTS
// =====================================================================
function renderStats() {
  const p = ST.pre, e = ST.eq, s = ST.sd;
  $('#statCards').innerHTML = `
    <div class="panel"><div class="muted">Preflop ranges</div><div class="big">${p.n ? Math.round(100 * p.ok / p.n) : 0}%</div><div class="ink2">${p.ok} / ${p.n} correct · best streak ${p.best}</div></div>
    <div class="panel"><div class="muted">Hands played out</div><div class="big" style="color:${(p.pl || 0) >= 0 ? '#7fd9a6' : '#f2a19c'}">${(p.pl || 0) >= 0 ? '+' : '−'}${Math.abs(p.pl || 0).toFixed(1)} bb</div><div class="ink2">${p.hands || 0} hands · ${(p.hands ? (100 * (p.pl || 0) / p.hands).toFixed(1) : '0.0')} bb/100 · later-street decisions ${ST.post && ST.post.n ? Math.round(100 * ST.post.ok / ST.post.n) + '%' : '–'}</div></div>
    <div class="panel"><div class="muted">Equity guessing</div><div class="big">${e.n ? (e.err / e.n).toFixed(1) : '–'}</div><div class="ink2">avg error over ${e.n} guesses · ${e.n ? Math.round(100 * e.within5 / e.n) : 0}% within 5 pts</div></div>
    <div class="panel"><div class="muted">Showdown reading</div><div class="big">${s.n ? Math.round(100 * s.ok / s.n) : 0}%</div><div class="ink2">${s.n} hands · high ${s.n ? Math.round(100 * s.hiOk / s.n) : 0}% · low ${s.n ? Math.round(100 * s.loOk / s.n) : 0}%</div></div>`;
  const tbl = (o, keys, name) => '<tr><th>' + name + '</th><th>Hands</th><th>Accuracy</th></tr>' + keys.map(k => { const v = o[k]; return `<tr><td>${TYPE_NAMES[k] || k}</td><td>${v ? v.n : 0}</td><td>${v && v.n ? Math.round(100 * v.ok / v.n) + '%' : '–'}</td></tr>`; }).join('');
  $('#stPos').innerHTML = tbl(p.byPos, POS, 'Position');
  $('#stType').innerHTML = tbl(p.byType, ['rfi', 'vsopen', 'vs3'], 'Spot');
  $('#stMist').innerHTML = p.mist.length ? p.mist.map(m => `<div class="handrow" style="margin:0"><div>${handHTML(sortHand(E.parseCards(m.hand).cards), 'sm')}</div>
    <div style="font-size:12px"><b>${m.spot}</b><br><span class="muted">You: ${m.you} · Correct: ${m.right} · better than ${(100 - m.top).toFixed(1)}% (top ${m.top}%)</span></div></div>`).join('') : '<span class="muted">No mistakes recorded yet.</span>';
  let h = '<tr><th>Spot</th><th>Raise / 3-bet / 4-bet</th><th>Call / complete</th><th>Continue total</th><th>Fold</th></tr>';
  const row = (lab, s) => { const a = spotActions(s); const r = a[0].top, c = a.length > 2 ? a[1].top - r : 0, tot = a.length > 2 ? a[1].top : r; const base = s.type === 'vs3' ? CFG.rfi[s.hero] : 100; return `<tr><td>${lab}</td><td>${r.toFixed(1)}%</td><td>${c ? c.toFixed(1) + '%' : '–'}</td><td>${tot.toFixed(1)}%</td><td>${(base - tot).toFixed(1)}%${s.type === 'vs3' ? ` <span class="muted">(${(100 * (base - tot) / base).toFixed(0)}% of opens)</span>` : ''}</td></tr>`; };
  ['UTG', 'HJ', 'CO', 'BTN', 'SB'].forEach(x => h += row(`${x} raise first in`, { type: 'rfi', hero: x }));
  PAIRS.forEach(([o, x]) => h += row(`${x} vs ${o} open`, { type: 'vsopen', opener: o, hero: x }));
  PAIRS.forEach(([x, v]) => h += row(`${x} open vs ${v} 3-bet (share of all hands)`, { type: 'vs3', hero: x, villain: v }));
  $('#stChart').innerHTML = h;
  const BP = typeof PLO6_BOTPOLICY !== 'undefined' ? PLO6_BOTPOLICY : null, sp = $('#stSelfplay');
  if (!BP) sp.innerHTML = '<span class="muted">No self-play run embedded yet.</span>';
  else {
    const sgn = x => (x >= 0 ? '+' : '') + x.toFixed(2);
    const hyp = list => (list || []).map(x => `<tr><td class="l">${x.name}</td><td>${x.street}.${x.key} ${x.from} → ${x.to}</td><td><b>${sgn(x.bb100)}</b> ± ${x.se100.toFixed(2)}</td><td>${x.z.toFixed(1)}</td></tr>`).join('');
    const KEYN = { vb: 'value-bet margin', big: 'big-value margin', thin: 'thin bet size', bomb: 'bomb at scoop ≥', bluff: 'bluff frequency', slack: 'call slack', sizeAdj: 'bet-size respect', raiseM: 'raise margin', raiseSc: 'raise at scoop ≥', swing: 'equity-swing trigger', swingVb: 'thinner after a swing', swingSize: 'bet size after a swing', swingRaise: 'raise more after a swing', initVb: 'thinner with initiative', bigSize: 'big-value bet size', bluffSize: 'bluff size', bluffMax: 'bluff below edge', huVb: 'heads-up thinner value', huAdj: 'heads-up call tax', braise: 'heads-up bluff-raise frequency', trap: 'heads-up trap frequency', stab: 'stab frequency', stabLo: 'stab down to edge' };
    const prev = BP.previous, fin = (BP.rounds || []).length ? Object.assign({}, BP.rounds[0].final.vsOriginalTable, { baseline: `round-${BP.rounds[0].n - 1} bot` }) : BP.final && BP.final.vsOriginalTable;
    const RS0 = BP.rounds || [], nChanges = (BP.history || []).length + RS0.reduce((a, R) => a + (R.history || []).length, 0), nDeals = (BP.deals || 0) + RS0.reduce((a, R) => a + (R.deals || 0), 0), lastN = RS0.length ? RS0[0].n : 5;
    const spotsTbl = S => S ? `<table class="data"><tr><th class="l">Spot</th><th>Usually</th><th>Better</th><th>bb/100 lost</th><th>z</th></tr>${S.top.slice(0, 10).map(x => `<tr><td class="l">${x.cat}</td><td>${x.usual}</td><td>${x.best}</td><td>${x.bb100.toFixed(2)}</td><td>${x.z.toFixed(1)}</td></tr>`).join('')}</table><div class="note">${S.hands.toLocaleString()} hands, ${S.decisions.toLocaleString()} decisions replayed with every alternative; significant leaks total ${S.totalSignificantLeak} bb/100.</div>` : '';
    const roundHTML = R => { const ROB = R.robustness, prevN = R.n - 1;
      const robRow = r => `<tr><td class="l">${r.label}</td>${Object.keys(ROB.cols).map(k => r.vals[k] ? `<td><b>${sgn(r.vals[k][0])}</b> <span class="muted">± ${r.vals[k][1].toFixed(1)}</span></td>` : '<td></td>').join('')}</tr>`;
      return `<h3 class="section">Round ${R.n} (${(R.history || []).length} changes, ${sgn(R.final.vsOriginalTable.bb100)} ± ${R.final.vsOriginalTable.se100.toFixed(2)} bb/100 vs round ${prevN}, ${((R.deals || 0) / 1e6).toFixed(1)}M hands)</h3>
      ${ROUND_NOTES[R.n] ? `<div class="note">${ROUND_NOTES[R.n]}</div>` : ''}
      <table class="data"><tr><th class="l">Change kept</th><th>From → to</th><th>Gain bb/100</th><th>z</th></tr>${(R.history || []).map(x => `<tr><td class="l">${x.key === 'guided' ? x.name : x.street + ' ' + (KEYN[x.key] || x.key)}</td><td>${x.key === 'guided' ? 'strategy jump' : x.from + ' → ' + x.to}</td><td><b>${sgn(x.bb100)}</b> ± ${x.se100.toFixed(2)}</td><td>${x.z.toFixed(1)}</td></tr>`).join('')}</table>
      ${ROB ? `<h3 class="section">Round ${R.n} robustness: bb/100 gained in the same seat, by table type</h3><table class="data"><tr><th class="l">Comparison</th>${Object.values(ROB.cols).map(t => `<th>${t}</th>`).join('')}</tr>${ROB.rows.map(robRow).join('')}</table><div class="note">${ROB.note}.</div>` : ''}
      ${R.spots ? `<h3 class="section">Problem spots in the round-${prevN} bot (what round ${R.n} tested)</h3>${spotsTbl(R.spots)}` : ''}`; };
    const ROUND_NOTES = { 6: 'Retuned after the rules fixes: rake comes only out of called pots, side pots are exact, and self-play bots rank preflop hands exactly as the trainer\'s bots do. Spot-scan ideas that lost as whole strategies (turn value-raises −9 to −12, turn bluff-raises −2 to −9, turn pot-size bets −2) were rejected.',
      7: 'New move: the stab: bet pot when checked to and only slightly behind, heads-up or multiway.',
      8: 'Tested counters to the stab (raising flop bets, re-steals, calling wider): all lost against the mixed population (−4 to −11 bb/100) and were rejected. Kept: stab a little more, fold a little more to flop bets, raise river bets a little less.',
      9: 'Preflop: every chart width (opening ranges, SB complete, BB iso-raise, calls and 3-bets vs opens, blind 3-bets, 4-bets and calls vs 3-bets) tested by self-play with the round-8 postflop bot. The solver charts held up everywhere except one spot: the blinds should 3-bet their top ~10% vs opens (the solver never 3-bet from the blinds). Blind 3-bets of 7% / 14% / 18% were worse or level. These tuned charts are now the trainer\'s preflop charts.' };
    const RS = BP.rounds || [], R6 = RS.length ? RS[0] : null;
    const r6html = RS.length ? RS.map(roundHTML).join('') + '<h3 class="section">Rounds 2–5</h3>' : '';
    sp.innerHTML = `<div class="statline" style="margin-bottom:10px"><div><b>${fin ? sgn(fin.bb100) + ' bb/100' : 'running…'}</b><span class="muted">tuned bot vs ${fin && fin.baseline ? fin.baseline : 'original'}${fin ? ` (± ${fin.se100.toFixed(2)}, ${fin.deals.toLocaleString()} duplicate deals)` : ''}</span></div>
      <div><b>${nChanges}</b><span class="muted">${RS0.length ? `changes kept, rounds 2–${lastN}` : prev ? 'round-2 changes' : 'leaks plugged'}</span></div><div><b>${(nDeals / 1e6).toFixed(1)}M</b><span class="muted">hands simulated (rounds 2–${lastN})</span></div><div><b>${(BP.sweeps || 0) + RS0.reduce((a, R) => a + (R.sweeps || 0), 0)}</b><span class="muted">sweeps</span></div></div>
      ${r6html}<table class="data"><tr><th class="l">Change kept</th><th>From → to</th><th>Gain bb/100</th><th>z</th></tr>${(BP.history || []).map(x => `<tr><td class="l">${x.key === 'guided' ? x.name : x.street + ' ' + (KEYN[x.key] || x.key)}</td><td>${x.key === 'guided' ? 'strategy jump' : x.from + ' → ' + x.to}</td><td><b>${sgn(x.bb100)}</b> ± ${x.se100.toFixed(2)}</td><td>${x.z.toFixed(1)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted l">none yet</td></tr>'}</table>
      ${prev ? `<h3 class="section">Round 1: leaks plugged (${(prev.history || []).length} changes, ${prev.final && prev.final.vsOriginalTable ? sgn(prev.final.vsOriginalTable.bb100) + ' bb/100 vs the original bot' : ''})</h3>
      <table class="data"><tr><th class="l">Change kept</th><th>From → to</th><th>Gain bb/100</th><th>z</th></tr>${(prev.history || []).map(x => `<tr><td class="l">${x.street} ${KEYN[x.key] || x.key}</td><td>${x.from} → ${x.to}</td><td><b>${sgn(x.bb100)}</b> ± ${x.se100.toFixed(2)}</td><td>${x.z.toFixed(1)}</td></tr>`).join('')}</table>` : ''}
      ${BP.spotsBefore ? `<h3 class="section">Problem spots before round 2</h3>${spotsTbl(BP.spotsBefore)}` : ''}
      ${BP.spotsAfter ? `<h3 class="section">Problem spots after round 3</h3>${spotsTbl(BP.spotsAfter)}` : ''}
      <h3 class="section">Your hypotheses (thin value, scoop bombs)</h3>
      <table class="data"><tr><th class="l">Test</th><th>Change</th><th>bb/100 vs current</th><th>z</th></tr>${hyp(BP.hypothesesEnd || BP.hypothesesStart)}${hyp(BP.exploits && BP.exploits.vsStations)}</table>
      <div class="note">${BP.hypothesesEnd ? 'Measured against the final tuned bot.' : 'Measured against the starting bot.'} Each row is a duplicate-deal comparison (same cards, same randomness) of one seat changing a single setting.</div>`;
  }
  $('#stModel').textContent = `Hand rank = simulated pot share 3-way vs 2 hands from the top ${MODEL.play}% (60k runouts per hand), compared with a table of ${MODEL.hands.toLocaleString()} random hands × ${MODEL.trials.toLocaleString()} runouts. Opponent ranges are sampled with a ${E.FEAT_NAMES.length}-feature model fit to the same metric (R² ${MODEL.r2.toFixed(3)}). Range sizes come from the Ranges & EV settings.`;
}
// two-tap reset (no confirm() dialog: it is blocked on hosted pages and awkward on phones)
let resetArmed = null;
$('#resetStats').onclick = () => {
  const b = $('#resetStats');
  if (!resetArmed) { b.dataset.label = b.dataset.label || b.textContent; b.textContent = 'Tap again to reset all stats'; resetArmed = setTimeout(() => { resetArmed = null; b.textContent = b.dataset.label; }, 3000); return; }
  clearTimeout(resetArmed); resetArmed = null; b.textContent = b.dataset.label; ST = freshStats(); saveStats(); renderStats();
};

// ---------- keyboard for trainer ----------
document.addEventListener('keydown', e => {
  if (e.target.closest('input[type=text],select') || e.metaKey || e.ctrlKey || e.altKey) return;
  const sub = activeSub(), k = e.key.toLowerCase();
  if (sub === 'tr-pre') {
    if (RV) { // reviewing a hand
      if (k === 'arrowleft') { e.preventDefault(); stepReview(-1); } else if (k === 'arrowright') { e.preventDefault(); stepReview(1); }
      else if (k === 'home') stepReview(-1e6); else if (k === 'end') stepReview(1e6);
      else if (k === 'p') togglePlay(); else if (k === ' ' || k === 'escape') { e.preventDefault(); exitReview(); }
      return;
    }
    if (H && H.over && k === 'arrowleft') { e.preventDefault(); startReview(H, H.snaps.length - 2); return; }
    if (H && H.over && k === 'p') { startReview(H, 0, true); return; }
    if (k === ' ') { e.preventDefault(); if (!H || H.over || H.heroFolded) nextPre(); }
    else if (k === 'n') nextPre();
    else if (H && H.heroTurn) { const i = H.opts.findIndex(o => o.key.toLowerCase() === k); if (i >= 0) heroChoose(i); }
  } else if (sub === 'tr-eq') {
    const sl = $('#eqSlider');
    if (k === 'enter') { e.preventDefault(); submitEq(); }
    else if (k === ' ') { e.preventDefault(); nextEq(); }
    else if (k === 'arrowleft' || k === 'arrowright') { if (e.target === sl) return; e.preventDefault(); sl.value = +sl.value + (k === 'arrowright' ? 1 : -1) * (e.shiftKey ? 5 : 1); sl.oninput({ target: sl }); }
  } else if (sub === 'tr-sd') {
    if (k === 'enter') { e.preventDefault(); submitSd(); }
    else if (k === ' ') { e.preventDefault(); nextSd(); }
    else if (k === 'n') { toggleNoLow(); }
    else {
      const m = /^(?:Digit|Numpad)([1-6])$/.exec(e.code);
      if (m) toggleSd(+m[1] - 1, e.shiftKey ? 'lo' : 'hi');
    }
  }
});

// ---------- boot trainer ----------
nextPre();
window.__plo6 = { evRun, simRank, spotActions, gradeRange, gradeEV, CFG: () => CFG, E, get H() { return H; }, get RV() { return RV; }, HANDS, potOf, ensureCands, narrowRange, heroCoach, liveCands, PROFILES, spotActionsFor };
nextEq(); drawEqSession();
nextSd(); drawSdSession();
})();
