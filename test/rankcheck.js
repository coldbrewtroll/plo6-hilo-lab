const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const ENGINE = require('../src/engine.js');
if (isMainThread) {
  const N = 8000, T = 1500, W = 4;
  const t0 = Date.now();
  Promise.all(Array.from({ length: W }, (_, i) => new Promise(res => {
    const w = new Worker(__filename, { workerData: { n: N / W, T } }); w.on('message', res);
  }))).then(parts => {
    const rows = parts.flat();
    const E = ENGINE();
    const eqs = rows.map(r => r.eq).sort((a, b) => a - b);
    const top = x => 100 * eqs.filter(e => e > x).length / eqs.length;
    const hero = E.parseCards('KsTd9c5h5d2s').cards;
    const res = {};
    for (const opp of [1, 2, 5]) {
      const players = [{ cards: hero }]; for (let k = 0; k < opp; k++) players.push({ cards: [] });
      const j = E.createEquityJob({ players, trials: 200000 }); j.step(1e9); res[opp] = j.result().players[0];
    }
    console.log(`sampled ${rows.length} random hands x ${T} trials vs 2 random in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    console.log('KsTd9c5h5d2s: HU', (res[1].eq * 100).toFixed(1), '| 3-way', (res[2].eq * 100).toFixed(1), '(scoop', (res[2].scoop * 100).toFixed(1) + ')', '| 6-way', (res[5].eq * 100).toFixed(1));
    console.log('Simulated-equity rank of KT9552 (3-way): top', top(res[2].eq).toFixed(1) + '%');
    const pctAt = p => eqs[Math.floor((1 - p / 100) * eqs.length)];
    console.log('3-way equity at top 22/34/48/60%:', [22, 34, 48, 60].map(p => (pctAt(p) * 100).toFixed(1)).join(' / '));
    const noAce = rows.filter(r => !r.ace), ace = rows.filter(r => r.ace);
    console.log('share of hands with no ace:', (100 * noAce.length / rows.length).toFixed(1) + '%');
    const avg = a => (100 * a.reduce((s, r) => s + r.eq, 0) / a.length).toFixed(1);
    console.log('avg 3-way equity: ace hands', avg(ace), '| aceless', avg(noAce));
    const inTop48 = rows.filter(r => r.eq >= pctAt(48));
    console.log('of the top-48% hands, aceless:', (100 * inTop48.filter(r => !r.ace).length / inTop48.length).toFixed(1) + '%');
    const better = noAce.filter(r => r.eq > res[2].eq).length;
    console.log('KT9552 among aceless hands: top', (100 * better / noAce.length).toFixed(1) + '%');
  });
} else {
  const E = ENGINE(), out = [];
  for (let i = 0; i < workerData.n; i++) {
    const h = E.randomHand();
    const j = E.createEquityJob({ players: [{ cards: h }, { cards: [] }, { cards: [] }], trials: workerData.T }); j.step(1e9);
    out.push({ eq: j.result().players[0].eq, ace: h.some(c => (c >> 2) === 12) });
  }
  parentPort.postMessage(out);
}
