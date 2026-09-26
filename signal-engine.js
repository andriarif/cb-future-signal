function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

export function normalizeCandles(raw) {
  let rows = raw;
  if (raw && !Array.isArray(raw)) {
    for (const k of ["candles","data","result","items"]) {
      if (Array.isArray(raw[k])) { rows = raw[k]; break; }
    }
  }
  if (!Array.isArray(rows)) throw new Error("Response candle bukan array.");

  const aliases = {
    timestamp:"time", ts:"time", datetime:"time", date:"time",
    o:"open", h:"high", l:"low", c:"close", v:"volume"
  };

  return rows.map(r => {
    const x = {...r};
    for (const [a,b] of Object.entries(aliases)) {
      if (x[b] === undefined && x[a] !== undefined) x[b] = x[a];
    }
    const t = typeof x.time === "number"
      ? (x.time > 10000000000 ? x.time : x.time * 1000)
      : Date.parse(x.time);

    return {
      time: new Date(t),
      open:num(x.open), high:num(x.high),
      low:num(x.low), close:num(x.close),
      volume:num(x.volume || 0)
    };
  }).filter(x =>
    !Number.isNaN(x.time.getTime()) &&
    [x.open,x.high,x.low,x.close].every(Number.isFinite)
  ).sort((a,b)=>a.time-b.time);
}

function ema(values, period) {
  const k = 2/(period+1);
  const out = Array(values.length).fill(NaN);
  let prev = NaN;
  for (let i=0;i<values.length;i++) {
    if (!Number.isFinite(values[i])) continue;
    prev = Number.isFinite(prev) ? values[i]*k + prev*(1-k) : values[i];
    out[i] = prev;
  }
  return out;
}

function sma(values, period, i) {
  if (i < period-1) return NaN;
  let s=0;
  for(let j=i-period+1;j<=i;j++) s += values[j];
  return s/period;
}

function std(values, period, i, mean) {
  if (i < period-1) return NaN;
  let s=0;
  for(let j=i-period+1;j<=i;j++) s += (values[j]-mean)**2;
  return Math.sqrt(s/period);
}

function rsi(values, period=14) {
  const out=Array(values.length).fill(NaN);
  let gain=0, loss=0;
  for(let i=1;i<values.length;i++) {
    const d=values[i]-values[i-1];
    const g=Math.max(d,0), l=Math.max(-d,0);
    if(i<=period){ gain+=g; loss+=l; if(i===period) out[i]=loss===0?100:100-100/(1+gain/loss); }
    else {
      gain=(gain*(period-1)+g)/period;
      loss=(loss*(period-1)+l)/period;
      out[i]=loss===0?100:100-100/(1+gain/loss);
    }
  }
  return out;
}

function body(r){ return Math.abs(r.close-r.open); }
function upper(r){ return r.high-Math.max(r.open,r.close); }
function lower(r){ return Math.min(r.open,r.close)-r.low; }

function bullishPin(r) {
  const b=Math.max(body(r),1e-12);
  return r.close>r.open && lower(r)>=2*b && upper(r)<=1.2*b;
}
function bearishPin(r) {
  const b=Math.max(body(r),1e-12);
  return r.close<r.open && upper(r)>=2*b && lower(r)<=1.2*b;
}
function bullishEngulf(p,r) {
  return p.close<p.open && r.close>r.open &&
    r.open<=p.close && r.close>=p.open;
}
function bearishEngulf(p,r) {
  return p.close>p.open && r.close<r.open &&
    r.open>=p.close && r.close<=p.open;
}

