// pool sampling must match rejection sampling, and be faster
const E = require('../src/engine.js')(), M = require('../data/model.json');
const q = M.modelQuantiles, at = t => { const x = (1 - t / 100) * 1000, i = Math.floor(x); return i >= 1000 ? q[1000] : q[i] + (x - i) * (q[i + 1] - q[i]); };
const hero = E.parseCards('KsTd9c5h5d2s').cards;
for (const [a, b] of [[0, 40], [0, 4], [10, 45]]) {
  const rng = { w: M.w, max: a > 0 ? at(a) : null, min: at(b) };
  const run = (extra, T) => { const t = Date.now(); const j = E.createEquityJob({ players: [{ cards: hero }, { cards: [], range: Object.assign({}, rng, extra) }, { cards: [], range: Object.assign({}, rng, extra) }], trials: T }); j.step(1e12); return [j.result().players[0], Date.now() - t]; };
  E.createEquityJob({ players: [{ cards: hero }, { cards: [], range: Object.assign({}, rng, { pool: 1000000 }) }], trials: 10 }).step(1e9); // build pool
  const [r1, t1] = run({}, 100000), [r2, t2] = run({ pool: 1000000 }, 100000);
  console.log(`band top ${a}-${b}%: rejection ${(r1.eq * 100).toFixed(2)}±${(r1.ci * 100).toFixed(2)} in ${t1}ms | pool ${(r2.eq * 100).toFixed(2)}±${(r2.ci * 100).toFixed(2)} in ${t2}ms`);
}
