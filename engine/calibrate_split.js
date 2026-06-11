const { scoreInto } = require('./breakdown.js');
const fs = require('fs');
const cardId = c => (c.r-1)*4 + c.s;
function deckExcluding(cards){const u=new Set(cards.map(cardId));const d=[];for(let r=1;r<=13;r++)for(let s=0;s<4;s++){const c={r,s};if(!u.has(cardId(c)))d.push(c);}return d;}
function rnd(n){return (Math.random()*n)|0;}
function randomHand(){const d=deckExcluding([]);for(let i=d.length-1;i>0;i--){const j=rnd(i+1);[d[i],d[j]]=[d[j],d[i]];}return d.slice(0,5);}
const BLEND=[0.096,0.0674,0.0526,0.0438,0.0182,0.0605,0.0891,0.0905,0.086,0.0709,0.0522,0.1146,0.1582];

const STATE='./state.json';
let st;
if(fs.existsSync(STATE)){ st=JSON.parse(fs.readFileSync(STATE,'utf8')); }
else { st={iter:0, dealer:BLEND.slice(), defender:BLEND.slice()}; }

const cumOf=p=>{const c=[];let s=0;for(const x of p){s+=x;c.push(s);}return c;};
const dCum=cumOf(st.dealer), fCum=cumOf(st.defender);
function pickRank(cum){const u=Math.random()*cum[12];for(let i=0;i<13;i++)if(u<=cum[i])return i+1;return 13;}
function drawCard(cum,suitsByRank,used){
  for(let t=0;t<48;t++){const r=pickRank(cum);const su=suitsByRank[r];if(!su.length)continue;const free=su.filter(s=>!used.has(r*4+s));if(!free.length)continue;const s=free[rnd(free.length)];used.add(r*4+s);return {r,s};}
  for(let r=1;r<=13;r++)for(const s of suitsByRank[r])if(!used.has(r*4+s)){used.add(r*4+s);return {r,s};}
  return null;
}
function handEV(four,dealt){const deck=deckExcluding(dealt);const acc=[0,0,0,0,0];let t=0;for(const st of deck)t+=scoreInto(four,st,false,acc);return t/deck.length;}
function cribEVrole(disc,dealt,N,role){
  const pool=deckExcluding(dealt);const suitsByRank=Array.from({length:14},()=>[]);for(const c of pool)suitsByRank[c.r].push(c.s);
  const acc=[0,0,0,0,0];let total=0;const used=new Set();
  for(let k=0;k<N;k++){used.clear();let o0,o1,o2;
    if(role==='deal'){o0=drawCard(fCum,suitsByRank,used);o1=drawCard(fCum,suitsByRank,used);o2=drawCard(fCum,suitsByRank,used);}
    else{o0=drawCard(dCum,suitsByRank,used);o1=drawCard(fCum,suitsByRank,used);o2=drawCard(fCum,suitsByRank,used);}
    // starter uniform
    let starter=null;for(let t=0;t<80;t++){const c=pool[rnd(pool.length)];if(!used.has(c.r*4+c.s)){starter=c;break;}}
    total+=scoreInto([disc,o0,o1,o2],starter,true,acc);}
  return total/N;
}
function bestRank(hand,role,N){let bI=0,bN=-1e9;for(let i=0;i<5;i++){const four=hand.filter((_,j)=>j!==i);const h=handEV(four,hand);const cr=cribEVrole(hand[i],hand,N,role);const net=role==='deal'?h+cr:h-cr;if(net>bN){bN=net;bI=i;}}return hand[bI].r;}

const RUNS=10000, N=2000;
const dealC=new Array(14).fill(0), defC=new Array(14).fill(0);let nDeal=0,nDef=0;
const t0=Date.now();
for(let h=0;h<RUNS;h++){
  const role=Math.random()<0.25?'deal':'defend';
  const r=bestRank(randomHand(),role,N);
  if(role==='deal'){dealC[r]++;nDeal++;}else{defC[r]++;nDef++;}
  if((h+1)%2500===0)process.stderr.write(`  ...${h+1}\n`);
}
const newDealer=[],newDef=[];
for(let r=1;r<=13;r++){newDealer.push(+(dealC[r]/nDeal).toFixed(5));newDef.push(+(defC[r]/nDef).toFixed(5));}
const l1=(a,b)=>a.reduce((s,x,i)=>s+Math.abs(x-b[i]),0);
const prevIter=st.iter;
const changeD=l1(newDealer,st.dealer).toFixed(4), changeF=l1(newDef,st.defender).toFixed(4);
fs.writeFileSync(STATE, JSON.stringify({iter:prevIter+1, dealer:newDealer, defender:newDef}));

const lab=r=>r===1?'A':r===11?'J':r===12?'Q':r===13?'K':String(r);
const secs=((Date.now()-t0)/1000).toFixed(0);
console.log(`\n=== ITERATION ${prevIter+1}  (10,000 hands, crib N=${N}, ${secs}s) ===`);
console.log(`input model = iteration ${prevIter}${prevIter===0?' (warm start: blended distribution, same for both roles)':''}`);
console.log(`samples: ${nDeal} dealer throws, ${nDef} defender throws`);
console.log(`L1 change from previous: dealer ${changeD}, defender ${changeF}\n`);
console.log('rank | DEALER throws (own crib) | DEFENDER throws (opp crib)');
for(let r=1;r<=13;r++){
  const d=newDealer[r-1]*100, f=newDef[r-1]*100;
  const bar=(v,m)=>'#'.repeat(Math.round(v/m*18));
  console.log(`${lab(r).padStart(2)}   | ${d.toFixed(2).padStart(5)}%  ${bar(d,16).padEnd(18)} | ${f.toFixed(2).padStart(5)}%  ${bar(f,20)}`);
}
console.log('\nDEALER_PROBS  =', JSON.stringify(newDealer));
console.log('DEFENDER_PROBS=', JSON.stringify(newDef));
