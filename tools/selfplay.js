// Headless 6-max PLO6 hi/lo self-play with a parameterized postflop policy.
// Used by tools/optimize.js (leak plugging) — and its policy mirrors botPolicy() in src/hand.js.
const vm = require('vm'), fs = require('fs'), path = require('path');
const ENGINE = require('../src/engine.js');
const ROOT = path.join(__dirname, '..');
const POS = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'], POST = ['SB', 'BB', 'UTG', 'HJ', 'CO', 'BTN'];
const STREETS = ['flop', 'turn', 'river'];

// ---------- seeded randomness (common random numbers for paired comparisons) ----------
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const hash = (...xs) => xs.reduce((h, x) => Math.imul(h ^ (x | 0), 2654435761) ^ (h >>> 13), 0x9e3779b9) >>> 0;
let _rng = mulberry32(1);
Math.random = () => _rng();
const reseed = (...xs) => { _rng = mulberry32(hash(...xs)); };

// ---------- engine + strategy tables ----------
const E = ENGINE();
E.setRealPool(new Uint8Array(fs.readFileSync(path.join(ROOT, 'data/realpool.bin'))));
const ctx = {}; Object.assign(ctx, { E, POS, P: (x, d = 1) => (x * 100).toFixed(d) + '%', PLO6_MODEL: JSON.parse(fs.readFileSync(path.join(ROOT, 'data/model.json'))),
  PLO6_RANGES: JSON.parse(fs.readFileSync(path.join(ROOT, fs.existsSync(path.join(ROOT, 'data/ranges.solver.json')) ? 'data/ranges.solver.json' : 'data/ranges.json'))), /* base charts; tuned widths (theta.pre) apply on top */ store: { get: (k, d) => d, set() {} },
  handStr: cs => cs.map(E.cardStr).join(''), sortHand: cs => cs.slice().sort((a, b) => (b >> 2) - (a >> 2) || (a & 3) - (b & 3)), trainRunner: null });
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/strategy.js'), 'utf8') + '\nglobalThis.__S={get CFG(){return CFG}, vsOpenOf, vs3Of, modelTop};', ctx);
const S = ctx.__S, CFG = S.CFG;

