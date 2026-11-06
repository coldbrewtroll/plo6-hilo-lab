// =====================================================================
// TRAINER — PREFLOP SPOT + PLAY THE HAND OUT
// The trainer spot is scripted up to your decision; after that a pot-limit
// hand engine plays every street to showdown against bots.
// =====================================================================
const PRE_ORDER = POS, POST_ORDER = ['SB', 'BB', 'UTG', 'HJ', 'CO', 'BTN'];
const STREETS = ['pre', 'flop', 'turn', 'river'];
const SNAME = { pre: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River' };
const wait = ms => new Promise(r => setTimeout(r, ms));
const cardTxt = c => `<span class="ct su-${E.SUITS[c & 3]}">${E.RANKS[c >> 2]}${SYM[E.SUITS[c & 3]]}</span>`;
let H = null;
// Opponent types. Range narrowing is mostly range-vs-range (the Reg values); Nit/Maniac tilt it slightly.
const PROFILES = {
  nit:    { label: 'Nit',    pre: 0.70, agg: 0.60, betMin: 0.26, med: 0.15, bluff: 0.02, callAdj: 0.05,  raiseAdj: 0.38, raiseP: 0.45 },
  reg:    { label: 'Reg',    pre: 1.00, agg: 1.00, betMin: 0.18, med: 0.40, bluff: 0.08, callAdj: -0.03, raiseAdj: 0.30, raiseP: 0.55 },
  maniac: { label: 'Maniac', pre: 1.50, agg: 2.20, betMin: 0.05, med: 0.75, bluff: 0.35, callAdj: -0.08, raiseAdj: 0.12, raiseP: 0.80 },
};
function pickProfile() {
  const m = $('#oppMix') ? $('#oppMix').value : 'mixed';
  if (PROFILES[m]) return m;
  const r = Math.random(); return r < 0.5 ? 'reg' : r < 0.75 ? 'nit' : 'maniac';
}
const profOf = pl => PROFILES[pl.prof || 'reg'];
const capPct = x => Math.min(100, x);
const potOf = h => POS.reduce((a, p) => a + h.players[p].contrib, 0);
const liveOf = h => POS.filter(p => !h.players[p].folded);
const usedOf = h => { const u = new Set(h.board); POS.forEach(p => (h.players[p].cards || []).forEach(c => u.add(c))); return [...u]; };
const nameOf = (h, p) => p === h.hero ? 'You' : p;
function logH(h, html) { h.log.push(html); }
function sampleBand(h, band, pl) { // a hand ranked within [a, b] (real-equity pool when available)
  const used = usedOf(h);
  if (E.hasReal()) { const r = E.sampleReal(band[0], band[1], used); if (r) { if (pl) pl.top = r.top; return sortHand(r.cards); } }
  for (let i = 0; i < 5000; i++) { const c = deal(6, used); const t = modelTop(c); if (t >= band[0] - 1e-9 && t <= band[1] + 1e-9) return sortHand(c); }
  return sortHand(deal(6, used));
}
function put(h, p, amt) {
  const pl = h.players[p]; amt = Math.min(amt, pl.stack);
  pl.stack -= amt; pl.contrib += amt; pl.sb += amt;
  if (pl.stack < 1e-9) { pl.stack = 0; pl.allin = true; }
  return amt;
}
function legal(h, p) {
  const pl = h.players[p], pot = potOf(h), toCall = Math.max(0, Math.min(h.bet - pl.sb, pl.stack));
  const maxTo = Math.min(pl.sb + pl.stack, h.bet + pot + (h.bet - pl.sb)); // pot-limit
  const minTo = Math.min(pl.sb + pl.stack, h.bet + Math.max(h.lastRaise, 1));
  // a short all-in raise does not reopen the betting for players who already acted on the last full bet/raise
  return { toCall, canCheck: toCall < 1e-9, canRaise: pl.stack > toCall + 1e-9 && !(pl.acted && h.shortRaise), minTo, maxTo, pot };
}
const RAISE_NAMES = ['Raise', 'Raise', '3-Bet', '4-Bet', '5-Bet', '6-Bet'];
function act(h, p, a, to) {
  const pl = h.players[p], L = legal(h, p), you = p === h.hero, who = you ? 'You' : (a !== 'fold' && pl.prof ? `${p} (${PROFILES[pl.prof].label})` : p);
  if (a === 'fold') { pl.folded = true; pl.tag = 'Fold'; pl.tagCls = 'fold'; logH(h, `${who} fold${you ? '' : 's'}`); }
  else if (a === 'check') { pl.tag = 'Check'; pl.tagCls = 'check'; logH(h, `${who} check${you ? '' : 's'}`); }
  else if (a === 'call') {
    const amt = put(h, p, L.toCall);
    pl.tag = pl.allin ? 'All-in ' + fmtAmt(pl.sb) : 'Call ' + fmtAmt(amt); pl.tagCls = 'call';
    logH(h, `${who} call${you ? '' : 's'} ${fmtAmt(amt)}${pl.allin ? ' (all-in)' : ''}`);
  } else if (!L.canRaise || Math.min(L.maxTo, to) <= h.bet + 1e-9) { act(h, p, L.canCheck ? 'check' : 'call'); return; }
  else {
    to = Math.max(L.minTo, Math.min(L.maxTo, to));
    const bet = h.bet < 1e-9, name = h.street === 'pre' ? RAISE_NAMES[Math.min(5, h.raises + 1)] : bet ? 'Bet' : 'Raise';
    // a full bet/raise (measured from the last full raise, so short all-ins can add up to one) reopens the action; a short all-in does not
    const lvl = h.fullBet ?? h.bet, full = h.bet < 1e-9 || to - lvl >= h.lastRaise - 1e-9;
    if (full) { h.lastRaise = Math.max(h.lastRaise, to - lvl); h.fullBet = to; h.shortRaise = false; POS.forEach(q => { if (q !== p) h.players[q].acted = false; }); } else h.shortRaise = true;
    h.bet = to;
    put(h, p, to - pl.sb);
    h.raises++; h.aggr = p; if (h.street === 'pre' && h.raises === 1) h.opener = p;
    pl.tag = (pl.allin ? 'All-in ' : (name === 'Bet' ? 'Bet ' : name + ' ')) + fmtAmt(to); pl.tagCls = 'raise';
    logH(h, `${who} ${name === 'Bet' ? (you ? 'bet' : 'bets') : name === 'Raise' ? (you ? 'raise to' : 'raises to') : (you ? name.toLowerCase() + ' to' : name.toLowerCase() + 's to')} ${fmtAmt(to)}${pl.allin ? ' (all-in)' : ''}`);
  }
  pl.acted = true; h.cursor = p;
}
function nextToAct(h, from) {
  const order = h.street === 'pre' ? PRE_ORDER : POST_ORDER, i0 = order.indexOf(from);
  for (let k = 1; k <= 6; k++) {
    const q = order[(i0 + k) % 6], pl = h.players[q];
    if (!pl.folded && !pl.allin && (!pl.acted || pl.sb < h.bet - 1e-9)) return q;
  }
  return null;
}
function newHand(spot, heroCards) {
  const players = {};
  POS.forEach(p => players[p] = { pos: p, cards: null, folded: false, stack: 100, contrib: 0, sb: 0, acted: false, allin: false, tag: '', tagCls: '', band: [0, 100] });
  const h = { spot, players, hero: spot.hero, board: [], street: 'pre', bet: 1, lastRaise: 1, raises: 0, aggr: null, opener: null,
    log: [], decisions: [], over: false, first: true, cursor: 'BB', heroTurn: false };
  players[spot.hero].cards = heroCards;
  POS.forEach(p => { if (p !== spot.hero) players[p].prof = pickProfile(); });
  put(h, 'SB', 0.5); put(h, 'BB', 1);
  logH(h, `<b>New hand</b> · you are ${spot.hero} · SB posts 0.5, BB posts 1`);
  const s = spot, foldRange = (a, b) => { for (let i = a; i < b; i++) act(h, POS[i], 'fold'); };
  if (s.type === 'rfi') foldRange(0, POS.indexOf(s.hero));
  else if (s.type === 'vsopen') {
    const oi = POS.indexOf(s.opener), band = [0, capPct(CFG.rfi[s.opener] * profOf(players[s.opener]).pre)];
    foldRange(0, oi);
    players[s.opener].cards = sampleBand(h, band, players[s.opener]); players[s.opener].band = band;
    act(h, s.opener, 'raise', legal(h, s.opener).maxTo);
    foldRange(oi + 1, POS.indexOf(s.hero));
  } else {
    const hi = POS.indexOf(s.hero), vi = POS.indexOf(s.villain), tb = capPct(vsOpenOf(s.hero, s.villain).tb * profOf(players[s.villain]).agg);
    foldRange(0, hi);
    act(h, s.hero, 'raise', legal(h, s.hero).maxTo);
    foldRange(hi + 1, vi);
    players[s.villain].cards = sampleBand(h, [0, tb], players[s.villain]); players[s.villain].band = [0, tb];
    act(h, s.villain, 'raise', legal(h, s.villain).maxTo);
    POS.slice(vi + 1).forEach(p => act(h, p, 'fold'));
  }
  POS.forEach(p => { if (!players[p].folded && !players[p].cards) players[p].cards = sampleBand(h, [0, 100], players[p]); });
  return h;
}

// ---------- bots ----------
function botDecide(h, p) {
  const pl = h.players[p], L = legal(h, p), r = Math.random(), PR = profOf(pl);
  const raise = band => ({ a: 'raise', to: L.maxTo, band });
  const passive = L.canCheck ? { a: 'check' } : { a: 'fold' };
  if (h.street === 'pre') {
    const t = pl.top != null ? pl.top : (pl.top = modelTop(pl.cards));
    const loose = x => capPct(x * PR.pre), aggro = x => capPct(x * PR.agg);
    if (h.raises === 0) {
      if (p === 'BB') { const iso = aggro(CFG.bbIso); return t <= iso && L.canRaise ? raise([0, iso]) : { a: 'check', band: [iso, 100] }; }
      if (p === 'SB') { const rr = loose(CFG.rfi.SB), cc = Math.max(rr, loose(CFG.sbComplete)); if (t <= rr) return raise([0, rr]); if (t <= cc) return { a: 'call', band: [rr, cc] }; return { a: 'fold' }; }
      const op = loose(CFG.rfi[p]); return t <= op ? raise([0, op]) : { a: 'fold' };
    }
    if (h.raises === 1 && CFG.vsOpen[h.opener + '>' + p]) {
      const v = vsOpenOf(h.opener, p), tb = aggro(v.tb), ct = Math.max(tb, loose(v.ct));
      if (t <= tb && L.canRaise) return raise([0, tb]);
      if (t <= ct) return { a: 'call', band: [tb, ct] };
      return passive;
    }
    if (h.raises === 2 && p === h.opener && CFG.vs3[p + '>' + h.aggr]) {
      const v = vs3Of(p, h.aggr), fb = aggro(v.fb), cb = Math.max(fb, loose(v.cb));
      if (t <= fb && L.canRaise) return raise([0, fb]);
      if (t <= cb) return { a: 'call', band: [0, cb] };
      return passive;
    }
    // facing a 4-bet+, or cold-calling a 3-bet: continue only with the strong part of your range
    const cont = loose(Math.max(2, pl.band[0] < 1e-9 && pl.band[1] < 100 ? pl.band[1] * (1 - CFG.foldTo4) : pl.band[0] + 0.3 * (pl.band[1] - pl.band[0])));
    if (t <= cont) return L.canRaise && r < 0.5 ? raise([0, cont]) : { a: 'call', band: [0, cont] };
    return passive;
  }
  return botPost(h, p);
}

// ---------- learned postflop policy (tools/optimize.js self-play) ----------
const POLICY_NEUTRAL = { swing: 0.10, swingVb: 0, swingSize: 0.66, swingRaise: 0, initVb: 0, bigSize: 0.66, bluffSize: 0.6, bluffMax: -0.05, huVb: 0, huAdj: 0, braise: 0, trap: 0, stab: 0, stabLo: -0.10 };
const POLICY_DEFAULT = Object.assign({ vb: 0.18, big: 0.18, thin: 0.66, bomb: 1.01, bluff: 0.08, slack: 0.03, sizeAdj: 0, raiseM: 0.30, raiseSc: 1.01 }, POLICY_NEUTRAL);
const BOTPOL = (typeof PLO6_BOTPOLICY !== 'undefined' && PLO6_BOTPOLICY && PLO6_BOTPOLICY.theta) ? PLO6_BOTPOLICY.theta : { flop: POLICY_DEFAULT, turn: POLICY_DEFAULT, river: POLICY_DEFAULT };
function policyFor(street, prof) { // Reg = the learned policy; Nit / Maniac are small tilts of it
  const T = Object.assign({}, POLICY_DEFAULT, BOTPOL[street] || {});
  if (prof === 'nit') { T.vb += 0.05; T.big += 0.03; T.bluff *= 0.25; T.slack -= 0.03; T.raiseM += 0.05; T.raiseSc = Math.min(1.01, T.raiseSc + 0.05); }
  if (prof === 'maniac') { T.vb -= 0.04; T.bluff = Math.min(0.5, T.bluff * 3 + 0.1); T.slack += 0.05; T.sizeAdj = 0; T.raiseM = Math.max(0, T.raiseM - 0.08); T.raiseSc = Math.max(0.3, T.raiseSc - 0.1); }
  return T;
}
// Self-play: scoop bombs lose vs size-aware regs but win vs calling stations (+9.9 bb/100 at scoop >= 40%).
const STATION_BOMB = { river: 0.40, turn: 0.50, flop: 1.01 };
const stationInHand = (h, me) => liveOf(h).some(q => q !== me && h.players[q].prof === 'maniac');
// vs calling stations (self-play): bomb scoop hands (+9.9 bb/100), never bluff (+5.4), value-bet 4 pts thinner (+4.7)
// vs only Nits (tight, rarely bluff): bet like the round-3 strategy: no traps, thicker value (+11 bb/100 at tight tables)
const VS_TIGHT = (typeof PLO6_BOTPOLICY !== 'undefined' && PLO6_BOTPOLICY && PLO6_BOTPOLICY.vsTight) || null;
const onlyNits = (h, me) => { const o = liveOf(h).filter(q => q !== me); return o.length > 0 && o.every(q => h.players[q].prof === 'nit'); };
function withExploit(T, h, me) {
  if (stationInHand(h, me)) { T.bomb = Math.min(T.bomb, STATION_BOMB[h.street] ?? 1.01); T.bluff = 0; T.braise = 0; T.trap = 0; T.stab = 0; T.vb -= 0.04; T.mode = 'station'; }
  else if (VS_TIGHT && onlyNits(h, me)) { Object.assign(T, VS_TIGHT[h.street] || {}); T.trap = 0; T.braise = 0; T.mode = 'tight'; }
  return T;
}
const oppRange = (h, q) => E.hasReal() ? { real: h.players[q].band } : rangeBand(...h.players[q].band);
// equity-swing bookkeeping: each player's edge (equity minus fair share) at the start of each street
function edgeSwing(h, p, m, ranges) {
  const pl = h.players[p];
  if (pl.mPrev == null) { // first postflop decision: compare with the preflop edge vs the same opponents
    const j0 = E.createEquityJob({ players: [{ cards: pl.cards }, ...ranges.map(r => ({ cards: [], range: r }))], board: [], trials: 400 }); j0.step(1e9);
    pl.mPrev = j0.result().players[0].eq - 1 / (ranges.length + 1); pl.mStreet = 'pre';
  }
  if (pl.mStreet !== h.street) { if (pl.mStreetVal != null) pl.mPrev = pl.mStreetVal; pl.mStreet = h.street; pl.mStreetVal = m; }
  return m - pl.mPrev;
}
// the self-play policy (mirrors tools/selfplay.js postDecide); returns the action and why
function policyDecide(h, p, T, eq, sc, nOpp, dm) {
  const L = legal(h, p), fair = 1 / (nOpp + 1), m = eq - fair, hu = nOpp === 1, swung = dm >= T.swing, init = h.prevAggr === p, r = Math.random();
  const info = { m, fair, hu, swung, init, dm };
  if (L.canCheck) {
    info.vbEff = T.vb - (swung ? T.swingVb : 0) - (init ? T.initVb : 0) - (hu ? T.huVb : 0);
    if (m >= info.vbEff && L.canRaise) {
      if (hu && m >= T.big && r < T.trap) return Object.assign(info, { a: 'check', kind: 'trap' });
      const size = sc >= T.bomb ? 1 : swung ? T.swingSize : m >= T.big ? T.bigSize : T.thin;
      return Object.assign(info, { a: 'raise', to: size * L.pot, size, kind: sc >= T.bomb ? 'bomb' : swung ? 'swing' : m >= T.big ? 'value' : 'thin' });
    }
    if (m >= T.stabLo && r < T.stab && L.canRaise) return Object.assign(info, { a: 'raise', to: L.pot, size: 1, kind: 'stab' });
    if (hu && m < T.bluffMax && r < T.bluff && L.canRaise) return Object.assign(info, { a: 'raise', to: T.bluffSize * L.pot, size: T.bluffSize, kind: 'bluff' });
    return Object.assign(info, { a: 'check' });
  }
  const betFrac = L.toCall / Math.max(0.5, L.pot - L.toCall), odds = L.toCall / (L.pot + L.toCall);
  info.odds = odds; info.req = Math.min(0.97, odds * (1 + T.sizeAdj * betFrac) + (hu ? T.huAdj : 0)); info.rM = T.raiseM - (swung ? T.swingRaise : 0);
  if (L.canRaise && (sc >= T.raiseSc || eq >= info.req + info.rM)) return Object.assign(info, { a: 'raise', to: L.maxTo, kind: 'raise' });
  if (L.canRaise && hu && m < T.bluffMax && r < T.braise) return Object.assign(info, { a: 'raise', to: L.maxTo, kind: 'bluff-raise' });
  if (eq >= info.req - T.slack) return Object.assign(info, { a: 'call' });
  return Object.assign(info, { a: 'fold' });
}
function botPost(h, p) {
  const pl = h.players[p], T = withExploit(policyFor(h.street, pl.prof), h, p), opps = liveOf(h).filter(q => q !== p), ranges = opps.map(q => oppRange(h, q));
  const job = E.createEquityJob({ players: [{ cards: pl.cards }, ...ranges.map(r => ({ cards: [], range: r }))], board: h.board, trials: 400 });
  job.step(1e9);
  const R = job.result().players[0], m = R.eq - 1 / (opps.length + 1), dm = edgeSwing(h, p, m, ranges);
  const d = policyDecide(h, p, T, R.eq, R.scoop, opps.length, dm);
  return { a: d.a, to: d.to };
}

// ---------- reading opponents: Bayesian range narrowing on every postflop action ----------
// Each opponent's range is a weighted sample of hands from their preflop band. After every action we reweight each candidate by
// how likely the bots' own postflop policy (policyFor + withExploit: the same thresholds, Nit/Maniac tilts, traps and bluffs) was to
// take that action holding it. So bluffs and traps stay in the range in the proportions the bots actually use them.
const READ_SIGMA = 0.035, READ_FLOOR = 0.04, READ_TRIALS = 100, N_CANDS = 360;
const softStep = x => 1 / (1 + Math.exp(-1.702 * x / READ_SIGMA)); // smooth threshold (the bots estimate equity with noise too)
function ensureCands(h, p) {
  const pl = h.players[p]; if (pl.cands) return;
  const ex = [...h.players[h.hero].cards, ...h.board], c = [];
  for (let i = 0; i < N_CANDS; i++) {
    let hand = null;
    if (E.hasReal()) { const r = E.sampleReal(pl.band[0], pl.band[1], ex); if (r) hand = r.cards; }
    for (let t = 0; t < 3000 && !hand; t++) { const x = deal(6, ex), top = modelTop(x); if (top >= pl.band[0] - 1e-9 && top <= pl.band[1] + 1e-9) hand = x; }
    c.push({ c: hand || deal(6, ex), w: 1 });
  }
  pl.cands = c; pl.candsStart = c.length; pl.reads = [];
}
function liveCands(h, p) { const b = new Set([...h.board, ...h.players[h.hero].cards]); return h.players[p].cands.filter(o => !o.c.some(x => b.has(x))); }
const essOf = cs => { let a = 0, b = 0; for (const o of cs) { a += o.w; b += o.w * o.w; } return b > 0 ? a * a / b : 0; };
function rangeList(cs, n = N_CANDS) { // systematic resampling of a weighted candidate list -> plain list range for the equity engine
  const W = cs.reduce((a, o) => a + o.w, 0); if (!(W > 0)) return cs.map(o => o.c);
  const out = [], step = W / n; let acc = 0, k = 0, u = step / 2;
  for (const o of cs) { acc += o.w; while (u < acc && k < n) { out.push(o.c); u += step; k++; } }
  return out;
}
// the decision context a bot saw (captured before it acts)
function readCtx(h, p) {
  const opps = liveOf(h).filter(q => q !== p);
  return { T: withExploit(policyFor(h.street, h.players[p].prof), h, p), L: legal(h, p), ranges: opps.map(q => oppRange(h, q)), nOpp: opps.length, init: h.prevAggr === p, street: h.street };
}
// probability that the policy takes `kind` holding a hand with equity eq / scoop sc (and edge change dm)
function actionLik(kind, eq, sc, dm, X) {
  const T = X.T, L = X.L, fair = 1 / (X.nOpp + 1), m = eq - fair, hu = X.nOpp === 1, swung = dm >= T.swing;
  if (L.canCheck) {
    const vbEff = T.vb - (swung ? T.swingVb : 0) - (X.init ? T.initVb : 0) - (hu ? T.huVb : 0);
    const pV = softStep(m - vbEff), pT = hu ? T.trap * softStep(m - T.big) : 0, pB = Math.max(hu ? T.bluff * softStep(T.bluffMax - m) : 0, T.stab * softStep(m - T.stabLo));
    const pBet = L.canRaise ? pV * (1 - pT) + (1 - pV) * pB : 0;
    return kind === 'check' ? 1 - pBet : pBet;
  }
  const betFrac = L.toCall / Math.max(0.5, L.pot - L.toCall), odds = L.toCall / (L.pot + L.toCall);
  const req = Math.min(0.97, odds * (1 + T.sizeAdj * betFrac) + (hu ? T.huAdj : 0)), rM = T.raiseM - (swung ? T.swingRaise : 0);
  const pCont = softStep(eq - (req - T.slack));
  if (!L.canRaise) return kind === 'call' ? pCont : 1 - pCont;
  const pR0 = Math.max(T.raiseSc <= 1 ? softStep(sc - T.raiseSc) : 0, softStep(eq - req - rM)), pR = pR0 + (1 - pR0) * (hu ? T.braise * softStep(T.bluffMax - m) : 0);
  return kind === 'raise' ? pR : kind === 'call' ? (1 - pR) * pCont : (1 - pR) * (1 - pCont);
}
function narrowRange(h, p, kind, sizeFrac, X) {
  const pl = h.players[p]; ensureCands(h, p);
  X = X || readCtx(h, p);
  const fair = 1 / (X.nOpp + 1);
  pl.cands = liveCands(h, p).map(o => {
    const j = E.createEquityJob({ players: [{ cards: o.c }, ...X.ranges.map(r => ({ cards: [], range: r }))], board: h.board, trials: READ_TRIALS }); j.step(1e9);
    const R = j.result().players[0], m = R.eq - fair;
    let mPrev = o.mPrev, mStreet = o.mStreet, mStreetVal = o.mStreetVal; // edge-swing bookkeeping per candidate (as the bots do)
    if (mStreet !== h.street) { if (mStreetVal != null) mPrev = mStreetVal; mStreet = h.street; mStreetVal = m; }
    const lik = actionLik(kind, R.eq, R.scoop, mPrev == null ? 0 : m - mPrev, X);
    return { c: o.c, w: o.w * (READ_FLOOR + (1 - READ_FLOOR) * lik), mPrev, mStreet, mStreetVal };
  });
  pl.reads.push(`${kind === 'bet' && sizeFrac >= 0.9 ? 'pot-size bet' : kind} on the ${SNAME[h.street].toLowerCase()}`);
}

// ---------- coach for your decisions after the first ----------
async function heroCoach(h) {
  const hero = h.hero, pl = h.players[hero], L = legal(h, hero);
  if (h.street === 'pre' && h.raises === 2 && h.opener === hero && CFG.vs3[hero + '>' + h.aggr]) {
    const spot = { type: 'vs3', hero, villain: h.aggr }, rk = await simRank(pl.cards), g = gradeRange(spot, rk.top);
    return { ok: g.ok, why: `Range chart: your hand is top ${rk.top.toFixed(1)}%. Vs a ${h.aggr} 3-bet: ${g.acts.slice(0, -1).map(x => `${x.label} top ${x.top.toFixed(1)}%`).join(', ')}, fold the rest.` };
  }
  const opps = liveOf(h).filter(p => p !== hero);
  const rangeOf = p => { const q = h.players[p]; if (q.cands) { const lc = liveCands(h, p); if (lc.length >= 10) return { list: rangeList(lc) }; } return rangeBand(...q.band); };
  const pre = opps.map(p => oppRange(h, p));
  const [r, rp] = await Promise.all([
    trainRunner.run({ cmd: 'equity', players: [{ cards: pl.cards }, ...opps.map(p => ({ cards: [], range: rangeOf(p) }))], board: h.board, trials: 8000, shareHist: true }), // vs ranges narrowed by betting
    trainRunner.run({ cmd: 'equity', players: [{ cards: pl.cards }, ...pre.map(x => ({ cards: [], range: x }))], board: h.board, trials: 4000 }), // policy input: vs preflop ranges
  ]);
  const eq = r.players[0].eq, n = opps.length, fair = 1 / (n + 1), ok = new Set();
  const eqP = rp.players[0].eq, scP = rp.players[0].scoop, mP = eqP - fair, dm = edgeSwing(h, hero, mP, pre);
  const T = withExploit(policyFor(h.street, 'reg'), h, hero), vsStation = stationInHand(h, hero);
  const d = policyDecide(h, hero, Object.assign({}, T, { bluff: 0, trap: 0, braise: 0, stab: 0 }), eqP, scP, n, dm); // deterministic (bluffs/traps handled below)
  const trapSpot = L.canCheck && d.hu && mP >= T.big && T.trap >= 0.2;
  const bandTxt = q => q.band[0] > 0.01 ? `top ${q.band[0].toFixed(0)}–${q.band[1].toFixed(0)}%` : q.band[1] >= 99.9 ? 'any hand' : `top ${q.band[1].toFixed(0)}%`;
  const rangeTxt = opps.map(p => { const q = h.players[p], lbl = `${p} (${profOf(q).label})`;
    return q.cands && q.reads.length ? `${lbl}: ${bandTxt(q)}, narrowed to ~${Math.max(1, Math.round(100 * essOf(liveCands(h, p)) / q.candsStart))}% by ${q.reads.join(', ')}` : `${lbl}: ${bandTxt(q)}`; }).join('; ');
  const pp = x => (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(0);
  const notes = [];
  if (d.swung) notes.push(`<b>Equity swing:</b> your edge went from ${pp(mP - dm)} to ${pp(mP)} points this street, so the strategy gets aggressive${L.canCheck ? ` (bets from a ${pp(d.vbEff)} edge, ${Math.round(T.swingSize * 100)}% pot)` : T.swingRaise ? ` (raises ${Math.round(T.swingRaise * 100)} points more readily)` : ''}.`);
  else if (dm <= -0.08) notes.push(`Your edge fell from ${pp(mP - dm)} to ${pp(mP)} points this street.`);
  if (T.mode === 'station') notes.push('<b>Calling station in the hand:</b> no bluffs or traps, value-bet thinner, bomb scoop hands.');
  if (T.mode === 'tight') notes.push('<b>Only Nits left:</b> they rarely bluff, so no traps and value-bet thicker.');
  if (trapSpot) notes.push(`<b>Trap option:</b> heads-up with a big hand, the strategy checks ${Math.round(T.trap * 100)}% of the time to induce a bluff, so checking is fine too.`);
  if (d.init && L.canCheck && T.initVb) notes.push(`<b>Initiative:</b> you were last street's aggressor, so keep firing ${Math.round(T.initVb * 100)} points thinner.`);
  let why, size = null;
  if (L.canCheck) {
    if (d.a === 'raise') ok.add('raise'); else ok.add('check');
    if (Math.abs(mP - d.vbEff) < 0.03 && L.canRaise) { ok.add('raise'); ok.add('check'); }
    const bluffSpot = d.hu && mP < T.bluffMax && T.bluff >= 0.1 && L.canRaise;
    const stabSpot = !bluffSpot && d.a !== 'raise' && mP >= T.stabLo && T.stab >= 0.15 && L.canRaise;
    if (bluffSpot || stabSpot) ok.add('raise');
    if (trapSpot) ok.add('check');
    if (d.a === 'raise') size = { cls: d.kind, frac: d.size, txt: `${d.kind === 'bomb' ? 'bomb it' : d.kind === 'swing' ? 'swing bet' : d.kind === 'value' ? 'value bet' : 'thin value'} (~${Math.round(d.size * 100)}% pot)${d.kind === 'bomb' && vsStation ? ': a calling station is in the hand' : ''}` };
    else if (stabSpot) size = { cls: 'stab', frac: 1, txt: `stab pot; checked to and only slightly behind, the strategy bets here ${Math.round(T.stab * 100)}% of the time` };
    else if (bluffSpot) size = { cls: 'bluff', frac: T.bluffSize, txt: `bluff ~${Math.round(T.bluffSize * 100)}% pot; the strategy bluffs here ${Math.round(T.bluff * 100)}% of the time` };
    why = `Your edge is ${pp(mP)} points (equity ${P(eqP)} vs fair share ${P(fair)}), scoop chance ${P(scP)}. ${notes.join(' ')} Strategy: bet from a ${pp(d.vbEff)} edge${d.hu && T.huVb ? ` (heads-up ${Math.round(T.huVb * 100)} points thinner)` : ''}.${size ? ` Size: ${size.txt}.` : ''} <span class="muted">Vs ranges narrowed by betting (${rangeTxt}): ${P(eq)}.</span>`;
  } else {
    // call / fold: your equity vs the hands they are likely to hold (read from their betting, the same numbers as the call-math box)
    // against the price after rake; flop/turn ask a little extra because you still have to play later streets
    const cp = callPrice(h), margin = h.street === 'river' ? 0 : h.street === 'turn' ? 0.02 : 0.03, callLine = cp.be + margin;
    // call vs fold comes from the read alone; raising also needs the read to say you are at least a call
    const raiseByPolicy = (d.a === 'raise' || (L.canRaise && Math.abs(eqP - (d.req + d.rM)) < 0.03)) && eq >= callLine - 0.03;
    ok.add(eq >= callLine ? 'call' : 'fold');
    if (Math.abs(eq - callLine) < 0.03) { ok.add('call'); ok.add('fold'); }
    if (raiseByPolicy) { ok.add('raise'); ok.add('call'); ok.delete('fold'); if (Math.abs(eq - callLine) < 0.03) ok.add('fold'); }
    why = `Your equity vs their likely hands is <b>${P(eq)}</b> (read from their betting: ${rangeTxt}). Calling ${fmtAmt(cp.toCall)} for a final pot of ${fmtAmt(cp.net)} (after rake) needs ${P(cp.be)}${margin ? ` + ${Math.round(margin * 100)} points because later streets are still to play` : ''} = ${P(callLine)}. Raise when your equity vs their whole range is ${P(d.req + d.rM)}+${T.raiseSc <= 1 ? ` or scoop ≥ ${P(T.raiseSc)}` : ''} (yours ${P(eqP)}, scoop ${P(scP)}). ${notes.join(' ')}`;
  }
  return { ok, why, eq, eqP, size, hist: r.shareHist, opps };
}

// ---------- your options ----------
function heroOptions(h) {
  const L = legal(h, h.hero), pl = h.players[h.hero], o = [];
  const allinTxt = to => to >= pl.sb + pl.stack - 1e-9 ? 'All-in ' : '';
  if (h.first) {
    spotActions(h.spot).slice().reverse().forEach(a => {
      if (a.a === 'fold') o.push({ a: 'fold', label: 'Fold', key: 'F' });
      else if (a.a === 'call') o.push({ a: 'call', label: `${a.label} ${fmtAmt(L.toCall)}`, key: 'C' });
      else o.push({ a: 'raise', to: L.maxTo, label: `${a.label} to ${fmtAmt(L.maxTo)}`, key: 'R' });
    });
    return o;
  }
  if (!L.canCheck) o.push({ a: 'fold', label: 'Fold', key: 'F' });
  o.push(L.canCheck ? { a: 'check', label: 'Check', key: 'C' } : { a: 'call', label: `Call ${L.toCall >= pl.stack - 1e-9 ? 'all-in ' : ''}${fmtAmt(L.toCall)}`, key: 'C' });
  if (L.canRaise) {
    if (L.canCheck && h.street !== 'pre') {
      const seen = new Set();
      [[1 / 3, '⅓ pot', '1'], [2 / 3, '⅔ pot', '2'], [1, 'Pot', '3']].forEach(([f, n, k]) => {
        const to = Math.max(L.minTo, Math.min(L.maxTo, f * L.pot)), key = to.toFixed(1);
        if (seen.has(key)) return; seen.add(key);
        o.push({ a: 'raise', to, label: `${allinTxt(to) || 'Bet '}${n} · ${fmtAmt(to)}`, key: k });
      });
    } else {
      const name = h.street === 'pre' ? RAISE_NAMES[Math.min(5, h.raises + 1)] : 'Raise';
      o.push({ a: 'raise', to: L.maxTo, label: `${allinTxt(L.maxTo) || name + ' to '}${fmtAmt(L.maxTo)}`, key: 'R' });
    }
  }
  return o;
}

// ---------- flow of the hand ----------
async function runHand(h) {
  while (h === H && !h.over) {
    const nxt = nextToAct(h, h.cursor);
    if (nxt == null) { await endRound(h); continue; }
    if (nxt === h.hero) {
      h.heroTurn = true; h.opts = heroOptions(h);
      h.coachP = h.first ? null : heroCoach(h); if (h.coachP) h.coachP.catch(() => {});
      h.callMath = null;
      if (h.coachP && !legal(h, h.hero).canCheck && (h.street === 'river' || ($('#mathAll') && $('#mathAll').checked))) {
        const me = h, st = h.street;
        h.coachP.then(c => { if (me === H && me.heroTurn && me.street === st && c && c.hist) { me.callMath = callMathHTML(me, c); renderHand(me); } }).catch(() => {});
      }
      renderHand(h); return;
    }
    h.thinking = nxt; renderHand(h);
    await wait(h.heroFolded ? 180 : h.street === 'pre' ? 380 : 650);
    if (h !== H) return;
    const d = botDecide(h, nxt);
    if (d.band) h.players[nxt].band = d.band;
    const potBefore = potOf(h), facing = h.bet > 1e-9, betBefore = h.bet, rctx = h.street !== 'pre' && d.a !== 'fold' ? readCtx(h, nxt) : null;
    act(h, nxt, d.a, d.to);
    if (h.street !== 'pre' && d.a !== 'fold' && !h.players[nxt].folded) {
      const pl = h.players[nxt];
      const kind = d.a === 'raise' && pl.sb > betBefore + 1e-9 ? (facing ? 'raise' : 'bet') : d.a === 'check' ? 'check' : 'call';
      if (!h.heroFolded) narrowRange(h, nxt, kind, (pl.sb - betBefore) / Math.max(1, potBefore), rctx);
    }
    h.thinking = null; renderHand(h);
  }
}
function dealNext(h) {
  const n = h.board.length === 0 ? 3 : 1;
  h.board.push(...deal(n, usedOf(h)));
  h.street = h.board.length === 3 ? 'flop' : h.board.length === 4 ? 'turn' : 'river';
  logH(h, `<b>${SNAME[h.street]}</b> ${h.board.map(cardTxt).join(' ')} · pot ${fmtAmt(potOf(h))}`);
}
async function endRound(h) {
  const live = liveOf(h);
  POS.forEach(p => { const pl = h.players[p]; pl.sb = 0; pl.acted = false; if (!pl.folded && !pl.allin) { pl.tag = ''; } });
  h.bet = 0; h.fullBet = 0; h.lastRaise = 1; h.shortRaise = false; h.raises = 0; h.prevAggr = h.aggr; h.aggr = null;
  if (live.length === 1) { const st = settleHand(h, null); return finish(h, st.won, null, st.ret); }
  if (h.street === 'river') return showdown(h);
  if (live.filter(p => !h.players[p].allin).length <= 1) { // all-in: show equities and run it out
    h.reveal = true;
    const job = E.createEquityJob({ players: live.map(p => ({ cards: h.players[p].cards })), board: h.board, trials: 6000, exactLimit: 20000 });
    job.step(1e9); const r = job.result();
    h.allinEq = {}; live.forEach((p, i) => h.allinEq[p] = r.players[i].eq);
    logH(h, `<b>All-in</b> · ${live.map(p => `${nameOf(h, p)} ${P(h.allinEq[p])}`).join(', ')}`);
    renderHand(h); await wait(h.heroFolded ? 500 : 1300);
    while (h.board.length < 5) { if (h !== H) return; dealNext(h); renderHand(h); await wait(h.heroFolded ? 400 : 1000); }
    if (h !== H) return;
    return showdown(h);
  }
  dealNext(h); h.cursor = 'BTN';
  renderHand(h); await wait(h.heroFolded ? 250 : 650);
}
const rakeOf = h => h.board.length >= 3 ? { pct: CFG.rakePct / 100, cap: CFG.rakeCap } : null; // no flop, no drop
function settleHand(h, res) { // uncalled bets back, main + side pots, rake, hi/lo split (E.settle)
  const live = POS.map(p => !h.players[p].folded);
  const S = E.settle(POS.map(p => h.players[p].contrib), live, POS.map(p => res && res[p] ? res[p].hi.value : 0), POS.map(p => res && res[p] ? res[p].lo.mask : E.NO_LOW), rakeOf(h));
  const won = {}; POS.forEach((p, i) => { if (S.won[i] > 1e-9) won[p] = S.won[i]; });
  if (S.returnedTo >= 0) logH(h, `Uncalled ${fmtAmt(S.returned)} returned to ${nameOf(h, POS[S.returnedTo])}`);
  if (S.pots.length > 1) S.pots.forEach((q, k) => logH(h, `${k ? 'Side pot ' + k : 'Main pot'} ${fmtAmt(q.amt)}: ${q.loW.length ? `high ${q.hiW.map(i => nameOf(h, POS[i])).join(' & ')}, low ${q.loW.map(i => nameOf(h, POS[i])).join(' & ')}` : q.hiW.map(i => nameOf(h, POS[i])).join(' & ')}`));
  h.rake = S.rake; if (S.rake > 1e-9) logH(h, `<span class="muted">Rake ${fmtAmt(S.rake)}</span>`);
  return { won, main: S.pots[0], ret: S.returnedTo >= 0 ? { [POS[S.returnedTo]]: S.returned } : {} };
}
function showdown(h) {
  const live = liveOf(h); h.reveal = true;
  const res = {}; live.forEach(p => res[p] = { hi: E.bestHiDetail(h.players[p].cards, h.board), lo: E.bestLowDetail(h.players[p].cards, h.board) });
  live.forEach(p => logH(h, `${nameOf(h, p)} show${p === h.hero ? '' : 's'} ${E.describeHi(res[p].hi.value)} · ${E.describeLow(res[p].lo.mask)}`));
  const { won, main, ret } = settleHand(h, res);
  finish(h, won, { res, hiW: main.hiW.map(i => POS[i]), loW: main.loW.map(i => POS[i]) }, ret);
}
function countResult(h) { // your result for the session stats (once per hand; a fold is final even while the bots play on)
  h.net = h.players[h.hero].stack - 100;
  if (h.played && !h.counted) { h.counted = true; sess.pre.pl += h.net; sess.pre.hands++; ST.pre.pl = (ST.pre.pl || 0) + h.net; ST.pre.hands = (ST.pre.hands || 0) + 1; saveStats(); }
}
function finish(h, won, sd, ret = {}) {
  Object.entries(won).forEach(([p, a]) => { h.players[p].stack += a; const w = a - (ret[p] || 0); if (w > 1e-9) logH(h, `${nameOf(h, p)} win${p === h.hero ? '' : 's'} ${fmtAmt(w)}`); });
  h.over = true; h.won = won; h.sd = sd || null; h.heroTurn = false; h.thinking = null; h.reveal = h.reveal || !!sd;
  countResult(h);
  renderHand(h); archiveHand(h); drawPreSession();
}

// ---------- your actions ----------
async function heroChoose(i) {
  const h = H; if (!h || !h.heroTurn || h.busy || h.over) return;
  const opt = h.opts[i]; if (!opt) return;
  h.busy = true; h.heroTurn = false; h.chosen = i; renderHand(h);
  const cat = opt.a;
  if (h.first) {
    h.preLabel = opt.label;
    await answerPre(cat);
    if (h !== H) return;
    h.first = false; drawCoach(h);
    h.played = $('#prePlayOut').checked;
  } else {
    let c; try { c = await h.coachP; } catch (e) { c = null; }
    if (h !== H) return;
    if (c) {
      const ok = c.ok.has(cat), names = { fold: 'Fold', check: 'Check', call: 'Call', raise: L_RAISE(h) };
      let why = c.why;
      if (cat === 'raise' && c.size && legal(h, h.hero).canCheck) {
        const frac = (opt.to - h.bet) / Math.max(1, legal(h, h.hero).pot);
        if (Math.abs(frac - c.size.frac) > 0.2) why += ` <b>Sizing:</b> you bet ${Math.round(frac * 100)}% pot; the strategy would ${c.size.txt}.`;
      }
      h.decisions.push({ street: SNAME[h.street], label: opt.label, ok, best: [...c.ok].map(x => names[x]).join(' or ') + (c.size && c.ok.has('raise') ? ` (${c.size.txt})` : ''), why, mixed: c.ok.size > 1 });
      ST.post = ST.post || { n: 0, ok: 0 }; ST.post.n++; if (ok) ST.post.ok++; sess.post.n++; if (ok) sess.post.ok++;
      saveStats(); drawCoach(h);
    }
  }
  h.busy = false; h.chosen = null;
  act(h, h.hero, cat, opt.to);
  if (cat === 'fold') {
    h.heroFolded = true;
    if (h.street === 'pre' || !h.played) return finish(h, {});
    countResult(h); archiveHand(h); drawPreSession(); // your result is final; the bots play the hand out quickly so you can see how it ends
    runHand(h); return;
  }
  if (!h.played) { h.over = true; renderHand(h); archiveHand(h); return; }
  runHand(h);
}
const L_RAISE = h => legal(h, h.hero).canCheck && h.street !== 'pre' ? 'Bet' : 'Raise';

// ---------- call math: what each outcome pays when you call (esp. getting quartered) ----------
const FRAC_GLYPH = [[1 / 6, '⅙'], [1 / 4, '¼'], [1 / 3, '⅓'], [1 / 2, '½'], [2 / 3, '⅔'], [3 / 4, '¾'], [5 / 6, '⅚']];
const fracName = x => { const g = FRAC_GLYPH.find(([v]) => Math.abs(v - x) < 0.02); return g ? g[1] + ' pot' : `~${Math.round(x * 100)}% pot`; };
// the price of a call. The equity counts every live opponent going to showdown, so the pot is priced the same way: players behind call too.
function callPrice(h) {
  const L = legal(h, h.hero), behind = liveOf(h).filter(q => q !== h.hero && !h.players[q].allin && h.players[q].sb < h.bet - 1e-9);
  const extra = behind.reduce((a, q) => a + Math.min(h.bet - h.players[q].sb, h.players[q].stack), 0);
  const potIf = L.pot + L.toCall + extra, net = raked(potIf);
  return { toCall: L.toCall, behind, extra, potIf, net, be: L.toCall / net };
}
function callMathHTML(h, c) {
  const f = x => fmtAmt(x), sg = x => (x >= 0 ? '+' : '−') + fmtAmt(Math.abs(x));
  const { toCall, behind, extra, potIf, net } = callPrice(h), L = { toCall };
  const NAMES = { scoop: () => 'Scoop', threeQuarter: x => fracName(x.share), half: x => Math.abs(x.share - 0.5) < 0.02 ? 'Half' : fracName(x.share), quartered: x => Math.abs(x.share - 0.25) < 0.02 ? 'Quartered (¼)' : `Split (${fracName(x.share)})`, lose: () => 'Lose' };
  const order = ['scoop', 'threeQuarter', 'half', 'quartered', 'lose'];
  const rows = order.map(k => c.hist.find(x => x.k === k)).filter(x => x && x.p >= 0.005).map(x => {
    const collect = x.share * net, profit = collect - L.toCall;
    return `<tr class="${x.k === 'quartered' ? 'q' : ''}"><td>${NAMES[x.k](x)}</td><td>${Math.round(x.p * 100)}%</td><td>${x.k === 'lose' ? '—' : f(collect)}</td><td class="${profit >= 0 ? 'pos' : 'neg'}">${sg(profit)}</td></tr>`;
  }).join('');
  const ev = c.eq * net - L.toCall, be = L.toCall / net, q = c.hist.find(x => x.k === 'quartered');
  return `<div class="callmath"><div class="cm-h">Call math · ${SNAME[h.street].toLowerCase()}</div>
    <div class="cm-line">Call <b>${f(L.toCall)}</b> to win <b>${f(net - L.toCall)}</b> <span class="muted">(pot ${f(potIf)} if you call${extra > 0 ? ` and ${behind.join(' & ')} call${behind.length > 1 ? '' : 's'} behind` : ''}, ${f(net)} after rake)</span></div>
    <table><tr class="cm-th"><th>Outcome</th><th>Chance</th><th>You get</th><th>Net</th></tr>${rows}</table>
    ${q && q.p >= 0.05 ? `<div class="cm-q">${Math.abs(q.share - 0.25) < 0.02 ? 'Quartered' : 'Small split'}: you get back ${f(q.share * net)} of the ${f(L.toCall)} you put in (${sg(q.share * net - L.toCall)}).</div>` : ''}
    <div class="cm-ev ${ev >= 0 ? 'pos' : 'neg'}">EV of calling: <b>${sg(ev)} bb</b> vs folding · break-even pot share ${P(be)}, yours ${P(c.eq)}</div>
    <div class="cm-f">vs ${c.opps.map(p => `${p} (${profOf(h.players[p]).label})`).join(', ')}'s range, read from their betting</div></div>`;
}

// ---------- rendering ----------
// ---------- hand review: snapshots, back / forward / replay ----------
const HANDS = []; // finished hands, most recent last
let RV = null;    // review state: { h, i, timer, reveal }
function snapOf(h) {
  return { players: Object.fromEntries(POS.map(p => { const pl = h.players[p]; return [p, { cards: pl.cards, folded: pl.folded, stack: pl.stack, sb: pl.sb, tag: pl.tag, tagCls: pl.tagCls, contrib: pl.contrib, prof: pl.prof }]; })),
    board: h.board.slice(), street: h.street, sd: h.sd, over: h.over, won: h.won, allinEq: h.allinEq, reveal: h.reveal,
    preRes: h.preRes, played: h.played, net: h.net, heroFolded: h.heroFolded, logLen: h.log.length, hero: h.hero, thinking: null };
}
function recordSnap(h) {
  h.snaps = h.snaps || [];
  const key = `${h.log.length}|${h.board.length}|${!!h.over}|${!!h.allinEq}|${!!h.sd}|${!!h.preRes}`;
  if (h.snapKey === key) return;
  h.snapKey = key; h.snaps.push(snapOf(h));
}
function archiveHand(h) { if (!HANDS.includes(h)) { recordSnap(h); HANDS.push(h); if (HANDS.length > 50) HANDS.shift(); } }
function renderHand(h) {
  if (RV) return; // reviewing: the live table is frozen
  recordSnap(h);
  drawView(h, h, false);
}
function startReview(h, i, play) {
  stopReplay();
  if (!h || !h.snaps || !h.snaps.length) return;
  RV = { h, i: Math.max(0, Math.min(h.snaps.length - 1, i)), timer: null, reveal: RV ? RV.reveal : true };
  if (h.panels) { $('#preFb').innerHTML = h.panels.fb; $('#preFb').classList.add('show'); $('#preTree').innerHTML = h.panels.tree; $('#preFlow').innerHTML = h.panels.flow; }
  drawCoach(h);
  if (play) { RV.i = 0; togglePlay(); } else drawReview();
}
function drawReview() { if (RV) drawView(RV.h, RV.h.snaps[RV.i], true); }
function stepReview(d) { if (!RV) return; stopReplay(); RV.i = Math.max(0, Math.min(RV.h.snaps.length - 1, RV.i + d)); drawReview(); }
function stopReplay() { if (RV && RV.timer) { clearInterval(RV.timer); RV.timer = null; } }
function togglePlay() {
  if (!RV) return;
  if (RV.timer) { stopReplay(); drawReview(); return; }
  if (RV.i >= RV.h.snaps.length - 1) RV.i = 0;
  RV.timer = setInterval(() => { if (!RV) return; if (RV.i >= RV.h.snaps.length - 1) { stopReplay(); drawReview(); return; } RV.i++; drawReview(); }, 950);
  drawReview();
}
function reviewHand(d) { // move between archived hands
  if (!RV) return;
  const k = HANDS.indexOf(RV.h) + d;
  if (k < 0 || k >= HANDS.length) return;
  startReview(HANDS[k], HANDS[k].snaps.length - 1);
}
function exitReview() { stopReplay(); RV = null; nextPre(); }
function drawView(h, v, review) {
  const seats = {};
  POS.forEach(p => {
    const pl = v.players[p], isHero = p === h.hero, revealAll = review && RV.reveal;
    let state = pl.folded ? 'folded' : 'active';
    if (isHero && !pl.folded) state = !review && h.heroTurn ? 'acting' : 'hero';
    if (!isHero && !review && h.thinking === p) state = 'acting';
    let under = '';
    if (v.sd && v.sd.res[p]) {
      const R = v.sd.res[p];
      under = `<div class="sdres">${v.sd.hiW.includes(p) ? '<span class="badge hi">HI</span> ' : ''}${E.describeHi(R.hi.value)}<br>${v.sd.loW.includes(p) ? '<span class="badge lo">LO</span> ' : ''}${E.describeLow(R.lo.mask)}${v.won && v.won[p] ? `<br><b class="won">+${fmtAmt(v.won[p])} bb</b>` : ''}</div>`;
    } else if (v.over && v.won && v.won[p]) under = `<div class="sdres"><b class="won">+${fmtAmt(v.won[p])} bb</b></div>`;
    else if (v.allinEq && !pl.folded) under = `<div class="eqbadge ${isHero ? 'hero' : ''}"><b>${P(v.allinEq[p])}</b><span>all-in equity</span></div>`;
    seats[p] = { state, cards: pl.cards, faceUp: isHero || revealAll || (v.reveal && !pl.folded), showCards: revealAll && pl.folded && !!pl.cards, cardCls: revealAll && pl.folded ? 'dim' : '', badge: !isHero && pl.prof ? PROFILES[pl.prof].label : '', badgeCls: pl.prof || '', bet: pl.sb, stack: pl.stack, tag: pl.tag, tagCls: pl.tagCls, under,
      cls: v.sd ? (v.sd.hiW.includes(p) ? ' win-hi' : '') + (v.sd.loW.includes(p) ? ' win-lo' : '') : '' };
  });
  // highlight the hole cards used for the high hand at showdown
  let overlay = '';
  if (v.preRes && v.street === 'pre') {
    const g = v.preRes.g, lab = x => g.acts.find(y => y.a === x).label;
    overlay = v.preRes.ok ? `<div class="verdict-pill ${g.mixed ? 'mix' : 'ok'}">✓ ${g.mixed ? 'Correct · mixed spot' : 'Correct'}</div>` : `<div class="verdict-pill no">✗ ${[...g.ok].map(lab).join(' or ')}</div>`;
    overlay += `<div class="overlay-sub">top ${v.preRes.rk.top.toFixed(1)}% · ${P(v.preRes.rk.eq)} vs playing hands</div>`;
  }
  if (v.over && v.played) {
    const n = v.net;
    overlay = `<div class="verdict-pill ${v.heroFolded ? 'mix' : n > 1e-9 ? 'ok' : n < -1e-9 ? 'no' : 'mix'}">${v.heroFolded ? 'You folded' : n > 1e-9 ? 'You win' : n < -1e-9 ? 'You lose' : 'Break even'} · ${n >= 0 ? '+' : '−'}${fmtAmt(Math.abs(n))} bb</div>` + (v.sd ? `<div class="overlay-sub">${v.sd.loW.length ? `High: ${v.sd.hiW.map(p => nameOf(h, p)).join(' & ')} · Low: ${v.sd.loW.map(p => nameOf(h, p)).join(' & ')}` : `${v.sd.hiW.map(p => nameOf(h, p)).join(' & ')} — no low`}</div>` : '');
  }
  const L = !review && h.heroTurn ? legal(h, h.hero) : null;
  let prompt;
  if (review) {
    const line = (h.log[v.logLen - 1] || '').replace(/<[^>]+>/g, '');
    prompt = `<div class="spot-title" id="preTitle">Review · step ${RV.i + 1} of ${h.snaps.length}</div><div class="muted">${line} · hand ${HANDS.indexOf(h) + 1} of ${HANDS.length}</div>`;
  } else if (h.first) prompt = `<div class="spot-title" id="preTitle">${spotTitle(h.spot)}</div><div class="muted">${h.spot.type === 'rfi' ? (h.spot.hero === 'SB' ? 'Raise, complete, or fold?' : 'Raise or fold?') : h.spot.type === 'vsopen' ? '3-bet, call, or fold?' : '4-bet, call, or fold?'} · graded by ${CFG.gradeBy === 'ev' ? 'best EV' : 'the range chart'}</div>`;
  else if (h.over) prompt = `<div class="spot-title" id="preTitle">${h.played ? 'Hand over' : 'Decision graded'}</div><div class="muted">${h.played ? 'Press Space for the next hand' : 'Turn on "Play hands out" to keep playing after the first decision'}</div>`;
  else if (h.heroFolded) prompt = `<div class="spot-title" id="preTitle">You folded</div><div class="muted">The bots play the hand out so you can see how it ends · Space for the next hand</div>`;
  else if (h.heroTurn) prompt = `<div class="spot-title" id="preTitle">${SNAME[h.street]} · your action</div><div class="muted">Pot ${fmtAmt(L.pot)}${L.toCall > 0 ? ` · to call ${fmtAmt(L.toCall)} (${P(L.toCall / (L.pot + L.toCall), 0)} pot odds)` : ''}</div>`;
  else prompt = `<div class="spot-title" id="preTitle">${SNAME[h.street]}</div><div class="muted">${h.thinking ? `${h.thinking} is thinking…` : h.busy ? 'Grading your decision…' : 'Dealing…'}</div>`;
  let actions = '';
  if (h.opts && (h.heroTurn || h.busy) && !h.over) actions = h.opts.map((o, i) => {
    const cls = o.a === 'fold' ? 'a-fold' : o.a === 'raise' ? 'a-raise' : 'a-call';
    return `<button class="pact ${cls} ${h.chosen === i ? 'pending' : ''}" data-i="${i}" data-a="${o.a}" ${h.heroTurn ? '' : 'disabled'}>${o.label}<kbd>${o.key}</kbd></button>`;
  }).join('');
  if (h.over && !review) actions = `<button class="rbtn" data-r="back" title="Step back through this hand (←)">◀ Back</button><button class="rbtn" data-r="replay" title="Replay the hand (P)">⏵ Replay</button><button class="pact a-next" id="preNext">Next hand<kbd>Space</kbd></button>`;
  if (review) {
    const k = HANDS.indexOf(h), atStart = RV.i === 0, atEnd = RV.i >= h.snaps.length - 1;
    actions = `<div class="rgroup"><button class="rbtn" data-r="start" ${atStart ? 'disabled' : ''} title="Start (Home)">⏮</button><button class="rbtn" data-r="back" ${atStart ? 'disabled' : ''} title="Back (←)">◀ Back</button>
      <button class="rbtn play" data-r="play" title="Replay / pause (P)">${RV.timer ? '⏸ Pause' : '⏵ Replay'}</button>
      <button class="rbtn" data-r="fwd" ${atEnd ? 'disabled' : ''} title="Forward (→)">Forward ▶</button><button class="rbtn" data-r="end" ${atEnd ? 'disabled' : ''} title="End (End)">⏭</button></div>
      <div class="rgroup"><button class="rbtn" data-r="prevhand" ${k <= 0 ? 'disabled' : ''} title="Previous hand">◀ Hand</button><button class="rbtn" data-r="nexthand" ${k >= HANDS.length - 1 ? 'disabled' : ''} title="Later hand">Hand ▶</button>
      <label class="rchk"><input type="checkbox" id="rvReveal" ${RV.reveal ? 'checked' : ''}> Show all cards</label></div>
      <button class="pact a-next" data-r="exit">Next hand<kbd>Space</kbd></button>`;
  }
  $('#preTable').innerHTML = tableHTML({
    hero: h.hero, seats, board: v.board, dealer: 'BTN', pot: `Pot <b>${fmtAmt(potOf(v))} bb</b>`, overlay, prompt, extra: !review && h.heroTurn && h.callMath ? h.callMath : '',
    actions: `<div class="pact-row" id="preActions">${actions}</div>`,
  });
  if (v.sd) liveOf(v).forEach(p => {
    const hc = v.sd.res[p].hi.cards || [];
    $$(`#preTable .pseat[data-pos="${p}"] .pcards .card`).forEach(c => { if (hc.includes(+c.dataset.c)) c.classList.add('used'); });
  });
  $$('#preActions .pact[data-i]').forEach(b => b.onclick = () => heroChoose(+b.dataset.i));
  const nx = $('#preNext'); if (nx) nx.onclick = () => nextPre();
  const R_ACT = { back: () => RV ? stepReview(-1) : startReview(h, h.snaps.length - 2), replay: () => startReview(h, 0, true), start: () => stepReview(-1e6), end: () => stepReview(1e6),
    fwd: () => stepReview(1), play: togglePlay, prevhand: () => reviewHand(-1), nexthand: () => reviewHand(1), exit: exitReview };
  $$('#preTable [data-r]').forEach(b => b.onclick = () => R_ACT[b.dataset.r]());
  const rv = $('#rvReveal'); if (rv) rv.onchange = e => { RV.reveal = e.target.checked; drawReview(); };
  if (review) {
    $('#preLog').innerHTML = h.log.map((x, i) => `<div class="${i === v.logLen - 1 ? 'cur' : i >= v.logLen ? 'future' : ''}">${x}</div>`).join('');
    const cur = $('#preLog .cur'); if (cur) cur.scrollIntoView({ block: 'nearest' });
  } else { $('#preLog').innerHTML = h.log.map(x => `<div>${x}</div>`).join(''); $('#preLog').scrollTop = 1e6; }
}
function drawCoach(h) {
  const rows = [];
  if (h.preRes) {
    const g = h.preRes.g, lab = x => g.acts.find(y => y.a === x).label;
    rows.push({ street: 'Preflop', label: h.preLabel || lab(h.preRes.choice), ok: h.preRes.ok, mixed: g.mixed, best: [...g.ok].map(lab).join(' or '),
      why: `Range chart: your hand is top ${h.preRes.rk.top.toFixed(1)}%. ${g.acts.slice(0, -1).map(x => `${x.label} top ${x.top.toFixed(1)}%`).join(', ')}, fold the rest.` });
  }
  rows.push(...h.decisions);
  $('#preCoach').innerHTML = rows.length ? rows.map(d => `<div class="coachrow"><span class="badge ${d.ok ? 'ok' : 'no'}">${d.ok ? '✓' : '✗'}</span>
    <div><b>${d.street}: you ${d.label}</b> · recommended: <b style="color:${d.ok ? 'var(--good)' : 'var(--bad)'}">${d.best}</b>${d.mixed ? ' <span class="muted">(close spot)</span>' : ''}<div class="muted">${d.why}</div></div></div>`).join('')
    : '<span class="muted">Every decision you make this hand is graded here, starting with preflop.</span>';
}

const openerProfOf = (h, spot) => spot.type === 'vsopen' && h && h.players[spot.opener] ? h.players[spot.opener].prof : null;
// ---------- preflop trainer entry points ----------
function nextPre() {
  if (RV) { stopReplay(); RV = null; }
  const spot = genSpot(), hand = genHand(spot);
  pre = { spot, hand, answered: false };
  pre.rankP = simRank(hand); pre.evP = evRun(spot, hand);
  pre.rankP.catch(() => {}); pre.evP.catch(() => {});
  H = newHand(spot, hand);
  $('#preFb').className = 'feedback panel'; $('#preFb').innerHTML = '';
  $('#preFlow').innerHTML = flowHTML(spot, undefined, spotActionsFor(spot, openerProfOf(H, spot)));
  $('#preTree').innerHTML = '<div class="muted">Act to reveal the EV of each choice.</div>';
  drawCoach(H);
  runHand(H);
}
async function answerPre(a) {
  if (!pre || pre.answered) return;
  const me = pre; me.answered = true;
  const fb = $('#preFb');
  fb.innerHTML = '<div class="muted">Simulating this hand and the EV tree…</div>'; fb.classList.add('show');
  let rk, tree;
  try { [rk, tree] = await Promise.all([me.rankP, me.evP]); }
  catch (e) { fb.innerHTML = `<div class="verdict no">Simulation failed: ${e.message}</div>`; return; }
  if (me !== pre) return;
  const oprof = H ? openerProfOf(H, me.spot) : null, adjActs = spotActionsFor(me.spot, oprof);
  const gr = gradeRange(me.spot, rk.top, adjActs), grBal = adjActs.adjusted ? gradeRange(me.spot, rk.top) : null, ge = gradeEV(me.spot, tree);
  const g = CFG.gradeBy === 'ev' ? ge : gr;
  const ok = g.ok.has(a);
  sess.pre.n++; if (ok) { sess.pre.ok++; sess.pre.streak++; } else sess.pre.streak = 0;
  ST.pre.n++; if (ok) ST.pre.ok++; ST.pre.best = Math.max(ST.pre.best, sess.pre.streak);
  bump(ST.pre.byPos, me.spot.hero, ok); bump(ST.pre.byType, me.spot.type, ok);
  const lab = x => g.acts.find(y => y.a === x).label;
  if (!ok) { ST.pre.mist.unshift({ hand: handStr(me.hand), spot: spotTitle(me.spot), you: lab(a), right: [...g.ok].map(lab).join(' / '), top: +rk.top.toFixed(1), t: Date.now() }); ST.pre.mist = ST.pre.mist.slice(0, 30); }
  saveStats();
  if (H) H.preRes = { choice: a, ok, g, rk };
  const vclass = ok ? (g.mixed ? 'mix' : 'ok') : 'no';
  const vtext = ok ? (g.mixed ? '✓ Correct — mixed spot, either action is fine' : '✓ Correct') : `✗ Mistake — ${[...g.ok].map(lab).join(' or ')}`;
  const segs = []; let prev = 0;
  gr.acts.forEach(x => { const w = x.top - prev; if (w > 0) segs.push(`<div class="r-${x.a}" style="width:${w}%" title="${x.label}: top ${prev.toFixed(1)}–${x.top.toFixed(1)}%">${w > 6 ? x.label : ''}</div>`); prev = x.top; });
  const evBest = ge.evs[0], evOf = x => ge.evs.find(e => e.a === x).ev;
  const typeNote = adjActs.adjusted ? `<div class="section" style="color:var(--warn)">The opener is a <b>${PROFILES[adjActs.adjusted].label}</b>, so the call range is adjusted: call top ${adjActs.find(x => x.a === 'call').top.toFixed(1)}% instead of top ${spotActions(me.spot).find(x => x.a === 'call').top.toFixed(1)}% vs a balanced opener${grBal && [...grBal.ok].join() !== [...gr.ok].join() ? ` (vs a balanced opener this hand would be: ${[...grBal.ok].map(x => grBal.acts.find(y => y.a === x).label).join(' or ')})` : ''}. Self-play: defending just outside the chart is about −0.2bb vs Regs but +1.6 to +1.8bb vs Maniac stations.</div>` : '';
  const agree = gr.ok.has(ge.best) ? `<span class="muted">The EV tree agrees: best EV is ${lab(ge.best)} (${fmtBB(evBest.ev)}).</span>`
    : `<span style="color:var(--warn)">The EV tree prefers ${lab(ge.best)} (${fmtBB(evBest.ev)} vs ${fmtBB(evOf(gr.best))} for ${lab(gr.best)}). Switch "Grade by" to grade on EV.</span>`;
  fb.innerHTML = `<div class="verdict ${vclass}">${vtext} <span class="muted" style="font-size:12px;font-weight:500">preflop decision · graded by ${CFG.gradeBy === 'ev' ? 'best EV' : 'range chart'}</span></div>
    <div>This hand is <b>${rankText(rk)}</b> — ${P(rk.eq)} pot share vs 2 playing hands (simulated). Spot ranges: ${gr.acts.slice(0, -1).map(x => `${x.label} top ${x.top.toFixed(1)}%`).join(', ')}; fold the rest.</div>
    <div class="rangebar">${segs.join('')}<span class="marker" style="left:calc(${Math.min(99.5, rk.top)}% - 1px)" title="Your hand: top ${rk.top.toFixed(1)}%"></span></div>
    <div class="rangeaxis"><span>best hands</span><span>▲ = your hand</span><span>worst hands</span></div>
${typeNote}
    <div class="section">${agree}</div>
    <div class="chips section">${featureChips(me.hand)}</div>`;
  $('#preFlow').innerHTML = flowHTML(me.spot, { rk, g });
  $('#preTree').innerHTML = `<ul class="tree">${treeHTML(tree)}</ul>`;
  if (H) H.panels = { fb: fb.innerHTML, tree: $('#preTree').innerHTML, flow: $('#preFlow').innerHTML };
  drawPreSession();
  if (ok && $('#preAuto').checked && !$('#prePlayOut').checked) setTimeout(() => { if (pre === me && !RV) nextPre(); }, g.mixed ? 1600 : 900);
}
