const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.message + '\n' + e.stack)); pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await pg.goto('file://' + process.cwd() + '/plo6-hilo-lab.html');
  await pg.click('.tab[data-tab=train]');
  let shotFlop = false, shotSd = false, showdowns = 0, streetsSeen = new Set(), bad = 0;
  for (let hand = 0; hand < 30; hand++) {
    for (let step = 0; step < 40; step++) {
      await pg.waitForFunction(() => { const H = window.__plo6.H; return H && (H.heroTurn || H.over); }, null, { timeout: 60000 });
      const st = await pg.evaluate(() => { const H = window.__plo6.H; return { over: H.over, street: H.street, first: H.first, opts: H.opts ? H.opts.map(o => o.a) : [] }; });
      if (st.over) break;
      streetsSeen.add(st.street);
      if (st.street === 'flop' && !shotFlop) { shotFlop = true; await pg.screenshot({ path: 'shots/p-flop.png' }); }
      // prefer continuing: first decision -> call/raise if available; later -> check/call, sometimes bet
      let pickA = st.opts.includes('call') ? 'call' : st.opts.includes('check') ? 'check' : st.opts.includes('raise') ? 'raise' : 'fold';
      if (!st.first && st.opts.includes('raise') && Math.random() < 0.25) pickA = 'raise';
      const idx = st.opts.indexOf(pickA);
      await pg.click(`#preActions .pact[data-i="${idx}"]`);
      await pg.waitForFunction(() => { const H = window.__plo6.H; return H && !H.busy && !H.heroTurn || (H && H.over); }, null, { timeout: 60000 }).catch(() => {});
    }
    const res = await pg.evaluate(() => { const X = window.__plo6, H = X.H; const tot = Object.values(H.players).reduce((a, p) => a + p.stack, 0); return { tot: tot + (H.rake || 0), rake: H.rake || 0, heroFolded: !!H.heroFolded, sd: !!H.sd, net: H.net, board: H.board.length, decisions: H.decisions.length }; });
    if (!res.heroFolded && Math.abs(res.tot - 600) > 1e-6) { bad++; console.log('CHIP MISMATCH', res); }
    if (res.sd) { showdowns++; if (!shotSd) { shotSd = true; await pg.screenshot({ path: 'shots/p-sd.png', fullPage: true }); } }
    await pg.keyboard.press(' ');
  }
  console.log('showdowns', showdowns, 'streets seen', [...streetsSeen], 'chip mismatches', bad);
  console.log('errors:', errs.length ? errs.slice(0, 3) : 'none');
  await b.close();
})();
