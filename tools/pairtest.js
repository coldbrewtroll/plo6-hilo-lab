// Paired ("duplicate") test of one strategy change: the same deals are played with one seat on the candidate and
// with that seat on the base policy; the difference is that seat's gain in bb/100. Field = POP (optimize.js syntax).
// usage: POLICY=data/x.json PATCH='{"pre":{"rfiCO":1.3}}' DEALS=600000 POP=... node tools/pairtest.js   (or CAND=data/y.json to compare two policies)
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs = require('fs'), path = require('path'), ROOT = path.join(__dirname, '..');
if (!isMainThread) {
  const SP = require('./selfplay.js'), w = workerData;
  const base = SP.withNeutral(JSON.parse(fs.readFileSync(w.policy)).theta), cand = w.cand ? SP.withNeutral(JSON.parse(fs.readFileSync(w.cand)).theta) : SP.clone(base); // CAND=file: compare two whole policies
  for (const [st, p] of Object.entries(w.patch)) cand[st] = Object.assign({}, cand[st] || (st === 'pre' ? SP.PRE_NEUTRAL : {}), p);
  const pop = w.pop ? w.pop.split(',').map(x => {
    if (x === 'self') return 'self';
    const [kind, f] = x.includes(':') ? x.split(':') : ['policy', x];
    const t = SP.withNeutral(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f))).theta);
    if (kind === 'station') for (const st of SP.STREETS) Object.assign(t[st], { sizeAdj: 0, huAdj: 0, slack: t[st].slack + 0.05, bluff: 0, braise: 0, trap: 0, stab: 0 });
    return t; }) : null;
  let n = 0, s1 = 0, s2 = 0;
  for (let s = w.from; s < w.from + w.count; s++) {
    const seat = s % 6, field = SP.POS.map((_, i) => { const t = pop ? pop[(i + s) % pop.length] : 'self'; return t === 'self' ? base : t; });
    const d = SP.playHand(s, field.map((t, i) => i === seat ? cand : t))[seat] - SP.playHand(s, field.map((t, i) => i === seat ? base : t))[seat];
    n++; s1 += d; s2 += d * d;
  }
  parentPort.postMessage({ n, s1, s2 }); return;
}
const DEALS = +(process.env.DEALS || 200000), CORES = 4, patch = JSON.parse(process.env.PATCH || '{}'), t0 = Date.now(), SEED0 = +(process.env.SEED0 || 5e9);
Promise.all(Array.from({ length: CORES }, (_, k) => new Promise((res, rej) => { const w = new Worker(__filename, { workerData: { policy: path.resolve(process.env.POLICY), cand: process.env.CAND ? path.resolve(process.env.CAND) : null, patch, pop: process.env.POP || null, from: SEED0 + k * Math.ceil(DEALS / CORES), count: Math.ceil(DEALS / CORES) } }); w.on('message', res); w.on('error', rej); }))).then(rs => {
  const n = rs.reduce((a, r) => a + r.n, 0), s1 = rs.reduce((a, r) => a + r.s1, 0), s2 = rs.reduce((a, r) => a + r.s2, 0), m = s1 / n, se = Math.sqrt((s2 / n - m * m) / n);
  console.log(`${process.env.NAME || 'change'}: ${m >= 0 ? '+' : ''}${(m * 100).toFixed(2)} ± ${(se * 100).toFixed(2)} bb/100 (z ${(m / se).toFixed(1)}) · ${n.toLocaleString()} duplicate deals (${(2 * n).toLocaleString()} hands) · ${((Date.now() - t0) / 60000).toFixed(1)} min`);
});
