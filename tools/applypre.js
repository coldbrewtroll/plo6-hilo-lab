// Write self-play-tuned preflop chart widths (theta.pre from a round-9+ policy) into data/ranges.json.
// The solver's original charts are kept in data/ranges.solver.json.
const fs = require('fs'), path = require('path'), ROOT = path.join(__dirname, '..');
const SP = require('./selfplay.js');
const file = path.resolve(process.argv[2] || path.join(ROOT, 'data/botpolicy6.json'));
const pre = JSON.parse(fs.readFileSync(file)).theta.pre;
if (!pre) { console.log('no preflop widths in', file); process.exit(1); }
const solverFile = path.join(ROOT, 'data/ranges.solver.json'), rangesFile = path.join(ROOT, 'data/ranges.json');
if (!fs.existsSync(solverFile)) fs.copyFileSync(rangesFile, solverFile);
const R = JSON.parse(fs.readFileSync(solverFile)), C = SP.preChart(pre), r2 = x => Math.round(x * 100) / 100;
R.rfi = Object.fromEntries(Object.entries(C.rfi).map(([k, v]) => [k, r2(v)]));
R.sbComplete = r2(C.sbComplete); R.bbIso = r2(C.bbIso);
R.vsOpen = Object.fromEntries(Object.entries(C.vsOpen).map(([k, v]) => [k, { tb: r2(v.tb), ct: r2(v.ct) }]));
R.vs3 = Object.fromEntries(Object.entries(C.vs3).map(([k, v]) => [k, { fb: r2(v.fb), cb: r2(v.cb) }]));
R.selfplay = { from: path.basename(file), widths: pre, note: 'chart widths tuned by self-play with the postflop bot (round 9+); solver charts in ranges.solver.json' };
fs.writeFileSync(rangesFile, JSON.stringify(R));
console.log('wrote', rangesFile, '\nrfi', R.rfi, '\nsbComplete', R.sbComplete, 'bbIso', R.bbIso, '\nvsOpen BTN>BB', R.vsOpen['BTN>BB'], 'UTG>BTN', R.vsOpen['UTG>BTN'], '\nvs3 UTG>BTN', R.vs3['UTG>BTN']);
