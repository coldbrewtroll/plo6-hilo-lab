const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = [];
  pg.on('pageerror', e => errs.push('pageerror: ' + e.message));
  pg.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await pg.goto('file://' + process.cwd() + '/plo6-hilo-lab.html');
  // default sim auto-run (MC, until ±0.5%)
  await pg.waitForFunction(() => /Monte Carlo|Exact/.test(document.querySelector('#simSummary').textContent) && !/…$/.test(document.querySelector('#simSummary').textContent), null, { timeout: 20000 });
  console.log('summary1:', await pg.textContent('#simSummary'));
  // set full table: hero vs 5 random, force MC ±0.25%
  await pg.click('#heroVsField');
  await pg.selectOption('#simTrials', 'ci:0.0025');
  await pg.waitForTimeout(400);
  await pg.waitForFunction(() => !/…$/.test(document.querySelector('#simSummary').textContent) && /Monte/.test(document.querySelector('#simSummary').textContent), null, { timeout: 30000 });
  console.log('summary2:', await pg.textContent('#simSummary'));
  console.log('seat0:', (await pg.textContent('#seat-0 .seat-res')).replace(/\s+/g, ' '));
  await pg.hover('#convChart svg .hit', { position: { x: 300, y: 100 } });
  await pg.screenshot({ path: 'shots/sim.png', fullPage: true });
  // exact mode with known hands
  await pg.click('#clearAll');
  await pg.fill('#seat-0 input[type=text]', 'As2s3dKdQh9c');
  await pg.fill('#seat-5 input[type=text]', 'Ah4h5c6cJdTd');
  await pg.selectOption('#simMode', 'exact');
  await pg.waitForTimeout(400);
  await pg.waitForFunction(() => /Exact enumeration/.test(document.querySelector('#simSummary').textContent) && !/…$/.test(document.querySelector('#simSummary').textContent), null, { timeout: 30000 });
  console.log('summary3:', await pg.textContent('#simSummary'));
  // analyzer
  await pg.click('.subtab[data-sub=sim-analyzer]');
  await pg.click('#anRun');
  await pg.waitForFunction(() => document.querySelectorAll('#anTable tr').length === 6 && !/running/.test(document.querySelector('#anTable').textContent), null, { timeout: 60000 });
  await pg.screenshot({ path: 'shots/analyzer.png', fullPage: true });
  console.log('analyzer row1:', (await pg.textContent('#anTable tr:nth-child(2)')).replace(/\s+/g, ' '));
  // trainer
  await pg.click('.tab[data-tab=train]');
  await pg.waitForFunction(() => document.querySelectorAll('#preActions .pact[data-a]').length > 0, null, { timeout: 60000 });
  await pg.uncheck('#prePlayOut');
  console.log('pre title:', await pg.textContent('#preTitle'));
  await pg.keyboard.press('f');
  await pg.waitForSelector('#preFb .verdict', { timeout: 30000 });
  console.log('pre verdict:', await pg.textContent('#preFb .verdict'));
  console.log('flow hit:', await pg.$$eval('#preFlow .fnode.hit', n => n.map(x => x.textContent.trim())));
  console.log('tree root:', (await pg.textContent('#preTree .tn')).replace(/\s+/g, ' ').trim());
  await pg.screenshot({ path: 'shots/preflop.png', fullPage: true });
  for (let i = 0; i < 8; i++) { await pg.keyboard.press(' '); await pg.waitForSelector('#preActions .pact[data-a]:not([disabled])'); await pg.click('#preActions .pact[data-a] >> nth=' + (i % 2)); await pg.waitForSelector('#preNext', { timeout: 30000 }); }
  await pg.click('.subtab[data-sub=tr-eq]');
  await pg.keyboard.press('Enter');
  await pg.waitForSelector('#eqFb.show', { timeout: 20000 });
  console.log('eq verdict:', await pg.textContent('#eqFb .verdict'));
  await pg.screenshot({ path: 'shots/equity.png', fullPage: true });
  await pg.click('.subtab[data-sub=tr-sd]');
  await pg.click('#sdTable .toggle.hi >> nth=0');
  await pg.keyboard.press('Enter');
  await pg.waitForSelector('#sdFb.show');
  console.log('sd verdict:', (await pg.textContent('#sdFb')).replace(/\s+/g, ' '));
  await pg.screenshot({ path: 'shots/showdown.png', fullPage: true });
  await pg.click('.subtab[data-sub=tr-stats]');
  await pg.screenshot({ path: 'shots/stats.png', fullPage: true });
  console.log('errors:', errs.length ? errs : 'none');
  await b.close();
})();
