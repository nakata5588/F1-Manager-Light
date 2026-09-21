// src/engine/PracticeSetupEngine.js
import { rngFor } from "../core/random.js";
import { teamCarPerformance } from "../domain/carPerformance.js";
import { applyPracticeComponentWear, practiceWearSummary } from "../domain/componentWear.js";
import { defaultDriverCondition, driverCondition, fatiguePenalty } from "../domain/driverRating.js";

const clamp=(n,min=0,max=100)=>Math.max(min,Math.min(max,Number(n)||0));
const round1=(n)=>Math.round(Number(n||0)*10)/10;
const num=(v,fb=0)=>{const n=Number(v);return Number.isFinite(n)?n:fb;};
const pick=(o,keys,fb=undefined)=>{for(const k of keys){const v=o?.[k];if(v!==undefined&&v!==null&&v!=="")return v;}return fb;};
const driverIdOf=(o)=>String(pick(o,["driver_id","person_id","id"],""));
const staffIdOf=(o)=>String(pick(o,["staff_id","person_id","id"],""));
const teamIdOf=(o)=>String(pick(o,["team_id","constructor_id","team","constructor"],""));

export const PRACTICE_PROGRAMMES=Object.freeze({
  balanced:Object.freeze({
    id:"balanced",
    label:"Balanced",
    description:"Evenly develops setup knowledge and race preparation.",
    mileageFactor:1.00,
    learningMultiplier:1.00,
    preparationGain:7,
    fatigue:7,
    wearFactor:1.00,
    incidentRisk:1.00,
    qualifyingBonus:0.25,
    raceBonus:0.25,
    reliabilityBonus:0.15,
  }),
  setup:Object.freeze({
    id:"setup",
    label:"Setup Focus",
    description:"Prioritises understanding the car and finding the circuit setup window.",
    mileageFactor:0.95,
    learningMultiplier:1.28,
    preparationGain:8,
    fatigue:6,
    wearFactor:0.90,
    incidentRisk:0.85,
    qualifyingBonus:0.20,
    raceBonus:0.20,
    reliabilityBonus:0.20,
  }),
  qualifying:Object.freeze({
    id:"qualifying",
    label:"Qualifying Focus",
    description:"Shorter, harder runs aimed at one-lap performance.",
    mileageFactor:0.82,
    learningMultiplier:0.92,
    preparationGain:6,
    fatigue:10,
    wearFactor:1.10,
    incidentRisk:1.22,
    qualifyingBonus:1.10,
    raceBonus:0.05,
    reliabilityBonus:0.00,
  }),
  race:Object.freeze({
    id:"race",
    label:"Race Focus",
    description:"Longer runs aimed at consistency and race trim.",
    mileageFactor:1.25,
    learningMultiplier:0.92,
    preparationGain:8,
    fatigue:12,
    wearFactor:1.22,
    incidentRisk:1.12,
    qualifyingBonus:0.00,
    raceBonus:1.05,
    reliabilityBonus:0.10,
  }),
  reliability:Object.freeze({
    id:"reliability",
    label:"Reliability Focus",
    description:"Controlled running aimed at understanding mechanical limits.",
    mileageFactor:0.88,
    learningMultiplier:0.82,
    preparationGain:5,
    fatigue:5,
    wearFactor:0.72,
    incidentRisk:0.68,
    qualifyingBonus:0.00,
    raceBonus:0.10,
    reliabilityBonus:1.35,
  }),
});

export function practiceProgramme(id){
  return PRACTICE_PROGRAMMES[String(id||"").toLowerCase()]||PRACTICE_PROGRAMMES.balanced;
}

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

export function trackSetupProfile(gs,gp={}){
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

  const target={
    aeroBalance:round1(directAero!=null
      ?normalizedDemand(directAero)
      :clamp(50+(overtaking-50)*0.30+(crash-50)*0.10,30,75)),
    mechanicalGrip:round1(directTechnical!=null
      ?normalizedDemand(directTechnical)
      :clamp(50+(tyreWear-50)*0.22+(crash-50)*0.12,30,75)),
    gearing:round1(directPower!=null
      ?normalizedDemand(directPower)
      :clamp(50+(lapLength-4.5)*5-(overtaking-50)*0.08,30,75)),
    cooling:round1(directCooling!=null
      ?normalizedDemand(directCooling)
      :clamp(50+(tyreWear-50)*0.16+(crash-50)*0.06,35,70)),
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
    },
    target,
  };
}

function activeStaffContracts(gs,teamId){
  const year=Number(gs?.activeYear);
  const rows=gs?.staffContracts?.length?gs.staffContracts:(gs?.dbStaffContracts||[]);
  return rows.filter((row)=>{
    if(teamIdOf(row)!==String(teamId))return false;
    const rowYear=num(pick(row,["year","season_year"],year),year);
    const start=num(pick(row,["contract_start","contract_start_year","start_year"],rowYear),rowYear);
    const end=num(pick(row,["contract_until","contract_until_year","end_year"],rowYear),rowYear);
    const status=String(row?.status??"active").toLowerCase();
    return year>=start&&year<=end&&!["terminated","expired","inactive"].includes(status);
  });
}

