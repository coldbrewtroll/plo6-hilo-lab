// =====================================================================
// STRATEGY: hand ranking (simulated), configurable ranges, EV model
// The ranking model/tables are calibrated offline by tools/calibrate.js
// =====================================================================
const MODEL = PLO6_MODEL;
const modelReady = Promise.resolve(MODEL);
function topFromQ(q, s) { // % of hands that are better than value s
  const n = q.length - 1;
  if (s <= q[0]) return 100; if (s >= q[n]) return 0;
  let lo = 0, hi = n;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (q[m] <= s) lo = m; else hi = m; }
  const f = q[hi] > q[lo] ? (s - q[lo]) / (q[hi] - q[lo]) : 0;
  return 100 * (1 - (lo + f) / n);
}
function valAtTop(q, t) {
  const n = q.length - 1, x = Math.max(0, Math.min(n, (1 - t / 100) * n)), i = Math.floor(x);
  return i >= n ? q[n] : q[i] + (x - i) * (q[i + 1] - q[i]);
}
const modelTop = h => topFromQ(MODEL.modelQuantiles, E.score(h, MODEL.w));
// opponent range = hands ranked between top a% and top b% (sampled via the fast model score)
let RANGE_POOL = 200000; // pre-sorted pool size used for fast opponent-range sampling
function rangeBand(a, b) {
  a = Math.max(0, a); b = Math.min(100, b);
  if (b - a < 2) { const mid = (a + b) / 2; a = Math.max(0, Math.min(98, mid - 1)); b = a + 2; }
  if (E.hasReal()) return { real: [a, b] }; // hands ranked by real simulated equity
  return { w: MODEL.w, pool: RANGE_POOL, max: a > 0.001 ? valAtTop(MODEL.modelQuantiles, a) : null, min: b < 99.999 ? valAtTop(MODEL.modelQuantiles, b) : null };
}
// Simulated rank: equity 3-way vs 2 hands from the top PLAY% ("hands that would actually play"),
// compared against the embedded table of the same metric for 24k simulated random hands.
const rankCache = new Map();
function simRank(hand, trials = 60000) {
  const key = handStr(sortHand(hand));
  if (rankCache.has(key)) return rankCache.get(key);
  const opp = rangeBand(0, MODEL.play);
  const p = trainRunner.run({ cmd: 'equity', players: [{ cards: hand }, { cards: [], range: opp }, { cards: [], range: opp }], trials })
    .then(r => { const eq = r.players[0].eq, top = topFromQ(MODEL.metricQuantiles, eq); return { eq, ci: r.players[0].ci, scoop: r.players[0].scoop, top, better: 100 - top }; });
  p.catch(() => rankCache.delete(key));
  rankCache.set(key, p);
  return p;
}
const rankText = rk => `better than ${rk.better.toFixed(1)}% of hands (top ${rk.top.toFixed(1)}%)`;

