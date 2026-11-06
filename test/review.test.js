const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.message + ' ' + e.stack)); pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await pg.goto('file://' + process.cwd() + '/plo6-hilo-lab.html');
  await pg.click('.tab[data-tab=train]');
  const playHand = async () => {
    for (let step = 0; step < 40; step++) {
      await pg.waitForFunction(() => { const H = window.__plo6.H; return H && (H.heroTurn || H.over); }, null, { timeout: 60000 });
      const st = await pg.evaluate(() => { const H = window.__plo6.H; return { over: H.over, opts: H.opts ? H.opts.map(o => o.a) : [] }; });
      if (st.over) return;
      const pick = st.opts.includes('call') ? 'call' : st.opts.includes('check') ? 'check' : 'raise';
      await pg.click(`#preActions .pact[data-i="${st.opts.indexOf(pick)}"]`);
      await pg.waitForFunction(() => { const H = window.__plo6.H; return H && (!H.busy && !H.heroTurn || H.over); }, null, { timeout: 60000 }).catch(() => {});
    }
  };
  // play until we get a hand that went to showdown
  for (let n = 0; n < 8; n++) { await playHand(); if (await pg.evaluate(() => !!window.__plo6.H.sd)) break; await pg.keyboard.press(' '); }
  await pg.screenshot({ path: 'shots/r-over.png' });
  const nSnaps = await pg.evaluate(() => window.__plo6.H.snaps.length);
  await pg.click('[data-r="back"]');
  const after1 = await pg.evaluate(() => window.__plo6.RV && window.__plo6.RV.i);
  await pg.keyboard.press('ArrowLeft'); await pg.keyboard.press('ArrowLeft');
  const after3 = await pg.evaluate(() => window.__plo6.RV.i);
  await pg.keyboard.press('Home');
  await pg.screenshot({ path: 'shots/r-start.png' });
  await pg.keyboard.press('ArrowRight'); await pg.keyboard.press('ArrowRight'); await pg.keyboard.press('ArrowRight');
  await pg.screenshot({ path: 'shots/r-mid.png', fullPage: true });
  const prompt = await pg.textContent('#preTitle');
  await pg.click('[data-r="play"]'); await pg.waitForTimeout(2200);
  const playing = await pg.evaluate(() => window.__plo6.RV.i);
  await pg.click('[data-r="play"]');
  await pg.uncheck('#rvReveal'); await pg.check('#rvReveal');
  const hands = await pg.evaluate(() => window.__plo6.HANDS.length);
  if (hands > 1) await pg.click('[data-r="prevhand"]');
  const reviewingIdx = await pg.evaluate(() => window.__plo6.HANDS.indexOf(window.__plo6.RV.h));
  await pg.keyboard.press(' ');
  const exited = await pg.evaluate(() => !window.__plo6.RV && !window.__plo6.H.over);
  console.log({ nSnaps, after1, after3, prompt, playingStep: playing, hands, reviewingIdx, exited });
  console.log('errors:', errs.length ? errs.slice(0, 3) : 'none');
  await b.close();
})();
