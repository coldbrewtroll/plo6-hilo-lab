// PLO6 Hi/Lo engine: hand evaluation, equity jobs, strategy-model calibration.
// Written as one function so the same source runs on the main thread and in a Web Worker.
function ENGINE() {
  'use strict';
  const RANKS = '23456789TJQKA', SUITS = 'shdc';
  const P4 = 28561, P3 = 2197, P2 = 169;
  const NO_LOW = 256;

  // ---------- high-hand tables ----------
  const tbl = new Int32Array(371293); // non-flush, indexed by 5 ranks base 13
  const ftbl = new Int32Array(8192);  // flush, indexed by 13-bit rank mask
  function enc(cat, rs) { let v = cat; for (let i = 0; i < 5; i++) v = v * 16 + (rs[i] || 0); return v; }
  function evalRanks(r) {
    const cnt = new Array(13).fill(0);
    for (const x of r) cnt[x]++;
    const g = [];
    for (let x = 12; x >= 0; x--) if (cnt[x]) g.push([cnt[x], x]);
    g.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
    const k = g.map(e => e[1]);
    if (g.length === 5) {
      if (k[0] - k[4] === 4) return enc(4, [k[0]]);
      if (k[0] === 12 && k[1] === 3) return enc(4, [3]);
      return enc(0, k);
    }
    if (g[0][0] === 5) return 0;
    if (g[0][0] === 4) return enc(7, k);
    if (g[0][0] === 3) return g[1][0] === 2 ? enc(6, k) : enc(3, k);
    return g[1][0] === 2 ? enc(2, k) : enc(1, k);
  }
  (function build() {
    const perms = [];
    (function gen(a, used) {
      if (a.length === 5) { perms.push(a.slice()); return; }
      for (let i = 0; i < 5; i++) if (!used[i]) { used[i] = 1; a.push(i); gen(a, used); a.pop(); used[i] = 0; }
    })([], []);
    const r = [0, 0, 0, 0, 0];
    for (r[0] = 12; r[0] >= 0; r[0]--) for (r[1] = r[0]; r[1] >= 0; r[1]--) for (r[2] = r[1]; r[2] >= 0; r[2]--)
      for (r[3] = r[2]; r[3] >= 0; r[3]--) for (r[4] = r[3]; r[4] >= 0; r[4]--) {
        const v = evalRanks(r);
        for (const p of perms) tbl[r[p[0]] * P4 + r[p[1]] * P3 + r[p[2]] * P2 + r[p[3]] * 13 + r[p[4]]] = v;
        if (r[0] > r[1] && r[1] > r[2] && r[2] > r[3] && r[3] > r[4]) {
          const m = (1 << r[0]) | (1 << r[1]) | (1 << r[2]) | (1 << r[3]) | (1 << r[4]);
          const cat = Math.floor(v / 1048576);
          ftbl[m] = cat === 4 ? v + 4 * 1048576 : enc(5, r);
        }
      }
  })();

  // ---------- low (8 or better) ----------
  // bit0 = A, bit1 = 2 ... bit7 = 8. Lower mask value = better low.
  const LOWBIT = new Int32Array(52);
  for (let c = 0; c < 52; c++) { const r = c >> 2; LOWBIT[c] = r === 12 ? 1 : r <= 6 ? 1 << (r + 1) : 0; }
  const lowCache = new Int16Array(65536).fill(-1);
  function low3(m) {
    let t = m; const b1 = t & -t; t ^= b1; if (!t) return 0;
    const b2 = t & -t; t ^= b2; if (!t) return 0;
    const b3 = t & -t; return b1 | b2 | b3;
  }
  function bestLow(H, B) {
    const key = (H << 8) | B;
    let v = lowCache[key];
    if (v >= 0) return v;
    v = NO_LOW;
    for (let i = 0; i < 8; i++) if (H & (1 << i)) for (let j = i + 1; j < 8; j++) if (H & (1 << j)) {
      const p = (1 << i) | (1 << j);
      const t = low3(B & ~p);
      if (t && (p | t) < v) v = p | t;
    }
    lowCache[key] = v;
    return v;
  }

  const PAIRS = [], TRIS = [];
  for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) PAIRS.push([i, j]);
  for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) for (let k = j + 1; k < 5; k++) TRIS.push([i, j, k]);

  // Fast per-hand precompute (15 two-card combos)
  function prepHand(h, pIdx, pSuit, pMask, off) {
    let lm = 0;
    for (let i = 0; i < 6; i++) lm |= LOWBIT[h[i]];
    for (let q = 0; q < 15; q++) {
      const a = h[PAIRS[q][0]], b = h[PAIRS[q][1]];
      const ra = a >> 2, rb = b >> 2;
      pIdx[off + q] = ra * P4 + rb * P3;
      pSuit[off + q] = (a & 3) === (b & 3) ? (a & 3) : -1;
      pMask[off + q] = (1 << ra) | (1 << rb);
    }
    return lm;
  }
  function prepBoard(b, tIdx, tSuit, tMask) {
    let lm = 0;
    for (let i = 0; i < 5; i++) lm |= LOWBIT[b[i]];
    for (let q = 0; q < 10; q++) {
      const x = b[TRIS[q][0]], y = b[TRIS[q][1]], z = b[TRIS[q][2]];
      tIdx[q] = (x >> 2) * P2 + (y >> 2) * 13 + (z >> 2);
      tSuit[q] = ((x & 3) === (y & 3) && (y & 3) === (z & 3)) ? (x & 3) : -2;
      tMask[q] = (1 << (x >> 2)) | (1 << (y >> 2)) | (1 << (z >> 2));
    }
    return lm;
  }
  function bestHiFast(pIdx, pSuit, pMask, off, tIdx, tSuit, tMask) {
    let best = 0;
    for (let i = off, e = off + 15; i < e; i++) {
      const pi = pIdx[i], ps = pSuit[i], pm = pMask[i];
      for (let j = 0; j < 10; j++) {
        const v = ps === tSuit[j] ? ftbl[pm | tMask[j]] : tbl[pi + tIdx[j]];
        if (v > best) best = v;
      }
    }
    return best;
  }

  // ---------- slow, descriptive evaluation (for UI) ----------
  function eval5(c) {
    const s = c[0] & 3;
    if ((c[1] & 3) === s && (c[2] & 3) === s && (c[3] & 3) === s && (c[4] & 3) === s) {
      let m = 0; for (const x of c) m |= 1 << (x >> 2); return ftbl[m];
    }
    return tbl[(c[0] >> 2) * P4 + (c[1] >> 2) * P3 + (c[2] >> 2) * P2 + (c[3] >> 2) * 13 + (c[4] >> 2)];
  }
  function bestHiDetail(hole, board) {
    let best = -1, cards = null;
    for (let i = 0; i < hole.length; i++) for (let j = i + 1; j < hole.length; j++)
      for (const t of TRIS) {
        if (board.length < 5) break;
        const five = [hole[i], hole[j], board[t[0]], board[t[1]], board[t[2]]];
        const v = eval5(five);
        if (v > best) { best = v; cards = five; }
      }
    return { value: best, cards };
  }
  function bestLowDetail(hole, board) {
    let H = 0, B = 0;
    for (const c of hole) H |= LOWBIT[c];
    for (const c of board) B |= LOWBIT[c];
    const m = bestLow(H, B);
    if (m === NO_LOW) return { mask: m, cards: null };
    const cards = [];
    // pick hole ranks: the two bits of m that come from hand; we need a split consistent with H/B
    for (let i = 0; i < 8; i++) if (m & H & (1 << i)) for (let j = i + 1; j < 8; j++) if (m & H & (1 << j)) {
      const rest = m & ~((1 << i) | (1 << j));
      if ((rest & B) === rest) {
        const pick = (src, bit) => src.find(c => LOWBIT[c] === bit);
        cards.push(pick(hole, 1 << i), pick(hole, 1 << j));
        for (let k = 0; k < 8; k++) if (rest & (1 << k)) cards.push(pick(board, 1 << k));
        return { mask: m, cards };
      }
    }
    return { mask: m, cards: null };
  }
  const RN = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
  const RNAME = ['Twos', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights', 'Nines', 'Tens', 'Jacks', 'Queens', 'Kings', 'Aces'];
  const RSING = ['Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace'];
  const CATS = ['High card', 'Pair', 'Two pair', 'Trips', 'Straight', 'Flush', 'Full house', 'Quads', 'Straight flush'];
  function describeHi(v) {
    const cat = Math.floor(v / 1048576);
    const d = []; for (let i = 4; i >= 0; i--) d.push((v >> (i * 4)) & 15);
    switch (cat) {
      case 0: return 'High card ' + RSING[d[0]];
      case 1: return 'Pair of ' + RNAME[d[0]];
      case 2: return 'Two pair, ' + RNAME[d[0]] + ' & ' + RNAME[d[1]];
      case 3: return 'Trip ' + RNAME[d[0]];
      case 4: return 'Straight, ' + RSING[d[0]] + ' high';
      case 5: return 'Flush, ' + RSING[d[0]] + ' high';
      case 6: return 'Full house, ' + RNAME[d[0]] + ' full of ' + RNAME[d[1]];
      case 7: return 'Quad ' + RNAME[d[0]];
      case 8: return d[0] === 12 ? 'Royal flush' : 'Straight flush, ' + RSING[d[0]] + ' high';
    }
    return '?';
  }
  function describeLow(m) {
    if (m === NO_LOW) return 'No low';
    const out = [];
    for (let i = 7; i >= 0; i--) if (m & (1 << i)) out.push(i === 0 ? 'A' : String(i + 1));
    return out.join('-');
  }

  // ---------- parsing ----------
  function parseCards(str) {
    const s = String(str || '').replace(/10/g, 'T');
    const re = /([2-9TJQKA])\s*([shdc])/gi;
    const out = []; let m;
    while ((m = re.exec(s))) out.push(RANKS.indexOf(m[1].toUpperCase()) * 4 + SUITS.indexOf(m[2].toLowerCase()));
    const leftover = s.replace(re, '').replace(/[\s,]/g, '');
    return { cards: out, error: leftover.length ? 'Unrecognised: "' + leftover + '"' : null };
  }
  function cardStr(c) { return RANKS[c >> 2] + SUITS[c & 3]; }

  // ---------- strategy model features ----------
  const FEAT_NAMES = ['bias', 'A2', 'A3 (no 2)', 'A4/A5 only', '23 no ace', 'distinct lows', '4+ lows', '5+ lows',
    'wheel ranks', 'broadways', 'AA', 'KK', 'pairs', 'trips+', 'suited ace', 'ace suit 4+', 'suited K (no A)',
    'suits w/ 2+', 'any suit 4+', 'adjacent ranks', 'one-gaps', '9-T-J cards', 'A2 + suited ace', 'aces',
    'A23', 'A2 x broadways', 'A2 x lows', 'AA + A2/A3', 'nut-low draw x suits', 'no ace, no 23'];
  function feats(h) {
    const rc = new Int8Array(13), sc = new Int8Array(4);
    for (const c of h) { rc[c >> 2]++; sc[c & 3]++; }
    const A = rc[12], has = r => rc[r] > 0;
    const a2 = A && has(0) ? 1 : 0;
    const a3 = A && !has(0) && has(1) ? 1 : 0;
    const a45 = A && !has(0) && !has(1) && (has(2) || has(3)) ? 1 : 0;
    const n23 = !A && has(0) && has(1) ? 1 : 0;
    let low = A ? 1 : 0; for (let r = 0; r <= 6; r++) if (rc[r]) low++;
    let wheel = A ? 1 : 0; for (let r = 0; r <= 3; r++) if (rc[r]) wheel++;
    let bw = 0; for (let r = 8; r <= 12; r++) if (rc[r]) bw++;
    let pairs = 0, trips = 0; for (let r = 0; r < 13; r++) { if (rc[r] === 2) pairs++; if (rc[r] >= 3) trips++; }
    let aceS = 0, ace4 = 0, kS = 0;
    for (const c of h) if ((c >> 2) === 12) { if (sc[c & 3] >= 2) aceS = 1; if (sc[c & 3] >= 4) ace4 = 1; }
    for (const c of h) if ((c >> 2) === 11 && sc[c & 3] >= 2 && !h.some(x => (x >> 2) === 12 && (x & 3) === (c & 3))) kS = 1;
    let ns2 = 0, s4 = 0; for (let s = 0; s < 4; s++) { if (sc[s] >= 2) ns2++; if (sc[s] >= 4) s4 = 1; }
    let m = 0; for (let r = 0; r < 13; r++) if (rc[r]) m |= 1 << (r + 1); if (A) m |= 1;
    let adj = 0, gap = 0; for (let t = m & (m >> 1); t; t &= t - 1) adj++; for (let t = m & (m >> 2); t; t &= t - 1) gap++;
    const mid = rc[7] + rc[8] + rc[9];
    return [1, a2, a3, a45, n23, low, low >= 4 ? 1 : 0, low >= 5 ? 1 : 0, wheel, bw, A >= 2 ? 1 : 0, rc[11] >= 2 ? 1 : 0,
      pairs, trips, aceS, ace4, kS, ns2, s4, adj, gap, mid, a2 * aceS, A,
      a2 && has(1) ? 1 : 0, a2 * bw, a2 * low, A >= 2 && (a2 || a3) ? 1 : 0, (a2 || a3) * ns2, !A && !n23 ? 1 : 0];
  }
  function score(h, w) { const f = feats(h); let s = 0; for (let i = 0; i < f.length; i++) s += f[i] * w[i]; return s; }

  // ---------- real-equity pool: hands sorted best-first by simulated equity (see tools/realpool.js) ----------
  let REAL = null;
  function setRealPool(bytes) { REAL = { hands: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), size: Math.floor(bytes.length / 6) }; }
  const hasReal = () => !!REAL;
  function realIdx(a, b) { const n = REAL.size, lo = Math.max(0, Math.min(n - 1, Math.floor(a / 100 * n))); return [lo, Math.max(lo + 1, Math.min(n, Math.ceil(b / 100 * n)))]; }
  function realHand(i) { return Array.from(REAL.hands.subarray(i * 6, i * 6 + 6)); }
  // sample a hand ranked between top a% and top b% that avoids the given cards; returns { cards, top }
  function sampleReal(a, b, exclude) {
    const [lo, hi] = realIdx(a, b), ex = new Uint8Array(52); (exclude || []).forEach(c => ex[c] = 1);
    for (let t = 0; t < 2000; t++) {
      const i = lo + Math.floor(Math.random() * (hi - lo)), base = i * 6; let ok = true;
      for (let q = 0; q < 6; q++) if (ex[REAL.hands[base + q]]) { ok = false; break; }
      if (ok) return { cards: realHand(i), top: 100 * (i + 0.5) / REAL.size };
    }
    return null;
  }

  // ---------- pre-sorted hand pool for fast range sampling ----------
  // A big set of random 6-card hands sorted by model score: a score band becomes an index range.
  let POOLC = null;
  function getPool(w, size) {
    const key = w.join(',') + '|' + size;
    if (POOLC && POOLC.key === key) return POOLC;
    const raw = new Uint8Array(size * 6), sc = new Float64Array(size), mark = new Int32Array(52), h = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < size; i++) {
      for (let k = 0; k < 6; k++) { let c; do { c = Math.floor(Math.random() * 52); } while (mark[c] === i + 1); mark[c] = i + 1; h[k] = c; raw[i * 6 + k] = c; }
      sc[i] = score(h, w);
    }
    const idx = new Uint32Array(size); for (let i = 0; i < size; i++) idx[i] = i;
    idx.sort((a, b) => sc[a] - sc[b]);
    const hands = new Uint8Array(size * 6), scores = new Float64Array(size);
    for (let i = 0; i < size; i++) { scores[i] = sc[idx[i]]; for (let k = 0; k < 6; k++) hands[i * 6 + k] = raw[idx[i] * 6 + k]; }
    POOLC = { key, hands, scores, size };
    return POOLC;
  }
  function poolRange(P, min, max) {
    const lb = v => { let lo = 0, hi = P.size; while (lo < hi) { const m = (lo + hi) >> 1; if (P.scores[m] < v) lo = m + 1; else hi = m; } return lo; };
    const lo = min == null ? 0 : lb(min), hi = max == null ? P.size : lb(max + 1e-12);
    return [lo, hi];
  }

  // ---------- equity job ----------
  // players: [{cards:[...], range:{w:[...], min?:score, max?:score} | undefined}]
  function createEquityJob(o) {
    const n = o.players.length;
    const board0 = (o.board || []).slice();
    const used = new Uint8Array(52);
    const mark = c => { if (used[c]) throw new Error('Duplicate card ' + cardStr(c)); used[c] = 1; };
    for (const p of o.players) for (const c of p.cards) mark(c);
    for (const c of board0) mark(c);
    for (const c of (o.dead || [])) mark(c);
    if (board0.length > 5) throw new Error('Board has more than 5 cards');
    const deck = []; for (let c = 0; c < 52; c++) if (!used[c]) deck.push(c);
    const needBoard = 5 - board0.length;
    let needPlayers = 0; for (const p of o.players) { if (p.cards.length > 6) throw new Error('A hand has more than 6 cards'); needPlayers += 6 - p.cards.length; }
    if (needBoard + needPlayers > deck.length) throw new Error('Not enough cards in the deck');

    const pIdx = new Int32Array(n * 15), pSuit = new Int8Array(n * 15), pMask = new Int32Array(n * 15);
    const handLow = new Int32Array(n);
    const fixed = o.players.map(p => p.cards.length === 6 && !p.range);
    o.players.forEach((p, i) => { if (fixed[i]) handLow[i] = prepHand(p.cards, pIdx, pSuit, pMask, i * 15); });
    const tIdx = new Int32Array(10), tSuit = new Int8Array(10), tMask = new Int32Array(10);
    const hands = o.players.map(p => p.cards.slice().concat(new Array(6 - p.cards.length).fill(0)));
    const board = board0.concat(new Array(needBoard).fill(0));

    const eq = new Float64Array(n), eq2 = new Float64Array(n), hi = new Float64Array(n), lo = new Float64Array(n), scoop = new Float64Array(n), lowMade = new Float64Array(n);
    const shC = new Float64Array(5), shS = new Float64Array(5); // player 0: lose / a third or less (quartered) / half / more than half (e.g. ¾) / scoop
    const heroCats = new Float64Array(9); let heroNut = 0, boardLow = 0;
    const hiV = new Int32Array(n), loV = new Int32Array(n);
    let done = 0;

    let exact = false, combos = null, total = o.trials || 20000;
    function nCr(a, b) { let r = 1; for (let i = 0; i < b; i++) r = r * (a - i) / (i + 1); return r; }
    const mode = o.mode || 'auto';
    const limit = mode === 'mc' ? -1 : mode === 'exact' ? 3000000 : (o.exactLimit != null ? o.exactLimit : 700000);
    const exactPossible = needPlayers === 0 && !o.players.some(p => p.range);
    if (exactPossible && nCr(deck.length, needBoard) <= limit) {
      exact = true; total = Math.round(nCr(deck.length, needBoard));
      combos = []; for (let i = 0; i < needBoard; i++) combos.push(i);
    }

    function scoreOne() {
      const bl = prepBoard(board, tIdx, tSuit, tMask);
      let bestH = -1, nH = 0, bestL = NO_LOW, nL = 0;
      for (let p = 0; p < n; p++) {
        const v = bestHiFast(pIdx, pSuit, pMask, p * 15, tIdx, tSuit, tMask);
        hiV[p] = v; if (v > bestH) { bestH = v; nH = 1; } else if (v === bestH) nH++;
        const l = bestLow(handLow[p], bl);
        loV[p] = l; if (l < bestL) { bestL = l; nL = 1; } else if (l === bestL && l !== NO_LOW) nL++;
      }
      const hasLow = bestL !== NO_LOW;
      if (hasLow) boardLow++;
      const hs = hasLow ? 0.5 / nH : 1 / nH, ls = hasLow ? 0.5 / nL : 0;
      for (let p = 0; p < n; p++) {
        let s = 0;
        if (hiV[p] === bestH) { s += hs; hi[p] += 1 / nH; }
        if (hasLow && loV[p] === bestL) { s += ls; lo[p] += 1 / nL; }
        if (loV[p] !== NO_LOW) lowMade[p]++;
        eq[p] += s; eq2[p] += s * s; if (s > 0.9999) scoop[p]++;
        if (p === 0 && o.shareHist) { const b = s < 1e-9 ? 0 : s < 0.4 ? 1 : s < 0.6 ? 2 : s < 0.9999 ? 3 : 4; shC[b]++; shS[b] += s; }
      }
      if (o.heroStats) {
        heroCats[Math.floor(hiV[0] / 1048576)]++;
        if (loV[0] !== NO_LOW && loV[0] === bestLow(255, bl)) heroNut++;
      }
      done++;
    }

    // fast path: players whose range has a pool (no known cards) are sampled straight from the sorted pool
    const isReal = p => p.range && p.range.real && REAL && p.cards.length === 0;
    const poolOf = o.players.map(p => isReal(p) ? REAL : (p.range && p.range.pool && p.cards.length === 0) ? getPool(p.range.w, p.range.pool) : null);
    const realBand = p => { const [a, b] = p.range.real; if (!(isFinite(a) && isFinite(b))) { if (typeof console !== 'undefined') console.warn('bad real range', a, b); return realIdx(0, 100); } return realIdx(a, b); };
    const poolIdx = o.players.map((p, i) => !poolOf[i] ? null : isReal(p) ? realBand(p) : poolRange(poolOf[i], p.range.min, p.range.max));
    const listOf = o.players.map(p => (p.range && p.range.list && p.range.list.length && p.cards.length === 0) ? p.range.list : null);
    const usePool = poolOf.some((P, i) => P && poolIdx[i][1] > poolIdx[i][0]) || listOf.some(Boolean);
    const stamp = new Int32Array(52); let trialNo = 0;
    const freeCard = c => !used[c] && stamp[c] !== trialNo;
    function randFree() { for (;;) { const c = deck[Math.floor(Math.random() * deck.length)]; if (stamp[c] !== trialNo) { stamp[c] = trialNo; return c; } } }
    const order = o.players.map((_, i) => i).sort((a, b) => ((poolOf[b] || listOf[b]) ? 1 : 0) - ((poolOf[a] || listOf[a]) ? 1 : 0));
    function dealPool() {
      trialNo++;
      for (const p of order) {
        if (fixed[p]) continue;
        const pl = o.players[p], have = pl.cards.length, need = 6 - have, h = hands[p];
        const P = poolOf[p], rg = poolIdx[p];
        let done6 = false;
        const LST = listOf[p];
        if (LST) { // a narrowed range: sample uniformly from the given hands
          for (let t = 0; t < 400 && !done6; t++) {
            const c6 = LST[Math.floor(Math.random() * LST.length)];
            let ok = true; for (let q = 0; q < 6; q++) if (!freeCard(c6[q])) { ok = false; break; }
            if (ok) { for (let q = 0; q < 6; q++) { h[q] = c6[q]; stamp[h[q]] = trialNo; } done6 = true; }
          }
        }
        if (!done6 && P && rg[1] > rg[0]) {
          for (let t = 0; t < 400 && !done6; t++) {
            const j = rg[0] + Math.floor(Math.random() * (rg[1] - rg[0])), b = j * 6;
            let ok = true; for (let q = 0; q < 6; q++) if (!freeCard(P.hands[b + q])) { ok = false; break; }
            if (ok) { for (let q = 0; q < 6; q++) { h[q] = P.hands[b + q]; stamp[h[q]] = trialNo; } done6 = true; }
          }
        }
        if (!done6) {
          if (pl.range && pl.range.w && need > 0) {
            for (let tries = 0; ; tries++) {
              for (let i = 0; i < need; i++) h[have + i] = randFree();
              const sc = score(h, pl.range.w);
              if (((pl.range.min == null || sc >= pl.range.min) && (pl.range.max == null || sc <= pl.range.max)) || tries > (pl.range.tries || 2500)) break;
              for (let i = 0; i < need; i++) stamp[h[have + i]] = 0;
            }
          } else for (let i = 0; i < need; i++) h[have + i] = randFree();
        }
        handLow[p] = prepHand(h, pIdx, pSuit, pMask, p * 15);
      }
      for (let i = 0; i < needBoard; i++) board[board0.length + i] = randFree();
    }
    function dealRandom() {
      if (usePool) return dealPool();
      let k = 0;
      const L = deck.length;
      const swapIn = pos => { const j = pos + Math.floor(Math.random() * (L - pos)); const t = deck[pos]; deck[pos] = deck[j]; deck[j] = t; };
      for (let p = 0; p < n; p++) {
        if (fixed[p]) continue;
        const pl = o.players[p], have = pl.cards.length, need = 6 - have;
        const h = hands[p];
        if (pl.range && need > 0) {
          let tries = 0;
          for (;;) {
            for (let i = 0; i < need; i++) { swapIn(k + i); h[have + i] = deck[k + i]; }
            const sc = score(h, pl.range.w);
            if ((pl.range.min == null || sc >= pl.range.min) && (pl.range.max == null || sc <= pl.range.max)) break;
            if (++tries > (pl.range.tries || 2500)) break;
          }
        } else {
          for (let i = 0; i < need; i++) { swapIn(k + i); h[have + i] = deck[k + i]; }
        }
        k += need;
        handLow[p] = prepHand(h, pIdx, pSuit, pMask, p * 15);
      }
      for (let i = 0; i < needBoard; i++) { swapIn(k + i); board[board0.length + i] = deck[k + i]; }
    }

    // Monte Carlo diagnostics: 95% CI half-width per player, convergence history
    const history = [];
    const histEvery = Math.max(200, Math.round(total / 150));
    let nextHist = Math.min(histEvery, 200);
    let stopped = false;
    function ciOf(p) {
      if (exact || done < 2) return 0;
      const m = eq[p] / done, v = Math.max(0, eq2[p] / done - m * m);
      return 1.96 * Math.sqrt(v / (done - 1));
    }
    function maxCI() { let m = 0; for (let p = 0; p < n; p++) m = Math.max(m, ciOf(p)); return m; }
    function snap() { const e = []; for (let p = 0; p < n; p++) e.push(eq[p] / done); history.push({ n: done, eq: e, ci: Array.from({ length: n }, (_, p) => ciOf(p)) }); }
    function step(maxTrials) {
      if (stopped) return true;
      const end = Math.min(total, done + maxTrials);
      if (exact) {
        while (done < end) {
          for (let i = 0; i < needBoard; i++) board[board0.length + i] = deck[combos[i]];
          scoreOne();
          // next combination
          let i = needBoard - 1;
          while (i >= 0 && combos[i] === deck.length - needBoard + i) i--;
          if (i < 0) break;
          combos[i]++;
          for (let j = i + 1; j < needBoard; j++) combos[j] = combos[j - 1] + 1;
        }
        if (needBoard === 0 && done === 0) scoreOne();
      } else {
        while (done < end) {
          dealRandom(); scoreOne();
          if (done >= nextHist) { snap(); nextHist += histEvery; }
        }
        if (o.targetCI && done >= 2000 && maxCI() <= o.targetCI) { stopped = true; }
      }
      if ((done >= total || stopped) && !exact && (!history.length || history[history.length - 1].n !== done)) snap();
      return done >= total || stopped;
    }
    function result() {
      const d = Math.max(done, 1);
      return {
        exact, done, total, mode, exactPossible, stoppedAtTarget: stopped, maxCI: maxCI(), history: exact ? null : history.slice(),
        players: Array.from({ length: n }, (_, p) => ({ eq: eq[p] / d, ci: ciOf(p), hi: hi[p] / d, lo: lo[p] / d, scoop: scoop[p] / d, lowMade: lowMade[p] / d })),
        boardLow: boardLow / d,
        heroCats: o.heroStats ? Array.from(heroCats, x => x / d) : null,
        shareHist: o.shareHist ? ['lose', 'quartered', 'half', 'threeQuarter', 'scoop'].map((k, b) => ({ k, p: shC[b] / d, share: shC[b] ? shS[b] / shC[b] : 0 })) : null,
        heroNutLow: o.heroStats ? heroNut / d : null,
      };
    }
    return { step, result, get total() { return total; } };
  }

  // ---------- model calibration: linear fit of features -> equity vs 2 random ----------
  function randomHand(exclude) {
    const used = new Uint8Array(52); for (const c of (exclude || [])) used[c] = 1;
    const h = [];
    while (h.length < 6) { const c = Math.floor(Math.random() * 52); if (!used[c]) { used[c] = 1; h.push(c); } }
    return h;
  }
  function createCalibrateJob(o) {
    const N = o.hands || 2200, T = o.trials || 260, opp = o.opp || 2;
    const X = [], Y = []; let i = 0;
    function step(k) {
      const end = Math.min(N, i + k);
      for (; i < end; i++) {
        const h = randomHand();
        const players = [{ cards: h }]; for (let j = 0; j < opp; j++) players.push({ cards: [] });
        const job = createEquityJob({ players, trials: T });
        job.step(T);
        X.push(feats(h)); Y.push(job.result().players[0].eq);
      }
      return i >= N;
    }
    function result() {
      const F = X[0].length;
      const A = Array.from({ length: F }, () => new Float64Array(F + 1));
      for (let r = 0; r < X.length; r++) {
        const x = X[r];
        for (let a = 0; a < F; a++) { for (let b = 0; b < F; b++) A[a][b] += x[a] * x[b]; A[a][F] += x[a] * Y[r]; }
      }
      for (let a = 0; a < F; a++) A[a][a] += 1e-3; // ridge
      for (let c = 0; c < F; c++) { // gaussian elimination
        let piv = c; for (let r = c + 1; r < F; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
        [A[c], A[piv]] = [A[piv], A[c]];
        for (let r = 0; r < F; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k2 = c; k2 <= F; k2++) A[r][k2] -= f * A[c][k2]; }
      }
      const w = Array.from({ length: F }, (_, a) => A[a][F] / A[a][a]);
      let my = 0; for (const y of Y) my += y; my /= Y.length;
      let ssr = 0, sst = 0;
      for (let r = 0; r < X.length; r++) { let p = 0; for (let a = 0; a < F; a++) p += w[a] * X[r][a]; ssr += (Y[r] - p) ** 2; sst += (Y[r] - my) ** 2; }
      // percentile table from many random hands
      const S = []; for (let r = 0; r < 40000; r++) S.push(score(randomHand(), w));
      S.sort((a, b) => a - b);
      const q = []; for (let r = 0; r <= 1000; r++) q.push(S[Math.min(S.length - 1, Math.floor(r / 1000 * S.length))]);
      return { w, quantiles: q, r2: 1 - ssr / sst, hands: N, trials: T, opp };
    }
    return { step, result, get progress() { return i / N; } };
  }


  // ---------- pot settlement (shared by the trainer and tools/selfplay.js) ----------
  // contrib[i] chips put in, live[i] still in the hand, hi[i] high value (bigger wins), lo[i] low mask (smaller wins, NO_LOW = none),
  // rake = { pct, cap } for pots that saw a flop (or null). Returns the uncalled excess to the top contributor, builds a main pot and
  // side pots by contribution level, takes rake proportionally, and splits each pot half high / half low among the players eligible for it.
  function settle(contrib, live, hi, lo, rake) {
    const n = contrib.length, c = contrib.slice(), won = new Array(n).fill(0);
    let top = -1; for (let i = 0; i < n; i++) if (top < 0 || c[i] > c[top]) top = i;
    let second = 0; for (let i = 0; i < n; i++) if (i !== top) second = Math.max(second, c[i]);
    const returned = Math.max(0, c[top] - second); if (returned > 0) { won[top] += returned; c[top] = second; }
    const total = c.reduce((a, x) => a + x, 0), rk = rake && total > 0 ? Math.min(total * rake.pct, rake.cap) : 0, f = total > 0 ? (total - rk) / total : 1;
    const liveIdx = []; for (let i = 0; i < n; i++) if (live[i]) liveIdx.push(i);
    const levels = [...new Set(liveIdx.map(i => c[i]))].sort((a, b) => a - b), pots = [];
    let prev = 0;
    levels.forEach((L, k) => {
      let amt = 0; for (let i = 0; i < n; i++) amt += Math.max(0, (k === levels.length - 1 ? c[i] : Math.min(c[i], L)) - prev);
      prev = L; if (amt <= 1e-12) return; amt *= f;
      const el = liveIdx.filter(i => c[i] >= L - 1e-12);
      let hiW = el, loW = [];
      if (el.length > 1) {
        const bh = Math.max(...el.map(i => hi[i])), bl = Math.min(...el.map(i => lo[i]));
        hiW = el.filter(i => hi[i] === bh); loW = bl === NO_LOW ? [] : el.filter(i => lo[i] === bl);
      }
      const give = (ws, a) => ws.forEach(i => won[i] += a / ws.length);
      if (loW.length) { give(hiW, amt / 2); give(loW, amt / 2); } else give(hiW, amt);
      pots.push({ amt, elig: el, hiW, loW });
    });
    return { won, pots, rake: rk, returned, returnedTo: returned > 0 ? top : -1 };
  }

  function handleMessage(msg, post) {
    try {
      if (msg.cmd === 'equity') {
        const job = createEquityJob(msg);
        const chunk = msg.chunk || 2500;
        let last = 0;
        while (!job.step(chunk)) {
          const now = Date.now();
          if (now - last > 120) { post({ id: msg.id, type: 'progress', result: job.result() }); last = now; }
        }
        post({ id: msg.id, type: 'done', result: job.result() });
      } else if (msg.cmd === 'setReal') { setRealPool(msg.bytes);
      } else if (msg.cmd === 'calibrate') {
        const job = createCalibrateJob(msg);
        while (!job.step(50)) post({ id: msg.id, type: 'progress', progress: job.progress });
        post({ id: msg.id, type: 'done', result: job.result() });
      }
    } catch (e) { post({ id: msg.id, type: 'error', error: String(e.message || e) }); }
  }

  return { RANKS, SUITS, NO_LOW, CATS, FEAT_NAMES, parseCards, cardStr, eval5, bestLow, LOWBIT, bestHiDetail, bestLowDetail,
    describeHi, describeLow, feats, score, settle, randomHand, setRealPool, hasReal, sampleReal, realHand, get realSize() { return REAL ? REAL.size : 0; }, createEquityJob, createCalibrateJob, handleMessage, evalRanks };
}
if (typeof module !== 'undefined') module.exports = ENGINE;
