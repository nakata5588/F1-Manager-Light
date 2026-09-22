// src/engine/WeekendWeatherEngine.js
// RW4.3 — persistent weekend meteorology, forecast uncertainty and track evolution.

import { rngFor } from "../core/random.js";

const clamp=(v,min=0,max=100)=>Math.max(min,Math.min(max,Number(v)||0));
const num=(v,fb=0)=>{const n=Number(v);return Number.isFinite(n)?n:fb;};
const staffId=(r)=>String(r?.staff_id??r?.person_id??r?.id??"");
const teamId=(r)=>String(r?.team_id??r?.team??r?.constructor_id??"");
const lower=(v)=>String(v??"").toLowerCase();

const RAIN={SUNNY:0,CLOUDY:0,WINDY:0,WETTING:0.28,LIGHT_RAIN:0.46,HEAVY_RAIN:0.80,STORM:1,DRYING:0.08};

function kindOf(s){
  const t=lower(s?.type??s?.id);
  if(t==="practice"||t.includes("practice"))return "practice";
  if(t==="race"||t.includes("race"))return "race";
  if(t.includes("qualifying")||t.includes("prequal"))return "qualifying";
  return null;
}
function keyOf(s,i){return String(s?.id??s?.session_id??((kindOf(s)||"session")+"_"+(i+1)));}
function isoOf(s,gp){return String(s?.dateISO??s?.date??gp?.race_date??gp?.dateISO??"").slice(0,10);}
function dayGap(a,b){
  const aa=Date.parse(String(a||"")+"T00:00:00Z"),bb=Date.parse(String(b||"")+"T00:00:00Z");
  return Number.isFinite(aa)&&Number.isFinite(bb)?Math.max(0,Math.round((bb-aa)/86400000)):0;
}
function profile(gs,gp){
  const tid=String(gp?.track_id??gs?.raceWeekendState?.track_id??"");
  const date=String(gp?.race_date??gp?.dateISO??gp?.date??gs?.currentDateISO??"");
  const month=Number(date.slice(5,7));
  const rows=gs?.dbWeatherProfiles||gs?.weatherProfiles||[];
  return rows.find(r=>String(r?.track_id??"")===tid&&Number(r?.month)===month)
    ||rows.find(r=>String(r?.track_id??"")===tid)||{};
}
function eraBase(year){
  if(year<=1989)return 0.54;
  if(year<=1999)return 0.62;
  if(year<=2009)return 0.72;
  if(year<=2019)return 0.82;
  return 0.88;
}
function activeStaff(gs,tid){
  const year=Number(gs?.activeYear);
  const rows=gs?.staffContracts?.length?gs.staffContracts:(gs?.dbStaffContracts||[]);
  return rows.filter(r=>{
    if(teamId(r)!==String(tid))return false;
    const start=num(r?.contract_start??r?.contract_start_year??r?.start_year??r?.year,-Infinity);
    const end=num(r?.contract_until??r?.contract_until_year??r?.end_year??r?.year,Infinity);
    return year>=start&&year<=end&&!["terminated","expired","inactive"].includes(lower(r?.status??"active"));
  });
}
function staffRating(gs,id){
  const rows=gs?.staffRatings?.length?gs.staffRatings:(gs?.dbStaffRatings||[]);
  return rows.find(r=>staffId(r)===String(id))||{};
}
function opsLevel(gs,tid){
  const player=String(gs?.team?.team_id??gs?.team?.id??"");
  const override=player===String(tid)?Number(gs?.hq?.facilityLevels?.pitcrew_training_level):NaN;
  if(Number.isFinite(override))return clamp(override,1,10);
  const year=Number(gs?.activeYear);
  const row=(gs?.facilities||gs?.dbFacilities||[]).find(r=>teamId(r)===String(tid)&&(!Number.isFinite(Number(r?.year))||Number(r?.year)===year))||{};
  return clamp(num(row?.pitcrew_training_level,5),1,10);
}
export function forecastAccuracyForTeam(gs,tid){
  const year=Number(gs?.activeYear)||1980;
  const scored=activeStaff(gs,tid).map(c=>{
    const r=staffRating(gs,staffId(c));
    const role=lower(c?.role??c?.position);
    const w=/strateg|engineer|technical/.test(role)?1:/principal/.test(role)?0.45:0.60;
    return {w,score:num(r?.data_analysis,50)*0.58+num(r?.communication,50)*0.24+num(r?.technical,50)*0.18};
  }).sort((a,b)=>b.score*b.w-a.score*a.w).slice(0,3);
  const staffScore=scored.length?scored.reduce((s,x)=>s+x.score*x.w,0)/scored.reduce((s,x)=>s+x.w,0):50;
  const capability=(staffScore-50)*0.0022+(opsLevel(gs,tid)-5)*0.008;
  const cap=year<=1989?0.68:year<=1999?0.76:year<=2009?0.86:0.95;
  return Number(Math.min(cap,Math.max(0.42,eraBase(year)+capability)).toFixed(3));
}
function nextState(rng,prev,rainChance,stormChance,wind){
  const p=String(prev||"CLOUDY");
  const carry=/RAIN|WETTING|STORM/.test(p)?14:p==="DRYING"?6:0;
  const roll=rng.next()*100;
  if(roll<stormChance+(p==="STORM"?7:0))return "STORM";
  if(roll<rainChance+carry){
    if(p==="HEAVY_RAIN"&&rng.next()<0.48)return "HEAVY_RAIN";
    if(p==="STORM"&&rng.next()<0.58)return "HEAVY_RAIN";
    if(["LIGHT_RAIN","WETTING"].includes(p)&&rng.next()<0.52)return "LIGHT_RAIN";
    return rng.next()<0.28?"HEAVY_RAIN":rng.next()<0.48?"WETTING":"LIGHT_RAIN";
  }
  if(/RAIN|STORM|WETTING/.test(p)&&rng.next()<0.68)return "DRYING";
  if(lower(wind)==="high"&&rng.next()<0.34)return "WINDY";
  return rng.next()<0.46?"CLOUDY":"SUNNY";
}
function segments(rng,state){
  if(state==="WETTING")return [
    {from_pct:0,to_pct:0.34,state:"CLOUDY"},
    {from_pct:0.34,to_pct:1,state:rng.next()<0.20?"HEAVY_RAIN":"LIGHT_RAIN"},
  ];
  if(state==="DRYING")return [
    {from_pct:0,to_pct:0.52,state:"LIGHT_RAIN"},
    {from_pct:0.52,to_pct:1,state:"DRYING"},
  ];
  if(state==="LIGHT_RAIN"&&rng.next()<0.28)return [
    {from_pct:0,to_pct:0.58,state:"LIGHT_RAIN"},
    {from_pct:0.58,to_pct:1,state:"DRYING"},
  ];
  return [{from_pct:0,to_pct:1,state}];
}
function wetTarget(state){
  return {SUNNY:0,CLOUDY:0,WINDY:0,DRYING:0.16,WETTING:0.42,LIGHT_RAIN:0.60,HEAVY_RAIN:0.88,STORM:1}[String(state)]??0;
}
function evolveTrack(prevWet,prevRubber,state,kind,gapDays){
  let start=num(prevWet,0);
  if(gapDays>0&&!/RAIN|STORM|WETTING/.test(state))start*=Math.pow(0.32,gapDays);
  const target=wetTarget(state);
  const rate=target>start?0.72:0.46;
  const end=clamp(start+(target-start)*rate,0,1);
  let rubber=Math.max(0,num(prevRubber,12)-Math.max(start,end)*22);
  if(kind==="practice"&&end<0.20)rubber+=8;
  else if(kind==="qualifying"&&end<0.20)rubber+=10;
  else if(kind==="race"&&end<0.20)rubber+=16;
  rubber=clamp(rubber,0,100);
  return {
    start_wetness:Number(start.toFixed(3)),
    end_wetness:Number(end.toFixed(3)),
    rubber_level:Number(rubber.toFixed(1)),
    grip_index:Number(clamp(88+rubber*0.10-end*28,45,100).toFixed(1)),
  };
}
function trackTemp(air,state){
  const d=state==="SUNNY"?12:state==="CLOUDY"?6:state==="WINDY"?5:/RAIN|STORM|WETTING/.test(state)?1:4;
  return Number((air+d).toFixed(1));
}
function actualSession(gs,gp,s,index,previous){
  const year=Number(gs?.activeYear)||Number(gp?.year)||1980;
  const p=profile(gs,gp);
  const gid=String(gp?.gp_id??gp?.id??gp?.track_id??"gp");
  const key=keyOf(s,index);
  const rng=rngFor(gs,year+"-"+gid+"-rw4.3-actual-"+key);
  const rainChance=clamp(num(p?.rain_chance,18),0,100);
  const stormChance=clamp(num(p?.storm_chance,3),0,100);
  const state=nextState(rng,previous?.state,rainChance,stormChance,p?.wind_profile);
  const air=Number((num(p?.avg_temp,22)+(rng.next()-0.5)*5.5+(state==="SUNNY"?1.5:/RAIN|STORM/.test(state)?-2:0)).toFixed(1));
  const gap=previous?dayGap(previous.dateISO,isoOf(s,gp)):0;
  const track=evolveTrack(previous?.track?.end_wetness,previous?.track?.rubber_level,state,kindOf(s),gap);
  return {
    id:key,kind:kindOf(s),label:s?.label||key,dateISO:isoOf(s,gp),state,
    segments:segments(rng,state),
    air_temp_c:air,track_temp_c:trackTemp(air,state),
    rain_intensity:Number(num(RAIN[state],0).toFixed(2)),
    rain_chance_profile_pct:rainChance,storm_chance_profile_pct:stormChance,
    wind_profile:p?.wind_profile||"medium",track,
  };
}
function family(state){
  if(["HEAVY_RAIN","STORM"].includes(String(state)))return "wet";
  if(["WETTING","LIGHT_RAIN","DRYING"].includes(String(state)))return "mixed";
  return "dry";
}
function rainObserved(state){
  return ["WETTING","LIGHT_RAIN","HEAVY_RAIN","STORM"].includes(String(state||"").toUpperCase());
}
function firstRainTransition(actual){
  const rows=(actual?.segments||[]).slice().sort((a,b)=>num(a?.from_pct)-num(b?.from_pct));
  if(rows.length<2)return null;
  let previous=rainObserved(rows[0]?.state);
  for(let index=1;index<rows.length;index+=1){
    const current=rainObserved(rows[index]?.state);
    if(current!==previous){
      return {
        direction:current?"arrival":"easing",
        pct:clamp(num(rows[index]?.from_pct,0),0,1),
      };
    }
    previous=current;
  }
  return null;
}
function forecastTimingModel(gs,gp,actual,tid,revision,predicted,accuracy){
  const gpId=String(gp?.gp_id??gp?.track_id??"gp");
  const rng=rngFor(gs,`${gpId}-rw4.6.1-team-forecast-timing-${tid}-${actual?.id||"session"}-r${revision}`);
  const predictedState=String(predicted||"SUNNY").toUpperCase();
  const transition=firstRainTransition(actual);
  const uncertaintyPct=Number(clamp(0.03+(1-accuracy)*0.16,0.025,0.15).toFixed(3));
  const maxTimingErrorPct=Number(clamp(0.015+(1-accuracy)*0.28,0.015,0.22).toFixed(3));
  const predictedWet=rainObserved(predictedState);
  const mode=predictedState==="DRYING"
    ?"rain_easing"
    :predictedState==="WETTING"
      ?"rain_arrival"
      :predictedWet
        ?"rain_from_start"
        :"dry_stable";

  if(["rain_arrival","rain_easing"].includes(mode)){
    const wantedDirection=mode==="rain_arrival"?"arrival":"easing";
    const canTrackActual=transition?.direction===wantedDirection;
    const centreBase=canTrackActual
      ?transition.pct
      :mode==="rain_arrival"
        ?0.18+rng.next()*0.48
        :0.22+rng.next()*0.44;
    const error=canTrackActual?(rng.next()-0.5)*2*maxTimingErrorPct:0;
    const centre=clamp(centreBase+error,0.03,0.96);
    return {
      mode,
      estimated_transition_pct:Number(centre.toFixed(3)),
      window_low_pct:Number(clamp(centre-uncertaintyPct,0.01,0.98).toFixed(3)),
      window_high_pct:Number(clamp(centre+uncertaintyPct,0.02,0.99).toFixed(3)),
      uncertainty_pct:uncertaintyPct,
      max_timing_error_pct:maxTimingErrorPct,
      source:"team_forecast_model",
    };
  }

  const horizonPct=clamp(
    0.10+accuracy*0.30+(rng.next()-0.5)*(1-accuracy)*0.08,
    0.08,
    0.46
  );
  return {
    mode,
    horizon_pct:Number(horizonPct.toFixed(3)),
    uncertainty_pct:uncertaintyPct,
    max_timing_error_pct:maxTimingErrorPct,
    source:"team_forecast_model",
  };
}
function noisyState(rng,actual,accuracy){
  if(rng.next()<accuracy)return actual;
  const f=family(actual);
  if(f==="wet")return rng.pick(["LIGHT_RAIN","WETTING","CLOUDY"]);
  if(f==="mixed")return rng.pick(["CLOUDY","LIGHT_RAIN","HEAVY_RAIN","DRYING"]);
  return rng.pick(["SUNNY","CLOUDY","WINDY","WETTING"]);
}
function forecastOne(gs,gp,actual,tid,index,revision){
  const base=forecastAccuracyForTeam(gs,tid);
  const boost=Math.min(0.12,index===0?0.11:index===1?0.06:0.02)+Math.min(0.10,revision*0.035);
  const accuracy=clamp(base+boost,0.35,0.97);
  const rng=rngFor(gs,String(gp?.gp_id??gp?.track_id??"gp")+"-rw4.3-forecast-"+tid+"-"+actual.id+"-r"+revision);
  const predicted=noisyState(rng,actual.state,accuracy);
  const actualRain=family(actual.state)==="dry"?actual.rain_chance_profile_pct*0.45:family(actual.state)==="mixed"?Math.max(35,actual.rain_chance_profile_pct):Math.max(70,actual.rain_chance_profile_pct);
  const uncertainty=(1-accuracy)*42;
  return {
    session_id:actual.id,predicted_state:predicted,
    rain_chance_pct:Math.round(clamp(actualRain+(rng.next()-0.5)*uncertainty*2,0,100)),
    air_temp_c:Number((actual.air_temp_c+(rng.next()-0.5)*(1-accuracy)*12).toFixed(1)),
    temperature_range_c:Number(Math.max(1.5,(1-accuracy)*9).toFixed(1)),
    confidence_pct:Math.round(accuracy*100),
    forecast_revision:Number(revision)||0,
    timing:forecastTimingModel(gs,gp,actual,tid,revision,predicted,accuracy),
    source:"team_forecast",
  };
}
export function createWeekendWeatherState(gs,{gp={},sessions=[]}={}){
  const player=String(gs?.team?.team_id??gs?.team?.id??"");
  const relevant=(sessions||[]).filter(s=>kindOf(s));
  const actual={};
  let previous=null;
  relevant.forEach((s,index)=>{const row=actualSession(gs,gp,s,index,previous);actual[row.id]=row;previous=row;});
  const forecast={};
  Object.values(actual).forEach((row,index)=>{forecast[row.id]=forecastOne(gs,gp,row,player,index,0);});
  return {
    version:1,year:Number(gs?.activeYear)||Number(gp?.year)||1980,source:"weekend_weather_world",
    forecast_team_id:player,forecast_accuracy:forecastAccuracyForTeam(gs,player),
    forecast_revision:0,observed_sessions:[],sessions:actual,forecast,
  };
}
export function weekendWeatherSession(gs,sessionId){
  const w=gs?.raceWeekendState?.weekend_weather;
  if(!w)return null;
  const id=String(sessionId??gs?.raceWeekendState?.active_session_id??"");
  return w.sessions?.[id]||null;
}
export function raceWeekendWeatherSession(gs){
  return Object.values(gs?.raceWeekendState?.weekend_weather?.sessions||{}).find(r=>r?.kind==="race")||null;
}
export function observeWeekendWeatherSession(gs,sessionId){
  const weekend=gs?.raceWeekendState,w=weekend?.weekend_weather,id=String(sessionId||"");
  if(!weekend||!w||!w.sessions?.[id])return gs;
  const observed=[...new Set([...(w.observed_sessions||[]),id])];
  const revision=Number(w.forecast_revision||0)+1;
  const player=String(gs?.team?.team_id??gs?.team?.id??"");
  const rows=Object.values(w.sessions||{});
  const completed=rows.findIndex(r=>String(r.id)===id);
  const forecast={...w.forecast};
  rows.forEach((row,index)=>{
    if(index<=completed)return;
    forecast[row.id]=forecastOne(gs,{gp_id:weekend.gp_id,track_id:weekend.track_id},row,player,Math.max(0,index-completed-1),revision);
  });
  return {...gs,raceWeekendState:{...weekend,weekend_weather:{...w,observed_sessions:observed,forecast_revision:revision,forecast}}};
}
function raceForecastRow(weather){
  const rows=Object.values(weather?.forecast||{});
  return rows.find((row)=>String(row?.session_id||"").toLowerCase()==="race")
    ||weather?.forecast?.race
    ||null;
}
function fallbackForecastTiming(gs,weather,forecast){
  const confidence=clamp(num(forecast?.confidence_pct,num(weather?.forecast_accuracy,0.55)*100)/100,0.35,0.97);
  const revision=Number(weather?.forecast_revision??forecast?.forecast_revision??0)||0;
  const rng=rngFor(gs,`rw4.6.1-team-forecast-fallback-r${revision}-${forecast?.session_id||"race"}`);
  const state=String(forecast?.predicted_state||"SUNNY").toUpperCase();
  const uncertaintyPct=Number(clamp(0.03+(1-confidence)*0.16,0.025,0.15).toFixed(3));
  if(state==="WETTING"||state==="DRYING"){
    const centre=state==="WETTING"?0.20+rng.next()*0.42:0.24+rng.next()*0.40;
    return {
      mode:state==="WETTING"?"rain_arrival":"rain_easing",
      estimated_transition_pct:Number(centre.toFixed(3)),
      window_low_pct:Number(clamp(centre-uncertaintyPct,0.01,0.98).toFixed(3)),
      window_high_pct:Number(clamp(centre+uncertaintyPct,0.02,0.99).toFixed(3)),
      uncertainty_pct:uncertaintyPct,
      source:"team_forecast_fallback",
    };
  }
  return {
    mode:rainObserved(state)?"rain_from_start":"dry_stable",
    horizon_pct:Number(clamp(0.10+confidence*0.30,0.08,0.46).toFixed(3)),
    uncertainty_pct:uncertaintyPct,
    source:"team_forecast_fallback",
  };
}
export function teamRaceForecast(gs,{currentLap=0,currentWeather=null,totalLaps=null}={}){
  const weather=gs?.raceWeekendState?.weekend_weather;
  const forecast=raceForecastRow(weather);
  if(!weather||!forecast){
    return {
      message:"Team forecast unavailable.",
      confidence_pct:null,
      predicted_state:null,
      timing:null,
      source:"unavailable",
    };
  }

  const timing=forecast.timing||fallbackForecastTiming(gs,weather,forecast);
  const total=Math.max(1,Math.round(num(totalLaps,gs?.raceWeekendState?.race_strategy?.track_snapshot?.laps??1)));
  const lap=Math.max(0,Math.min(total,Math.round(num(currentLap,0))));
  const hasObservation=currentWeather!==null&&currentWeather!==undefined&&String(currentWeather)!=="";
  const observed=String(currentWeather||"").toUpperCase();
  const observedWet=rainObserved(observed);
  const observedEasing=observed==="DRYING";
  const confidence=Math.round(clamp(num(forecast?.confidence_pct,num(weather?.forecast_accuracy,0.55)*100),0,100));
  const capability=clamp(num(weather?.forecast_accuracy,confidence/100),0.35,0.97);
  const revision=Number(weather?.forecast_revision??forecast?.forecast_revision??0)||0;
  const remaining=Math.max(1,total-lap);
  const adaptiveLookahead=Math.max(
    1,
    Math.min(remaining,Math.round(4+capability*8+Math.min(4,revision)))
  );
  const relativeWindow=()=>{
    if(!Number.isFinite(Number(timing?.window_low_pct))||!Number.isFinite(Number(timing?.window_high_pct)))return null;
    const rawLow=Math.round(Number(timing.window_low_pct)*total)-lap;
    const rawHigh=Math.round(Number(timing.window_high_pct)*total)-lap;
    if(rawHigh<=0)return {passed:true,low:0,high:0};
    return {
      passed:false,
      low:Math.max(1,rawLow),
      high:Math.max(Math.max(1,rawLow),rawHigh),
    };
  };

  let message;
  if(!hasObservation&&timing.mode==="rain_from_start"){
    message="Rain possible from the opening laps.";
  }else if(observedEasing){
    message=`Rain is easing; conditions may continue improving over the next ${adaptiveLookahead} laps.`;
  }else if(observedWet){
    if(timing.mode==="rain_easing"){
      const window=relativeWindow();
      message=window&&!window.passed
        ?`Rain may ease in approximately ${window.low}–${window.high} laps.`
        :`Rain may ease soon, but timing remains uncertain.`;
    }else{
      message=`Rain may persist for at least ${adaptiveLookahead} laps.`;
    }
  }else if(timing.mode==="rain_arrival"){
    const window=relativeWindow();
    message=window&&!window.passed
      ?`Rain possible in approximately ${window.low}–${window.high} laps.`
      :`Rain remains possible within the next ${adaptiveLookahead} laps.`;
  }else if(hasObservation&&timing.mode==="rain_from_start"){
    message=`Rain remains possible within the next ${adaptiveLookahead} laps.`;
  }else{
    message=`No significant rain expected in the next ${adaptiveLookahead} laps.`;
  }

  return {
    message,
    confidence_pct:confidence,
    predicted_state:forecast.predicted_state||null,
    rain_chance_pct:num(forecast.rain_chance_pct,0),
    forecast_revision:revision,
    forecast_accuracy:Number(capability.toFixed(3)),
    timing:{...timing},
    source:"weekend_weather.forecast",
  };
}

export function sessionWeatherIsWet(s){return family(s?.state)!=="dry"||num(s?.track?.start_wetness,0)>=0.18;}
export function sessionWeatherPerformanceMultiplier(s){
  if(!s)return 1;
  const wet=num(s?.track?.end_wetness,0),grip=num(s?.track?.grip_index,88),state=String(s?.state||"SUNNY");
  const weather=state==="STORM"?0.88:state==="HEAVY_RAIN"?0.91:["LIGHT_RAIN","WETTING"].includes(state)?0.95:state==="DRYING"?0.97:1;
  return Number(clamp(weather*(0.94+grip/100*0.06)*(1-wet*0.03),0.82,1.02).toFixed(4));
}
export function weatherSimilarity(a,b){
  if(!a||!b)return 0.75;
  const familyScore=family(a.state)===family(b.state)?1:0.55;
  const wetDelta=Math.abs(num(a?.track?.end_wetness,0)-num(b?.track?.start_wetness,0));
  const tempDelta=Math.abs(num(a?.track_temp_c,25)-num(b?.track_temp_c,25));
  return Number(clamp(familyScore-wetDelta*0.25-tempDelta*0.008,0.35,1).toFixed(3));
}
