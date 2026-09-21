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
const driverIdOf=(row)=>String(pick(row,["driver_id","person_id","id"],""));

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
  const source=(gs?.drivers||[]).length?gs.drivers:(gs?.dbDrivers||[]);
  const row=source.find((d)=>driverIdOf(d)===String(driverId));
  return row?.display_name||row?.name||String(driverId);
}
function currentAvailability(gs,driverId){
  const source=gs?.driverAvailability;
  if(Array.isArray(source)){
    return source.find((r)=>driverIdOf(r)===String(driverId))||null;
  }
  if(source&&typeof source==="object")return source[String(driverId)]||null;
  return null;
}
function availabilityMap(gs){
  const source=gs?.driverAvailability;
  if(Array.isArray(source)){
    return Object.fromEntries(source
      .map((row)=>[driverIdOf(row),row])
      .filter(([id])=>id));
  }
  return {...(source&&typeof source==="object"?source:{})};
}
function medicalHistory(gs){
  return Array.isArray(gs?.medicalHistory)?gs.medicalHistory.slice():[];
}
function severityLabel(row){
  const explicit=String(row?.incident_severity||"").toLowerCase();
  if(["low","medium","high","critical"].includes(explicit))return explicit;
  const score=Number(row?.incident_severity_score);
  if(Number.isFinite(score)){
    if(score>=0.96)return "critical";
    if(score>=0.82)return "high";
    if(score>=0.55)return "medium";
    return "low";
  }
  return "medium";
}
function severityFactor(label){
  if(label==="critical")return 3.2;
  if(label==="high")return 1.8;
  if(label==="medium")return 0.95;
  return 0.45;
}

export function healthOutcomeProbabilities(gs,row,{year=Number(gs?.activeYear)}={}){
  const accidentModel=effectiveYearRow(gs?.accidentModel??gs?.dbAccidentModel,year);
  const safety=effectiveYearRow(gs?.eraSafety??gs?.dbEraSafety,year);
  const baseInjury=clamp(Number(pick(accidentModel,["injury_prob"],0.01)),0,1);
  const baseFatality=clamp(Number(pick(accidentModel,["fatality_prob"],0)),0,1);
  const carSafety=clamp(Number(pick(safety,["car_safety"],0.5)),0,1);
  const eraSafety=clamp(Number(pick(safety,["era_safety_index"],0.42)),0,1);
  const medicalResponse=clamp(Number(pick(safety,["medical_response"],0.6)),0,1);
  const incidentSeverity=severityLabel(row);
  const severity=severityFactor(incidentSeverity);

  // Accident-model probabilities remain the era baseline. Safety values adjust
  // that baseline relative to the 1980 reference values instead of replacing it.
  const safetyFactor=clamp(
    1-(carSafety-0.50)*0.70-(eraSafety-0.42)*0.40,
    0.55,
    1.45
  );
  const medicalFatalityFactor=clamp(
    1-(medicalResponse-0.60)*0.80,
    0.50,
    1.40
  );

  return {
    incidentSeverity,
    severityFactor:severity,
    injuryProbability:clamp(baseInjury*severity*safetyFactor,0,0.45),
    fatalityProbability:clamp(baseFatality*severity*safetyFactor*medicalFatalityFactor,0,0.12),
    baseInjuryProbability:baseInjury,
    baseFatalityProbability:baseFatality,
    carSafety,
    eraSafety,
    medicalResponse,
  };
}

