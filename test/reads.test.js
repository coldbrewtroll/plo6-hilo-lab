const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('file://' + process.cwd() + '/plo6-hilo-lab.html');
  await pg.waitForFunction(() => window.__plo6 && window.__plo6.H);
  const out = await pg.evaluate(async () => {
    const X = window.__plo6, E = X.E, h = X.H, P = c => E.parseCards(c).cards;
    // 1) list ranges == explicit sampling
    const hands = Array.from({ length: 200 }, () => E.randomHand([...P('As2s4dKdJc8c'), ...P('Qh9h3c')]));
    const j = E.createEquityJob({ players: [{ cards: P('As2s4dKdJc8c') }, { cards: [], range: { list: hands } }], board: P('Qh9h3c'), trials: 40000 }); j.step(1e9);
    let tot = 0; for (const hd of hands.slice(0, 200)) { const k = E.createEquityJob({ players: [{ cards: P('As2s4dKdJc8c') }, { cards: hd }], board: P('Qh9h3c'), trials: 400 }); k.step(1e9); tot += k.result().players[0].eq; }
    const listCheck = [j.result().players[0].eq, tot / 200];
    // 2) same flop bet, three player types
    const hero = h.hero, v = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'].find(p => p !== hero);
    for (const p of Object.keys(h.players)) { const q = h.players[p]; q.folded = p !== hero && p !== v; q.sb = 0; q.contrib = p === hero || p === v ? 12 : 0; q.stack = 88; q.allin = false; q.cands = null; }
    h.players[hero].cards = P('As2s4dKdJc8c'); h.board = P('Qh9h3c'); h.street = 'flop'; h.first = false; h.raises = 0;
    h.players[v].band = [0, 25]; h.players[v].cards = E.randomHand([...h.players[hero].cards, ...h.board]);
    X.ensureCands(h, v); const base = h.players[v].cands.slice();
    const res = {};
    // no read (preflop range only)
    h.players[v].cands = null; h.bet = 24; h.players[v].sb = 24; h.players[v].contrib = 36; h.players[v].stack = 64; h.lastRaise = 24;
    res.noRead = (await X.heroCoach(h)).eq;
    for (const prof of ['nit', 'reg', 'maniac']) {
      const q = h.players[v]; q.prof = prof; q.cands = base.slice(); q.candsStart = base.length; q.reads = [];
      X.narrowRange(h, v, 'bet', 1.0);
      const c = await X.heroCoach(h); res[prof] = { eq: c.eq, kept: q.cands.length, ok: [...c.ok].join('/'), why: c.why };
    }
    return { listCheck, res };
  });
  console.log('list-range eq', (out.listCheck[0] * 100).toFixed(1), 'vs averaged explicit', (out.listCheck[1] * 100).toFixed(1));
  console.log('hero eq facing a pot-size flop bet — no read:', (out.res.noRead * 100).toFixed(1) + '%');
  for (const k of ['nit', 'reg', 'maniac']) console.log(`  ${k.padEnd(7)} eq ${(out.res[k].eq * 100).toFixed(1)}%  kept ${out.res[k].kept}/360  coach: ${out.res[k].ok}`);
  console.log('  why (reg):', out.res.reg.why);
  console.log('errors:', errs.length ? errs : 'none');
  await b.close();
})();