// ---------- configurable ranges ----------
// Defaults come from tools/solve.js: an iterated best-response fixed point of the EV model below,
// so the range chart and the EV tree agree at default settings.
const OPENERS = ['UTG', 'HJ', 'CO', 'BTN', 'SB'];
const PAIRS = OPENERS.flatMap((o, i) => POS.slice(i + 1).map(h => [o, h]));
function formulaTables(rfi) { // starting point for the solver
  const vsOpen = {}, vs3 = {};
  for (const [o, h] of PAIRS) {
    const r = rfi[o], tb = r * 0.3, cm = h === 'BB' ? 1.6 : h === 'SB' ? 0.5 : 0.9;
    vsOpen[o + '>' + h] = { tb, ct: Math.min(100, tb + r * cm) };
    const ip = isBlind(h) && o !== 'SB';
    vs3[o + '>' + h] = { fb: r * 0.13, cb: r * (0.13 + (ip ? 0.55 : 0.42)) };
  }
  return { vsOpen, vs3 };
}
const SOLVED = typeof PLO6_RANGES !== 'undefined' ? PLO6_RANGES : null;
const RFI0 = SOLVED ? SOLVED.rfi : { UTG: 16, HJ: 20, CO: 26, BTN: 36, SB: 30 };
const T0 = SOLVED ? { vsOpen: SOLVED.vsOpen, vs3: SOLVED.vs3 } : formulaTables(RFI0);
const CFG_DEFAULT = {
  rfi: Object.assign({}, RFI0), sbComplete: SOLVED ? SOLVED.sbComplete : 50, vsOpen: T0.vsOpen, vs3: T0.vs3,
  tbScale: 1, callScale: 1, fbScale: 1, call3Scale: 1,
  bbIso: SOLVED && SOLVED.bbIso ? SOLVED.bbIso : 25, foldTo4: 0.20, playSpread: 0.40, realIP: 0.90, realOOP: 0.75, realOOP3: 0.65, rakePct: 5, rakeCap: 2, gradeBy: 'range', adjustForType: true,
};
const CFG_KEY = 'plo6hl_cfg_v4'; // v4: charts tuned by self-play (round 9)
let CFG = (() => {
  const s = store.get(CFG_KEY, {});
  return Object.assign(JSON.parse(JSON.stringify(CFG_DEFAULT)), s, { rfi: Object.assign({}, CFG_DEFAULT.rfi, s.rfi || {}), vsOpen: CFG_DEFAULT.vsOpen, vs3: CFG_DEFAULT.vs3 });
})();
const saveCfg = () => { const c = Object.assign({}, CFG); delete c.vsOpen; delete c.vs3; store.set(CFG_KEY, c); };
function isBlind(p) { return p === 'SB' || p === 'BB'; }
function spotActions(spot) {
  if (spot.type === 'rfi') {
    if (spot.hero === 'SB') return [{ a: 'raise', label: 'Raise', top: CFG.rfi.SB }, { a: 'call', label: 'Complete', top: Math.max(CFG.rfi.SB, CFG.sbComplete) }, { a: 'fold', label: 'Fold', top: 100 }];
    return [{ a: 'raise', label: 'Raise', top: CFG.rfi[spot.hero] }, { a: 'fold', label: 'Fold', top: 100 }];
  }
  if (spot.type === 'vsopen') {
    const e = CFG.vsOpen[spot.opener + '>' + spot.hero];
    const tb = Math.min(100, e.tb * CFG.tbScale), ct = Math.min(100, tb + Math.max(0, e.ct - e.tb) * CFG.callScale);
    return [{ a: 'raise', label: '3-Bet', top: tb }, { a: 'call', label: 'Call', top: ct }, { a: 'fold', label: 'Fold', top: 100 }];
  }
  const e = CFG.vs3[spot.hero + '>' + spot.villain], open = CFG.rfi[spot.hero];
  const fb = Math.min(open, e.fb * CFG.fbScale), cb = Math.min(open, fb + Math.max(0, e.cb - e.fb) * CFG.call3Scale);
  return [{ a: 'raise', label: '4-Bet', top: fb }, { a: 'call', label: 'Call', top: cb }, { a: 'fold', label: 'Fold', top: 100 }];
}
const band = B => Math.max(0.4, B * 0.07);
// Opener-type adjustment for defending vs an open (played-out self-play sims: defending just outside the chart
// is ~-0.2bb vs Regs/Nits but +1.6 to +1.8bb vs Maniac stations, so the call range widens vs Maniacs).
const OPENER_CALL_MULT = { nit: 0.9, reg: 1, maniac: 1.8 };
function spotActionsFor(spot, openerProf) {
  const acts = spotActions(spot).map(a => Object.assign({}, a));
  if (spot.type === 'vsopen' && openerProf && openerProf !== 'reg' && CFG.adjustForType !== false) {
    const call = acts.find(a => a.a === 'call'), rb = acts.find(a => a.a === 'raise');
    call.top = Math.max(rb.top, Math.min(85, call.top * OPENER_CALL_MULT[openerProf]));
    call.label = 'Call'; acts.adjusted = openerProf;
  }
  return acts;
}
function gradeRange(spot, t, actsIn) {
  const acts = actsIn || spotActions(spot);
  let k = acts.findIndex(x => t <= x.top + 1e-9); if (k < 0) k = acts.length - 1;
  const ok = new Set([acts[k].a]);
  if (k > 0 && t - acts[k - 1].top <= band(acts[k - 1].top)) ok.add(acts[k - 1].a);
  if (k < acts.length - 1 && acts[k].top - t <= band(acts[k].top)) ok.add(acts[k + 1].a);
  return { acts, best: acts[k].a, ok, mixed: ok.size > 1, k };
}
const EV_MIX = 0.10; // bb: actions within this of the best EV are graded as mixed
function gradeEV(spot, tree) {
  const acts = spotActions(spot);
  const evs = tree.children.map(c => ({ a: c.a, ev: c.ev })).sort((x, y) => y.ev - x.ev);
  const ok = new Set(evs.filter(x => x.ev >= evs[0].ev - EV_MIX).map(x => x.a));
  return { acts, best: evs[0].a, ok, mixed: ok.size > 1, evs };
}
function spotTitle(s) {
  if (s.type === 'rfi') return `Folded to you in the ${s.hero}`;
  if (s.type === 'vsopen') return `${s.opener} opens. You're in the ${s.hero}.`;
  return `You open ${s.hero}, ${s.villain} 3-bets.`;
}

