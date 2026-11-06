const ENGINE = require('../src/engine.js');
const E = ENGINE();
// naive evaluators
function naiveHi5(c){ // independent implementation
  const r=c.map(x=>x>>2).sort((a,b)=>b-a), s=c.map(x=>x&3);
  const flush=s.every(x=>x===s[0]);
  const uniq=[...new Set(r)];
  let straightHi=-1;
  if(uniq.length===5){ if(r[0]-r[4]===4) straightHi=r[0]; else if(r.join()==='12,3,2,1,0') straightHi=3; }
  const cnt={}; r.forEach(x=>cnt[x]=(cnt[x]||0)+1);
  const g=Object.entries(cnt).map(([k,v])=>[v,+k]).sort((a,b)=>b[0]-a[0]||b[1]-a[1]);
  const key=g.map(x=>x[1]);
  let cat;
  if(straightHi>=0&&flush) return [8,straightHi];
  if(g[0][0]===4) cat=7; else if(g[0][0]===3&&g[1][0]===2) cat=6; else if(flush) return [5,...r];
  else if(straightHi>=0) return [4,straightHi]; else if(g[0][0]===3) cat=3; else if(g[0][0]===2&&g[1][0]===2) cat=2; else if(g[0][0]===2) cat=1; else cat=0;
  return [cat,...key];
}
const cmp=(a,b)=>{for(let i=0;i<Math.max(a.length,b.length);i++){const d=(a[i]||0)-(b[i]||0); if(d) return d;} return 0;};
function naiveBestHi(h,b){let best=null; for(let i=0;i<6;i++)for(let j=i+1;j<6;j++)for(let x=0;x<5;x++)for(let y=x+1;y<5;y++)for(let z=y+1;z<5;z++){const v=naiveHi5([h[i],h[j],b[x],b[y],b[z]]); if(!best||cmp(v,best)>0) best=v;} return best;}
function lowR(c){const r=c>>2; return r===12?1:(r<=6?r+2:99);}
function naiveBestLow(h,b){let best=null; for(let i=0;i<6;i++)for(let j=i+1;j<6;j++)for(let x=0;x<5;x++)for(let y=x+1;y<5;y++)for(let z=y+1;z<5;z++){const rs=[h[i],h[j],b[x],b[y],b[z]].map(lowR); if(rs.some(v=>v>8)) continue; if(new Set(rs).size<5) continue; rs.sort((a,b)=>b-a); if(!best||cmp(rs,best)<0) best=rs;} return best?best.join('-'):'No low';}
function deal(n){const d=[...Array(52).keys()]; for(let i=0;i<n;i++){const j=i+Math.floor(Math.random()*(52-i)); [d[i],d[j]]=[d[j],d[i]];} return d.slice(0,n);}
let bad=0;
for(let t=0;t<20000;t++){
  const d=deal(17); const h1=d.slice(0,6), h2=d.slice(6,12), b=d.slice(12,17);
  const v1=E.bestHiDetail(h1,b).value, v2=E.bestHiDetail(h2,b).value;
  const n1=naiveBestHi(h1,b), n2=naiveBestHi(h2,b);
  if(Math.sign(v1-v2)!==Math.sign(cmp(n1,n2))) {bad++; if(bad<5) console.log('HI MISMATCH', h1.map(E.cardStr), h2.map(E.cardStr), b.map(E.cardStr));}
  if(Math.floor(v1/1048576)!==n1[0]) {bad++; if(bad<5) console.log('CAT MISMATCH');}
  const L=E.describeLow(E.bestLowDetail(h1,b).mask).replace(/A/g,'1'); const nl=naiveBestLow(h1,b);
  if(L!==nl) {bad++; if(bad<5) console.log('LOW MISMATCH',L,nl,h1.map(E.cardStr),b.map(E.cardStr));}
}
console.log('eval mismatches:', bad);
// fast path vs detail
const job=E.createEquityJob({players:[{cards:E.parseCards('As2s3dKdQh9c').cards},{cards:E.parseCards('Ah4h5c6cJdTd').cards}],trials:1});
// symmetry test: random vs random x3
let t0=Date.now(); const j2=E.createEquityJob({players:[{cards:[]},{cards:[]},{cards:[]}],trials:60000}); j2.step(1e9); const r=j2.result();
console.log('3 random:', r.players.map(p=>p.eq.toFixed(4)).join(' '), 'boardLow', r.boardLow.toFixed(3), (Date.now()-t0)+'ms');
t0=Date.now(); const j3=E.createEquityJob({players:Array.from({length:6},()=>({cards:[]})),trials:30000}); j3.step(1e9);
console.log('6 random:', j3.result().players.map(p=>p.eq.toFixed(4)).join(' '), (Date.now()-t0)+'ms');
// exact enumeration check: 2 known hands flop given
const A=E.parseCards('As2s3dKdQh9c').cards, B=E.parseCards('Ah4h5c6cJdTd').cards, F=E.parseCards('7s8hKc').cards;
const ex=E.createEquityJob({players:[{cards:A},{cards:B}],board:F,trials:1}); ex.step(1e9); const er=ex.result();
const mc=E.createEquityJob({players:[{cards:A},{cards:B}],board:F,trials:200000,exactLimit:0}); mc.step(1e9); const mr=mc.result();
console.log('exact', er.exact, er.total, er.players.map(p=>p.eq.toFixed(4)), 'mc', mr.players.map(p=>p.eq.toFixed(4)));
// brute check of exact via naive
let eqA=0,cnt=0; const used=new Set([...A,...B,...F]); const rest=[...Array(52).keys()].filter(c=>!used.has(c));
for(let i=0;i<rest.length;i++)for(let j=i+1;j<rest.length;j++){const b=[...F,rest[i],rest[j]]; const ha=naiveBestHi(A,b), hb=naiveBestHi(B,b); const la=naiveBestLow(A,b), lb=naiveBestLow(B,b);
 const hc=cmp(ha,hb); let s=0; const lowA=la!=='No low', lowB=lb!=='No low';
 const hiShare = hc>0?1:hc<0?0:0.5;
 if(!lowA&&!lowB) s=hiShare; else { let lc; if(lowA&&!lowB) lc=1; else if(!lowA&&lowB) lc=0; else { const c2=cmp(la.split('-').map(Number), lb.split('-').map(Number)); lc=c2<0?1:c2>0?0:0.5;} s=hiShare/2+lc/2; }
 eqA+=s; cnt++;}
console.log('naive exact eqA', (eqA/cnt).toFixed(4), cnt);
