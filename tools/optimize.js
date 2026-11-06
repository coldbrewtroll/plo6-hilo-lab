// Overnight leak plugging by self-play.
// Paired ("duplicate") evaluation: each deal is played twice with identical cards and random streams —
// once with one learner seat using candidate params, once with everybody on the current params (theta*).
// The difference is purely the learner's decisions, so small edges become measurable.
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), OUT = process.env.OUT ? path.resolve(process.env.OUT) : path.join(ROOT, 'data/botpolicy.json');
const CORES = 4, HYP_DEALS = +(process.env.HYP_DEALS || 40000), FINAL_DEALS = +(process.env.FINAL_DEALS || 200000), HOURS = +(process.env.HOURS || 7), DEALS = +(process.env.DEALS || 30000), Z = +(process.env.Z || 2.5);

if (!isMainThread) {
  const SP = require('./selfplay.js');
  let cacheVer = null, cache = new Map();
  parentPort.on('message', m => {
    if (m.ver !== cacheVer) { cacheVer = m.ver; cache = new Map(); }
    let n = 0, s1 = 0, s2 = 0, nz = 0;
    for (let s = m.from; s < m.from + m.count; s++) {
      const seat = s % 6;
      let base = cache.get(s);
      const field = m.pop ? SP.POS.map((_, i) => { const t = m.pop[(i + s) % m.pop.length]; return t === 'self' ? m.star : t; }) : SP.POS.map(() => m.star);
      if (base == null) { base = SP.playHand(s, field.map((t, i) => i === seat ? m.star : t))[seat]; cache.set(s, base); }
      const th = field.map((t, i) => i === seat ? m.cand : t);
      const d = SP.playHand(s, th)[seat] - base;
      n++; s1 += d; s2 += d * d; if (Math.abs(d) > 1e-9) nz++;
    }
    parentPort.postMessage({ n, s1, s2, nz });
  });
  return;
}

const SP = require('./selfplay.js');
const workers = Array.from({ length: CORES }, () => new Worker(__filename));
const t0 = Date.now(), log = (...a) => { const line = `[${((Date.now() - t0) / 60000).toFixed(1)}m] ` + a.join(' '); console.log(line); };
let ver = 0;
const POPULATION = process.env.POP ? process.env.POP.split(',').map(x => {
  if (x === 'self') return 'self';
  const [kind, f] = x.includes(':') ? x.split(':') : ['policy', x];
  const t = SP.withNeutral(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f))).theta);
  if (kind === 'station') for (const st of SP.STREETS) Object.assign(t[st], { sizeAdj: 0, huAdj: 0, slack: t[st].slack + 0.05, bluff: 0, braise: 0, trap: 0, stab: 0 });
  return t;
}) : null;
async function pairEval(star, cand, seedBase, deals) {
  const per = Math.ceil(deals / CORES);
  const rs = await Promise.all(workers.map((w, k) => new Promise(res => { w.once('message', res); w.postMessage({ ver, star, cand, pop: POPULATION, from: seedBase + k * per, count: per }); })));
  const n = rs.reduce((a, r) => a + r.n, 0), s1 = rs.reduce((a, r) => a + r.s1, 0), s2 = rs.reduce((a, r) => a + r.s2, 0), nz = rs.reduce((a, r) => a + r.nz, 0);
  const mean = s1 / n, se = Math.sqrt(Math.max(1e-12, s2 / n - mean * mean) / n);
  return { bb100: mean * 100, se100: se * 100, z: mean / se, n, changed: nz / n };
}
const STEP0 = { vb: 0.04, big: 0.05, thin: 0.15, bomb: 0.15, bluff: 0.05, slack: 0.03, sizeAdj: 0.25, raiseM: 0.08, raiseSc: 0.15, swing: 0.05, swingVb: 0.05, swingSize: 0.2, swingRaise: 0.06, initVb: 0.04, bigSize: 0.2, bluffSize: 0.2, bluffMax: 0.05, huVb: 0.04, huAdj: 0.04, braise: 0.05, trap: 0.08, stab: 0.08, stabLo: 0.05, rfiUTG: 0.15, rfiHJ: 0.15, rfiCO: 0.15, rfiBTN: 0.12, rfiSB: 0.15, sbc: 0.12, iso: 0.2, tbIP: 0.2, ctIP: 0.15, tbBlind: 3, ctSB: 0.15, ctBB: 0.12, fb: 0.2, cb: 0.2 };
const clamp = (k, v) => Math.max(SP.BOUNDS[k][0], Math.min(SP.BOUNDS[k][1], +v.toFixed(3)));
function save(state) { fs.writeFileSync(OUT, JSON.stringify(state, null, 1)); }

