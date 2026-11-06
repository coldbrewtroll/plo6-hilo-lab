// Iterated best response for the preflop range tables under the EV model in src/strategy.js.
// Each spot's thresholds move toward the EV-optimal thresholds given everyone else's current ranges.
const vm = require('vm'), fs = require('fs'), path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const ENGINE = require('../src/engine.js');
const ROOT = path.join(__dirname, '..');
const CORES = 4, ITERS = +(process.env.ITERS || 7), PER_SPOT = +(process.env.PER_SPOT || 70), POOL = +(process.env.POOL || 700);
const TARGET = +(process.env.TARGET || 0), BURN = +(process.env.BURN || 2), AVG_STOP = +(process.env.AVG_STOP || 0);
const REFINE = !!process.env.REFINE, EV_T = +(process.env.EV_T || 4000), RANK_T = +(process.env.RANK_T || 8000), STOP = +(process.env.STOP || 0); // warm-start from data/ranges.json, boundary-focused sampling, regression thresholds, averaging

function loadStrategy() {
  const E = ENGINE();
  const ctx = {}; Object.assign(ctx, {
    E, POS: ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'], P: (x, d = 1) => (x * 100).toFixed(d) + '%',
    PLO6_MODEL: JSON.parse(fs.readFileSync(path.join(ROOT, 'data/model.json'))), store: { get: (k, d) => d, set() {} },
    handStr: cs => cs.map(E.cardStr).join(''), sortHand: cs => cs.slice().sort((a, b) => (b >> 2) - (a >> 2) || (a & 3) - (b & 3)),
    trainRunner: { run: m => { ctx.trialCount += m.trials || 0; const j = E.createEquityJob(m); j.step(1e12); return Promise.resolve(j.result()); } }, trialCount: 0,
  });
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/strategy.js'), 'utf8') +
    '\nglobalThis.__S={get CFG(){return CFG}, setCfg:c=>{CFG=c}, setTrials:t=>{EV_TRIALS=t}, setPool:n=>{RANGE_POOL=n}, evRun, simRank, rankCache, spotActions, PAIRS, OPENERS, CFG_DEFAULT};', ctx);
  ctx.__S.setPool(1000000);
  const rb = path.join(ROOT, 'data/realpool.bin');
  if (fs.existsSync(rb) && !process.env.NO_REAL) E.setRealPool(new Uint8Array(fs.readFileSync(rb)));
  return { S: ctx.__S, E, ctx };
}

if (!isMainThread) {
  const { S, E, ctx } = loadStrategy();
  parentPort.on('message', async m => {
    ctx.trialCount = 0;
    if (m.cmd === 'rank') {
      const out = [];
      for (const h of m.hands) out.push((await S.simRank(h, m.trials)).top);
      parentPort.postMessage({ out, trials: ctx.trialCount });
    } else {
      S.setCfg(m.cfg);
      const out = [];
      for (const t of m.tasks) {
        S.rankCache.clear(); S.setTrials(t.trials);
        S.rankCache.set(t.handKey, Promise.resolve({ top: t.top, eq: 0, better: 100 - t.top }));
        const tree = await S.evRun(t.spot, t.hand);
        out.push({ i: t.i, evs: Object.fromEntries(tree.children.map(c => [c.a, c.ev])) });
      }
      parentPort.postMessage({ out, trials: ctx.trialCount });
    }
  });
  return;
}

