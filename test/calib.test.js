const E = require('../src/engine.js')();
let t0=Date.now(); const job=E.createCalibrateJob({}); while(!job.step(100)); const r=job.result();
console.log('time',Date.now()-t0,'ms R2',r.r2.toFixed(3));
E.FEAT_NAMES.forEach((n,i)=>console.log(n.padEnd(18), (r.w[i]*100).toFixed(2)));
const pct=s=>{const q=r.quantiles; let lo=0,hi=q.length-1; while(lo<hi){const m=(lo+hi)>>1; if(q[m]<s) lo=m+1; else hi=m;} return lo/10;};
for(const h of ['As2s3dKdQh9c','Ah2h3s4sKcQd','AhAs2h3s4d5d','9hTsJdQc8h7s','2c3d4h5s6c7d','KsKhQdJdTc9s','Ac2d7h8sJcQd','2h2s7c7d9hJc','AsAd2s3d4c5h'])
{const c=E.parseCards(h).cards; const s=E.score(c,r.w); const j=E.createEquityJob({players:[{cards:c},{cards:[]},{cards:[]}],trials:20000}); j.step(1e9);
 console.log(h, 'model', (s*100).toFixed(1), 'actual', (j.result().players[0].eq*100).toFixed(1), 'top', (100-pct(s)).toFixed(1)+'%');}
