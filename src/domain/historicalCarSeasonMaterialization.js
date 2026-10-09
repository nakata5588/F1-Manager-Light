// One-time historical starting car specifications for a NEW GAME Season Pack.
// Historical outcomes are never consulted by the live race engine or by season rollover.
// These are inferred technical proxies, not claimed historical hardware measurements.
const num=(v,f=NaN)=>v==null||v===""?f:Number.isFinite(Number(v))?Number(v):f;
const id=(r)=>String(r?.team_id??r?.team??"").trim();
const clamp=(v,a=35,b=98)=>Math.max(a,Math.min(b,v));
const round1=(v)=>Math.round(v*10)/10;

function resultEvidence(proxy){
  const strength=num(proxy?.overall_competitiveness_proxy);
  if(!Number.isFinite(strength))return null;
  const q=num(proxy?.qualifying_index,strength);
  const pct=num(proxy?.classified_finish_rate);
  return {
    year:num(proxy.year),
    team_id:id(proxy),
    race:round1(clamp(42+clamp(strength,0,100)*0.54)),
    qualifying:round1(clamp(42+clamp(q,0,100)*0.54)),
    // Aggregate classification cannot distinguish crashes from mechanical DNF.
    // Keep a neutral baseline rather than inventing the breakdown.
    reliability:75,
    evidence_driver_count:null,
    evidence_result_count:num(proxy?.event_records,0),
    source:"derived_race_results_competitiveness_proxy",
    confidence:"low",
    historical_result_strength:round1(strength),
  };
}

function toSpecs(baseline,year){
  const race=clamp(num(baseline?.race,70));
  const qualifying=clamp(num(baseline?.qualifying,race));
  const reliability=clamp(num(baseline?.reliability,75));
  return {
    year,season_year:year,team_id:id(baseline),
    // Proxy part values seed the existing single technical model and permit
    // subsequent seasons to evolve from the simulated car package.
    chassis_spec:round1(race),
    aero_spec:round1(qualifying),
    gearbox_spec:round1((race+qualifying)/2),
    suspension_spec:round1(race),
    brakes_spec:round1(race),
    cooling_spec:round1(reliability),
    reliability:round1(reliability),
    generation_source:"historical_results_inference",
    historical_baseline_source:baseline.source,
    historical_baseline_confidence:baseline.confidence,
    historical_result_strength:baseline.historical_result_strength??null,
    historical_evidence_driver_count:baseline.evidence_driver_count??null,
    historical_evidence_result_count:baseline.evidence_result_count??null,
  };
}

/**
 * Preserves exact-year manual specifications; otherwise uses verified
 * two-driver results, then an explicitly labelled precomputed Results proxy.
 * Previous-year tech rows are a last resort, never preferred to same-year evidence.
 */
export function materializeHistoricalSeasonCarStats({
  year,teamIds=[],explicitRows=[],inheritedRows=[],resultBaselines=[],resultProxies=[],
}={}){
  const yr=Number(year);
  const explicitByTeam=new Map(explicitRows.filter(r=>num(r?.year??r?.season_year)===yr).map(r=>[id(r),r]));
  const inheritedByTeam=new Map(inheritedRows.map(r=>[id(r),r]));
  const verifiedByTeam=new Map(resultBaselines
    .filter(r=>num(r?.year)===yr&&r?.confidence==="medium"&&num(r?.evidence_driver_count,0)>=2)
    .map(r=>[id(r),r]));
  const proxyByTeam=new Map(resultProxies
    .filter(r=>num(r?.year)===yr)
    .map(r=>[id(r),resultEvidence(r)]).filter(([,r])=>Boolean(r)));
  return [...new Set(teamIds.map(x=>String(x).trim()).filter(Boolean))]
    .map(team=>{
      if(explicitByTeam.has(team))return {...explicitByTeam.get(team),team_id:team,year:yr};
      const evidence=verifiedByTeam.get(team)||proxyByTeam.get(team);
      if(evidence)return toSpecs(evidence,yr);
      const fallback=inheritedByTeam.get(team);
      const sourceYear=num(fallback?.year??fallback?.season_year);
      // Never present a decades-old manual car (e.g. 1980) as an untouched
      // 2000 car. Nearby historical specs can carry over provisionally.
      return fallback&&Number.isFinite(sourceYear)&&yr-sourceYear>=0&&yr-sourceYear<=2
        ?{...fallback,team_id:team,year:yr,
          generation_source:"historical_nearby_spec_carryover",
          historical_baseline_confidence:"low",source_season:sourceYear}
        :null;
    }).filter(Boolean);
}
