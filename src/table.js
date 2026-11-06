// =====================================================================
// POKER TABLE UI (shared by the three trainer modes)
// =====================================================================
// Seat slots around the oval, clockwise from the hero at bottom centre (action moves to the hero's left).
const SLOTS = [[50, 80], [11, 59], [15, 21], [50, 13], [85, 21], [89, 59]];
const CENTER = [50, 45];
// phones (portrait): a tall oval, seats down both sides
const SLOTS_PHONE = [[50, 85], [16, 56], [16, 26], [50, 10], [84, 26], [84, 56]], CENTER_PHONE = [50, 46];
const PHONE_MQ = typeof matchMedia !== 'undefined' ? matchMedia('(max-width: 640px)') : { matches: false };
const isPhone = () => PHONE_MQ.matches;
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const AV_COLORS = { UTG: '#5b8def', HJ: '#a06ee0', CO: '#e0739f', BTN: '#e3a33c', SB: '#3fb6a8', BB: '#6fbf5a' };
const fmtAmt = x => (Math.round(x * 10) / 10).toString();
const backsHTML = n => Array.from({ length: n }, () => '<span class="card md back"></span>').join('');
function chipStackHTML(amt) {
  const n = amt >= 50 ? 4 : amt >= 10 ? 3 : amt >= 3 ? 2 : 1, cls = amt >= 50 ? 'c-k' : amt >= 10 ? 'c-g' : amt >= 3 ? 'c-r' : 'c-w';
  return `<span class="chips-stack">${Array.from({ length: n }, (_, i) => `<i class="pchip ${cls}" style="bottom:${i * 3}px"></i>`).join('')}</span>`;
}
// o = { hero, seats: {POS: {state:'hero'|'active'|'folded'|'empty'|'acting', cards, faceUp, bet, stack, tag, under, cls, num}},
//       board:[], pot:'html', overlay:'html', dealer:'BTN', info:'html', prompt:'html', actions:'html' }
function tableHTML(o) {
  const hi = POS.indexOf(o.hero), slot = {}, phone = isPhone(), SL = phone ? SLOTS_PHONE : SLOTS, CEN = phone ? CENTER_PHONE : CENTER;
  for (let k = 0; k < 6; k++) slot[POS[(hi + k) % 6]] = SL[k];
  let seats = '', bets = '';
  for (const p of POS) {
    const s = o.seats[p] || { state: 'empty' }, [x, y] = slot[p], isHero = p === o.hero;
    let cards = '';
    if (s.cards && ((s.state !== 'folded' && s.state !== 'empty') || s.showCards)) cards = s.faceUp ? handHTML(s.cards, (isHero ? 'xl' : 'md') + (s.cardCls ? ' ' + s.cardCls : '')) : backsHTML(6);
    seats += `<div class="pseat st-${s.state} ${isHero ? 'is-hero' : ''} ${s.cls || ''}" style="left:${x}%;top:${y}%" data-pos="${p}">
      <div class="pcards ${isHero ? 'hero' : ''}">${cards}</div>
      <div class="plate">
        <div class="pav" style="--av:${AV_COLORS[p]}">${s.num != null ? `<b class="pnum">${s.num}</b>` : ''}${p}</div>
        <div class="pinfo"><div class="pname">${isHero ? 'You · ' + p : p}${s.badge ? ` <span class="pbadge b-${s.badgeCls}">${s.badge}</span>` : ''}</div><div class="pstack">${s.stackText != null ? s.stackText : s.state === 'empty' ? 'empty seat' : fmtAmt(s.stack != null ? s.stack : 100) + ' bb'}</div></div>
      </div>
      <div class="pbelow">${s.tag ? `<div class="ptag ${s.tagCls || ''}">${s.tag}</div>` : ''}${s.under ? `<div class="punder">${s.under}</div>` : ''}</div>
    </div>`;
    if (s.bet > 0 && s.state !== 'empty') {
      const [bx, by] = lerp([x, y], CEN, phone ? (isHero ? 0.3 : 0.38) : isHero ? 0.33 : 0.42);
      bets += `<div class="pbet" style="left:${bx}%;top:${by}%">${chipStackHTML(s.bet)}<span>${fmtAmt(s.bet)}</span></div>`;
    }
  }
  let dealer = '';
  if (o.dealer && slot[o.dealer]) {
    const [sx, sy] = slot[o.dealer], dx = sx > 55 ? sx - (phone ? 15 : 11) : sx + (phone ? 15 : 11); // beside the name plate, toward the table
    dealer = `<div class="pdealer" style="left:${dx}%;top:${sy}%">D</div>`;
  }
  return `<div class="ptable">
      <div class="pinfo-top">${o.info || '6-max · PLO6 Hi/Lo · Blinds 0.5/1 · 100bb'}</div>
      <div class="rail"><div class="felt"><div class="felt-logo">PLO6 · HI/LO LAB</div></div></div>
      <div class="pcenter">
        ${o.pot ? `<div class="ppot">${o.pot}</div>` : ''}
        <div class="pboard">${(o.board || []).length ? handHTML(o.board, 'xl') : ''}</div>
        <div class="poverlay">${o.overlay || ''}</div>
      </div>
      ${bets}${dealer}${seats}${phone ? '' : o.extra || ''}
    </div>
    <div class="pactionbar"><div class="pprompt">${o.prompt || ''}</div><div class="pbuttons">${o.actions || ''}</div></div>${phone && o.extra ? `<div class="pextra">${o.extra}</div>` : ''}`;
}

