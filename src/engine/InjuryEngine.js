// src/engine/InjuryEngine.js
import { rngFor } from "../core/random.js";

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
const dateOnly=(value)=>String(value||"").slice(0,10);
function addDaysISO(iso,days){
  const [y,m,d]=dateOnly(iso).split("-").map(Number);
  const dt=new Date(Date.UTC(y||1970,(m||1)-1,d||1));
  dt.setUTCDate(dt.getUTCDate()+Number(days||0));
  return dt.toISOString().slice(0,10);
}
function effectiveYearRow(source,year){
  const rows=Array.isArray(source)?source:Object.values(source||{});
  const eligible=rows
    .filter((r)=>{
      const ry=Number(pick(r,["year","season_year"],NaN));
      return Number.isFinite(ry)&&ry<=year;
    })
    .sort((a,b)=>Number(pick(b,["year","season_year"],0))-Number(pick(a,["year","season_year"],0)));
  return eligible[0]||{};
}
function driverName(gs,driverId){
  const row=(gs?.drivers||[]).find((d)=>String(d?.driver_id??d?.id??"")===String(driverId));
  return row?.display_name||row?.name||String(driverId);
}
function currentAvailability(gs,driverId){
  const source=gs?.driverAvailability;
  if(Array.isArray(source)){
    return source.find((r)=>String(r?.driver_id??r?.id??"")===String(driverId))||null;
  }
  if(source&&typeof source==="object")return source[String(driverId)]||null;
  return null;
}
function availabilityMap(gs){
  const source=gs?.driverAvailability;
  if(Array.isArray(source)){
    return Object.fromEntries(source
      .map((row)=>[String(row?.driver_id??row?.id??""),row])
      .filter(([id])=>id));
  }
  return {...(source&&typeof source==="object"?source:{})};
}
function injuryProfile(rng,medicalResponse=0.6){
  const roll=rng.next();
  const recoveryFactor=clamp(1.18-Number(medicalResponse||0.6)*0.30,0.82,1.12);
  if(roll<0.62){
    const days=Math.max(2,Math.round(rng.int(3,7)*recoveryFactor));
    return {severity:"minor",days,reasons:["bruising","wrist sprain","neck strain","minor leg injury"]};
  }
  if(roll<0.90){
    const days=Math.max(6,Math.round(rng.int(8,21)*recoveryFactor));
    return {severity:"moderate",days,reasons:["concussion","rib injury","shoulder injury","hand injury"]};
  }
  const days=Math.max(18,Math.round(rng.int(22,60)*recoveryFactor));
  return {severity:"serious",days,reasons:["leg injury","arm injury","serious concussion","multiple injuries"]};
}

export function applyRaceInjuries(gs,{gp,race,forceInjuryProbability=null}={}){
  if(!gs||gs?.settings?.gameplay?.enableInjuryRandomEvents===false)return gs;
  const year=Number(gs?.activeYear)||Number(pick(gp,["year","season_year"],NaN))||1980;
  const accidentModel=effectiveYearRow(gs?.accidentModel??gs?.dbAccidentModel,year);
  const safety=effectiveYearRow(gs?.eraSafety??gs?.dbEraSafety,year);
  const modelProbability=clamp(Number(pick(accidentModel,["injury_prob"],0.01)),0,1);
  const injuryProbability=forceInjuryProbability==null?modelProbability:clamp(forceInjuryProbability,0,1);
  if(injuryProbability<=0)return gs;

  const gpId=String(pick(gp,["gp_id","id","track_id"],"gp"));
  const today=dateOnly(gs?.currentDateISO||pick(gp,["race_date","date","dateISO"],""));
  const rng=rngFor(gs, year+"-"+gpId+"-race-injuries");
  const availability=availabilityMap(gs);
  const messages=[];

  for(const row of race||[]){
    if(!row?.retired)continue;
    const reason=String(row?.retirement_reason||"").toLowerCase();
    if(!/accident|collision/.test(reason))continue;
    const driverId=String(row?.driver?.driver_id??row?.driver?.id??"");
    if(!driverId)continue;

    const existing=currentAvailability({...gs,driverAvailability:availability},driverId);
    if(existing&&String(existing.status||"").toLowerCase()==="injured"){
      const until=dateOnly(existing.expectedReturnDate||existing.expected_return_date);
      if(!until||!today||until>=today)continue;
    }

    if(rng.next()>=injuryProbability)continue;

    const medicalResponse=Number(pick(safety,["medical_response"],0.6));
    const profile=injuryProfile(rng,medicalResponse);
    const injuryReason=rng.pick(profile.reasons);
    const expectedReturnDate=today?addDaysISO(today,profile.days):null;
    const record={
      driver_id:driverId,
      status:"injured",
      reason:injuryReason,
      severity:profile.severity,
      unavailableFrom:today||null,
      expectedReturnDate,
      expectedDaysOut:profile.days,
      source:"race_incident",
      sourceEventId:gpId,
    };
    availability[driverId]=record;
    messages.push({
      id:"injury_"+gpId+"_"+driverId,
      date:today||gs?.currentDateISO,
      unread:true,
      type:"MEDICAL",
      from:"Team Medical",
      tag:"Driver Availability",
      subject:driverName(gs,driverId)+" ruled out",
      body:driverName(gs,driverId)+" sustained "+injuryReason+" and is expected to be unavailable for about "+profile.days+" day(s).",
      driver_id:driverId,
      availability:record,
    });
  }

  if(!messages.length)return gs;
  return {
    ...gs,
    driverAvailability:availability,
    inbox:[...messages,...(gs?.inbox||[])],
  };
}

export function refreshDriverAvailability(gs,dateISO=gs?.currentDateISO){
  if(!gs)return gs;
  const today=dateOnly(dateISO);
  if(!today)return gs;
  const availability=availabilityMap(gs);
  let changed=false;
  const messages=[];

  for(const [driverId,record] of Object.entries(availability)){
    const status=String(record?.status||"").toLowerCase();
    const returnDate=dateOnly(record?.expectedReturnDate||record?.expected_return_date);
    if(["","available","fit","active","cleared"].includes(status)||!returnDate||today<=returnDate)continue;

    availability[driverId]={
      ...record,
      status:"available",
      recoveredAt:today,
    };
    changed=true;
    if(status==="injured"||status==="injury"||status==="medical"){
      messages.push({
        id:"return_"+driverId+"_"+today,
        date:today,
        unread:true,
        type:"MEDICAL",
        from:"Team Medical",
        tag:"Driver Availability",
        subject:driverName(gs,driverId)+" cleared to race",
        body:driverName(gs,driverId)+" has completed recovery and is available for selection again.",
        driver_id:driverId,
      });
    }
  }

  if(!changed)return gs;
  return {
    ...gs,
    driverAvailability:availability,
    inbox:[...messages,...(gs?.inbox||[])],
  };
}