// ---------- EV model (pot-limit, 100bb, single opponent per branch) ----------
const BLIND = { SB: 0.5, BB: 1 };
const bl = p => BLIND[p] || 0;
const POSTFLOP = ['SB', 'BB', 'UTG', 'HJ', 'CO', 'BTN'];
const isIP = (a, b) => POSTFLOP.indexOf(a) > POSTFLOP.indexOf(b);
let HERO_TOP = 50; // set per evaluation: playability scales realization (nut-heavy hands over-realize, weak ones under-realize)
const playMult = () => 1 + CFG.playSpread * (0.5 - HERO_TOP / 100);
// pot3: a 3-bet pot — out of position there (low SPR, facing the stronger range / initiative) realizes less
const realOf = (h, v, pot3) => (isIP(h, v) ? CFG.realIP : pot3 ? CFG.realOOP3 : CFG.realOOP) * playMult();
const raked = pot => pot - Math.min(pot * CFG.rakePct / 100, CFG.rakeCap); // rake on pots that see a flop
const fmtBB = x => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(2) + ' bb';
const pctTxt = x => (x * 100).toFixed(0) + '%';
const rlab = (a, b) => a <= 0.001 ? `top ${b.toFixed(1)}%` : `top ${a.toFixed(1)}–${b.toFixed(1)}%`;
const vsOpenOf = (opener, hero) => { const a = spotActions({ type: 'vsopen', opener, hero }); return { tb: a[0].top, ct: a[1].top }; };
const vs3Of = (hero, villain) => { const a = spotActions({ type: 'vs3', hero, villain }); return { fb: a[0].top, cb: a[1].top, open: CFG.rfi[hero] }; };

