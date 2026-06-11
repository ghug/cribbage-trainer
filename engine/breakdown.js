const fifteenVal = r => Math.min(r,10);
// accumulate category points into acc[5]=[15s,pairs,runs,flush,nobs], return total
function scoreInto(four, starter, isCrib, acc){
  const all=[...four,starter]; let f=0,p=0,ru=0,fl=0,no=0;
  for(let m=1;m<32;m++){let s=0;for(let i=0;i<5;i++)if(m&(1<<i))s+=fifteenVal(all[i].r);if(s===15)f+=2;}
  for(let i=0;i<5;i++)for(let j=i+1;j<5;j++)if(all[i].r===all[j].r)p+=2;
  const c=new Array(14).fill(0);for(const x of all)c[x.r]++;
  let r=1;while(r<=13){if(!c[r]){r++;continue;}let len=0,pr=1,rr=r;while(rr<=13&&c[rr]>0){len++;pr*=c[rr];rr++;}if(len>=3)ru+=len*pr;r=rr;}
  const s0=four[0].s;if(four.every(x=>x.s===s0)){if(starter.s===s0)fl+=5;else if(!isCrib)fl+=4;}
  for(const x of four)if(x.r===11&&x.s===starter.s)no+=1;
  acc[0]+=f;acc[1]+=p;acc[2]+=ru;acc[3]+=fl;acc[4]+=no;
  return f+p+ru+fl+no;
}
// locked points among 4 cards (no starter)
function lockedFour(four){
  let f=0,p=0,ru=0,fl=0;
  for(let m=1;m<16;m++){let s=0;for(let i=0;i<4;i++)if(m&(1<<i))s+=fifteenVal(four[i].r);if(s===15)f+=2;}
  for(let i=0;i<4;i++)for(let j=i+1;j<4;j++)if(four[i].r===four[j].r)p+=2;
  const c=new Array(14).fill(0);for(const x of four)c[x.r]++;
  let r=1;while(r<=13){if(!c[r]){r++;continue;}let len=0,pr=1,rr=r;while(rr<=13&&c[rr]>0){len++;pr*=c[rr];rr++;}if(len>=3)ru+=len*pr;r=rr;}
  if(four.every(x=>x.s===four[0].s))fl+=4;
  return f+p+ru+fl;
}
module.exports={scoreInto,lockedFour};

if(require.main===module){
  const c=(r,s)=>({r,s});
  // verify category sum == known totals
  const acc=[0,0,0,0,0];
  let t=scoreInto([c(5,1),c(5,0),c(5,3),c(11,2)],c(5,2),false,acc);
  console.log('perfect29 total',t,'cats',acc,'sum',acc.reduce((a,b)=>a+b)); // 29
  console.log('locked 4-5-5-6', lockedFour([c(4,0),c(5,1),c(5,2),c(6,3)])); // pair2 + run? 4556 -> run 4-5-6 doubled = 6, pair 2 =>8; 15s 4+5+6=15 x2=4 => 12
}
