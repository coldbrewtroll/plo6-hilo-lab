// Problem-spot finder: counterfactual replays of sampled decisions.
// For each sampled decision we replay the identical hand (same cards, same random streams) with every alternative
// action and record the deciding seat's result. Grouped by situation, this shows where the policy loses money.
// MODE=post (default): postflop decisions, grouped by street · facing · HU/MW · edge · edge change.
// MODE=pre: preflop chart decisions, grouped by spot (e.g. "BB vs BTN open") · hand-strength band (top x–y%).
// POP (same syntax as tools/optimize.js): the scanned bot plays a mixed field; only its own ('self') seats are sampled.
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const HANDS = +(process.env.HANDS || 40000), PER_HAND = +(process.env.PER_HAND || 2), CORES = +(process.env.CORES || 4), MODE = process.env.MODE || 'post';
const OUT = process.env.OUT || path.join(ROOT, 'data/spots.json');

const mB = m => m < -0.1 ? 'behind (<−10)' : m < 0 ? 'slightly behind' : m < 0.1 ? 'slightly ahead' : m < 0.2 ? 'ahead +10–20' : 'way ahead (>+20)';
const dB = d => d < -0.08 ? 'edge fell' : d > 0.08 ? 'edge jumped' : 'edge steady';
const catOf = (street, c) => [street, c.facing ? 'facing a bet' : 'checked to / first in', c.nOpp === 1 ? 'heads-up' : 'multiway', mB(c.m), dB(c.dm)].join(' · ');
const BINS = [0, 2, 5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 100];
const binOf = t => { for (let k = 1; k < BINS.length; k++) if (t <= BINS[k]) return `top ${BINS[k - 1]}–${BINS[k]}%`; return 'top 75–100%'; };

if (!isMainThread) {
  const SP = require('./selfplay.js'), POSN = SP.POS;
  const th = SP.withNeutral(JSON.parse(fs.readFileSync(workerData.policy)).theta);
  const pop = workerData.pop ? workerData.pop.split(',').map(x => {
    if (x === 'self') return 'self';
    const [kind, f] = x.includes(':') ? x.split(':') : ['policy', x];
    const t = SP.withNeutral(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f))).theta);
    if (kind === 'station') for (const st of SP.STREETS) Object.assign(t[st], { sizeAdj: 0, huAdj: 0, slack: t[st].slack + 0.05, bluff: 0, braise: 0, trap: 0, stab: 0 });
    return t;
  }) : null;
  const fieldOf = s => pop ? POSN.map((_, i) => pop[(i + s) % pop.length]) : POSN.map(() => 'self');
  const spotOf = (h, i) => {
    const p = POSN[i];
    if (h.raises === 0) return p === 'BB' ? 'BB vs SB complete' : `${p} first in`;
    if (h.raises === 1) return `${p} vs ${POSN[h.opener]} open`;
    if (h.raises === 2 && i === h.opener) return `${p} open vs ${POSN[h.aggr]} 3-bet`;
    return h.raises >= 3 ? 'facing a 4-bet or more' : `${p} facing a 3-bet (not the opener)`;
  };
  const cats = {}; let plays = 0, decisions = 0;
  for (let s = workerData.from; s < workerData.from + workerData.count; s++) {
    const F = fieldOf(s), T = F.map(t => t === 'self' ? th : t), decs = [];
    plays++;
    SP.playHand(s, T, (h, i, d, k) => {
      if (F[i] !== 'self' || (MODE === 'pre') !== (k < 0)) return;
      const L = SP.legal(h, i);
      decs.push({ k, i, d, street: h.street, top: h.P[i].top, spot: k < 0 ? spotOf(h, i) : null, L: { pot: L.pot, minTo: L.minTo, maxTo: L.maxTo, canRaise: L.canRaise, canCheck: L.canCheck, bet: h.bet } });
    });
    const per = MODE === 'pre' ? 1 : PER_HAND;
    const pick = decs.filter((_, j) => (s * 7 + j * 13) % Math.max(1, Math.ceil(decs.length / per)) === 0).slice(0, per);
    for (const D of pick) {
      const alts = [];
      if (MODE === 'pre') {
        // no open-limping (the bots behind would ignore a limper, which makes limps look better than they are); SB completes are kept
        const limp = /first in$/.test(D.spot) && D.spot.slice(0, 2) !== 'SB';
        if (D.L.canCheck) alts.push(['check', { a: 'check' }]); else { alts.push(['fold', { a: 'fold' }]); if (!limp) alts.push(['call', { a: 'call' }]); }
        if (D.L.canRaise) alts.push(['raise', { a: 'raise', to: D.L.maxTo }]);
      } else if (!D.L.canCheck) { alts.push(['fold', { a: 'fold' }], ['call', { a: 'call' }]); if (D.L.canRaise) alts.push(['raise', { a: 'raise', to: D.L.maxTo }]); }
      else { alts.push(['check', { a: 'check' }]); if (D.L.canRaise) for (const [n, f] of [['bet ⅓', 1 / 3], ['bet ⅔', 2 / 3], ['bet pot', 1]]) alts.push([n, { a: 'raise', to: Math.max(D.L.minTo, Math.min(D.L.maxTo, f * D.L.pot)) }]); }
      let mine;
      if (D.d.a !== 'raise') mine = D.d.a;
      else if (MODE === 'pre' || !D.L.canCheck) mine = 'raise';
      else { const f = (D.d.to - D.L.bet) / Math.max(1, D.L.pot); mine = f < 0.5 ? 'bet ⅓' : f < 0.83 ? 'bet ⅔' : 'bet pot'; }
      if (!alts.some(([n]) => n === mine)) continue;
      const res = {};
      for (const [n, a] of alts) { res[n] = SP.playHand(s, T, null, k => k === D.k ? a : null)[D.i]; plays++; }
      decisions++;
      const cat = MODE === 'pre' ? `${D.spot} · ${binOf(D.top)}` : catOf(D.street, D.d.ctx);
      const c = cats[cat] || (cats[cat] = { n: 0, mine: {}, alt: {} });
      c.n++; c.mine[mine] = (c.mine[mine] || 0) + 1;
      for (const [a, v] of Object.entries(res)) { const x = c.alt[a] || (c.alt[a] = { n: 0, s: 0, d: 0, d2: 0 }); const dv = v - res[mine]; x.n++; x.s += v; x.d += dv; x.d2 += dv * dv; }
    }
  }
  parentPort.postMessage({ cats, plays, decisions }); return;
}