// Each spot: list the equity sims needed (hero HU vs a range band), then build the tree from the results.
function evPlan(spot) {
  const s = spot, sims = {};
  if (s.type === 'rfi') {
    const behind = POS.slice(POS.indexOf(s.hero) + 1);
    const resp = behind.map(b => { const v = vsOpenOf(s.hero, b); return { b, p3: v.tb / 100, pc: Math.max(0, v.ct - v.tb) / 100, tb: v.tb, ct: v.ct }; });
    const argmax = k => resp.reduce((m, r) => r[k] >= m[k] ? r : m, resp[0]);
    const caller = argmax('pc'), tbr = argmax('p3');
    const byCall = resp.slice().sort((x, y) => y.pc - x.pc || POS.indexOf(y.b) - POS.indexOf(x.b));
    const c2 = byCall[1];
    sims.call = { band: [caller.tb, caller.ct], who: caller.b };
    if (c2) sims.call2 = { bands: [[caller.tb, caller.ct], [c2.tb, c2.ct]], who: caller.b + ' & ' + c2.b };
    sims.tb = { band: [0, tbr.tb], who: tbr.b };
    sims.tb4 = { band: [0, tbr.tb * (1 - CFG.foldTo4)], who: tbr.b };
    if (s.hero === 'SB') { sims.check = { band: [CFG.bbIso, 100], who: 'BB' }; sims.iso = { band: [0, CFG.bbIso], who: 'BB' }; }
    return { sims, resp, caller, tbr, c2 };
  }
  if (s.type === 'vsopen') {
    const v = vs3Of(s.opener, s.hero);
    sims.open = { band: [0, CFG.rfi[s.opener]], who: s.opener };
    sims.flat = { band: [v.fb, v.cb], who: s.opener };
    sims.fb = { band: [0, v.fb], who: s.opener };
    return { sims, v };
  }
  const v = vsOpenOf(s.hero, s.villain);
  sims.tb = { band: [0, v.tb], who: s.villain };
  sims.tb4 = { band: [0, v.tb * (1 - CFG.foldTo4)], who: s.villain };
  return { sims, v };
}
let EV_TRIALS = 20000;
function evRun(spot, hand) {
  const plan = evPlan(spot), keys = Object.keys(plan.sims);
  const opps = k => (plan.sims[k].bands || [plan.sims[k].band]).map(b => ({ cards: [], range: rangeBand(...b) }));
  return Promise.all([simRank(hand), ...keys.map(k => trainRunner.run({ cmd: 'equity', players: [{ cards: hand }, ...opps(k)], trials: EV_TRIALS }))])
    .then(([rk, ...rs]) => { const eq = {}; keys.forEach((k, i) => eq[k] = rs[i].players[0].eq); HERO_TOP = rk.top; const t = evTree(spot, plan, eq); t.playMult = playMult(); return t; });
}
const leaf = (label, ev, detail) => ({ kind: 'leaf', label, ev, detail });
const chance = (label, a, children, detail) => ({ kind: 'chance', label, a, children, detail, ev: children.reduce((s, c) => s + c.p * c.ev, 0) });
function decision(label, children, a) { const ev = Math.max(...children.map(c => c.ev)); children.forEach(c => c.best = Math.abs(c.ev - ev) < 1e-9); return { kind: 'dec', label, children, ev, a }; }
const withP = (p, node) => Object.assign(node, { p });
function allinNode(label, eq, dead, sunk) {
  const pot = raked(200 + dead);
  return leaf(label, eq * pot - 100 + sunk, `all-in: eq ${P(eq)} × pot ${pot.toFixed(1)} (after rake) − 100`);
}
function evTree(spot, plan, eq) {
  const s = spot, h = s.hero, bh = bl(h);
  const kids = [];
  if (s.type === 'rfi') {
    kids.push(Object.assign(leaf('Fold', 0, bh ? `lose the ${bh}bb blind already posted (baseline)` : 'baseline'), { a: 'fold' }));
    const r = h === 'SB' ? 3 : 3.5;
    const { resp, caller, tbr } = plan;
    const pno3 = resp.reduce((m, x) => m * (1 - x.p3), 1), p3 = 1 - pno3;
    const qs = resp.map(x => x.pc / Math.max(1e-9, 1 - x.p3)); // P(call | nobody 3-bets)
    const q0 = qs.reduce((m, q) => m * (1 - q), 1), q1 = qs.reduce((sum, q, i) => sum + q * qs.reduce((m, r2, j) => j === i ? m : m * (1 - r2), 1), 0);
    const pf = pno3 * q0, pc = pno3 * q1, pc2 = plan.c2 ? Math.max(0, pno3 * (1 - q0 - q1)) : 0;
    const c2 = plan.c2, dead2 = c2 ? 1.5 - bl(caller.b) - bl(c2.b) - bh : 0, pot2 = 3 * r + dead2;
    const R2 = c2 ? (isIP(h, caller.b) && isIP(h, c2.b) ? CFG.realIP : CFG.realOOP) * playMult() : 0;
    const deadC = 1.5 - bl(caller.b) - bh, potC = 2 * r + deadC, R = realOf(h, caller.b);
    // 3-bet branch
    const vb = bl(tbr.b), dead3 = 1.5 - vb - bh, pot3 = r + vb + dead3, to3 = r + pot3 + (r - vb);
    const R3 = realOf(h, tbr.b, true), potCall3 = 2 * to3 + dead3;
    const after3 = decision(`${tbr.b} 3-bets to ${to3.toFixed(1)} → your move`, [
      Object.assign(leaf('Fold', -r + bh, `lose your ${r}bb open`), { a: 'fold' }),
      Object.assign(leaf('Call', R3 * eq.tb * raked(potCall3) - to3 + bh, `${(R3 * 100).toFixed(0)}% × eq ${P(eq.tb)} vs ${rlab(...plan.sims.tb.band)} × pot ${raked(potCall3).toFixed(1)} − ${to3.toFixed(1)}`), { a: 'call' }),
      Object.assign(chance('4-Bet (all-in)', 'raise', [
        withP(CFG.foldTo4, leaf(`${tbr.b} folds`, to3 + dead3 + bh, `win ${(to3 + dead3).toFixed(1)}bb`)),
        withP(1 - CFG.foldTo4, allinNode(`${tbr.b} calls`, eq.tb4, dead3, bh)),
      ], `villain folds ${pctTxt(CFG.foldTo4)} of the 3-bet range to a 4-bet`), {}),
    ]);
    const raiseKids = [
      withP(pf, leaf('Everyone folds', 1.5, 'win the blinds')),
      withP(pc, leaf(`One caller (${caller.b})`, R * eq.call * raked(potC) - r + bh, `${(R * 100).toFixed(0)}% × eq ${P(eq.call)} vs ${rlab(...plan.sims.call.band)} × pot ${raked(potC).toFixed(1)} − ${r}`)),
    ];
    if (c2) raiseKids.push(withP(pc2, leaf(`Two+ callers (${caller.b} & ${c2.b})`, R2 * eq.call2 * raked(pot2) - r + bh, `${(R2 * 100).toFixed(0)}% × 3-way eq ${P(eq.call2)} × pot ${raked(pot2).toFixed(1)} − ${r}`)));
    raiseKids.push(withP(p3, after3));
    kids.push(chance(`Raise to ${r}`, 'raise', raiseKids, `${resp.map(x => `${x.b} continues ${x.ct.toFixed(0)}%`).join(', ')}`));
    if (h === 'SB') {
      const pi = CFG.bbIso / 100, Ro = realOf('SB', 'BB');
      const afterIso = decision('BB raises to 3 → your move', [
        Object.assign(leaf('Fold', -0.5, 'lose 1bb (0.5 more than folding now)'), { a: 'fold' }),
        Object.assign(leaf('Call', Ro * eq.iso * raked(6) - 3 + 0.5, `${(Ro * 100).toFixed(0)}% × eq ${P(eq.iso)} vs top ${CFG.bbIso}% × pot ${raked(6).toFixed(1)} − 3`), { a: 'call' }),
      ]);
      kids.splice(1, 0, chance('Complete to 1', 'call', [
        withP(1 - pi, leaf('BB checks', Ro * eq.check * raked(2) - 1 + 0.5, `${(Ro * 100).toFixed(0)}% × eq ${P(eq.check)} vs BB's checking range × pot ${raked(2).toFixed(1)} − 1`)),
        withP(pi, afterIso),
      ], `BB raises the top ${CFG.bbIso}% vs a limp`));
    }
    return decision(`You (${h}), folded to`, kids);
  }
  if (s.type === 'vsopen') {
    const o = s.opener, r = o === 'SB' ? 3 : 3.5, dead = 1.5 - bl(o) - bh, R = realOf(h, o), v = plan.v;
    kids.push(Object.assign(leaf('Fold', 0, bh ? `lose the ${bh}bb blind already posted (baseline)` : 'baseline'), { a: 'fold' }));
    const potC = 2 * r + dead;
    kids.push(Object.assign(leaf('Call', R * eq.open * raked(potC) - r + bh, `${(R * 100).toFixed(0)}% × eq ${P(eq.open)} vs ${o} open (top ${CFG.rfi[o]}%) × pot ${raked(potC).toFixed(1)} − ${(r - bh).toFixed(1)} more; players behind assumed to fold`), { a: 'call' }));
    const to3 = 3 * r + dead, pf = Math.max(0, 1 - v.cb / v.open), pc = Math.max(0, (v.cb - v.fb) / v.open), p4 = Math.max(0, v.fb / v.open);
    const pot3c = 2 * to3 + dead;
    const after4 = decision(`${o} 4-bets → your move`, [
      Object.assign(leaf('Fold', -to3 + bh, `lose your ${to3.toFixed(1)}bb 3-bet`), { a: 'fold' }),
      Object.assign(allinNode('Call all-in', eq.fb, dead, bh), { a: 'call' }),
    ]);
    kids.push(chance(`3-Bet to ${to3.toFixed(1)}`, 'raise', [
      withP(pf, leaf(`${o} folds`, r + dead + bh, `win ${(r + dead).toFixed(1)}bb`)),
      withP(pc, leaf(`${o} calls`, realOf(h, o, true) * eq.flat * raked(pot3c) - to3 + bh, `${(realOf(h, o, true) * 100).toFixed(0)}% × eq ${P(eq.flat)} vs ${rlab(...plan.sims.flat.band)} × pot ${raked(pot3c).toFixed(1)} − ${to3.toFixed(1)}`)),
      withP(p4, after4),
    ], `${o} responds with its facing-a-3-bet strategy`));
    return decision(`You (${h}) vs ${o} open`, kids);
  }
  const vill = s.villain, r = h === 'SB' ? 3 : 3.5, vb = bl(vill), dead = 1.5 - bh - vb;
  const pot = r + vb + dead, to3 = r + pot + (r - vb), R = realOf(h, vill, true), potC = 2 * to3 + dead;
  kids.push(Object.assign(leaf('Fold', 0, `your ${r}bb open is lost (baseline)`), { a: 'fold' }));
  kids.push(Object.assign(leaf('Call', R * eq.tb * raked(potC) - (to3 - r), `${(R * 100).toFixed(0)}% × eq ${P(eq.tb)} vs ${vill} 3-bet (${rlab(...plan.sims.tb.band)}) × pot ${raked(potC).toFixed(1)} − ${(to3 - r).toFixed(1)} more`), { a: 'call' }));
  kids.push(chance('4-Bet (all-in)', 'raise', [
    withP(CFG.foldTo4, leaf(`${vill} folds`, to3 + dead + r, `win ${(to3 + dead).toFixed(1)}bb`)),
    withP(1 - CFG.foldTo4, allinNode(`${vill} calls`, eq.tb4, dead, r)),
  ], `villain folds ${pctTxt(CFG.foldTo4)} of the 3-bet range to a 4-bet`));
  return decision(`You opened ${h}, ${vill} 3-bets to ${to3.toFixed(1)}`, kids);
}
function treeHTML(n, depth = 0) {
  const evc = n.ev > 0.005 ? 'pos' : n.ev < -0.005 ? 'neg' : '';
  const head = `<div class="tn ${n.kind}${n.best ? ' best' : ''}">
    ${n.p != null ? `<span class="tp">${pctTxt(n.p)}</span>` : ''}<span class="tl">${n.label}</span>
    <span class="tev ${evc}">${fmtBB(n.ev)}</span>${n.best && depth > 0 ? '<span class="tbest">best</span>' : ''}
    ${n.detail ? `<div class="td">${n.detail}</div>` : ''}</div>`;
  if (!n.children) return `<li>${head}</li>`;
  return `<li>${head}<ul>${n.children.map(c => treeHTML(c, depth + 1)).join('')}</ul></li>`;
}

