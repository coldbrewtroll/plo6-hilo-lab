// Offline calibration of the "equity vs playing hands" ranking metric.
// metric(h) = hero's pot share, 3-way, vs 2 opponents each drawn from the top PLAY% of hands.
// Iterates: ranking model -> opponents' range -> re-simulate -> refit, until stable.
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const ENGINE = require('../src/engine.js');
const PLAY = 40, CORES = 4;

function simBatch({ n, T, w, min, seed }) {
  const E = ENGINE(), X = [], Y = [], H = [];
  for (let i = 0; i < n; i++) {
    const h = E.randomHand();
    const opp = w ? { cards: [], range: { w, min, pool: 1000000 } } : { cards: [] };
    const j = E.createEquityJob({ players: [{ cards: h }, opp, Object.assign({}, opp)], trials: T }); j.step(1e9);
    X.push(E.feats(h)); Y.push(j.result().players[0].eq); H.push(h);
  }
  return { X, Y, H };
}
if (!isMainThread) { parentPort.postMessage(simBatch(workerData)); return; }

const E = ENGINE();
const par = (n, T, w, min) => Promise.all(Array.from({ length: CORES }, () => new Promise((res, rej) => {
  const wk = new Worker(__filename, { workerData: { n: Math.ceil(n / CORES), T, w, min } }); wk.on('message', res); wk.on('error', rej);
}))).then(parts => ({ X: parts.flatMap(p => p.X), Y: parts.flatMap(p => p.Y), H: parts.flatMap(p => p.H) }));

function fit(X, Y) {
  const F = X[0].length, A = Array.from({ length: F }, () => new Float64Array(F + 1));
  for (let r = 0; r < X.length; r++) { const x = X[r]; for (let a = 0; a < F; a++) { for (let b = 0; b < F; b++) A[a][b] += x[a] * x[b]; A[a][F] += x[a] * Y[r]; } }
  for (let a = 0; a < F; a++) A[a][a] += 1e-3;
  for (let c = 0; c < F; c++) {
    let piv = c; for (let r = c + 1; r < F; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    for (let r = 0; r < F; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k <= F; k++) A[r][k] -= f * A[c][k]; }
  }
  const w = Array.from({ length: F }, (_, a) => A[a][F] / A[a][a]);
  let my = Y.reduce((s, y) => s + y, 0) / Y.length, ssr = 0, sst = 0;
  X.forEach((x, r) => { let p = 0; for (let a = 0; a < F; a++) p += w[a] * x[a]; ssr += (Y[r] - p) ** 2; sst += (Y[r] - my) ** 2; });
  return { w, r2: 1 - ssr / sst };
}
function quantiles(vals) { const s = vals.slice().sort((a, b) => a - b); return Array.from({ length: 1001 }, (_, r) => s[Math.min(s.length - 1, Math.floor(r / 1000 * s.length))]); }
function modelQuantiles(w) { const S = []; for (let r = 0; r < 60000; r++) S.push(E.score(E.randomHand(), w)); return quantiles(S); }
const scoreAtTop = (q, t) => { const x = (1 - t / 100) * 1000, i = Math.floor(x); return i >= 1000 ? q[1000] : q[i] + (x - i) * (q[i + 1] - q[i]); };
function spearman(a, b) {
  const rk = v => { const idx = v.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]); const r = new Array(v.length); idx.forEach(([, i], k) => r[i] = k); return r; };
  const ra = rk(a), rb = rk(b), n = a.length; let d = 0; for (let i = 0; i < n; i++) d += (ra[i] - rb[i]) ** 2; return 1 - 6 * d / (n * (n * n - 1));
}

(async () => {
  const t0 = Date.now(), log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
  const N_IT = +(process.env.N_IT || 12000), T_IT = +(process.env.T_IT || 2000), N_FIN = +(process.env.N_FIN || 40000), T_FIN = +(process.env.T_FIN || 5000);
  let d = await par(N_IT, T_IT, null, null);
  let m = fit(d.X, d.Y); log('iter0 (vs random) R2', m.r2.toFixed(3));
  let prevW = m.w;
  for (let it = 1; it <= 6; it++) {
    const q = modelQuantiles(prevW), min = scoreAtTop(q, PLAY);
    d = await par(N_IT, T_IT, prevW, min);
    m = fit(d.X, d.Y);
    const probe = Array.from({ length: 4000 }, () => E.randomHand());
    const rho = spearman(probe.map(h => E.score(h, prevW)), probe.map(h => E.score(h, m.w)));
    log(`iter${it} (vs top ${PLAY}%) R2 ${m.r2.toFixed(3)} rank-corr with previous ${rho.toFixed(4)}`);
    prevW = m.w;
    if (rho > 0.995) break;
  }
  // final: model used for opponent-range sampling, and a big simulated percentile table for hero grading
  const w = prevW, mq = modelQuantiles(w), min = scoreAtTop(mq, PLAY);
  const fin = await par(N_FIN, T_FIN, w, min);
  const fitFin = fit(fin.X, fin.Y);
  const out = { version: 3, metric: `equity 3-way vs 2 hands from top ${PLAY}%`, play: PLAY, w, modelQuantiles: mq, metricQuantiles: quantiles(fin.Y),
    r2: fitFin.r2, hands: fin.Y.length, trials: T_FIN };
  require('fs').writeFileSync(__dirname + '/../data/model.json', JSON.stringify(out));
  log('final table:', fin.Y.length, 'hands; model R2 on final data', fitFin.r2.toFixed(3));
  const pct = v => 100 * out.metricQuantiles.filter(x => x > v).length / 1001;
  for (const hs of ['KsTd9c5h5d2s', 'As2s3dKdQh9c', 'Ah2h3s4sKcQd', 'AsAd2s3d4c5h', '2c3d4h5s6c7d', 'KsKhQdJdTc9s', 'Ac2d7h8sJcQd', '9hTsJdQc8h7s', 'Ad5c6h9sTdKc', '2s3s4d5dKhQc']) {
    const h = E.parseCards(hs).cards;
    const j = E.createEquityJob({ players: [{ cards: h }, { cards: [], range: { w, min, pool: 1000000 } }, { cards: [], range: { w, min, pool: 1000000 } }], trials: 200000 }); j.step(1e12);
    const v = j.result().players[0].eq;
    console.log(hs.padEnd(14), 'metric', (v * 100).toFixed(1), ' top', pct(v).toFixed(1) + '%');
  }
  const noAce = fin.H.map((h, i) => [h, fin.Y[i]]).filter(([h]) => !h.some(c => (c >> 2) === 12));
  const cut = scoreAtTop(out.metricQuantiles, 36);
  console.log('aceless share of top-36%:', (100 * noAce.filter(([, y]) => y >= cut).length / fin.Y.filter(y => y >= cut).length).toFixed(1) + '%');
})();