function injuryProfile(rng,{incidentSeverity,medicalResponse}){
  const recoveryFactor=clamp(1.18-Number(medicalResponse||0.6)*0.30,0.82,1.12);
  const roll=rng.next();
  let severity;
  let minDays;
  let maxDays;
  let reasons;

  if(incidentSeverity==="critical"){
    if(roll<0.28){
      severity="moderate"; minDays=14; maxDays=30;
      reasons=["concussion","rib injury","shoulder injury"];
    }else if(roll<0.78){
      severity="serious"; minDays=30; maxDays=75;
      reasons=["leg injury","arm injury","serious concussion","multiple injuries"];
    }else{
      severity="critical"; minDays=60; maxDays=150;
      reasons=["major leg injury","major spinal trauma","severe multiple injuries"];
    }
  }else if(incidentSeverity==="high"){
    if(roll<0.28){
      severity="minor"; minDays=5; maxDays=12;
      reasons=["wrist sprain","neck strain","bruising"];
    }else if(roll<0.78){
      severity="moderate"; minDays=10; maxDays=28;
      reasons=["concussion","rib injury","shoulder injury","hand injury"];
    }else{
      severity="serious"; minDays=24; maxDays=65;
      reasons=["leg injury","arm injury","serious concussion","multiple injuries"];
    }
  }else if(incidentSeverity==="medium"){
    if(roll<0.55){
      severity="minor"; minDays=3; maxDays=9;
      reasons=["bruising","wrist sprain","neck strain","minor leg injury"];
    }else if(roll<0.92){
      severity="moderate"; minDays=8; maxDays=21;
      reasons=["concussion","rib injury","shoulder injury","hand injury"];
    }else{
      severity="serious"; minDays=20; maxDays=45;
      reasons=["leg injury","arm injury","serious concussion"];
    }
  }else{
    if(roll<0.82){
      severity="minor"; minDays=2; maxDays=6;
      reasons=["bruising","wrist sprain","neck strain"];
    }else{
      severity="moderate"; minDays=6; maxDays=14;
      reasons=["concussion","rib injury","hand injury"];
    }
  }

  const days=Math.max(2,Math.round(rng.int(minDays,maxDays)*recoveryFactor));
  return {severity,days,reasons};
}

function terminateDriverCareer(gs,driverId,today,gpId){
  const drivers=(gs?.drivers||[]).map((driver)=>
    driverIdOf(driver)===String(driverId)
      ? {...driver,status:"deceased",canHireF1:false,death_date:today||driver?.death_date||null}
      : driver
  );
  const contracts=(gs?.contracts||[]).map((contract)=>{
    if(driverIdOf(contract)!==String(driverId))return contract;
    const status=String(contract?.status||"active").toLowerCase();
    if(["terminated","expired","released","bought_out","inactive","void"].includes(status))return contract;
    return {
      ...contract,
      status:"terminated",
      termination_reason:"fatality",
      terminated_at:today||null,
      source_event_id:gpId,
    };
  });
  return {...gs,drivers,contracts};
}

function medicalRecord({gpId,today,driverId,outcome,incidentSeverity,reason=null,severity=null,days=null,returnDate=null,probabilities}){
  return {
    id:"medical_"+gpId+"_"+driverId+"_"+outcome,
    gp_id:gpId,
    date:today||null,
    driver_id:String(driverId),
    outcome,
    incident_severity:incidentSeverity,
    injury_reason:reason,
    injury_severity:severity,
    expected_days_out:days,
    expected_return_date:returnDate,
    injury_probability:probabilities.injuryProbability,
    fatality_probability:probabilities.fatalityProbability,
  };
}