function staffRating(gs,id){
  const rows=gs?.staffRatings?.length?gs.staffRatings:(gs?.dbStaffRatings||[]);
  return rows.find((row)=>staffIdOf(row)===String(id))||{};
}

export function teamEngineeringSupport(gs,teamId){
  const rows=activeStaffContracts(gs,teamId);
  const scored=rows.map((contract)=>{
    const rating=staffRating(gs,staffIdOf(contract));
    const role=String(contract?.role??contract?.position??"").toLowerCase();
    const relevance=/engineer|technical|designer/.test(role)?1
      :/strateg/.test(role)?0.80
        :/principal|owner/.test(role)?0.45:0.60;
    const quality=
      num(rating?.technical,50)*0.42+
      num(rating?.data_analysis,50)*0.28+
      num(rating?.communication,50)*0.18+
      num(rating?.reliability_focus,50)*0.12;
    return {quality,relevance,score:quality*relevance};
  }).sort((a,b)=>b.score-a.score).slice(0,3);

  if(!scored.length)return 50;
  const weighted=scored.reduce((sum,row)=>sum+row.quality*row.relevance,0);
  const weight=scored.reduce((sum,row)=>sum+row.relevance,0);
  return round1(weight?weighted/weight:50);
}

function ratingFor(gs,driverId){
  const rows=gs?.driverRatings||[];
  return rows.find((row)=>driverIdOf(row)===String(driverId))||{};
}

function entryTeam(gs,driverId){
  const entry=(gs?.raceEntryState?.entries||[]).find((row)=>String(row?.driver_id??"")===String(driverId));
  return String(entry?.team_id??"");
}

function setupQuality(actual,target){
  const fields=["aeroBalance","mechanicalGrip","gearing","cooling"];
  const meanError=fields.reduce((sum,key)=>sum+Math.abs(num(actual?.[key],50)-num(target?.[key],50)),0)/fields.length;
  return round1(clamp(100-meanError*2.25,25,100));
}

function feedbackFor(actual,target){
  const labels={
    aeroBalance:"Aero balance",
    mechanicalGrip:"Mechanical grip",
    gearing:"Gearing",
    cooling:"Cooling",
  };
  const rows=Object.keys(labels).map((key)=>({
    key,
    error:Math.abs(num(actual?.[key],50)-num(target?.[key],50)),
  })).sort((a,b)=>b.error-a.error);
  const main=rows[0];
  if(!main||main.error<3)return "The car is inside a strong setup window.";
  if(main.error<7)return `${labels[main.key]} still needs a small adjustment.`;
  return `${labels[main.key]} remains the main setup concern.`;
}

function aiProgrammeFor(gs,teamId,driverId,engineering){
  const car=teamCarPerformance(gs,teamId,driverId);
  if(num(car?.reliability,75)<66)return PRACTICE_PROGRAMMES.reliability;
  if(engineering<55)return PRACTICE_PROGRAMMES.setup;
  const rating=ratingFor(gs,driverId);
  if(num(rating?.qualifying,60)-num(rating?.racecraft,60)>8)return PRACTICE_PROGRAMMES.qualifying;
  if(num(rating?.racecraft,60)-num(rating?.qualifying,60)>8)return PRACTICE_PROGRAMMES.race;
  return PRACTICE_PROGRAMMES.balanced;
}

function issueFor(gs,{driverId,teamId,programme,weekendKey,trackRisk=50}){
  const rating=ratingFor(gs,driverId);
  const car=teamCarPerformance(gs,teamId,driverId);
  const crash=num(rating?.crash_likelihood,25)/100;
  const reliability=num(car?.reliability,75)/100;
  const fatigue=num(driverCondition(gs,driverId)?.fatigue,0);
  const rng=rngFor(gs,`${weekendKey}-practice-issue-${driverId}`);

  const trackRiskFactor=0.80+clamp(trackRisk,0,100)/250;
  const fatigueRisk=Math.max(0,fatigue-35)*0.00032;
  const contactChance=clamp(((0.002+crash*0.018)*programme.incidentRisk*trackRiskFactor)+fatigueRisk,0,0.075);
  const mechanicalChance=clamp(((0.003+(1-reliability)*0.028)*programme.incidentRisk)+(fatigueRisk*0.35),0,0.075);
  const roll=rng.next();
  if(roll<contactChance)return {issue_type:"contact",issue_slot:"aero_front",issue_note:"Minor contact interrupted part of the programme."};
  if(roll<contactChance+mechanicalChance){
    const slots=["gearbox","cooling","brakes","suspension","turbocharger"];
    return {issue_type:"mechanical",issue_slot:rng.pick(slots),issue_note:"A mechanical issue shortened the running."};
  }
  return {issue_type:null,issue_slot:null,issue_note:null};
}