(async () => {
  const policy = process.env.POLICY || path.join(ROOT, 'data/botpolicy.json'), t0 = Date.now(), SEED0 = +(process.env.SEED0 || 4e8);
  const parts = await Promise.all(Array.from({ length: CORES }, (_, k) => new Promise((res, rej) => {
    const w = new Worker(__filename, { workerData: { policy, pop: process.env.POP || null, from: SEED0 + k * Math.ceil(HANDS / CORES), count: Math.ceil(HANDS / CORES) } }); w.on('message', res); w.on('error', rej); })));
  const cats = {}; let plays = 0, decisions = 0;
  for (const P of parts) {
    plays += P.plays; decisions += P.decisions;
    for (const [k, c] of Object.entries(P.cats)) {
      const C = cats[k] || (cats[k] = { n: 0, mine: {}, alt: {} }); C.n += c.n;
      for (const [a, v] of Object.entries(c.mine)) C.mine[a] = (C.mine[a] || 0) + v;
      for (const [a, x] of Object.entries(c.alt)) { const X = C.alt[a] || (C.alt[a] = { n: 0, s: 0, d: 0, d2: 0 }); X.n += x.n; X.s += x.s; X.d += x.d; X.d2 += x.d2; }
    }
  }
  const list = Object.entries(cats).map(([cat, c]) => {
    const alts = Object.entries(c.alt).filter(([, x]) => x.n >= 0.9 * c.n).map(([a, x]) => ({ a, mean: x.s / x.n, gain: x.d / x.n, se: Math.sqrt(Math.max(1e-12, x.d2 / x.n - (x.d / x.n) ** 2) / x.n) }));
    if (!alts.length) return null;
    const best = alts.reduce((m, x) => x.gain > m.gain ? x : m, alts[0]);
    const usual = Object.entries(c.mine).sort((a, b) => b[1] - a[1])[0][0];
    return { cat, n: c.n, usual, usualShare: c.mine[usual] / c.n, best: best.a, gain: best.gain, se: best.se, z: best.gain / best.se, bb100: 100 * best.gain * c.n / HANDS * (MODE === 'pre' ? 1 : 1), alts: alts.map(x => ({ a: x.a, mean: +x.mean.toFixed(3), gain: +x.gain.toFixed(3), se: +x.se.toFixed(3) })) };
  }).filter(Boolean).sort((a, b) => b.bb100 - a.bb100);
  const total = list.filter(x => x.z > 2).reduce((a, x) => a + x.bb100, 0);
  fs.writeFileSync(OUT, JSON.stringify({ mode: MODE, hands: HANDS, plays, decisions, policy: path.basename(policy), pop: process.env.POP || null, totalSignificantLeak: +total.toFixed(2), spots: list }, null, 1));
  console.log(`${MODE} scan: ${HANDS.toLocaleString()} deals · ${decisions.toLocaleString()} decisions replayed with every alternative · ${plays.toLocaleString()} hands played · ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  console.log(`significant leaks (z>2) add up to ${total.toFixed(2)} bb/100 (lower bound: only sampled decisions)`);
  for (const x of list.slice(0, +(process.env.SHOW || 15))) console.log(`${x.bb100.toFixed(2).padStart(6)} bb/100 · ${x.cat} · n=${x.n} · usually ${x.usual} (${Math.round(100 * x.usualShare)}%) → better: ${x.best} (+${x.gain.toFixed(2)} bb/decision, z ${x.z.toFixed(1)})`);
})();