export function applyRaceHealthOutcomes(gs,{
  gp,
  race,
  forceInjuryProbability=null,
  forceFatalityProbability=null,
}={}){
  if(!gs||gs?.settings?.gameplay?.enableInjuryRandomEvents===false)return gs;
  const year=Number(gs?.activeYear)||Number(pick(gp,["year","season_year"],NaN))||1980;
  const gpId=String(pick(gp,["gp_id","id","track_id"],"gp"));
  const today=dateOnly(gs?.currentDateISO||pick(gp,["race_date","date","dateISO"],""));
  const rng=rngFor(gs,year+"-"+gpId+"-race-health");
  const availability=availabilityMap(gs);
  const history=medicalHistory(gs);
  const messages=[];
  let next=gs;
  let changed=false;

  for(const row of race||[]){
    if(!row?.retired)continue;
    const reason=String(row?.retirement_reason||"").toLowerCase();
    if(!/accident|collision/.test(reason))continue;
    const driverId=String(row?.driver?.driver_id??row?.driver?.id??"");
    if(!driverId)continue;

    const existing=currentAvailability({...next,driverAvailability:availability},driverId);
    const existingStatus=String(existing?.status||"").toLowerCase();
    if(existingStatus==="deceased")continue;
    if(existingStatus==="injured"){
      const until=dateOnly(existing?.expectedReturnDate||existing?.expected_return_date);
      if(!until||!today||until>today)continue;
    }

    const probabilities=healthOutcomeProbabilities(next,row,{year});
    const fatalityProbability=forceFatalityProbability==null
      ? probabilities.fatalityProbability
      : clamp(forceFatalityProbability,0,1);
    const injuryProbability=forceInjuryProbability==null
      ? probabilities.injuryProbability
      : clamp(forceInjuryProbability,0,1);

    const fatalityEnabled=next?.settings?.gameplay?.enableFatalities!==false;
    if(fatalityEnabled&&fatalityProbability>0&&rng.next()<fatalityProbability){
      const record={
        driver_id:driverId,
        status:"deceased",
        reason:"fatal race accident",
        severity:"fatal",
        unavailableFrom:today||null,
        expectedReturnDate:null,
        expectedDaysOut:null,
        source:"race_incident",
        sourceEventId:gpId,
        incidentSeverity:probabilities.incidentSeverity,
      };
      availability[driverId]=record;
      next=terminateDriverCareer(next,driverId,today,gpId);
      history.push(medicalRecord({
        gpId,today,driverId,outcome:"fatality",
        incidentSeverity:probabilities.incidentSeverity,
        reason:record.reason,severity:"fatal",probabilities,
      }));
      messages.push({
        id:"fatality_"+gpId+"_"+driverId,
        date:today||next?.currentDateISO,
        unread:true,
        type:"MEDICAL",
        from:"Race Medical",
        tag:"Driver Availability",
        subject:"Fatal accident — "+driverName(next,driverId),
        body:driverName(next,driverId)+" died following injuries sustained in the "+String(pick(gp,["gp_name","name"],"Grand Prix"))+".",
        driver_id:driverId,
        availability:record,
      });
      changed=true;
      continue;
    }

    if(injuryProbability<=0||rng.next()>=injuryProbability)continue;

    const profile=injuryProfile(rng,{
      incidentSeverity:probabilities.incidentSeverity,
      medicalResponse:probabilities.medicalResponse,
    });
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
      incidentSeverity:probabilities.incidentSeverity,
    };
    availability[driverId]=record;
    history.push(medicalRecord({
      gpId,today,driverId,outcome:"injury",
      incidentSeverity:probabilities.incidentSeverity,
      reason:injuryReason,severity:profile.severity,
      days:profile.days,returnDate:expectedReturnDate,probabilities,
    }));
    messages.push({
      id:"injury_"+gpId+"_"+driverId,
      date:today||next?.currentDateISO,
      unread:true,
      type:"MEDICAL",
      from:"Team Medical",
      tag:"Driver Availability",
      subject:driverName(next,driverId)+" ruled out",
      body:driverName(next,driverId)+" sustained "+injuryReason+" ("+profile.severity+") and is expected to be unavailable for about "+profile.days+" day(s).",
      driver_id:driverId,
      availability:record,
    });
    changed=true;
  }

  if(!changed)return gs;
  return {
    ...next,
    driverAvailability:availability,
    medicalHistory:history,
    inbox:[...messages,...(next?.inbox||[])],
  };
}

// Backwards-compatible alias used by older tests/imports.
export function applyRaceInjuries(gs,opts={}){
  return applyRaceHealthOutcomes(gs,opts);
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
    if(["deceased","retired","withdrawn"].includes(status))continue;
    const returnDate=dateOnly(record?.expectedReturnDate||record?.expected_return_date);
    if(["","available","fit","active","cleared"].includes(status)||!returnDate||today<returnDate)continue;

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
