#!/usr/bin/env python3
"""Inline src/ into a single self-contained HTML file."""
import pathlib
root = pathlib.Path(__file__).parent
src = root / 'src'
html = (src / 'index.html').read_text()
html = html.replace('/*STYLE*/', (src / 'style.css').read_text())
html = html.replace('/*ENGINE*/', (src / 'engine.js').read_text().replace("if (typeof module !== 'undefined') module.exports = ENGINE;", ''))
import json
model = json.loads((root / 'data' / 'model.json').read_text())
r = lambda v: [round(x, 6) for x in v]
model['w'] = r(model['w']); model['modelQuantiles'] = r(model['modelQuantiles']); model['metricQuantiles'] = r(model['metricQuantiles'])
rp = root / 'data' / 'realpool.json'
if rp.exists():
    meta = json.loads(rp.read_text())
    model['metricQuantiles'] = meta['quantiles']; model['hands'] = meta['n']; model['trials'] = meta['trials']
html = html.replace('/*MODEL*/', json.dumps(model, separators=(',', ':')))
import base64
rb = root / 'data' / 'realpool.bin'
html = html.replace('/*REALPOOL*/', '"' + base64.b64encode(rb.read_bytes()).decode() + '"' if rb.exists() else 'null')
bp, bp2 = root / 'data' / 'botpolicy.json', root / 'data' / 'botpolicy2.json'
pol = json.loads(bp.read_text()) if bp.exists() else None
if bp2.exists():  # round 2 (aggressive, equity-driven) supersedes round 1; keep round 1's report
    p2 = json.loads(bp2.read_text())
    if pol: p2['previous'] = {k: pol.get(k) for k in ('history', 'final', 'hypothesesEnd', 'exploits', 'deals', 'sweeps')}
    p2.setdefault('exploits', pol.get('exploits') if pol else None)
    r3 = root / 'data' / 'botpolicy2.round3.json'
    if r3.exists():  # vs tight (non-bluffing) opponents, bet like round 3: no traps, thicker value (+11 bb/100 on tight tables)
        R3 = json.loads(r3.read_text())['theta']
        BET = ['vb', 'big', 'thin', 'bigSize', 'bluff', 'bluffSize', 'bluffMax', 'huVb', 'swing', 'swingVb', 'swingSize', 'initVb', 'trap', 'braise']
        p2['vsTight'] = {st: {k: R3[st].get(k) for k in BET if k in R3[st]} for st in ('flop', 'turn', 'river')}
        p2['vsTight'] = {st: dict(v, trap=0, braise=0) for st, v in p2['vsTight'].items()}
    sp = root / 'data' / 'spots.before.json'; sa = root / 'data' / 'spots.after.json'
    if sp.exists(): p2['spotsBefore'] = {k: v for k, v in json.loads(sp.read_text()).items() if k != 'spots'} | {'top': json.loads(sp.read_text())['spots'][:12]}
    if sa.exists(): p2['spotsAfter'] = {k: v for k, v in json.loads(sa.read_text()).items() if k != 'spots'} | {'top': json.loads(sa.read_text())['spots'][:12]}
    # rounds 6+: retuned after the rules fixes (rake only on called pots, real-pool preflop ranks, side pots). data/botpolicy{3,4,...}.json
    p2['rounds'] = []
    for n in range(6, 30):
        f = root / 'data' / f'botpolicy{n - 3}.json'
        if not f.exists(): break
        p3 = json.loads(f.read_text())
        if not p3.get('final'): break
        p2['theta'] = p3['theta']
        R = {k: p3.get(k) for k in ('history', 'final', 'deals', 'sweeps')} | {'n': n}
        rb = root / 'data' / f'robustness{n}.json'
        if rb.exists(): R['robustness'] = json.loads(rb.read_text())
        sc = next((f for f in (root / 'data' / f'spots.post.r{n - 1}.json', root / 'data' / f'spots.pre.r{n - 1}.json', root / 'data' / f'spots.r{n - 1}.json') if f.exists()), None)
        if sc: S = json.loads(sc.read_text()); R['spots'] = {k: v for k, v in S.items() if k != 'spots'} | {'top': S['spots'][:12]}
        if p3.get('hypothesesEnd'): p2['hypothesesEnd'] = p3['hypothesesEnd']
        p2['rounds'].insert(0, R)  # latest first
    pol = p2
