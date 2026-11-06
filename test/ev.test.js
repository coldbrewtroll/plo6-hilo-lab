const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('file://' + process.cwd() + '/plo6-hilo-lab.html');
  await pg.waitForFunction(() => window.__plo6);
  const out = await pg.evaluate(async () => {
    const X = window.__plo6, E = X.E, res = [];
    const hands = ['KsTd9c5h5d2s', 'As2s3dKdQh9c', 'Ac2d7h8sJcQd', 'Ad5c6h9sTdKc', '2s3s4d5dKhQc', '9hTsJdQc8h7s', 'KsKhQdJdTc9s', 'Ah3c6d8sJhQc'];
    const spots = [{ type: 'rfi', hero: 'BTN' }, { type: 'rfi', hero: 'UTG' }, { type: 'rfi', hero: 'SB' }, { type: 'vsopen', opener: 'CO', hero: 'BB' }, { type: 'vsopen', opener: 'UTG', hero: 'BTN' }, { type: 'vs3', hero: 'CO', villain: 'BTN' }];
    for (const h of hands) {
      const c = E.parseCards(h).cards, rk = await X.simRank(c);
      const row = { h, top: rk.top.toFixed(1), eq: (rk.eq * 100).toFixed(1) };
      for (const s of spots) {
        const t = await X.evRun(s, c), gr = X.gradeRange(s, rk.top), ge = X.gradeEV(s, t);
        const key = s.type === 'rfi' ? s.hero : s.type === 'vsopen' ? `${s.hero}v${s.opener}` : `${s.hero}v3${s.villain}`;
        row[key] = `${[...gr.ok].join('/')} | ${ge.evs.map(e => e.a[0] + (e.ev >= 0 ? '+' : '') + e.ev.toFixed(2)).join(' ')}`;
      }
      res.push(row);
    }
    return res;
  });
  for (const r of out) { console.log(`${r.h}  top ${r.top}%  eq ${r.eq}`); for (const [k, v] of Object.entries(r)) if (!['h', 'top', 'eq'].includes(k)) console.log('   ', k.padEnd(9), v); }
  console.log('errors', errs);
  await b.close();
})();
