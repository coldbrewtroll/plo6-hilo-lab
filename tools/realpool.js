// Real-equity hand pool: N random hands, each with simulated pot share 3-way vs 2 hands from the top 40%,
// sorted best-first. Ranges ("top a%-b%") then sample real-equity-ranked hands instead of model-ranked ones.
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs = require('fs'), path = require('path');
const ENGINE = require('../src/engine.js');
const ROOT = path.join(__dirname, '..'), CORES = 4;
const N = +(process.env.N || 120000), T = +(process.env.T || 5000);
if (!isMainThread) {
  const E = ENGINE(), M = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/model.json')));
  const q = M.modelQuantiles, x = (1 - M.play / 100) * 1000, i = Math.floor(x), min = q[i] + (x - i) * (q[i + 1] - q[i]);
  const opp = { cards: [], range: { w: M.w, min, pool: 1000000 } };
  const hands = new Uint8Array(workerData.n * 6), eqs = new Float32Array(workerData.n);
  for (let k = 0; k < workerData.n; k++) {
    const h = E.randomHand();
    const j = E.createEquityJob({ players: [{ cards: h }, opp, Object.assign({}, opp)], trials: T }); j.step(1e12);
    eqs[k] = j.result().players[0].eq; hands.set(h, k * 6);
    if (k % 2000 === 0) parentPort.postMessage({ progress: k });
  }
  parentPort.postMessage({ hands, eqs });
  return;
}
(async () => {
  const t0 = Date.now(), done = new Array(CORES).fill(0);
  const parts = await Promise.all(Array.from({ length: CORES }, (_, w) => new Promise((res, rej) => {
    const wk = new Worker(__filename, { workerData: { n: Math.ceil(N / CORES) } });
    wk.on('message', m => { if (m.progress != null) { done[w] = m.progress; if (w === 0) console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ~${(done.reduce((a, b) => a + b, 0)).toLocaleString()} hands`); } else res(m); });
    wk.on('error', rej);
  })));
  const all = []; parts.forEach(p => { for (let k = 0; k < p.eqs.length; k++) all.push([p.eqs[k], p.hands.subarray(k * 6, k * 6 + 6)]); });
  all.sort((a, b) => b[0] - a[0]); // best first
  const bin = new Uint8Array(all.length * 6); all.forEach(([, h], k) => bin.set(h, k * 6));
  const asc = all.map(a => a[0]).reverse();
  const quantiles = Array.from({ length: 1001 }, (_, r) => +asc[Math.min(asc.length - 1, Math.floor(r / 1000 * asc.length))].toFixed(6));
  fs.writeFileSync(path.join(ROOT, 'data/realpool.bin'), bin);
  fs.writeFileSync(path.join(ROOT, 'data/realpool.json'), JSON.stringify({ n: all.length, trials: T, metric: 'pot share 3-way vs 2 hands from the top 40%', quantiles }));
  console.log(`done: ${all.length} hands × ${T} runouts (${(all.length * T / 1e6).toFixed(0)}M trials) in ${((Date.now() - t0) / 1000).toFixed(0)}s · best ${(all[0][0] * 100).toFixed(1)}% · median ${(asc[asc.length >> 1] * 100).toFixed(1)}%`);
})();