// ---------- policy parameters ----------
// per street: vb = value-bet margin over fair share; big = margin for a 2/3-pot bet; thin = size of thin value bets (fraction of pot);
// bomb = scoop probability that triggers a pot-size bet; bluff = bluff frequency (heads-up, weak hands);
// slack = how far below the required equity you still call; sizeAdj = extra equity demanded per unit of bet/pot;
// raiseM = margin over required equity to raise; raiseSc = scoop probability that triggers a raise.
const KEYS = ['vb', 'big', 'thin', 'bomb', 'bluff', 'slack', 'sizeAdj', 'raiseM', 'raiseSc', 'swing', 'swingVb', 'swingSize', 'swingRaise', 'initVb', 'bigSize', 'bluffSize', 'bluffMax', 'huVb', 'huAdj', 'braise', 'trap', 'stab', 'stabLo'];
// stab = chance to bet pot when checked to with an edge in [stabLo, value line) — heads-up or multiway (round 7).
// braise = heads-up bluff-raise frequency when facing a bet and behind; trap = heads-up chance to check a big hand (to induce bluffs).
// swing = edge gain since last street that counts as 'equity swung our way'; swingVb / swingRaise = how much thinner we bet / raise then;
// swingSize = bet size then; initVb = how much thinner we keep betting when we hold the initiative (were last street's aggressor).
// bigSize = bet size when well ahead; bluffSize / bluffMax = bluff size and the edge below which we may bluff (heads-up);
// huVb = how much thinner we value-bet heads-up; huAdj = extra equity we demand to call a bet heads-up.
const NEUTRAL = { swing: 0.10, swingVb: 0, swingSize: 0.66, swingRaise: 0, initVb: 0, bigSize: 0.66, bluffSize: 0.6, bluffMax: -0.05, huVb: 0, huAdj: 0, braise: 0, trap: 0, stab: 0, stabLo: -0.10 };
const BOUNDS = { vb: [-0.05, 0.4], big: [0, 0.5], thin: [0.2, 0.8], bomb: [0.2, 1.01], bluff: [0, 0.5], slack: [-0.15, 0.15], sizeAdj: [0, 1.5], raiseM: [0, 0.6], raiseSc: [0.3, 1.01], swing: [0.02, 0.3], swingVb: [0, 0.25], swingSize: [0.33, 1], swingRaise: [0, 0.3], initVb: [0, 0.2], bigSize: [0.25, 1], bluffSize: [0.25, 1], bluffMax: [-0.3, 0.05], huVb: [-0.1, 0.2], huAdj: [-0.1, 0.25], braise: [0, 0.5], trap: [0, 0.6], stab: [0, 0.6], stabLo: [-0.3, 0.05] };
for (const k of ['rfiUTG', 'rfiHJ', 'rfiCO', 'rfiBTN', 'rfiSB', 'sbc', 'iso', 'tbIP', 'ctIP', 'ctSB', 'ctBB', 'fb', 'cb']) BOUNDS[k] = [0.4, 2.5];
BOUNDS.tbBlind = [0, 20];
// starting point = the current app heuristic translated into these terms (equity margins over fair share, no scoop logic)
const BASELINE = {
  flop: { vb: 0.18, big: 0.18, thin: 0.66, bomb: 1.01, bluff: 0.08, slack: 0.03, sizeAdj: 0, raiseM: 0.30, raiseSc: 1.01 },
  turn: { vb: 0.18, big: 0.18, thin: 0.66, bomb: 1.01, bluff: 0.08, slack: 0.03, sizeAdj: 0, raiseM: 0.30, raiseSc: 1.01 },
  river: { vb: 0.18, big: 0.18, thin: 0.66, bomb: 1.01, bluff: 0.08, slack: 0.03, sizeAdj: 0, raiseM: 0.30, raiseSc: 1.01 },
};
const clone = o => JSON.parse(JSON.stringify(o));
const withNeutral = th => { const t = clone(th); for (const st of STREETS) t[st] = Object.assign({}, NEUTRAL, t[st]); if (t.pre) t.pre = Object.assign({}, PRE_NEUTRAL_(), t.pre); return t; };
const PRE_NEUTRAL_ = () => ({ rfiUTG: 1, rfiHJ: 1, rfiCO: 1, rfiBTN: 1, rfiSB: 1, sbc: 1, iso: 1, tbIP: 1, ctIP: 1, tbBlind: 0, ctSB: 1, ctBB: 1, fb: 1, cb: 1 });
for (const st of STREETS) Object.assign(BASELINE[st], NEUTRAL, BASELINE[st]);