/*HAND*/

// =====================================================================
// TRAINER — EQUITY GUESS (table)
// =====================================================================
let eqq = null;
function renderEqTable() {
  const q = eqq, heroPos = q.seats[q.hero], seats = {};
  q.seats.forEach((p, i) => {
    const r = q.res && q.answered ? q.res.players[i] : null;
    seats[p] = { state: i === q.hero ? 'hero' : 'active', cards: q.hands[i], faceUp: true, stack: 0, tag: 'All-in', tagCls: 'raise',
      under: r ? `<div class="eqbadge ${i === q.hero ? 'hero' : ''}"><b>${P(r.eq)}</b><span>Hi ${P(r.hi, 0)} · Lo ${P(r.lo, 0)} · Scoop ${P(r.scoop, 0)}</span></div>` : '' };
  });
  POS.forEach(p => { if (!seats[p]) seats[p] = { state: 'folded', tag: 'Fold', tagCls: 'fold' }; });
  const n = q.seats.length;
  let overlay = '';
  if (q.answered && q.res) {
    const act = q.res.players[q.hero].eq * 100, err = Math.abs(q.guess - act);
    overlay = `<div class="verdict-pill ${err <= 3 ? 'ok' : err <= 7 ? 'mix' : 'no'}">${P(act / 100)} · off by ${err.toFixed(1)}</div>`;
  }
  $('#eqTable').innerHTML = tableHTML({
    hero: heroPos, seats, board: q.board, dealer: 'BTN', pot: `${n}-way all-in · ${q.street === 'pre' ? 'preflop' : q.street}`, overlay,
    prompt: `<div class="spot-title" id="eqTitle">Guess your equity (${heroPos})</div><div class="muted">Hi/lo split pot · share of the pot you win on average</div>`,
    actions: `<div class="pact-row eqbar"><input type="range" id="eqSlider" min="0" max="100" step="0.5" value="${q.guess != null ? q.guess : 50}" ${q.answered ? 'disabled' : ''}>
      <span class="guessval" id="eqVal">${q.guess != null ? q.guess : 50}%</span>
      ${q.answered ? '' : '<button class="pact a-raise" id="eqSubmit">Submit<kbd>Enter</kbd></button>'}
      <button class="pact a-next" id="eqNext">Next<kbd>Space</kbd></button></div>`,
  });
  $('#eqSlider').oninput = e => { $('#eqVal').textContent = e.target.value + '%'; };
  if ($('#eqSubmit')) $('#eqSubmit').onclick = submitEq;
  $('#eqNext').onclick = nextEq;
}
function nextEq() {
  const pv = $('#eqPlayers').value, sv = $('#eqStreet').value;
  const n = pv === 'mix' ? pick([2, 2, 3, 3, 4, 6]) : +pv;
  const street = sv === 'mix' ? pick(['pre', 'flop', 'flop', 'turn']) : sv;
  const seats = POS.slice().sort(() => Math.random() - 0.5).slice(0, n).sort((a, b) => POS.indexOf(a) - POS.indexOf(b));
  const nb = street === 'pre' ? 0 : street === 'flop' ? 3 : 4;
  const cards = deal(n * 6 + nb);
  const hands = seats.map((_, i) => sortHand(cards.slice(i * 6, i * 6 + 6)));
  const board = cards.slice(n * 6);
  eqq = { seats, hands, board, hero: rnd(n), street, answered: false, res: null, guess: null };
  eqq.promise = trainRunner.run({ cmd: 'equity', players: hands.map(h => ({ cards: h })), board, trials: 20000 }).then(r => (eqq.res = r));
  renderEqTable();
  $('#eqFb').className = 'feedback';
}
function submitEq() {
  if (!eqq || eqq.answered) return;
  const me = eqq; me.guess = +$('#eqSlider').value; me.answered = true;
  if ($('#eqSubmit')) $('#eqSubmit').disabled = true;
  me.promise.then(r => {
    if (me !== eqq) return;
    const act = r.players[me.hero].eq * 100, err = Math.abs(me.guess - act), pts = Math.max(0, Math.round(100 - err * 8));
    sess.eq.n++; sess.eq.err += err; sess.eq.pts += pts;
    ST.eq.n++; ST.eq.err += err; ST.eq.pts += pts; if (err <= 5) ST.eq.within5++;
    saveStats();
    renderEqTable();
    const cls = err <= 3 ? 'ok' : err <= 7 ? 'mix' : 'no';
    $('#eqFb').innerHTML = `<div class="verdict ${cls}">Actual ${P(act / 100)} · you said ${me.guess}% · off by ${err.toFixed(1)} → ${pts} pts</div>
      <div class="ink2">Fair share would be ${P(1 / me.seats.length)}. Board makes a low ${P(r.boardLow)} of the time${r.exact ? ' (exact)' : ''}.</div>`;
    $('#eqFb').classList.add('show');
    drawEqSession();
  }).catch(() => {});
}
function drawEqSession() {
  const s = sess.eq;
  $('#eqSession').innerHTML = `<div><b>${s.n}</b><span class="muted">guesses</span></div><div><b>${s.n ? (s.err / s.n).toFixed(1) : '–'}</b><span class="muted">avg error (pts)</span></div><div><b>${s.n ? Math.round(s.pts / s.n) : '–'}</b><span class="muted">avg score</span></div>`;
}
$('#eqPlayers').onchange = $('#eqStreet').onchange = nextEq;

