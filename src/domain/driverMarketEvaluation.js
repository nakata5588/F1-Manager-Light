// src/domain/driverMarketEvaluation.js
const unwrap=(v)=>{
  if(v&&typeof v==="object"&&!Array.isArray(v)){
    if(v.result!==undefined&&v.result!==null&&v.result!=="")return unwrap(v.result);
    if(v.value!==undefined&&v.value!==null&&v.value!=="")return unwrap(v.value);
  }
  return v;
};
const pick=(o,keys,fb=undefined)=>{
  for(const k of keys){
    const v=unwrap(o?.[k]);
    if(v!==undefined&&v!==null&&v!=="")return v;
  }
  return fb;
};
const clamp=(n,min,max)=>Math.max(min,Math.min(max,Number(n)||0));
const asRows=(value)=>{
  const raw=unwrap(value);
  if(Array.isArray(raw))return raw;
  if(!raw||typeof raw!=="object")return [];
  for(const key of ["items","rows","list","data"])if(Array.isArray(raw[key]))return raw[key];
  return Object.values(raw).filter((row)=>row&&typeof row==="object"&&!Array.isArray(row));
};
const driverIdOf=(row)=>String(pick(row,["driver_id","person_id","id"],""));

function finiteValue(...values){
  for(const value of values){
    const n=Number(unwrap(value));
    if(Number.isFinite(n))return n;
  }
  return null;
}
function weightedAverage(signals){
  const usable=signals.filter((s)=>Number.isFinite(s?.value)&&Number(s?.weight)>0);
  if(!usable.length)return null;
  const totalWeight=usable.reduce((sum,s)=>sum+Number(s.weight),0);
  return usable.reduce((sum,s)=>sum+Number(s.value)*Number(s.weight),0)/totalWeight;
}
function marketValueScore(value){
  const market=Number(value);
  if(!Number.isFinite(market)||market<=0)return null;
  const score=45+Math.log10(Math.max(1,market/100_000))*20;
  return clamp(score,35,90);
}
function careerSignal(gs,driverId){
  const year=Number(gs?.activeYear);
  const live=asRows(gs?.driverCareer);
  const rows=live.length?live:asRows(gs?.dbDriverCareer);
  const relevant=rows.filter((row)=>{
    if(driverIdOf(row)!==String(driverId))return false;
    const ry=Number(pick(row,["year","season_year"],NaN));
    return !Number.isFinite(year)||!Number.isFinite(ry)||ry<=year;
  });
  if(!relevant.length)return null;

  const f1=relevant.filter((row)=>String(pick(row,["series_division","series"],"")).toUpperCase()==="F1");
  const source=f1.length?f1:relevant;
  const starts=source.reduce((sum,row)=>sum+Math.max(0,Number(pick(row,["starts","races"],0))||0),0);
  const wins=source.reduce((sum,row)=>sum+Math.max(0,Number(pick(row,["wins"],0))||0),0);
  const podiums=source.reduce((sum,row)=>sum+Math.max(0,Number(pick(row,["podiums"],0))||0),0);

  if(!starts&&!wins&&!podiums)return null;

  const base=f1.length?50:44;
  const score=
    base+
    Math.log1p(starts)*(f1.length?5.0:3.2)+
    Math.min(12,wins*1.6)+
    Math.min(8,podiums*0.45);

  return {
    score:clamp(score,35,92),
    starts,
    wins,
    podiums,
    hasF1Experience:Boolean(f1.length),
  };
}

export function driverMarketEvaluation(gs,driverOrId){
  const id=typeof driverOrId==="object"
    ? driverIdOf(driverOrId)
    : String(driverOrId??"");
  const drivers=asRows(gs?.drivers).length?asRows(gs?.drivers):asRows(gs?.dbDrivers);
  const driver=typeof driverOrId==="object"
    ? driverOrId
    : drivers.find((row)=>driverIdOf(row)===id)||{};

  const ratings=asRows(gs?.driverRatings).length?asRows(gs?.driverRatings):asRows(gs?.dbDriverRatings);
  const rating=ratings.find((row)=>driverIdOf(row)===id)||{};

  const knownAttributes=[
    finiteValue(rating?.current_ability),
    finiteValue(rating?.overall),
    finiteValue(rating?.pace),
    finiteValue(rating?.racecraft),
    finiteValue(rating?.consistency),
    finiteValue(rating?.experience),
  ].filter(Number.isFinite);

  const attributeScore=knownAttributes.length
    ? knownAttributes.reduce((a,b)=>a+b,0)/knownAttributes.length
    : null;

  const reputation=finiteValue(rating?.reputation,driver?.reputation);
  const marketValue=finiteValue(rating?.market_value,driver?.market_value);
  const career=careerSignal(gs,id);

  const signals=[
    {name:"attributes",value:attributeScore,weight:0.55},
    {name:"reputation",value:reputation,weight:0.20},
    {name:"career",value:career?.score??null,weight:0.20},
    {name:"market_value",value:marketValueScore(marketValue),weight:0.05},
  ];
  const weighted=weightedAverage(signals);
  const score=Number((weighted==null?55:clamp(weighted,35,95)).toFixed(2));
  const availableSignals=signals.filter((s)=>Number.isFinite(s.value)).map((s)=>s.name);
  const confidence=Number((availableSignals.reduce((sum,name)=>{
    const signal=signals.find((s)=>s.name===name);
    return sum+Number(signal?.weight||0);
  },0)/signals.reduce((sum,s)=>sum+Number(s.weight),0)).toFixed(2));

  return {
    driver_id:id,
    score,
    confidence,
    data_quality:
      knownAttributes.length>=4?"full":
      knownAttributes.length>0||availableSignals.length>=2?"partial":
      availableSignals.length?"fallback":
      "unknown",
    known_attribute_count:knownAttributes.length,
    attribute_score:attributeScore==null?null:Number(attributeScore.toFixed(2)),
    reputation:reputation==null?null:Number(reputation),
    market_value:marketValue==null?null:Number(marketValue),
    career,
    signals:availableSignals,
  };
}

export function compareDriverMarketValue(gs,a,b){
  const ea=driverMarketEvaluation(gs,a);
  const eb=driverMarketEvaluation(gs,b);
  if(Math.abs(eb.score-ea.score)>0.0001)return eb.score-ea.score;
  if(Math.abs(eb.confidence-ea.confidence)>0.0001)return eb.confidence-ea.confidence;
  return driverIdOf(a).localeCompare(driverIdOf(b));
}