(async () => {
  const t0 = Date.now(), log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
  const { S, E } = loadStrategy();
  const workers = Array.from({ length: CORES }, () => new Worker(__filename));
  const runAll = (msgs) => Promise.all(msgs.map((m, i) => new Promise(res => { const w = workers[i % CORES]; w.once('message', res); w.postMessage(m); })));
  const chunk = (arr, n) => Array.from({ length: n }, (_, i) => arr.filter((_, j) => j % n === i));

  let totalTrials = 0;
  const unwrap = rs => { rs.forEach(r => totalTrials += r.trials); return rs.flatMap(r => r.out); };
  let hands;
  if (E.hasReal()) { // candidate hands straight from the real-equity pool, evenly spread, with their real rank
    const n = E.realSize;
    hands = Array.from({ length: POOL }, (_, k) => { const i = Math.min(n - 1, Math.floor((k + Math.random()) / POOL * n)); return { h: E.realHand(i), top: 100 * (i + 0.5) / n }; });
    log(`candidate hands: ${hands.length} from the real-equity pool (${n.toLocaleString()} hands)`);
  } else {
    const pool = Array.from({ length: POOL }, () => E.randomHand());
    const ranks = unwrap(await runAll(chunk(pool, CORES).map(hands => ({ cmd: 'rank', hands, trials: RANK_T }))));
    const order = chunk(pool, CORES).flat();
    hands = order.map((h, i) => ({ h, top: ranks[i] }));
    log('ranked pool of', hands.length);
  }

  const cfg = JSON.parse(JSON.stringify(S.CFG_DEFAULT));
  if (REFINE) { const src = process.env.WARM_RAW && fs.existsSync(path.join(ROOT, 'data/ranges.raw.json')) ? 'data/ranges.raw.json' : 'data/ranges.json'; log('warm start from ' + src); const r = JSON.parse(fs.readFileSync(path.join(ROOT, src))); Object.assign(cfg, { rfi: r.rfi, sbComplete: r.sbComplete, vsOpen: r.vsOpen, vs3: r.vs3 }); }
  const hist = []; let prevOut = null;
  const spots = [];
  ['UTG', 'HJ', 'CO', 'BTN', 'SB'].forEach(h => spots.push({ type: 'rfi', hero: h }));
  S.PAIRS.forEach(([o, h]) => spots.push({ type: 'vsopen', opener: o, hero: h }));
  S.PAIRS.forEach(([o, h]) => spots.push({ type: 'vs3', hero: o, villain: h }));
  const sKey = s => s.type === 'rfi' ? 'rfi:' + s.hero : s.type === 'vsopen' ? `vsopen:${s.opener}>${s.hero}` : `vs3:${s.hero}>${s.villain}`;

  // threshold that best separates label=true (better hands) from false
  function stepFit(pts) {
    pts.sort((a, b) => a.top - b.top);
    let best = 0, bestScore = pts.filter(p => !p.y).length; // t=0: everything above
    let score = bestScore;
    for (let i = 0; i < pts.length; i++) {
      score += pts[i].y ? 1 : -1;
      if (score > bestScore) { bestScore = score; best = i + 1 < pts.length ? (pts[i].top + pts[i + 1].top) / 2 : Math.min(100, pts[i].top + 1); }
    }
    return best;
  }
  let damp = 0.5;
  for (let it = 1; it <= ITERS; it++) {
    if (REFINE) damp = it === 1 ? 0.5 : 0.35;
    S.setCfg(cfg);
    const tasks = [];
    for (const s of spots) {
      let cap = 85;
      if (s.type === 'vs3') cap = cfg.rfi[s.hero];
      if (s.type === 'rfi' && s.hero === 'SB') cap = 100;
      let cand = hands.filter(x => x.top <= cap);
      if (REFINE) {
        const th = S.spotActions(s).slice(0, -1).map(a => a.top);
        cand = cand.filter(x => th.some(t => Math.abs(x.top - t) <= Math.max(6, t * 0.35)));
      }
      const nUse = Math.min(PER_SPOT, cand.length), sims = s.type === 'rfi' ? (s.hero === 'SB' ? 6 : 4) : s.type === 'vsopen' ? 3 : 2;
      const trialsPer = TARGET ? Math.max(3000, Math.min(60000, Math.ceil(TARGET / (nUse * sims)))) : EV_T;
      for (let k = 0; k < nUse; k++) {
        const x = cand[Math.floor(k * cand.length / nUse)];
        tasks.push({ i: tasks.length, spot: s, hand: x.h, top: x.top, trials: trialsPer, handKey: x.h.slice().sort((a, b) => (b >> 2) - (a >> 2) || (a & 3) - (b & 3)).map(E.cardStr).join('') });
      }
    }
    const before = totalTrials;
    const res = unwrap(await runAll(chunk(tasks, CORES).map(ts => ({ cmd: 'ev', tasks: ts, cfg, trials: EV_T }))));
    const itTrials = totalTrials - before;
    const byI = new Map(res.map(r => [r.i, r.evs]));
    let maxMove = 0, maxGap = 0; const moves = [], gaps = [];
    for (const s of spots) {
      const pts = tasks.filter(t => sKey(t.spot) === sKey(s)).map(t => { const ev = byI.get(t.i); const best = Object.entries(ev).sort((a, b) => b[1] - a[1])[0][0]; return { top: t.top, best, ev }; });
      let tRaise = stepFit(pts.map(p => ({ top: p.top, y: p.best === 'raise' })));
      let tCont = Math.max(tRaise, stepFit(pts.map(p => ({ top: p.top, y: p.best !== 'fold' }))));
      if (REFINE) {
        const cur = S.spotActions(s);
        const nonFoldOther = ev => Math.max(...Object.entries(ev).filter(([a]) => a !== 'fold' && a !== 'raise').map(([, v]) => v), -1e9);
        const cross = (sel, d, t0) => { // linear fit of EV advantage vs rank near t0, solve for 0
          const q = pts.filter(p => Math.abs(p.top - t0) <= Math.max(8, t0 * 0.5)).map(p => [p.top, d(p.ev)]);
          if (q.length < 6) return sel;
          const n = q.length, mx = q.reduce((a, p) => a + p[0], 0) / n, my = q.reduce((a, p) => a + p[1], 0) / n;
          const sxy = q.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0), sxx = q.reduce((a, p) => a + (p[0] - mx) ** 2, 0);
          const slope = sxy / sxx; if (!(slope < 0)) return sel;
          const W = Math.max(8, t0 * 0.5); // no extrapolating past the sampled window
          return Math.max(0, Math.min(100, Math.max(t0 - W, Math.min(t0 + W, mx - my / slope))));
        };
        const hasCall = cur.length > 2;
        tRaise = cross(tRaise, ev => ev.raise - Math.max(ev.fold, hasCall ? nonFoldOther(ev) : -1e9), cur[0].top);
        tCont = hasCall ? Math.max(tRaise, cross(tCont, ev => Math.max(ev.raise, nonFoldOther(ev)) - ev.fold, cur[1].top)) : tRaise;
      }
      const mv = (o, n, cap = 100) => { n = Math.max(0, Math.min(cap, n)); const v = o + damp * (n - o); maxMove = Math.max(maxMove, Math.abs(v - o)); maxGap = Math.max(maxGap, Math.abs(n - o)); gaps.push([sKey(s), +(n - o).toFixed(2)]); return +v.toFixed(2); };
      if (s.type === 'rfi') {
        cfg.rfi[s.hero] = Math.max(1, mv(cfg.rfi[s.hero], s.hero === 'SB' ? tRaise : tCont));
        if (s.hero === 'SB') cfg.sbComplete = Math.max(cfg.rfi.SB, mv(cfg.sbComplete, tCont));
      } else if (s.type === 'vsopen') {
        const e = cfg.vsOpen[s.opener + '>' + s.hero]; e.tb = mv(e.tb, tRaise); e.ct = Math.max(e.tb, mv(e.ct, tCont));
      } else {
        const e = cfg.vs3[s.hero + '>' + s.villain], open = cfg.rfi[s.hero];
        e.fb = Math.min(open, mv(e.fb, tRaise, open)); e.cb = Math.min(open, Math.max(e.fb, mv(e.cb, tCont, open)));
      }
    }
    log(`iter ${it}: ${(itTrials / 1e6).toFixed(0)}M trials (min ${(Math.min(...spots.map(s => tasks.filter(t => sKey(t.spot) === sKey(s)).reduce((a, t) => a + t.trials * (t.spot.type === 'rfi' ? (t.spot.hero === 'SB' ? 6 : 4) : t.spot.type === 'vsopen' ? 3 : 2), 0))) / 1e6).toFixed(1)}M/spot) · max gap to best response ${maxGap.toFixed(2)} pts · max move ${maxMove.toFixed(2)} · RFI ${JSON.stringify(cfg.rfi)} SBcomplete ${cfg.sbComplete}`);
    hist.push(JSON.parse(JSON.stringify({ rfi: cfg.rfi, sbComplete: cfg.sbComplete, vsOpen: cfg.vsOpen, vs3: cfg.vs3 })));
    fs.writeFileSync(path.join(ROOT, 'data/ranges.raw.json'), JSON.stringify(Object.assign({}, hist[hist.length - 1], { iteration: it }), null, 1));
    let outCfg = hist[hist.length - 1];
    if (REFINE && hist.length > BURN) { // Polyak averaging over every iterate after burn-in
      const last = hist.slice(BURN), avg = JSON.parse(JSON.stringify(last[0]));
      const walk = (o, path2) => { for (const k of Object.keys(o)) { if (typeof o[k] === 'object') walk(o[k], path2.concat(k)); else o[k] = +(last.reduce((a, h) => a + path2.concat(k).reduce((x, kk) => x[kk], h), 0) / last.length).toFixed(2); } };
      walk(avg, []); outCfg = avg;
    }
    let avgShift = null;
    if (prevOut) { avgShift = 0; const cmp = (a, b) => { for (const k of Object.keys(a)) { if (typeof a[k] === 'object') cmp(a[k], b[k]); else avgShift = Math.max(avgShift, Math.abs(a[k] - b[k])); } }; cmp({ rfi: outCfg.rfi, sbComplete: outCfg.sbComplete, vsOpen: outCfg.vsOpen, vs3: outCfg.vs3 }, prevOut); }
    if (hist.length > BURN) log(`  averaged over ${hist.length - BURN} iterations${avgShift != null ? ` · largest change in the average ${avgShift.toFixed(2)} pts` : ''}`);
    const stableNow = AVG_STOP && avgShift != null && hist.length - BURN >= 3 && avgShift < AVG_STOP;
    prevOut = hist.length > BURN ? JSON.parse(JSON.stringify({ rfi: outCfg.rfi, sbComplete: outCfg.sbComplete, vsOpen: outCfg.vsOpen, vs3: outCfg.vs3 })) : null;
    fs.writeFileSync(path.join(ROOT, 'data/ranges.json'), JSON.stringify(Object.assign({}, outCfg, { iterations: it, refined: REFINE, pool: hands.length, perSpot: PER_SPOT, evTrials: EV_T, totalTrials, maxGap: +maxGap.toFixed(2) }), null, 1));
    log('  largest gaps: ' + gaps.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 4).map(g => `${g[0]} ${g[1] > 0 ? '+' : ''}${g[1]}`).join(' · '));
    if (stableNow) { log(`smooth: the averaged ranges moved less than ${AVG_STOP} pts`); break; }
    if (STOP && maxGap < STOP && it >= 3) { log(`converged: every threshold within ${STOP} pts of its best response`); break; }
  }
  const f = x => x.toFixed(1);
  console.log('vsOpen (3bet / continue):'); for (const [k, v] of Object.entries(cfg.vsOpen)) console.log('  ', k.padEnd(8), f(v.tb), '/', f(v.ct));
  console.log('vs3 (4bet / continue):'); for (const [k, v] of Object.entries(cfg.vs3)) console.log('  ', k.padEnd(8), f(v.fb), '/', f(v.cb));
  workers.forEach(w => w.terminate());
})();