export function simulatePracticeSession(gs,{gp={},selections={}}={}){
  const weekend=gs?.raceWeekendState;
  if(!weekend||weekend.phase!=="practice")return {gameState:gs,practice:null};

  const profile=trackSetupProfile(gs,gp);
  const playerTeamId=String(gs?.team?.team_id??gs?.team?.id??"");
  const results=[];
  const conditionDict={...(gs?.driverAttributes||{})};

  for(const entry of gs?.raceEntryState?.entries||[]){
    const driverId=String(entry?.driver_id??"");
    const teamId=String(entry?.team_id??"");
    if(!driverId||!teamId)continue;

    const rating=ratingFor(gs,driverId);
    const engineering=teamEngineeringSupport(gs,teamId);
    const programme=String(teamId)===playerTeamId
      ?practiceProgramme(selections?.[driverId]||"balanced")
      :aiProgrammeFor(gs,teamId,driverId,engineering);

    const feedback=clamp(num(rating?.technical_feedback,50));
    const adaptability=clamp(num(rating?.adaptability,50));
    const consistency=clamp(num(rating?.consistency,50));
    const previous=driverCondition(gs,driverId);
    const fatigueBefore=clamp(num(previous?.fatigue,0));
    const fatigueEfficiency=clamp(1-Math.max(0,fatigueBefore-15)*0.006,0.55,1);
    const learning=clamp((
      feedback*0.38+
      adaptability*0.20+
      consistency*0.12+
      engineering*0.30
    )*fatigueEfficiency);

    const rng=rngFor(gs,`${weekend.key}-practice-setup-${driverId}`);
    const initial={};
    const final={};
    const progress=clamp((0.28+(learning/100)*0.50)*programme.learningMultiplier,0.20,0.92);
    for(const [key,target] of Object.entries(profile.target)){
      const initialError=(rng.next()-0.5)*38;
      initial[key]=round1(clamp(target+initialError));
      final[key]=round1(clamp(target+initialError*(1-progress)));
    }

    const quality=setupQuality(final,profile.target);
    const knowledge=round1(clamp(
      22+
      learning*0.52+
      programme.mileageFactor*12+
      (programme.id==="setup"?8:0)
    ));
    const issue=issueFor(gs,{
      driverId,
      teamId,
      programme,
      weekendKey:weekend.key,
      trackRisk:profile.inputs.crash_risk,
    });
    const issuePenalty=issue.issue_type?2:0;
    const prepGain=clamp((
      programme.preparationGain+
      Math.max(0,quality-60)*0.05+
      Math.max(0,knowledge-60)*0.025-
      issuePenalty
    )*(0.70+fatigueEfficiency*0.30),2,14);

    const fatigueAfter=round1(clamp(fatigueBefore+programme.fatigue));
    conditionDict[driverId]={
      ...defaultDriverCondition(),
      ...previous,
      preparation:round1(clamp(num(previous.preparation,50)+prepGain)),
      fatigue:fatigueAfter,
      confidence:round1(clamp(num(previous.confidence,50)+(quality>=82?1:quality<55?-0.5:0))),
    };

    results.push({
      driver_id:driverId,
      team_id:teamId,
      programme_id:programme.id,
      programme_label:programme.label,
      engineering_support:engineering,
      learning_rate:round1(learning),
      setup_knowledge:knowledge,
      setup_quality:quality,
      preparation_gain:round1(prepGain),
      fatigue_before:round1(fatigueBefore),
      fatigue_after:fatigueAfter,
      fatigue_efficiency:round1(fatigueEfficiency*100),
      fatigue_performance_penalty_before:round1(fatiguePenalty(gs,driverId)),
      initial_setup:initial,
      setup:final,
      target_setup:profile.target,
      feedback:feedbackFor(final,profile.target),
      qualifying_bonus:programme.qualifyingBonus,
      race_bonus:programme.raceBonus,
      reliability_bonus:programme.reliabilityBonus,
      mileage_factor:programme.mileageFactor,
      wear_factor:round1(programme.wearFactor*(0.85+profile.inputs.tyre_wear/100*0.30)),
      fatigue_cost:programme.fatigue,
      ...issue,
    });
  }

  let next={...gs,driverAttributes:conditionDict};
  next=applyPracticeComponentWear(next,{practiceResults:results,gp});
  const enrichedResults=results.map((row)=>({
    ...row,
    component_wear:practiceWearSummary(next,{driverId:row.driver_id,gp}),
  }));

  const practice={
    completed_at:String(gs?.currentDateISO||"").slice(0,10),
    status:"completed",
    source:"rw2_practice_setup",
    track_profile:profile,
    results:enrichedResults,
  };
  return {gameState:next,practice};
}

export function practiceResultForDriver(gs,driverId){
  return (gs?.raceWeekendState?.practice?.results||[]).find((row)=>String(row?.driver_id??"")===String(driverId))||null;
}
