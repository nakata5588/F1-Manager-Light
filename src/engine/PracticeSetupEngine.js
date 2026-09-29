// src/engine/PracticeSetupEngine.js
import { getSaveSeed } from "../core/random.js";
import { teamCarPerformance } from "../domain/carPerformance.js";
import { carReliabilityProfile } from "../domain/carReliability.js";
import { applyPracticeComponentWear, practiceWearSummary } from "../domain/componentWear.js";
import { driverCondition, fatiguePenalty } from "../domain/driverRating.js";
import { raceEngineerPreparationProfile } from "../domain/driverRelationshipConsequences.js";
import { appendDriverMentalStateLog } from "../domain/driverMentalState.js";
import { raceWeekendWeatherSession, weekendWeatherSession, weatherSimilarity } from "./WeekendWeatherEngine.js";
import { teamStaffCapability } from "../domain/staffPerformance.js";
import {
  PRACTICE_PROGRAMMES,
  practiceProgramme,
  simulateCanonicalPractice,
} from "../race2/core/PracticeSimulation.js";

export { PRACTICE_PROGRAMMES, practiceProgramme };

const clamp=(n,min=0,max=100)=>Math.max(min,Math.min(max,Number(n)||0));
const round1=(n)=>Math.round(Number(n||0)*10)/10;
const num=(v,fb=0)=>{const n=Number(v);return Number.isFinite(n)?n:fb;};
const pick=(o,keys,fb=undefined)=>{for(const k of keys){const v=o?.[k];if(v!==undefined&&v!==null&&v!=="")return v;}return fb;};
const driverIdOf=(o)=>String(pick(o,["driver_id","person_id","id"],""));

function currentTrack(gs,gp){
  const id=String(gp?.track_id??gs?.raceWeekendState?.track_id??"");
  const rows=(gs?.coreTracks?.length?gs.coreTracks:gs?.dbCoreTracks)||[];
  return rows.find((row)=>String(row?.track_id??row?.id??"")===id)||{};
}

function currentLayout(gs,gp){
  const id=String(gp?.track_id??gs?.raceWeekendState?.track_id??"");
  const year=Number(gs?.activeYear??gp?.year);
  const rows=gs?.trackLayoutByYear?.length?gs.trackLayoutByYear:(gs?.dbTrackLayoutByYear||[]);
  return rows.find((row)=>{
    if(String(row?.track_id??"")!==id)return false;
    const from=num(row?.year_from,-Infinity);
    const to=num(row?.year_to,Infinity);
    return year>=from&&year<=to;
  })||{};
}

function normalizedDemand(value,fb=50){
  const n=num(value,NaN);
  if(!Number.isFinite(n))return fb;
  return clamp(n<=1?n*100:n);
}

export function trackSetupProfile(gs,gp={},sessionWeather=null){
  const track=currentTrack(gs,gp);
  const layout=currentLayout(gs,gp);
  const crash=normalizedDemand(pick(track,["crash_risk"],50),50);
  const overtaking=normalizedDemand(pick(track,["overtaking_difficulty"],50),50);
  const tyreWear=normalizedDemand(pick(track,["tyre_wear"],50),50);
  const lapLength=num(pick(layout,["lap_length_km"],pick(track,["lap_length_km"],4.5)),4.5);

  const directAero=pick(track,["aero_dependency","downforce_dependency","aero_sensitivity"],null);
  const directTechnical=pick(track,["technicality","handling_dependency","mechanical_grip_demand"],null);
  const directPower=pick(track,["power_dependency","engine_dependency","power_sensitivity"],null);
  const directCooling=pick(track,["cooling_demand"],null);

  const wetness=clamp(num(sessionWeather?.track?.start_wetness,0)*100,0,100);
  const wetFactor=wetness/100;
  const target={
    aeroBalance:round1(clamp((directAero!=null
      ?normalizedDemand(directAero)
      :clamp(50+(overtaking-50)*0.30+(crash-50)*0.10,30,75))+wetFactor*8,25,85)),
    mechanicalGrip:round1(clamp((directTechnical!=null
      ?normalizedDemand(directTechnical)
      :clamp(50+(tyreWear-50)*0.22+(crash-50)*0.12,30,75))+wetFactor*13,25,90)),
    gearing:round1(clamp((directPower!=null
      ?normalizedDemand(directPower)
      :clamp(50+(lapLength-4.5)*5-(overtaking-50)*0.08,30,75))-wetFactor*7,25,80)),
    cooling:round1(clamp((directCooling!=null
      ?normalizedDemand(directCooling)
      :clamp(50+(tyreWear-50)*0.16+(crash-50)*0.06,35,70))-wetFactor*5,25,80)),
  };

  return {
    track_id:String(track?.track_id??gp?.track_id??""),
    track_name:track?.track_name||gp?.gp_name||gp?.name||"Circuit",
    source:"derived_gameplay_profile",
    inputs:{
      crash_risk:crash,
      overtaking_difficulty:overtaking,
      tyre_wear:tyreWear,
      lap_length_km:lapLength,
      weather_state:sessionWeather?.state||"UNKNOWN",
      track_wetness:round1(wetness),
      track_grip:round1(num(sessionWeather?.track?.grip_index,88)),
      track_temp_c:round1(num(sessionWeather?.track_temp_c,0)),
    },
    target,
  };
}