html = html.replace('/*BOTPOLICY*/', json.dumps(pol) if pol else 'null')
rng = root / 'data' / 'ranges.json'
html = html.replace('/*RANGES*/', rng.read_text() if rng.exists() else 'null')
app = (src / 'app.js').read_text().replace('/*STRATEGY*/', (src / 'strategy.js').read_text()).replace('/*TABLE*/', (src / 'table.js').read_text()).replace('/*HAND*/', (src / 'hand.js').read_text())
html = html.replace('/*APP*/', app)
icon = root / 'docs' / 'icon-180.png'
html = html.replace('/*TOUCHICON*/', 'data:image/png;base64,' + base64.b64encode(icon.read_bytes()).decode() if icon.exists() else '')
(root / 'plo6-hilo-lab.html').write_text(html.replace('<!--WEBAPP-->', ''))
print('wrote plo6-hilo-lab.html', len(html), 'bytes')
# docs/ (served by GitHub Pages): the same page as an installable web app (Add to Home Screen) with an offline cache, for any static host (GitHub Pages, Netlify...)
web = root / 'docs'; web.mkdir(exist_ok=True)
import hashlib
ver = hashlib.sha1(html.encode()).hexdigest()[:10]
(web / 'index.html').write_text(html.replace('<!--WEBAPP-->', '<link rel="manifest" href="manifest.webmanifest">\n<script>if (\'serviceWorker\' in navigator && location.protocol === \'https:\' && window.top === window) addEventListener(\'load\', () => navigator.serviceWorker.register(\'sw.js\').catch(() => {}));</script>'))
(web / 'manifest.webmanifest').write_text(json.dumps({
    'name': 'PLO6 Hi/Lo Lab', 'short_name': 'PLO6 Lab', 'description': '6-card Omaha Hi/Lo 8-or-better simulator and trainer',
    'start_url': './', 'scope': './', 'display': 'standalone', 'orientation': 'portrait', 'background_color': '#0b0f13', 'theme_color': '#0b0f13',
    'icons': [{'src': 'icon-192.png', 'sizes': '192x192', 'type': 'image/png'}, {'src': 'icon-512.png', 'sizes': '512x512', 'type': 'image/png', 'purpose': 'any'}]}, indent=1))
(web / 'sw.js').write_text(f"""// offline cache for the PLO6 Hi/Lo Lab web app (version {ver}): serve from cache, refresh in the background
const C = 'plo6-{ver}', FILES = ['./', 'index.html', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => {{ e.waitUntil(caches.open(C).then(c => c.addAll(FILES))); self.skipWaiting(); }});
self.addEventListener('activate', e => {{ e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k))))); self.clients.claim(); }});
self.addEventListener('fetch', e => {{
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.open(C).then(c => c.match(e.request).then(hit => {{
    const net = fetch(e.request).then(r => {{ if (r.ok) c.put(e.request, r.clone()); return r; }}).catch(() => hit);
    return hit || net;
  }})));
}});
""")
print('wrote docs/ (index.html, manifest.webmanifest, sw.js, icons) version', ver)
# artifact.html: the same page for a hosted artifact. The host wraps it in its own document skeleton (and pads :root by the
# phone's safe-area insets), so drop our document tags and let the sticky header sit below the top inset.
import re
art = html.replace('<!--WEBAPP-->', '')
art = re.sub(r'<!DOCTYPE html>\s*<html[^>]*>\s*<head>\s*', '', art, count=1)
art = art.replace('<meta charset="utf-8">', '', 1)
art = re.sub(r'<meta name="viewport"[^>]*>', '', art, count=1)
art = art.replace('</head>', '', 1).replace('<body>', '', 1).replace('</body>', '').replace('</html>', '')
title_end = art.index('</title>') + len('</title>')
art = art[:title_end] + '\n<meta name="claude:viewport-fit-sides" content="cover">\n<style>:root{color-scheme:dark}body{background:#0b0f13}body::before{content:"";position:fixed;inset:0 0 auto;height:env(safe-area-inset-top,0px);z-index:11;background:#0b0f13}header{top:env(safe-area-inset-top,0px)!important;padding-top:6px!important}</style>' + art[title_end:]
(root / 'artifact.html').write_text(art)
print('wrote artifact.html', len(art), 'bytes')