// ---------- headless hand engine ----------
const RAKE = { pct: 0.05, cap: 2 }; // same defaults as the app (CFG.rakePct / rakeCap)
const potOf = h => h.P.reduce((a, p) => a + p.contrib, 0);
function legal(h, i) {
  const pl = h.P[i], pot = potOf(h), toCall = Math.max(0, Math.min(h.bet - pl.sb, pl.stack));
  return { toCall, canCheck: toCall < 1e-9, canRaise: pl.stack > toCall + 1e-9 && !(pl.acted && h.shortRaise), pot,
    maxTo: Math.min(pl.sb + pl.stack, h.bet + pot + (h.bet - pl.sb)), minTo: Math.min(pl.sb + pl.stack, h.bet + Math.max(h.lastRaise, 1)) };
}
function put(h, i, amt) { const pl = h.P[i]; amt = Math.min(amt, pl.stack); pl.stack -= amt; pl.contrib += amt; pl.sb += amt; if (pl.stack < 1e-9) { pl.stack = 0; pl.allin = true; } }
function act(h, i, a, to, stats) {
  const pl = h.P[i], L = legal(h, i);
  if (a === 'raise' && (!L.canRaise || Math.min(L.maxTo, to) <= h.bet + 1e-9)) a = L.canCheck ? 'check' : 'call';
  if (a === 'fold') pl.folded = true;
  else if (a === 'call') put(h, i, L.toCall);
  else if (a === 'raise') {
    to = Math.max(L.minTo, Math.min(L.maxTo, to));
    const lvl = h.fullBet ?? h.bet, full = h.bet < 1e-9 || to - lvl >= h.lastRaise - 1e-9; // short all-ins don't reopen the action (unless they add up to a full raise)
    if (full) { h.lastRaise = Math.max(h.lastRaise, to - lvl); h.fullBet = to; h.shortRaise = false; h.P.forEach((q, j) => { if (j !== i) q.acted = false; }); } else h.shortRaise = true;
    h.bet = to; put(h, i, to - pl.sb);
    h.raises++; h.aggr = i; if (h.street === 'pre' && h.raises === 1) h.opener = i;
  }
  pl.acted = true;
  if (stats) stats(h, i, a, L);
}
function nextToAct(h, from) {
  const order = h.street === 'pre' ? POS : POST, i0 = order.indexOf(POS[from]);
  for (let k = 1; k <= 6; k++) { const j = POS.indexOf(order[(i0 + k) % 6]), pl = h.P[j]; if (!pl.folded && !pl.allin && (!pl.acted || pl.sb < h.bet - 1e-9)) return j; }
  return -1;
}
// preflop: the solved range tables (same logic as the app's Reg bots)
// preflop chart widths (round 9+): multipliers on the solved charts (data/ranges.json). tbBlind = extra 3-bet % for the blinds vs opens.
const PRE_KEYS = ['rfiUTG', 'rfiHJ', 'rfiCO', 'rfiBTN', 'rfiSB', 'sbc', 'iso', 'tbIP', 'ctIP', 'tbBlind', 'ctSB', 'ctBB', 'fb', 'cb'];
const PRE_NEUTRAL = { rfiUTG: 1, rfiHJ: 1, rfiCO: 1, rfiBTN: 1, rfiSB: 1, sbc: 1, iso: 1, tbIP: 1, ctIP: 1, tbBlind: 0, ctSB: 1, ctBB: 1, fb: 1, cb: 1 };
// the chart a seat plays with these widths (also used to write tuned charts back into data/ranges.json)
function preChart(T) {
  T = Object.assign({}, PRE_NEUTRAL, T || {});
  const rfi = {}; for (const p of ['UTG', 'HJ', 'CO', 'BTN', 'SB']) rfi[p] = Math.min(100, CFG.rfi[p] * T['rfi' + p]);
  const vsOpen = {}, vs3 = {};
  for (const k of Object.keys(CFG.vsOpen)) { const [o, p] = k.split('>'), v = S.vsOpenOf(o, p), blind = p === 'SB' || p === 'BB';
    const tb = Math.min(60, blind ? v.tb + T.tbBlind : v.tb * T.tbIP), cw = (v.ct - v.tb) * (blind ? (p === 'SB' ? T.ctSB : T.ctBB) : T.ctIP);
    vsOpen[k] = { tb, ct: Math.min(100, tb + cw) }; }
  for (const k of Object.keys(CFG.vs3)) { const [p, a] = k.split('>'), v = S.vs3Of(p, a), fb = Math.min(rfi[p] || 100, v.fb * T.fb);
    vs3[k] = { fb, cb: Math.max(fb, Math.min(rfi[p] || 100, v.cb * T.cb)) }; }
  return { rfi, sbComplete: Math.max(rfi.SB, Math.min(100, CFG.sbComplete * T.sbc)), bbIso: Math.min(100, CFG.bbIso * T.iso), vsOpen, vs3 };
}
const chartCache = new WeakMap();
const chartOf = th => { const T = th && th.pre; if (!T) return BASE_CHART; let c = chartCache.get(T); if (!c) { c = preChart(T); chartCache.set(T, c); } return c; };
let BASE_CHART = null;
// preflop: the solved range tables (same logic as the app's Reg bots), widened or narrowed by the seat's chart multipliers
function preDecide(h, i, th) {
  const pl = h.P[i], L = legal(h, i), p = POS[i], t = pl.top, C = chartOf(th), raise = band => ({ a: 'raise', to: L.maxTo, band }), passive = L.canCheck ? { a: 'check' } : { a: 'fold' };
  if (h.raises === 0) {
    if (p === 'BB') return t <= C.bbIso && L.canRaise ? raise([0, C.bbIso]) : { a: 'check', band: [C.bbIso, 100] };
    if (p === 'SB') { if (t <= C.rfi.SB) return raise([0, C.rfi.SB]); if (t <= C.sbComplete) return { a: 'call', band: [C.rfi.SB, C.sbComplete] }; return { a: 'fold' }; }
    return t <= C.rfi[p] ? raise([0, C.rfi[p]]) : { a: 'fold' };
  }
  const op = POS[h.opener];
  if (h.raises === 1 && C.vsOpen[op + '>' + p]) { const v = C.vsOpen[op + '>' + p]; if (t <= v.tb && L.canRaise) return raise([0, v.tb]); if (t <= v.ct) return { a: 'call', band: [v.tb, v.ct] }; return passive; }
  if (h.raises === 2 && i === h.opener && C.vs3[p + '>' + POS[h.aggr]]) { const v = C.vs3[p + '>' + POS[h.aggr]]; if (t <= v.fb && L.canRaise) return raise([0, v.fb]); if (t <= v.cb) return { a: 'call', band: [0, v.cb] }; return passive; }
  const cont = Math.max(2, pl.band[0] < 1e-9 && pl.band[1] < 100 ? pl.band[1] * (1 - CFG.foldTo4) : pl.band[0] + 0.3 * (pl.band[1] - pl.band[0]));
  if (t <= cont) return L.canRaise && h.rng() < 0.5 ? raise([0, cont]) : { a: 'call', band: [0, cont] };
  return passive;
}
// postflop: parameterized policy. eq/scoop are vs the opponents' preflop ranges (real-equity pool).
const EQ_T = +(process.env.EQ_T || 300);
function postDecide(h, i, th) {
  const pl = h.P[i], L = legal(h, i), T = th[h.street], opps = h.P.map((q, j) => j).filter(j => j !== i && !h.P[j].folded);
  reseed(h.seed, i, h.nDec++);
  const job = E.createEquityJob({ players: [{ cards: pl.cards }, ...opps.map(j => ({ cards: [], range: { real: h.P[j].band } }))], board: h.board, trials: EQ_T });
  job.step(1e9);
  const R = job.result().players[0], eq = R.eq, sc = R.scoop, fair = 1 / (opps.length + 1), m = eq - fair, rnd = Math.random();
  // equity swing: edge now vs our edge at the start of the previous street (preflop edge for the flop)
  if (pl.mPrev == null) {
    const j0 = E.createEquityJob({ players: [{ cards: pl.cards }, ...opps.map(j => ({ cards: [], range: { real: h.P[j].band } }))], board: [], trials: EQ_T }); j0.step(1e9);
    pl.mPrev = j0.result().players[0].eq - fair; pl.mStreet = 'pre';
  }
  if (pl.mStreet !== h.street) { if (pl.mStreetVal != null) pl.mPrev = pl.mStreetVal; pl.mStreet = h.street; pl.mStreetVal = m; }
  const dm = m - pl.mPrev, swung = dm >= T.swing, init = h.prevAggr === i, hu = opps.length === 1;
  const ctx = { eq, m, dm, sc, nOpp: opps.length, facing: !L.canCheck, swung, init, pot: L.pot, toCall: L.toCall };
  if (L.canCheck) {
    const vbEff = T.vb - (swung ? T.swingVb : 0) - (init ? T.initVb : 0) - (hu ? T.huVb : 0);
    if (m >= vbEff) {
      if (hu && m >= T.big && rnd < T.trap) return { a: 'check', tag: 'trap', ctx };
      const size = sc >= T.bomb ? 1 : swung ? T.swingSize : m >= T.big ? T.bigSize : T.thin;
      return { a: 'raise', to: size * L.pot, tag: sc >= T.bomb ? 'bomb' : swung ? 'swing' : m >= T.big ? 'value' : 'thin', ctx };
    }
    if (m >= T.stabLo && rnd < T.stab) return { a: 'raise', to: L.pot, tag: 'stab', ctx };
    if (hu && m < T.bluffMax && rnd < T.bluff) return { a: 'raise', to: T.bluffSize * L.pot, tag: 'bluff', ctx };
    return { a: 'check', ctx };
  }
  const betFrac = L.toCall / Math.max(0.5, L.pot - L.toCall), odds = L.toCall / (L.pot + L.toCall);
  const req = Math.min(0.97, odds * (1 + T.sizeAdj * betFrac) + (hu ? T.huAdj : 0)), rM = T.raiseM - (swung ? T.swingRaise : 0);
  if (L.canRaise && (sc >= T.raiseSc || eq >= req + rM)) return { a: 'raise', to: L.maxTo, tag: 'raise', ctx };
  if (L.canRaise && hu && m < T.bluffMax && rnd < T.braise) return { a: 'raise', to: L.maxTo, tag: 'bluff-raise', ctx };
  if (eq >= req - T.slack) return { a: 'call', ctx };
  return { a: 'fold', ctx };
}
function showdown(h) { // shared settlement: uncalled bets back, side pots, rake on pots that saw a flop, hi/lo split
  const live = h.P.map(p => !p.folded), many = live.filter(Boolean).length > 1;
  const hi = h.P.map(p => many && !p.folded ? E.bestHiDetail(p.cards, h.board).value : 0), lo = h.P.map(p => many && !p.folded ? E.bestLowDetail(p.cards, h.board).mask : E.NO_LOW);
  const r = E.settle(h.P.map(p => p.contrib), live, hi, lo, h.flopSeen ? RAKE : null);
  h.P.forEach((p, i) => p.stack += r.won[i]);
}
// play one deal. thetas[i] = postflop params for seat i. Returns net bb per seat (+ optional tracer callback).
function playHand(seed, thetas, trace, override) {
  // hole cards come from the real-equity pool (random hands with their real preflop rank, exactly as the app's bots are ranked)
  const used = [], hands = POS.map((_, i) => { reseed(seed, 70, i); let r = null; for (let t = 0; t < 100 && !r; t++) r = E.sampleReal(0, 100, used); used.push(...r.cards); return r; });
  const deckR = mulberry32(hash(seed, 7)), inUse = new Set(used), deck = [...Array(52).keys()].filter(c => !inUse.has(c));
  for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(deckR() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  const h = { seed, P: POS.map((p, i) => ({ cards: hands[i].cards, stack: 100, contrib: 0, sb: 0, folded: false, allin: false, acted: false, band: [0, 100], top: hands[i].top })),
    board: [], fullBoard: deck.slice(0, 5), street: 'pre', bet: 1, lastRaise: 1, raises: 0, aggr: -1, opener: -1, prevAggr: -1, k: 0, nDec: 0, rng: mulberry32(hash(seed, 11)), flopSeen: false };
  put(h, 4, 0.5); put(h, 5, 1);
  let cur = 5;
  for (;;) {
    const i = nextToAct(h, cur);
    if (i < 0) {
      const live = h.P.filter(p => !p.folded);
      h.P.forEach(p => { p.sb = 0; p.acted = false; }); h.bet = 0; h.fullBet = 0; h.lastRaise = 1; h.shortRaise = false; h.raises = 0; h.prevAggr = h.aggr; h.aggr = -1;
      if (live.length === 1 || h.street === 'river') break;
      h.flopSeen = true;
      h.board = h.fullBoard.slice(0, h.board.length === 0 ? 3 : h.board.length + 1);
      h.street = STREETS[h.board.length - 3];
      if (live.filter(p => !p.allin).length <= 1) { h.board = h.fullBoard.slice(); h.street = 'river'; break; }
      cur = 3; continue; // BTN index: postflop action starts left of the button
    }
    let d;
    if (h.street === 'pre') d = preDecide(h, i, thetas[i]);
    else { d = postDecide(h, i, thetas[i]); const k = h.k++; if (override) { const o = override(k, h, i, d); if (o) d = Object.assign({}, o, { ctx: d.ctx }); } }
    if (d.band) h.P[i].band = d.band;
    if (trace) trace(h, i, d, h.street === 'pre' ? -1 : h.k - 1);
    act(h, i, d.a, d.to);
    cur = i;
  }
  showdown(h);
  return h.P.map(p => p.stack - 100);
}
// Play a specific heads-up spot from the flop: hero (fixed cards) called a raise from villain (range band).
// spec = { hero, heroCards, heroBand, vill, villBand, each, dead } -> hero's net bb for the hand
function playSpot(seed, spec, thetas) {
  reseed(seed, 99);
  const v = E.sampleReal(spec.villBand[0], spec.villBand[1], spec.heroCards);
  const used = new Set([...spec.heroCards, ...v.cards]), deckR = mulberry32(hash(seed, 7));
  const rest = [...Array(52).keys()].filter(c => !used.has(c));
  for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(deckR() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
  const h = { seed, P: POS.map(() => ({ cards: null, stack: 100, contrib: 0, sb: 0, folded: true, allin: false, acted: false, band: [0, 100], top: 50 })),
    board: [], fullBoard: rest.slice(0, 5), street: 'flop', bet: 0, lastRaise: 1, raises: 0, aggr: -1, prevAggr: spec.vill, opener: spec.vill, k: 0, nDec: 0, rng: mulberry32(hash(seed, 11)), flopSeen: true };
  Object.assign(h.P[spec.hero], { cards: spec.heroCards, folded: false, band: spec.heroBand, stack: 100 - spec.each, contrib: spec.each });
  Object.assign(h.P[spec.vill], { cards: v.cards, folded: false, band: spec.villBand, stack: 100 - spec.each, contrib: spec.each });
  if (spec.dead) { const d = POS.indexOf('SB'); if (d !== spec.hero && d !== spec.vill) h.P[d].contrib = spec.dead; }
  h.board = h.fullBoard.slice(0, 3);
  let cur = 3;
  for (;;) {
    const i = nextToAct(h, cur);
    if (i < 0) {
      const live = h.P.filter(p => !p.folded);
      h.P.forEach(p => { p.sb = 0; p.acted = false; }); h.bet = 0; h.fullBet = 0; h.lastRaise = 1; h.shortRaise = false; h.raises = 0; h.prevAggr = h.aggr; h.aggr = -1;
      if (live.length === 1 || h.street === 'river') break;
      h.board = h.fullBoard.slice(0, h.board.length + 1); h.street = STREETS[h.board.length - 3];
      if (live.filter(p => !p.allin).length <= 1) { h.board = h.fullBoard.slice(); h.street = 'river'; break; }
      cur = 3; continue;
    }
    const d = postDecide(h, i, thetas[i]);
    act(h, i, d.a, d.to); cur = i;
  }
  showdown(h);
  return h.P[spec.hero].stack - 100;
}
BASE_CHART = preChart(null);
module.exports = { PRE_KEYS, PRE_NEUTRAL, preChart, playHand, playSpot, BASELINE, KEYS, BOUNDS, STREETS, NEUTRAL, withNeutral, clone, E, POS, S, legal };

if (require.main === module) { // quick sanity / speed check
  const th = POS.map(() => clone(BASELINE));
  const t0 = Date.now(); let n = 0, tot = 0, sumAbs = 0, flops = 0; const tags = {};
  for (let s = 1; s <= +(process.env.N || 2000); s++) {
    const r = playHand(s, th, (h, i, d) => { if (d.tag) tags[d.tag] = (tags[d.tag] || 0) + 1; });
    const sum = r.reduce((a, b) => a + b, 0); tot += sum; n++; sumAbs += Math.abs(r[0]);
  }
  console.log(`${n} hands in ${(Date.now() - t0) / 1000}s · avg chips lost to rake per hand ${(-tot / n).toFixed(3)} bb · mean |net| seat0 ${(sumAbs / n).toFixed(2)} · postflop tags`, tags);
}