// ---------- flow chart ----------
function flowHTML(spot, res, actsIn) {
  // res: undefined (before answer) or {rk, g, mode}
  const acts = (res && res.g && res.g.acts) || actsIn || spotActions(spot), on = !!res, ev = CFG.gradeBy === 'ev';
  const q = v => on ? v : '<span class="muted">?</span>';
  let h = `<div class="fnode start">${spot.hero} · ${spot.type === 'rfi' ? 'folded to you' : spot.type === 'vsopen' ? `facing ${spot.opener} open` : `facing ${spot.villain} 3-bet`}</div>
    <div class="farrow ${on ? 'on' : ''}"></div>
    <div class="fnode proc ${on ? 'on' : ''}">Simulate 60k runouts vs 2 playing hands (top ${MODEL.play}%)<br><b>${q(on && P(res.rk.eq))}</b> pot share</div>
    <div class="farrow ${on ? 'on' : ''}"></div>
    <div class="fnode proc ${on ? 'on' : ''}">Rank vs ${MODEL.hands.toLocaleString()} simulated hands<br><b>${q(on && `top ${res.rk.top.toFixed(1)}%`)}</b></div>`;
  if (ev) {
    h += `<div class="farrow ${on ? 'on' : ''}"></div><div class="fnode proc ${on ? 'on' : ''}">Simulate equity vs each response range → build EV tree</div>
      <div class="farrow ${on ? 'on' : ''}"></div><div class="fnode dec ${on ? 'on' : ''}">Pick the highest-EV action<br><span class="muted">(within ${EV_MIX}bb = mixed)</span></div><div class="farrow ${on ? 'on' : ''}"></div>
      <div class="fouts">${acts.map(a => `<div class="fnode out o-${a.a} ${on && res.g.ok.has(a.a) ? 'hit' : ''}">${a.label}${on && res.g.evs ? `<br><small>${fmtBB(res.g.evs.find(x => x.a === a.a).ev)}</small>` : ''}</div>`).join('')}</div>`;
    return h;
  }
  const k = on ? res.g.k : -1;
  acts.forEach((a, i) => {
    const last = i === acts.length - 1, reached = on && i <= k;
    if (!last && a.top < 0.05) return; // e.g. a 0% 3-bet range: nothing to decide
    h += `<div class="farrow ${reached ? 'on' : ''}">${i > 0 ? '<span>no</span>' : ''}</div>`;
    if (last) { h += `<div class="fnode out o-${a.a} ${on && res.g.ok.has(a.a) ? 'hit' : ''}">${a.label.toUpperCase()}</div>`; return; }
    const yes = on && i === k;
    h += `<div class="frow"><div class="fnode dec ${reached ? 'on' : ''}">In top ${a.top.toFixed(1)}%?<br><span class="muted">${a.label} range</span></div>
      <div class="fyes ${yes ? 'on' : ''}">yes →</div><div class="fnode out o-${a.a} ${on && res.g.ok.has(a.a) ? 'hit' : ''}">${a.label.toUpperCase()}</div></div>`;
  });
  if (on && res.g.mixed) h += `<div class="note">Within ${band(res.g.acts[Math.max(0, res.g.k - 1)].top).toFixed(1)} pts of a boundary → mixed: both highlighted actions are fine.</div>`;
  return h;
}
