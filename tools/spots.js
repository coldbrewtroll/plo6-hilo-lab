// Problem-spot finder: counterfactual replays of sampled postflop decisions.
// For each sampled decision we replay the identical hand (same cards, same random streams) with every alternative
// action and record the deciding seat's result. Grouped by situation, this shows where the policy loses money.
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const HANDS = +(process.env.HANDS || 40000), PER_HAND = +(process.env.PER_HAND || 2), CORES = 4;
const OUT = process.env.OUT || path.join(ROOT, 'data/spots.json');

const mB = m => m < -0.1 ? 'behind (<−10)' : m < 0 ? 'slightly behind' : m < 0.1 ? 'slightly ahead' : m < 0.2 ? 'ahead +10–20' : 'way ahead (>+20)';
const dB = d => d < -0.08 ? 'edge fell' : d > 0.08 ? 'edge jumped' : 'edge steady';
const catOf = (street, c) => [street, c.facing ? 'facing a bet' : 'checked to / first in', c.nOpp === 1 ? 'heads-up' : 'multiway', mB(c.m), dB(c.dm)].join(' · ');

if (!isMainThread) {
  const SP = require('./selfplay.js');
  const th = SP.withNeutral(JSON.parse(fs.readFileSync(workerData.policy)).theta);
  // POP (same syntax as tools/optimize.js): the scanned bot plays a mixed field; only its own ('self') seats are sampled
  const pop = workerData.pop ? workerData.pop.split(',').map(x => {
    if (x === 'self') return 'self';
    const [kind, f] = x.includes(':') ? x.split(':') : ['policy', x];
    const t = SP.withNeutral(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f))).theta);
    if (kind === 'station') for (const st of SP.STREETS) Object.assign(t[st], { sizeAdj: 0, huAdj: 0, slack: t[st].slack + 0.05, bluff: 0, braise: 0, trap: 0, stab: 0 });
    return t;
  }) : null;
  const fieldOf = s => pop ? SP.POS.map((_, i) => pop[(i + s) % pop.length]) : SP.POS.map(() => 'self');
  const out = [];
  for (let s = workerData.from; s < workerData.from + workerData.count; s++) {
    const decs = [];
    const F = fieldOf(s), T = F.map(t => t === 'self' ? th : t);
    const base = SP.playHand(s, T, (h, i, d, k) => { if (k >= 0 && F[i] === 'self') { const L = SP.legal(h, i); decs.push({ k, i, d, street: h.street, L: { pot: L.pot, minTo: L.minTo, maxTo: L.maxTo, canRaise: L.canRaise, canCheck: L.canCheck, bet: h.bet } }); } });
    // sample decisions (deterministic per seed)
    const pick = decs.filter((_, j) => (s * 7 + j * 13) % Math.max(1, Math.ceil(decs.length / PER_HAND)) === 0).slice(0, PER_HAND);
    for (const D of pick) {
      const alts = [];
      if (!D.L.canCheck) { alts.push(['fold', { a: 'fold' }], ['call', { a: 'call' }]); if (D.L.canRaise) alts.push(['raise', { a: 'raise', to: D.L.maxTo }]); }
      else { alts.push(['check', { a: 'check' }]); if (D.L.canRaise) for (const [n, f] of [['bet ⅓', 1 / 3], ['bet ⅔', 2 / 3], ['bet pot', 1]]) alts.push([n, { a: 'raise', to: Math.max(D.L.minTo, Math.min(D.L.maxTo, f * D.L.pot)) }]); }
      // which alternative did the policy pick?
      let mine;
      if (D.d.a !== 'raise') mine = D.d.a;
      else if (!D.L.canCheck) mine = 'raise';
      else { const f = (D.d.to - D.L.bet) / Math.max(1, D.L.pot); mine = f < 0.5 ? 'bet ⅓' : f < 0.83 ? 'bet ⅔' : 'bet pot'; }
      const res = {};
      for (const [n, a] of alts) res[n] = SP.playHand(s, T, null, (k) => k === D.k ? a : null)[D.i];
      out.push({ cat: catOf(D.street, D.d.ctx), mine, res, tag: D.d.tag || '' });
    }
  }
  parentPort.postMessage(out); return;
}

(async () => {
  const policy = process.env.POLICY || path.join(ROOT, 'data/botpolicy.json'), t0 = Date.now();
  const parts = await Promise.all(Array.from({ length: CORES }, (_, k) => new Promise((res, rej) => {
    const w = new Worker(__filename, { workerData: { policy, pop: process.env.POP || null, from: 4e8 + k * Math.ceil(HANDS / CORES), count: Math.ceil(HANDS / CORES) } }); w.on('message', res); w.on('error', rej); })));
  const rows = parts.flat(), cats = {};
  for (const r of rows) {
    const c = cats[r.cat] || (cats[r.cat] = { n: 0, alt: {}, mine: {} });
    c.n++; c.mine[r.mine] = (c.mine[r.mine] || 0) + 1;
    for (const [a, v] of Object.entries(r.res)) { const x = c.alt[a] || (c.alt[a] = { n: 0, s: 0, d: 0, d2: 0 }); x.n++; x.s += v; const dv = v - r.res[r.mine]; x.d += dv; x.d2 += dv * dv; }
  }
  const sampleScale = HANDS * PER_HAND / rows.length; // decisions are sampled; scale regret back to all decisions… approximately
  const list = Object.entries(cats).map(([cat, c]) => {
    const alts = Object.entries(c.alt).filter(([, x]) => x.n >= 0.9 * c.n).map(([a, x]) => ({ a, mean: x.s / x.n, gain: x.d / x.n, se: Math.sqrt(Math.max(1e-12, x.d2 / x.n - (x.d / x.n) ** 2) / x.n) }));
    const best = alts.reduce((m, x) => x.gain > m.gain ? x : m, alts[0]);
    const usual = Object.entries(c.mine).sort((a, b) => b[1] - a[1])[0][0];
    return { cat, n: c.n, usual, usualShare: c.mine[usual] / c.n, best: best.a, gain: best.gain, se: best.se, z: best.gain / best.se, bb100: 100 * best.gain * c.n / HANDS, alts: alts.map(x => ({ a: x.a, mean: +x.mean.toFixed(3) })) };
  }).sort((a, b) => b.bb100 - a.bb100);
  const total = list.filter(x => x.z > 2).reduce((a, x) => a + x.bb100, 0);
  fs.writeFileSync(OUT, JSON.stringify({ hands: HANDS, decisions: rows.length, policy: path.basename(policy), totalSignificantLeak: +total.toFixed(2), spots: list }, null, 1));
  console.log(`${HANDS.toLocaleString()} hands · ${rows.length.toLocaleString()} decisions replayed with every alternative · ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  console.log(`significant leaks (z>2) add up to ${total.toFixed(2)} bb/100 (lower bound: only sampled decisions)`);
  for (const x of list.slice(0, 15)) console.log(`${x.bb100.toFixed(2).padStart(6)} bb/100 · ${x.cat} · n=${x.n} · usually ${x.usual} (${Math.round(100 * x.usualShare)}%) → better: ${x.best} (+${x.gain.toFixed(2)} bb/decision, z ${x.z.toFixed(1)})`);
})();
