const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage();
  await pg.goto('file://' + process.cwd() + '/plo6-hilo-lab.html');
  await pg.waitForFunction(() => window.__plo6);
  const t = await pg.evaluate(async ([hs, spot]) => {
    const X = window.__plo6; const h = X.E.parseCards(hs).cards;
    const rk = await X.simRank(h); const tree = await X.evRun(spot, h);
    const pr = (n, d) => '  '.repeat(d) + (n.p != null ? `[${(n.p * 100).toFixed(0)}%] ` : '') + n.label + ' ' + n.ev.toFixed(2) + (n.detail ? '  — ' + n.detail : '') + '\n' + (n.children || []).map(c => pr(c, d + 1)).join('');
    return `top ${rk.top.toFixed(1)}  playMult ${tree.playMult.toFixed(2)}\n` + pr(tree, 0);
  }, [process.argv[2], JSON.parse(process.argv[3])]);
  console.log(t); await b.close();
})();
