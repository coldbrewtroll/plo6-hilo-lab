# PLO6 Hi/Lo Lab

6-card Pot-Limit Omaha Hi/Lo (8-or-better) simulator + trainer for 6-max.

- **Windows app:** run `dist/PLO6-HiLo-Lab.exe` — a single portable file, no installer. It opens in its own window using the Microsoft Edge WebView2 runtime that ships with Windows 10/11 (if WebView2 is missing it opens in your default browser instead). Stats and settings are saved between runs.
- **Browser:** open `plo6-hilo-lab.html` in any modern browser — the same app as one self-contained file.

## Simulator tab
- **6-Max Table Equity** — UTG/HJ/CO/BTN/SB/BB seats, board, dead cards, card picker. Blank or partial hands are dealt randomly each trial.
  - Method: Auto (exact when feasible) · Monte Carlo · Exact enumeration
  - Stop rule: fixed trials, or run until the 95% CI is ±0.5% / ±0.25% / ±0.1%
  - Reports equity ± 95% CI, hi win, lo win, scoop, low made, and a Monte Carlo convergence chart
- **Hand Analyzer** — equity vs 1–5 random opponents, final-hand distribution, low/nut-low frequency, preflop verdict by spot.

## Trainer tab
- **Preflop Ranges** — RFI / facing an open / facing a 3-bet. Each hand is ranked by a fresh 60k-run simulation (pot share 3-way vs 2 hands from the top 40%) against a table of 40k simulated hands × 5k runouts. Grade by the range chart or by best EV. Includes a decision-flow chart and an EV decision tree for every choice; ranges and EV assumptions are adjustable. Hands play out to showdown against Nit / Reg / Maniac opponents (badge on each seat; choose the mix in Drill settings) with a coach grading every decision. The coach reads each opponent range-vs-range: every bet, raise, call and check reweights the hands in their preflop range by how often the bots' own strategy (with its Nit/Maniac tilt, bluffs and traps) would take that action holding each one, so a river bet still contains its bluffs. Call/fold grading uses that read against the price after rake, the same numbers as the river call-math box. Checked in bot-vs-bot hands: the reads land within ~1–3 points of hero's true average equity (the older cut-off reads were 6–14 points too pessimistic on turn and river). If you fold after the flop, the bots finish the hand quickly so you can see how it ends; finished hands can be reviewed step by step (◀ Back / Forward ▶, ⏵ Replay, show all cards, browse your last 50 hands; keys ← → Home End P).
- **Equity Guess** — guess hero's all-in equity, 2–6 way, preflop/flop/turn.
- **Showdown Reader** — pick the high and low winners.
- **Stats & Charts** — accuracy by position/spot, recent mistakes, range chart.

Default ranges are a fixed point of the trainer's simplified EV model (`tools/solve.js`): each spot's ranges are a best response to the others. That is an equilibrium of a simplified preflop model, **not** a full-game solver.

## EV model assumptions (Trainer → Ranges & EV model)
Equity realization: 90% in position, 75% out of position, **65% out of position in 3-bet pots** (low SPR vs the stronger range), scaled ±20% by hand quality; rake 5% capped at 2bb; 4-bets treated as all-in with the 3-bettor folding 20%.

## Bot self-play (postflop policy)
`node tools/optimize.js` tunes 27 postflop parameters (value/thin/bomb thresholds, bluffing, call slack, bet-size respect, raises; per street) by duplicate-deal self-play and writes `data/botpolicy.json` (resumable; `tools/selfplay.js` is the headless engine). Last run: 5 sweeps, 32.4M hands, 29 leaks plugged, tuned bot **+75.5 ± 2.0 bb/100** vs the original bot. Scoop bombs lose vs size-aware regs (−3 to −4 bb/100) but win vs calling stations (+9.9 bb/100 at scoop ≥ 40%), so bots and the coach bomb only when a Maniac/station is in the hand.

## Rounds 2–5: aggressive, equity-driven postflop strategy
`tools/spots.js` replays sampled decisions with every alternative (same cards, same randomness) to find problem spots; `tools/optimize.js` (GUIDED=… for multi-parameter jumps, POP=… for population training) tunes 63 postflop parameters per street set: equity-swing aggression, initiative, heads-up call tax / thinner heads-up value, big-bet and swing sizing, river bluffs, traps. Rounds 2–5: 48 changes, 62.8M hands. Final (round 5) vs round 1: +23.7 bb/100 on a round-1 table; robust across table types (≥ round 4 everywhere, better than round 3 on aggressive and mixed tables). App applies type adjustments: vs calling stations no bluffs/traps + thinner value + scoop bombs (+15 vs round 3 at station tables); vs only Nits bet like round 3 (no traps, +11 at tight tables). Aggression: bet/raise 20.7% → 28.6% of postflop decisions, AF 1.62 → 2.04, while folding more to bets (9.4% → 16.5%). The trainer also shows a call-math box (scoop / ¾ / half / quartered / lose payouts and EV) when facing a river bet.

## Round 6: retuned after the rules fixes
With the corrected engine (rake only on called pots, exact side pots, real-pool preflop ranks), the bot was retuned from round 5 against a mixed population (round-1, round-3 and round-5 bots, calling stations, itself): 23.3M more hands, 5 changes kept. They fold more on heads-up flops when slightly behind (+3.5), stop thin-betting slightly-ahead hands heads-up on the river (+2.8), respect turn bets less (+4.5), value-bet the flop thinner (+5.1) and raise river bets with a 75%+ scoop chance (+1.4). Result: +8.69 ± 1.47 bb/100 vs round 5, and ahead of round 5 at every table type (+2.8 to +12.0). Spot-scan ideas that lost as whole strategies were rejected: turn value-raises (−9 to −12), turn bluff-raises (−2 to −9), turn pot-size bets (−2).

