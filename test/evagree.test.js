// For each spot: does the range chart pick the same fold/continue decision as the hand's own EV tree?
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage();
  await pg.goto('file://' + process.cwd() + '/plo6-hilo-lab.html');
  await pg.waitForFunction(() => window.__plo6);
  const out = await pg.evaluate(async () => {
    const X = window.__plo6, E = X.E;
    const spots = [{ type: 'rfi', hero: 'UTG' }, { type: 'rfi', hero: 'CO' }, { type: 'rfi', hero: 'BTN' }, { type: 'rfi', hero: 'SB' }, { type: 'vsopen', opener: 'UTG', hero: 'BTN' }, { type: 'vsopen', opener: 'BTN', hero: 'BB' }, { type: 'vsopen', opener: 'CO', hero: 'SB' }];
    const hands = []; for (let i = 0; i < 200; i++) { const h = E.randomHand(); hands.push({ h, rk: await X.simRank(h, 20000) }); }
    const res = {};
    for (const s of spots) {
      const acts = X.spotActions(s), cont = acts[acts.length - 2].top;
      let agree = 0, n = 0, inChart = 0, evPlay = 0, near = 0, nearAgree = 0;
      for (const { h, rk } of hands) {
        if (rk.top > Math.min(100, cont * 2 + 10)) continue; // far-off hands are trivially folds
        const t = await X.evRun(s, h), g = X.gradeEV(s, t);
        const chartPlay = rk.top <= cont, evp = g.best !== 'fold';
        n++; if (chartPlay === evp) agree++; if (chartPlay) inChart++; if (evp) evPlay++;
        if (Math.abs(rk.top - cont) <= 5) { near++; if (chartPlay === evp) nearAgree++; }
      }
      res[(s.type === 'rfi' ? s.hero + ' open' : s.hero + ' vs ' + s.opener)] = `chart continue ${cont.toFixed(1)}% · fold/continue agreement ${(100 * agree / n).toFixed(0)}% of ${n} hands · within ±5 pts of the line: ${near ? (100 * nearAgree / near).toFixed(0) : '–'}% of ${near} · sample: chart plays ${inChart}, EV plays ${evPlay}`;
    }
    return res;
  });
  for (const [k, v] of Object.entries(out)) console.log(k.padEnd(14), v);
  await b.close();
})();
