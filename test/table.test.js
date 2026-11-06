const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await pg.goto('file://' + process.cwd() + '/plo6-hilo-lab.html');
  await pg.click('.tab[data-tab=train]');
  await pg.waitForSelector('#preActions .pact');
  await pg.uncheck('#prePlayOut');
  await pg.screenshot({ path: 'shots/t-pre.png' });
  for (let i = 0; i < 6; i++) {
    await pg.click('#preActions .pact[data-a] >> nth=0');
    await pg.waitForSelector('#preNext', { timeout: 30000 });
    if (i === 0) await pg.screenshot({ path: 'shots/t-pre-ans.png', fullPage: true });
    console.log('pre:', await pg.textContent('#preTitle'), '|', (await pg.textContent('.poverlay')).trim());
    await pg.keyboard.press(' ');
    await pg.waitForSelector('#preActions .pact[data-a]:not([disabled])');
  }
  await pg.click('.subtab[data-sub=tr-eq]');
  await pg.selectOption('#eqPlayers', '6');
  await pg.keyboard.press('Enter');
  await pg.waitForSelector('#eqFb.show', { timeout: 30000 });
  await pg.screenshot({ path: 'shots/t-eq.png' });
  await pg.click('.subtab[data-sub=tr-sd]');
  await pg.selectOption('#sdCount', '4');
  await pg.keyboard.press('Digit1'); await pg.keyboard.press('Shift+Digit2');
  await pg.screenshot({ path: 'shots/t-sd.png' });
  await pg.keyboard.press('Enter');
  await pg.waitForSelector('#sdFb.show');
  await pg.screenshot({ path: 'shots/t-sd-ans.png' });
  console.log('errors:', errs.length ? errs : 'none');
  await b.close();
})();
