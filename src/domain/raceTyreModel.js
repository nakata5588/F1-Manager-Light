// src/domain/raceTyreModel.js
// Shared factual tyre catalog + tyre condition model used by Legacy strategy
// and the canonical RW2 race core. Keep one source of truth for compounds,
// pace-mode wear multipliers and tyre-condition effects.

const num=(value,fallback=0)=>{
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const clamp=(value,min=0,max=100)=>Math.max(min,Math.min(max,num(value,min)));

export const RACE_PACE_MODES=Object.freeze({
  conserve:{id:"conserve",label:"Conserve",lap_delta_s:0.42,wear_mult:0.78,risk_mult:0.88,fatigue_mult:0.72},
  balanced:{id:"balanced",label:"Balanced",lap_delta_s:0,wear_mult:1,risk_mult:1,fatigue_mult:1},
  attack:{id:"attack",label:"Attack",lap_delta_s:-0.38,wear_mult:1.28,risk_mult:1.14,fatigue_mult:1.34},
});

export function genericTyresForYear(yearInput){
  const year=Number(yearInput)||1980;
  const prefix=`generic_${year||"era"}`;
  return [
    {tyre_id:`${prefix}_hard`,year_from:year,year_to:year,supplier:"Generic",compound_name:"Hard",category:"dry",grip_index:74,wear_rate:0.015,warmup_time_s:2.8},
    {tyre_id:`${prefix}_soft`,year_from:year,year_to:year,supplier:"Generic",compound_name:"Soft",category:"dry",grip_index:80,wear_rate:0.022,warmup_time_s:2.2},
    {tyre_id:`${prefix}_inter`,year_from:year,year_to:year,supplier:"Generic",compound_name:"Intermediate",category:"intermediate",grip_index:65,wear_rate:0.018,warmup_time_s:3.1},
    {tyre_id:`${prefix}_wet`,year_from:year,year_to:year,supplier:"Generic",compound_name:"Wet",category:"wet",grip_index:55,wear_rate:0.020,warmup_time_s:3.5},
  ];
}

// Bridgestone's publicly announced 2000 Australian GP dry allocation was
// Soft + Medium (Autosport, 3 March 2000). This is a factual event selection,
// not a claim that the numerical grip/wear figures below were measured in 2000.
// The grip/wear parameters are deliberately estimated game-model values.
// https://www.autosport.com/f1/news/bridgestone-prepares-for-50th-race-5036487/5036487/
// The 2000 race rules permitted one chosen dry specification per driver after
// qualifying, with separate wet-weather allocations (Bridgestone F1 archive).
// https://ms.bridgestone.co.jp/special/document/f1/en/techs_regs/2000/
const AUSTRALIA_2000_ALLOCATION=Object.freeze([
  {tyre_id:"bs_2000_aus_medium",year_from:2000,year_to:2000,supplier:"Bridgestone",compound_name:"Medium",category:"dry",grip_index:77,wear_rate:0.018,warmup_time_s:2.55,model_parameters_estimated:true},
  {tyre_id:"bs_2000_aus_soft",year_from:2000,year_to:2000,supplier:"Bridgestone",compound_name:"Soft",category:"dry",grip_index:80,wear_rate:0.022,warmup_time_s:2.20,model_parameters_estimated:true},
  {tyre_id:"bs_2000_aus_inter",year_from:2000,year_to:2000,supplier:"Bridgestone",compound_name:"Intermediate",category:"intermediate",grip_index:65,wear_rate:0.018,warmup_time_s:3.1,model_parameters_estimated:true},
  {tyre_id:"bs_2000_aus_wet",year_from:2000,year_to:2000,supplier:"Bridgestone",compound_name:"Wet",category:"wet",grip_index:55,wear_rate:0.020,warmup_time_s:3.5,model_parameters_estimated:true},
]);

export function historicalEventTyres(yearInput,trackIdInput){
  const year=Number(yearInput);
  const trackId=String(trackIdInput||"");
  if(year===2000&&trackId==="tr_0019")return AUSTRALIA_2000_ALLOCATION.map(t=>({...t}));
  return null;
}

export function activeTyresForYear(gs,yearInput=null){
  const year=Number(yearInput??gs?.activeYear);
  if(Array.isArray(gs?.tyres)&&gs.tyres.length)return gs.tyres;
  const source=Array.isArray(gs?.dbTyres)?gs.dbTyres:[];
  if(!source.length)return genericTyresForYear(year);

  const exact=source.filter((row)=>{
    const from=num(row?.year_from,row?.year??-Infinity);
    const to=num(row?.year_to,row?.year??Infinity);
    return !Number.isFinite(year)||(year>=from&&year<=to);
  });
  if(exact.length)return exact;

  const priorYears=source
    .map((row)=>num(row?.year_to,row?.year??row?.year_from??NaN))
    .filter((value)=>Number.isFinite(value)&&value<=year);
  if(!priorYears.length)return genericTyresForYear(year);
  const nearest=Math.max(...priorYears);
  return source.filter((row)=>num(row?.year_to,row?.year??row?.year_from??NaN)===nearest);
}

// One authority for which dry-specification tyres can be refitted at pits.
// Weather tyres remain available regardless of the selected dry specification.
export function legalTyresForChosenDrySpecification(options,startTyreId,locked=false){
  const source=Array.isArray(options)?options:[];
  if(!locked)return source;
  const selected=source.find(row=>String(row?.tyre_id??row?.id)===String(startTyreId??""));
  if(!selected||String(selected.category)!=="dry")return source;
  return source.filter(row=>
    String(row?.category||"dry")!=="dry"||
    String(row?.tyre_id??row?.id)===String(startTyreId)
  );
}

export function tyresForTeam(gs,teamId,{year=null,trackId=null}={}){
  const world=gs?.raceStrategyWorld||{};
  const supplier=world?.teamSuppliers?.[String(teamId)]||null;
  const effectiveYear=Number(year??gs?.raceWeekendState?.year??gs?.activeYear);
  const effectiveTrack=String(trackId??gs?.raceWeekendState?.track_id??"");
  const eventAllocation=historicalEventTyres(effectiveYear,effectiveTrack);
  // Respect real, explicitly supplied historical tyre data. Replace only the
  // generic/yearless fallback with a verified per-GP dry compound allocation.
  const explicitlySupplied=Array.isArray(gs?.tyres)&&gs.tyres.length>0;
  const hasYearDatabase=Array.isArray(gs?.dbTyres)&&gs.dbTyres.some(t=>
    effectiveYear>=num(t?.year_from,t?.year??Infinity)&&
    effectiveYear<=num(t?.year_to,t?.year??-Infinity)
  );
  // Existing career saves may already contain a planned generic_2000 tyre
  // from before the verified event allocation was introduced. Do not remap
  // those race-weekend selections under the player's feet.
  const existingSelections=Object.values(gs?.raceWeekendState?.race_strategy?.selections||{});
  const hasLegacyGenericSelection=existingSelections.some(selection=>
    String(selection?.team_id||"")===String(teamId)&&
    /^generic_2000_/.test(String(selection?.start_tyre_id||""))
  );
  const all=eventAllocation&&!explicitlySupplied&&!hasYearDatabase&&!hasLegacyGenericSelection
    ?eventAllocation
    :activeTyresForYear(gs,effectiveYear);
  const matching=supplier
    ?all.filter((row)=>String(row?.supplier||"")===String(supplier))
    :[];
  return matching.length?matching:all;
}

export function tyreConditionEffects(conditionInput){
  const condition=clamp(conditionInput,0,100);
  if(condition>=70)return {pace_penalty_s:0,grip_multiplier:1,risk_multiplier:1,band:"healthy"};
  if(condition>=45){
    const severity=(70-condition)/25;
    return {
      pace_penalty_s:Number((severity*0.42).toFixed(3)),
      grip_multiplier:Number((1-severity*0.035).toFixed(4)),
      risk_multiplier:Number((1+severity*0.06).toFixed(4)),
      band:"used",
    };
  }
  if(condition>=25){
    const severity=(45-condition)/20;
    return {
      pace_penalty_s:Number((0.42+severity*1.05).toFixed(3)),
      grip_multiplier:Number((0.965-severity*0.075).toFixed(4)),
      risk_multiplier:Number((1.06+severity*0.22).toFixed(4)),
      band:"worn",
    };
  }
  const severity=(25-condition)/25;
  return {
    pace_penalty_s:Number((1.47+severity*3.3).toFixed(3)),
    grip_multiplier:Number((0.89-severity*0.16).toFixed(4)),
    risk_multiplier:Number((1.28+severity*0.72).toFixed(4)),
    band:condition<12?"critical":"severe",
  };
}

export function optimalTyreTemperatureC(tyre){
  const category=String(tyre?.category||"dry");
  return category==="wet"?68:category==="intermediate"?78:96;
}

export function projectedTyreWearPerLap(
  tyre,
  {
    trackWearMult=1,
    paceMode="balanced",
    pace=null,
    wearDriverMult=1,
    hotWearMult=1,
  }={}
){
  const paceProfile=pace||RACE_PACE_MODES[String(paceMode)]||RACE_PACE_MODES.balanced;
  return num(tyre?.wear_rate,0.018)*100*0.72*
    num(trackWearMult,1)*
    num(paceProfile?.wear_mult,1)*
    num(wearDriverMult,1)*
    num(hotWearMult,1);
}