async function hypotheses(star, label, seedBase) {
  const out = [];
  const test = async (name, street, key, values) => {
    for (const v of values) {
      const cand = SP.clone(star); cand[street][key] = v;
      if (Math.abs(cand[street][key] - star[street][key]) < 1e-9) continue;
      const r = await pairEval(star, cand, seedBase, HYP_DEALS);
      out.push({ name, street, key, from: star[street][key], to: v, bb100: +r.bb100.toFixed(2), se100: +r.se100.toFixed(2), z: +r.z.toFixed(2) });
      log(`  ${label} ${name}: ${street}.${key} ${star[street][key]} → ${v}: ${r.bb100 >= 0 ? '+' : ''}${r.bb100.toFixed(2)} ± ${r.se100.toFixed(2)} bb/100 (z ${r.z.toFixed(1)})`);
    }
  };
  await test('thin river value', 'river', 'vb', [0.02, 0.06, 0.10, 0.14]);
  await test('river bomb with scoop potential', 'river', 'bomb', [0.40, 0.55, 0.70, 1.01]);
  await test('turn bomb with scoop potential', 'turn', 'bomb', [0.50, 0.65, 1.01]);
  await test('thin value size (river)', 'river', 'thin', [0.33, 0.5, 0.75]);
  return out;
}