export function analyze(asset, candles, minScore=4) {
  if (candles.length < 220) return null;

  const closes=candles.map(x=>x.close);
  const e50=ema(closes,50), e200=ema(closes,200), rs=rsi(closes,14);
  const i=candles.length-1, p=i-1, p3=i-3;

  const mid=sma(closes,20,i);
  const sd=std(closes,20,i,mid);
  const upperBB=mid+2*sd, lowerBB=mid-2*sd;

  let support=Infinity, resistance=-Infinity;
  for(let j=Math.max(0,i-20);j<i;j++){
    support=Math.min(support,candles[j].low);
    resistance=Math.max(resistance,candles[j].high);
  }

  const r=candles[i], prev=candles[p];
  const tol=Math.max((r.high-r.low)*0.75,r.close*0.0003);
  const mom3=r.close-closes[p3];

  let bull=0, bear=0, br=[], sr=[];
  if(e50[i]>e200[i] && e50[i]>e50[p]) {bull++;br.push("EMA50>EMA200 + rising");}
  if(e50[i]<e200[i] && e50[i]<e50[p]) {bear++;sr.push("EMA50<EMA200 + falling");}

  if(rs[p]<=40 && rs[i]>rs[p]) {bull++;br.push(`RSI recovery ${rs[i].toFixed(1)}`);}
  else if(rs[i]<50 && rs[i]>rs[p]) {bull++;br.push(`RSI rising ${rs[i].toFixed(1)}`);}
  if(rs[p]>=60 && rs[i]<rs[p]) {bear++;sr.push(`RSI rejection ${rs[i].toFixed(1)}`);}
  else if(rs[i]>50 && rs[i]<rs[p]) {bear++;sr.push(`RSI falling ${rs[i].toFixed(1)}`);}

  if(r.close<=lowerBB || (r.close<mid && r.close>prev.close)){
    bull++; br.push("BB lower/recovery");
  }
  if(r.close>=upperBB || (r.close>mid && r.close<prev.close)){
    bear++; sr.push("BB upper/rejection");
  }

  if(Math.abs(r.close-support)<=tol || r.low<=support+tol){
    bull++; br.push("near support");
  }
  if(Math.abs(r.close-resistance)<=tol || r.high>=resistance-tol){
    bear++; sr.push("near resistance");
  }

  const bp=bullishPin(r)||bullishEngulf(prev,r);
  const sp=bearishPin(r)||bearishEngulf(prev,r);

  if(bp){bull++; br.push(mom3>0?"bullish PA + momentum":"bullish Pin/Engulfing");}
  if(sp){bear++; sr.push(mom3<0?"bearish PA + momentum":"bearish Pin/Engulfing");}

  if(bull>=minScore && bull>bear){
    return makeSignal(asset,"CALL",bull,r,br);
  }
  if(bear>=minScore && bear>bull){
    return makeSignal(asset,"PUT",bear,r,sr);
  }
  return null;
}

function makeSignal(asset,direction,score,r,reasons){
  const entry=new Date(r.time.getTime()+60000);
  return {
    asset,direction,score,
    signalTime:r.time.toISOString(),
    entryTime:entry.toISOString(),
    entryPrice:r.close,
    reasons
  };
}

export function candleKey(iso){
  return new Date(iso).toISOString().slice(0,16);
}

export function formatSignal(sig, tz="Asia/Jakarta"){
  const fmt = new Intl.DateTimeFormat("en-GB",{
    timeZone:tz,hour:"2-digit",minute:"2-digit",hour12:false
  });
  const d = sig.direction==="CALL"?"🟢":"🔴";
  return `${d} <b>NEW FUTURE SIGNAL</b>

🌐 Asset: <b>${escapeHtml(sig.asset)}</b>
🕐 TF: M1
⏰ Entry: <b>${fmt.format(new Date(sig.entryTime))}</b>
📌 Direction: <b>${sig.direction}</b>
📊 Confirmation: <b>${sig.score}/5</b>
💰 Reference close: ${sig.entryPrice}

${sig.reasons.map(x=>"🔎 "+escapeHtml(x)).join("\n")}

🔒 Candle: CLOSED
⚠️ Score is a rule-based filter, not a guarantee.`;
}

function escapeHtml(s){
  return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;")
    .replaceAll(">","&gt;").replaceAll('"',"&quot;");
}