// =====================================================================
// TRAINER — SHOWDOWN READER (table)
// =====================================================================
let sd = null;
const setEq = (a, b) => a.size === b.size && [...a].every(x => b.has(x));
function renderSdTable() {
  const q = sd, seats = {};
  q.seats.forEach((p, i) => {
    let under, cls = '', cardCls = '';
    if (!q.answered) {
      under = `<div class="sdtoggles"><button class="toggle hi ${q.selHi.has(i) ? 'on' : ''}" data-i="${i}" data-k="hi">HI</button><button class="toggle lo ${q.selLo.has(i) ? 'on' : ''}" data-i="${i}" data-k="lo">LO</button></div>`;
    } else {
      const hi = q.his[i], lo = q.los[i], wh = q.hiW.has(i), wl = q.loW.has(i);
      cls = (wh ? ' win-hi' : '') + (wl ? ' win-lo' : '');
      under = `<div class="sdres">${wh ? '<span class="badge hi">HI</span> ' : ''}${E.describeHi(hi.value)}<br>${wl ? '<span class="badge lo">LO</span> ' : ''}${E.describeLow(lo.mask)}
        ${(q.selHi.has(i) !== wh) || (q.selLo.has(i) !== wl) ? '<span class="badge no">✗</span>' : ''}</div>`;
    }
    seats[p] = { state: p === q.view ? 'hero' : 'active', cards: q.hands[i], faceUp: true, stackText: 'showdown', num: i + 1, under, cls };
  });
  POS.forEach(p => { if (!seats[p]) seats[p] = { state: 'folded', tag: 'Fold', tagCls: 'fold' }; });
  let overlay = '';
  if (q.answered) overlay = `<div class="verdict-pill ${q.ok ? 'ok' : 'no'}">${q.ok ? '✓ Correct' : '✗ Not quite'}</div><div class="overlay-sub">${q.split}</div>`;
  $('#sdTable').innerHTML = tableHTML({
    hero: q.view, seats, board: q.board, dealer: 'BTN', pot: `Showdown · ${q.seats.length} hands`, overlay,
    info: '6-max · PLO6 Hi/Lo · Showdown — every hand is face up',
    prompt: `<div class="spot-title">Who wins the high and the low?</div><div class="muted">Exactly 2 hole cards + 3 board cards, separately for each half. Keys: <kbd>1</kbd>–<kbd>${q.seats.length}</kbd> high · <kbd>Shift</kbd>+# low · <kbd>N</kbd> no low</div>`,
    actions: `<div class="pact-row">${q.answered ? '' : `<button class="pact a-fold ${q.noLow ? 'on' : ''}" id="sdNoLow">No low<kbd>N</kbd></button><button class="pact a-raise" id="sdSubmit">Submit<kbd>Enter</kbd></button>`}
      <button class="pact a-next" id="sdNext">Next<kbd>Space</kbd></button></div>`,
  });
  // highlight the two hole cards used for the high hand
  if (q.answered) q.seats.forEach((p, i) => {
    const hc = q.his[i].cards || [];
    $$(`.pseat[data-pos="${p}"] .pcards .card`, $('#sdTable')).forEach(c => { if (hc.includes(+c.dataset.c)) c.classList.add('used'); });
  });
  $$('#sdTable .toggle').forEach(b => b.onclick = () => toggleSd(+b.dataset.i, b.dataset.k));
  if ($('#sdNoLow')) $('#sdNoLow').onclick = () => toggleNoLow();
  if ($('#sdSubmit')) $('#sdSubmit').onclick = submitSd;
  $('#sdNext').onclick = nextSd;
}
function nextSd() {
  const n = +$('#sdCount').value;
  const seats = POS.slice().sort(() => Math.random() - 0.5).slice(0, n).sort((a, b) => POS.indexOf(a) - POS.indexOf(b));
  const cards = deal(n * 6 + 5);
  const hands = seats.map((_, i) => sortHand(cards.slice(i * 6, i * 6 + 6)));
  const board = cards.slice(n * 6);
  const his = hands.map(h => E.bestHiDetail(h, board)), los = hands.map(h => E.bestLowDetail(h, board));
  const bestHi = Math.max(...his.map(x => x.value)), bestLo = Math.min(...los.map(x => x.mask));
  sd = { seats, hands, board, his, los, view: seats[0], noLow: false,
    hiW: new Set(his.map((x, i) => x.value === bestHi ? i : -1).filter(i => i >= 0)),
    loW: new Set(bestLo === E.NO_LOW ? [] : los.map((x, i) => x.mask === bestLo ? i : -1).filter(i => i >= 0)),
    selHi: new Set(), selLo: new Set(), answered: false, t0: Date.now() };
  renderSdTable();
  $('#sdFb').className = 'feedback';
}
function toggleSd(i, k) {
  if (!sd || sd.answered || i >= sd.seats.length) return;
  const set = k === 'hi' ? sd.selHi : sd.selLo;
  set.has(i) ? set.delete(i) : set.add(i);
  if (k === 'lo' && set.size) sd.noLow = false;
  renderSdTable();
}
function toggleNoLow() { if (!sd || sd.answered) return; sd.noLow = !sd.noLow; if (sd.noLow) sd.selLo.clear(); renderSdTable(); }
function submitSd() {
  if (!sd || sd.answered) return;
  const q = sd; q.answered = true;
  const hiOk = setEq(q.selHi, q.hiW);
  const loOk = q.loW.size === 0 ? q.selLo.size === 0 : setEq(q.selLo, q.loW);
  q.ok = hiOk && loOk;
  sess.sd.n++; if (q.ok) { sess.sd.ok++; sess.sd.streak++; } else sess.sd.streak = 0;
  ST.sd.n++; if (q.ok) ST.sd.ok++; if (hiOk) ST.sd.hiOk++; if (loOk) ST.sd.loOk++;
  saveStats();
  const name = s => [...s].map(i => q.seats[i]).join(' & ');
  if (!q.loW.size) q.split = `${name(q.hiW)} ${q.hiW.size > 1 ? 'split' : 'scoops'} — no qualifying low`;
  else if (q.hiW.size === 1 && setEq(q.hiW, q.loW)) q.split = `${name(q.hiW)} scoops!`;
  else if (setEq(q.hiW, q.loW)) q.split = `${name(q.hiW)} split both high and low`;
  else q.split = `High: ${name(q.hiW)} · Low: ${name(q.loW)}${[...new Set([...q.hiW, ...q.loW])].some(i => Math.abs((q.hiW.has(i) ? 0.5 / q.hiW.size : 0) + (q.loW.has(i) ? 0.5 / q.loW.size : 0) - 0.25) < 1e-9) ? ' (quartered)' : ''}`;
  renderSdTable();
  $('#sdFb').innerHTML = `<div class="verdict ${q.ok ? 'ok' : 'no'}">${q.ok ? '✓ Correct' : '✗ Not quite'} <span class="muted" style="font-size:12px;font-weight:500">${((Date.now() - q.t0) / 1000).toFixed(1)}s</span></div>
    <div class="ink2">${q.split.replace(/[!.]$/, '')}. High ${hiOk ? '<span class="badge ok">✓</span>' : '<span class="badge no">✗</span>'} · Low ${loOk ? '<span class="badge ok">✓</span>' : '<span class="badge no">✗</span>'}.
    Gold-outlined hole cards are the two used for high; a ✗ under a seat marks a pick you got wrong.</div>`;
  $('#sdFb').classList.add('show');
  drawSdSession();
}
function drawSdSession() {
  const s = sess.sd;
  $('#sdSession').innerHTML = `<div><b>${s.n ? Math.round(100 * s.ok / s.n) : 0}%</b><span class="muted">accuracy</span></div><div><b>${s.ok}/${s.n}</b><span class="muted">correct</span></div><div><b>${s.streak}</b><span class="muted">streak</span></div>`;
}
$('#sdCount').onchange = nextSd;