(async () => {
  let state = fs.existsSync(OUT) && !process.env.FRESH ? JSON.parse(fs.readFileSync(OUT)) : null;
  if (!state && process.env.WARM) { const w = SP.withNeutral(JSON.parse(fs.readFileSync(path.resolve(process.env.WARM))).theta); state = { theta: w, baseline: SP.clone(w), baselineName: 'previous tuned bot', history: [], sweeps: 0, deals: 0, hypothesesStart: [], hypothesesEnd: null, final: null, started: new Date().toISOString() }; }
  if (!state) state = { theta: SP.clone(SP.BASELINE), baseline: SP.clone(SP.BASELINE), history: [], sweeps: 0, deals: 0, hypothesesStart: null, hypothesesEnd: null, final: null, started: new Date().toISOString() };
  state.theta = SP.withNeutral(state.theta);
  const deadline = t0 + HOURS * 3600e3, SWEEP0 = process.env.STEP_RESET ? state.sweeps : 0; // STEP_RESET: start this run's sweeps at full step size
  if (!state.hypothesesStart) { log('testing your hypotheses against the starting bot…'); state.hypothesesStart = await hypotheses(state.theta, 'start', 9e8); save(state); }
  // guided jumps: multi-parameter moves suggested by the problem-spot scan (tools/spots.js)
  if (process.env.GUIDED && !state.guidedDone) {
    const G = JSON.parse(fs.readFileSync(path.resolve(process.env.GUIDED))), GD = +(process.env.GUIDED_DEALS || 60000);
    log(`guided jumps: ${G.length} candidates from the problem-spot scan (${GD.toLocaleString()} duplicate deals each)`);
    for (const [gi, g] of G.entries()) {
      if (g.street === 'pre') state.theta.pre = Object.assign({}, SP.PRE_NEUTRAL, state.theta.pre || {});
      const cand = SP.clone(state.theta), from = {};
      for (const [k, v] of Object.entries(g.patch)) { from[k] = cand[g.street][k]; cand[g.street][k] = clamp(k, v); }
      const r = await pairEval(state.theta, cand, 6e8 + gi * 1e6, GD); state.deals += r.n * 2;
      const keep = r.bb100 > 0 && r.z >= Z;
      log(`  ${keep ? '✓' : '·'} ${g.name}: ${r.bb100 >= 0 ? '+' : ''}${r.bb100.toFixed(2)} ± ${r.se100.toFixed(2)} bb/100 (z ${r.z.toFixed(1)})`);
      if (keep) { state.history.push({ sweep: 'guided', street: g.street, key: 'guided', name: g.name, from: JSON.stringify(from), to: JSON.stringify(g.patch), bb100: +r.bb100.toFixed(2), se100: +r.se100.toFixed(2), z: +r.z.toFixed(2), deals: r.n }); state.theta = cand; ver++; }
      save(state);
    }
    state.guidedDone = true; save(state);
  }
  const order = [];
  const KEYSET = process.env.KEYSET ? process.env.KEYSET.split(',') : SP.KEYS;
  if (process.env.PRE) { state.theta.pre = Object.assign({}, SP.PRE_NEUTRAL, state.theta.pre || {}); for (const k of SP.PRE_KEYS) order.push(['pre', k]); } // round 9+: tune the preflop charts
  else for (const st of ['river', 'turn', 'flop']) for (const k of KEYSET) order.push([st, k]);
  while (Date.now() < deadline) {
    const sweep = ++state.sweeps, scale = Math.max(0.25, Math.pow(0.7, sweep - 1 - SWEEP0)), seedBase = sweep * 1e7;
    let accepted = 0;
    log(`sweep ${sweep} (step ×${scale.toFixed(2)}, ${DEALS.toLocaleString()} duplicate deals per test)`);
    for (const [st, k] of order) {
      if (Date.now() > deadline) break;
      const cur = state.theta[st][k], step = STEP0[k] * scale;
      let best = null;
      const cands = [clamp(k, cur - step), clamp(k, cur + step)];
      if (k === 'bomb' || k === 'raiseSc') for (const j of [0.45, 0.6, 0.75]) if (Math.abs(j - cur) > step) cands.push(j); // jump tests: scoop-triggered bombs/raises
      for (const v of cands) {
        if (Math.abs(v - cur) < 1e-9) continue;
        const cand = SP.clone(state.theta); cand[st][k] = v;
        const r = await pairEval(state.theta, cand, seedBase, DEALS);
        state.deals += r.n * 2;
        if (!best || r.bb100 > best.r.bb100) best = { v, r, cand };
      }
      if (best && best.r.bb100 > 0 && best.r.z >= Z) {
        state.history.push({ sweep, street: st, key: k, from: cur, to: best.v, bb100: +best.r.bb100.toFixed(2), se100: +best.r.se100.toFixed(2), z: +best.r.z.toFixed(2), deals: best.r.n, changedShare: +best.r.changed.toFixed(3) });
        state.theta = best.cand; ver++; accepted++;
        log(`  ✓ ${st}.${k}: ${cur} → ${best.v}  ${best.r.bb100 >= 0 ? '+' : ''}${best.r.bb100.toFixed(2)} ± ${best.r.se100.toFixed(2)} bb/100 (z ${best.r.z.toFixed(1)})`);
      }
      save(state);
    }
    log(`sweep ${sweep} done: ${accepted} changes kept · ${(state.deals / 1e6).toFixed(1)}M hands simulated so far`);
    if (accepted === 0 && scale <= 0.25) { log('no further improvements at the finest step size — converged'); break; }
  }
  if (process.env.SKIP_FINAL) { save(state); log('phase done (final checks skipped)'); workers.forEach(w => w.terminate()); return; }
  log('final checks…');
  state.hypothesesEnd = await hypotheses(state.theta, 'end', 8e8);
  // how much did plugging the leaks win? tuned bot in a table of original bots, vs the original bot in the same seat
  const r1 = await (async () => { const star = state.baseline, cand = state.theta; ver++; return pairEval(star, cand, 7e8, FINAL_DEALS); })();
  state.final = { vsOriginalTable: { bb100: +r1.bb100.toFixed(2), se100: +r1.se100.toFixed(2), z: +r1.z.toFixed(1), deals: r1.n, baseline: state.baselineName || 'original bot' } };
  log(`tuned bot vs the ${state.baselineName || 'original bot'} (same seat, same cards, table of baseline bots): ${r1.bb100 >= 0 ? '+' : ''}${r1.bb100.toFixed(2)} ± ${r1.se100.toFixed(2)} bb/100`);
  state.finished = new Date().toISOString(); save(state);
  workers.forEach(w => w.terminate());
})();