## Round 7: the stab
New move: when checked to and only slightly behind (edge down to −10 points, heads-up or multiway), bet pot some of the time. Round 7 stabs the flop 50% of the time (+6.1 bb/100) and bluffs heads-up rivers 35% instead of 50% (+1.6). Result: +4.43 ± 1.08 bb/100 vs round 6. Versus calling stations the trainer turns stabs off (they call).

## Round 8: converged
Counters to the stab (raising flop bets, re-steals, calling wider) all lost against the mixed population (−4 to −11 bb/100). Kept: stab a little more (56%), fold a little more to flop bets, raise river bets a little less: +2.08 ± 0.85 bb/100 vs round 7, level with it at every table type. Problem-spot scans can now play against the same mixed population (`POP=` in `tools/spots.js`): against it, round 7's significant leaks total 29 bb/100 instead of 205 against copies of itself.

## Round 9: preflop charts by self-play
Every chart width (opening range per position, SB complete, BB iso-raise, calls and 3-bets vs opens, blind 3-bets, 4-bets and calls vs 3-bets) was tested by self-play with the round-8 postflop bot. The solver charts held up everywhere except one spot: **the blinds should 3-bet their top ~10% vs opens** (the solver never 3-bet from the blinds), keeping the same flatting band behind it. +5.5 bb/100 on average over table types (+8.6 vs round-1 bots, +4.0 vs round-8 bots, level vs calling stations). The trainer's preflop charts now include this (`tools/applypre.js` writes them into `data/ranges.json`; the solver charts stay in `data/ranges.solver.json`). Saved range settings were reset (settings key v4) so the new charts take effect. The optional "grade by EV" mode still uses the equity-realization model, which is more pessimistic about the blinds than self-play, so in SB/BB spots it agrees with the chart less often (84–93% instead of 95–98%).

## iPhone / phone version
The same page adapts to phone screens: a portrait table, a bottom action bar within thumb reach, the river call-math box under the buttons, panels stacked, wide tables scroll inside their panel, 16px inputs (so iOS Safari doesn't zoom), safe-area padding for the notch and home bar.
- `artifact.html`: the build for a hosted claude.ai page (open it in Safari on the phone).
- `docs/`: an installable web app (served by GitHub Pages) for any static host (GitHub Pages, Netlify): `index.html`, `manifest.webmanifest`, an offline cache (`sw.js`) and icons (`tools/icon.py`). Host the folder over HTTPS, open it in Safari, Share → Add to Home Screen: it launches full screen with its own icon and works offline.

## Rules engine
Both the trainer and the self-play engine settle pots with one shared function (`settle` in `src/engine.js`): uncalled bets go back, then main and side pots are built by contribution level and each pot is split half high / half low (quartering included) among the players eligible for it. Rake (5% capped at 2bb by default, set in Ranges & EV model) comes only out of pots that saw a flop. A short all-in raise does not reopen the betting for players who already acted. Self-play deals hole cards from the real-equity pool, so its bots rank hands exactly as the trainer's bots do.

## Opener-type preflop grading
Facing an open, the call range adjusts to the opener's type (setting: "Adjust preflop grading for the opener's type"): ×1.8 (max top 85%) vs Maniacs, ×0.9 vs Nits, chart vs Regs. Played-out self-play (BB vs UTG/BTN, to the river): defending just outside the chart is ≈ −0.2 bb vs Regs/Nits but +1.6 to +1.8 bb vs Maniac stations. Weak AA hands are not an exception vs Regs: AA hands just outside the BB-vs-UTG chart average −0.76 bb vs folding (non-AA at the same rank −0.13).

## Development
- `desktop/build.sh` → `dist/PLO6-HiLo-Lab.exe` (Go 1.24+, cross-compiles from Linux/macOS/Windows; source in `desktop/main.go`)
- `node tools/calibrate.js` → `data/model.json` (hand-rank metric table + range-sampling model)
- `node tools/calibrate.js` (fitted ranking model, R² 0.919; used only as a fallback)
- `node tools/realpool.js` → `data/realpool.bin`: 120k hands × 5k runouts (600M trials) sorted by real simulated equity. Opponent ranges, hand ranks, bots and the solver all sample from this pool.
- `REFINE=1 BURN=2 AVG_STOP=0.3 PER_SPOT=500 TARGET=10000000 POOL=4000 RANK_T=20000 node tools/solve.js` → `data/ranges.json`: best-response iteration with ≥10M trials per spot per iteration, averaged after burn-in until the averaged ranges move <0.3 pts (current tables: `TARGET=50000000 PER_SPOT=1200 POOL=8000 AVG_STOP=0.2`, 7 iterations, 12.2B trials, ~2 h on 4 cores; averaged ranges moved <0.12 pts)
- `node test/evagree.test.js` checks that the range chart and each hand's EV tree agree (93–98% of hands per spot)

Source lives in `src/`; `python3 build.py` inlines it into `plo6-hilo-lab.html`.
`node test/engine.test.js` checks the evaluator against a naive implementation and exact enumeration.