export function teamEngineeringSupport(gs,teamId){
  return teamStaffCapability(gs,teamId,"technical_program");
}

export function teamSetupSupport(gs,teamId){
  return teamStaffCapability(gs,teamId,"setup");
}

function ratingFor(gs,driverId){
  const rows=gs?.driverRatings||[];
  return rows.find((row)=>driverIdOf(row)===String(driverId))||{};
}

export function simulatePracticeSession(gs,{gp={},selections={}}={}){
  const weekend=gs?.raceWeekendState;
  if(!weekend||weekend.phase!=="practice")return {gameState:gs,practice:null};

  const sessionWeather=weekendWeatherSession(gs,"practice")||weekendWeatherSession(gs);
  const profile=trackSetupProfile(gs,gp,sessionWeather);
  const raceWeather=raceWeekendWeatherSession(gs);
  const qualifyingWeather=Object.values(gs?.raceWeekendState?.weekend_weather?.sessions||{})
    .find((row)=>row?.kind==="qualifying")||null;
  const raceRelevance=weatherSimilarity(sessionWeather,raceWeather);
  const qualifyingRelevance=weatherSimilarity(sessionWeather,qualifyingWeather);
  const weatherRisk=1+
    num(sessionWeather?.rain_intensity,0)*0.85+
    Math.max(0,62-num(sessionWeather?.track?.grip_index,62))*0.022;
  const weatherLearning=clamp(1-num(sessionWeather?.rain_intensity,0)*0.16,0.78,1);
  const playerTeamId=String(gs?.team?.team_id??gs?.team?.id??"");

  const entrants=(gs?.raceEntryState?.entries||[]).map((entry)=>{
    const driverId=String(entry?.driver_id??"");
    const teamId=String(entry?.team_id??"");
    if(!driverId||!teamId)return null;
    const engineering=teamSetupSupport(gs,teamId);
    return {
      driverId,
      teamId,
      isPlayerTeam:teamId===playerTeamId,
      requestedProgrammeId:selections?.[driverId]||"balanced",
      carReliabilityScore:num(teamCarPerformance(gs,teamId,driverId)?.reliability,75),
      rating:{...ratingFor(gs,driverId)},
      engineeringSupport:engineering,
      engineerRelationship:{...raceEngineerPreparationProfile(gs,driverId,{teamId})},
      conditionBefore:{...driverCondition(gs,driverId)},
      fatiguePerformancePenaltyBefore:fatiguePenalty(gs,driverId),
      reliabilityProfile:{...carReliabilityProfile(gs,teamId,driverId)},
    };
  }).filter(Boolean);

  const simulated=simulateCanonicalPractice({
    seed:getSaveSeed(gs),
    weekendKey:weekend.key,
    trackProfile:profile,
    sessionWeather:sessionWeather?{...sessionWeather}:null,
    trackRisk:profile.inputs.crash_risk,
    tyreWear:profile.inputs.tyre_wear,
    weatherRisk,
    weatherLearning,
    qualifyingRelevance,
    raceRelevance,
    entrants,
  });

  const conditionDict={...(gs?.driverAttributes||{})};
  let mentalStateLog={...(gs?.driverMentalStateLog||{})};
  const entrantByDriver=new Map(entrants.map((entry)=>[entry.driverId,entry]));

  for(const row of simulated.results){
    const driverId=String(row?.driver_id??"");
    const before=entrantByDriver.get(driverId)?.conditionBefore||driverCondition(gs,driverId);
    const after=simulated.effects?.conditionByDriver?.[driverId]||before;
    conditionDict[driverId]=after;
    mentalStateLog=appendDriverMentalStateLog(mentalStateLog,driverId,{
      before,
      after,
      source:"practice",
      reason:`${row.programme_label} practice`,
      dateISO:gs?.currentDateISO,
      meta:{
        programme:row.programme_id,
        setup_quality:row.setup_quality,
        setup_knowledge:row.setup_knowledge,
        preparation_gain:row.preparation_gain,
      },
    });
  }

  let next={...gs,driverAttributes:conditionDict,driverMentalStateLog:mentalStateLog};
  next=applyPracticeComponentWear(next,{practiceResults:simulated.results,gp});
  const enrichedResults=simulated.results.map((row)=>({
    ...row,
    component_wear:practiceWearSummary(next,{driverId:row.driver_id,gp}),
  }));

  const practice={
    completed_at:String(gs?.currentDateISO||"").slice(0,10),
    status:"completed",
    source:simulated.source,
    model:simulated.model,
    track_profile:profile,
    weather:sessionWeather?{...sessionWeather}:null,
    results:enrichedResults,
  };
  return {gameState:next,practice};
}

export function practiceResultForDriver(gs,driverId){
  return (gs?.raceWeekendState?.practice?.results||[]).find((row)=>String(row?.driver_id??"")===String(driverId))||null;
}
