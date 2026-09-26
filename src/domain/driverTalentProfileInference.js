// src/domain/driverTalentProfileInference.js
// D7.R1C — Talent Attribute Inference.
//
// Converts normalized historical evidence into candidate permanent Talent
// Profile ceilings. This remains analysis-only: profiles generated here are
// NOT runtime ratings, do not alter New Game, and do not encode annual history.
//
// Design rules:
// - direct historical evidence receives the strongest signal;
// - weak/short samples regress toward a neutral percentile;
// - unsupported traits are explicit low-confidence proxies, never fake facts;
// - aggression/crash tendency are NOT inferred from generic DNF counts;
// - current ability is intentionally absent: R2 will materialize it by start year.

const clamp=(value,min=0,max=100)=>Math.max(min,Math.min(max,Number(value)||0));
const round1=(value)=>Number.isFinite(Number(value))
  ?Math.round(Number(value)*10)/10
  :null;
const num=(value,fallback=null)=>{
  if(value===undefined||value===null||value==="")return fallback;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};

const ATTRIBUTE_SPECS=Object.freeze({
  pace:Object.freeze({
    source:"direct",
    confidence_multiplier:1.00,
    weights:Object.freeze({qualifying:0.45,race:0.25,peak:0.30}),
  }),
  qualifying:Object.freeze({
    source:"direct",
    confidence_multiplier:1.00,
    weights:Object.freeze({qualifying:0.65,peak:0.35}),
  }),
  racecraft:Object.freeze({
    source:"direct",
    confidence_multiplier:1.00,
    weights:Object.freeze({race:0.55,peak:0.30,qualifying:0.15}),
  }),
  consistency:Object.freeze({
    source:"direct",
    confidence_multiplier:0.95,
    weights:Object.freeze({consistency:0.65,race:0.25,qualifying:0.10}),
  }),
  race_intelligence:Object.freeze({
    source:"derived",
    confidence_multiplier:0.85,
    weights:Object.freeze({race:0.50,consistency:0.25,peak:0.25}),
  }),
  pressure_handling:Object.freeze({
    source:"derived",
    confidence_multiplier:0.80,
    weights:Object.freeze({peak:0.45,qualifying:0.25,consistency:0.30}),
  }),
  mentality:Object.freeze({
    source:"derived",
    confidence_multiplier:0.75,
    weights:Object.freeze({peak:0.30,race:0.35,consistency:0.35}),
  }),
  adaptability:Object.freeze({
    source:"derived",
    confidence_multiplier:0.65,
    weights:Object.freeze({race:0.30,qualifying:0.25,consistency:0.25,peak:0.20}),
  }),
  tire_management:Object.freeze({
    source:"proxy",
    confidence_multiplier:0.60,
    weights:Object.freeze({race:0.45,consistency:0.35,peak:0.20}),
  }),
  start_launch:Object.freeze({
    source:"proxy",
    confidence_multiplier:0.50,
    weights:Object.freeze({qualifying:0.35,race:0.30,peak:0.35}),
  }),
  wet_skill:Object.freeze({
    source:"proxy",
    confidence_multiplier:0.38,
    weights:Object.freeze({composite:0.45,peak:0.35,consistency:0.20}),
  }),
  technical_feedback:Object.freeze({
    source:"proxy",
    confidence_multiplier:0.30,
    weights:Object.freeze({composite:0.45,consistency:0.30,peak:0.25}),
  }),
  ers_fuel_management:Object.freeze({
    source:"proxy",
    confidence_multiplier:0.28,
    weights:Object.freeze({race:0.40,consistency:0.40,peak:0.20}),
  }),
  leadership:Object.freeze({
    source:"proxy",
    confidence_multiplier:0.24,
    weights:Object.freeze({composite:0.40,peak:0.35,consistency:0.25}),
  }),
  team_player:Object.freeze({
    source:"proxy",
    confidence_multiplier:0.20,
    weights:Object.freeze({consistency:0.45,composite:0.35,race:0.20}),
  }),
  car_development_impact:Object.freeze({
    source:"proxy",
    confidence_multiplier:0.24,
    weights:Object.freeze({composite:0.40,consistency:0.30,peak:0.30}),
  }),
});

const CORE_POTENTIAL_WEIGHTS=Object.freeze({
  pace:0.20,
  qualifying:0.12,
  racecraft:0.18,
  consistency:0.12,
  race_intelligence:0.14,
  pressure_handling:0.08,
  mentality:0.06,
  adaptability:0.05,
  tire_management:0.05,
});

function weightedAverage(parts=[]){
  let sum=0;
  let weight=0;
  for(const [value,w] of parts){
    if(!Number.isFinite(value)||!Number.isFinite(w)||w<=0)continue;
    sum+=value*w;
    weight+=w;
  }
  return weight>0?sum/weight:null;
}

function confidenceBand(score){
  const value=num(score,0);
  if(value>=75)return "HIGH";
  if(value>=60)return "MEDIUM-HIGH";
  if(value>=40)return "MEDIUM";
  if(value>=15)return "LOW";
  return "INSUFFICIENT";
}

function sourceConfidenceBand(source,score){
  const value=num(score,0);
  if(source==="proxy"){
    if(value>=55)return "MEDIUM";
    if(value>=20)return "LOW";
    return "INSUFFICIENT";
  }
  return confidenceBand(value);
}

export function talentCeilingFromPercentile(percentile){
  const p=clamp(num(percentile,50),0,100)/100;
  // Historical F1 is already a selected population. This curve keeps the
  // median around low-70s, separates the lower tail, and reserves 95+ for the
  // extreme historical percentiles without requiring hand-authored stars.
  return round1(clamp(38+61*(p**0.82),35,99));
}

export function regularizeTalentPercentile(percentile,confidenceScore,multiplier=1){
  const raw=num(percentile,50);
  const evidenceFactor=clamp(num(confidenceScore,0)/80,0,1);
  const factor=clamp(evidenceFactor*num(multiplier,1),0,1);
  return round1(50+(raw-50)*factor);
}

function evidencePercentiles(row){
  const source=row?.comparative_evidence_percentiles||{};
  return {
    qualifying:num(source.qualifying,null),
    race:num(source.race,null),
    peak:num(source.peak,null),
    consistency:num(source.consistency,null),
    composite:num(source.composite,null),
  };
}

function blendEvidencePercentile(row,spec){
  const evidence=evidencePercentiles(row);
  const parts=Object.entries(spec?.weights||{}).map(([key,weight])=>[
    num(evidence[key],null),
    Number(weight),
  ]);
  return weightedAverage(parts);
}

function breadthAdjustment(row){
  const seasons=Math.max(0,num(row?.sample?.seasons,0));
  const teams=Math.max(0,num(row?.sample?.teams,0));
  // Breadth is only a small supporting signal for adaptability. Merely staying
  // in F1 a long time cannot manufacture elite talent.
  return clamp(
    Math.min(3,Math.max(0,seasons-3)*0.25)+
    Math.min(2,Math.max(0,teams-2)*0.35),
    0,5
  );
}

function inferAttribute(row,key,spec){
  const baseConfidence=num(row?.confidence?.score,0);
  const raw=blendEvidencePercentile(row,spec);
  let adjustedRaw=raw;
  if(key==="adaptability"&&Number.isFinite(raw)){
    adjustedRaw=clamp(raw+breadthAdjustment(row),0,100);
  }

  const regularized=regularizeTalentPercentile(
    Number.isFinite(adjustedRaw)?adjustedRaw:50,
    baseConfidence,
    spec.confidence_multiplier
  );
  const ceiling=talentCeilingFromPercentile(regularized);
  const attributeConfidence=round1(clamp(
    baseConfidence*spec.confidence_multiplier,
    0,100
  ));

  return {
    key,
    ceiling,
    evidence_percentile:round1(raw),
    regularized_percentile:regularized,
    confidence_score:attributeConfidence,
    confidence_band:sourceConfidenceBand(spec.source,attributeConfidence),
    source:spec.source,
  };
}

function peakAbilityFromAttributes(attributes,row){
  const core=weightedAverage(
    Object.entries(CORE_POTENTIAL_WEIGHTS).map(([key,weight])=>[
      num(attributes?.[key]?.ceiling,null),
      weight,
    ])
  );
  const peakPercentile=regularizeTalentPercentile(
    num(row?.comparative_evidence_percentiles?.peak,50),
    num(row?.confidence?.score,0),
    1
  );
  const peakSignal=talentCeilingFromPercentile(peakPercentile);

  if(!Number.isFinite(core))return peakSignal;
  // Peak evidence can lift a driver whose career-average evidence is diluted by
  // rookie/decline seasons, but it cannot fully replace multi-dimensional skill.
  return round1(clamp(core*0.70+peakSignal*0.30,35,99));
}

function talentBand(value){
  const score=num(value,0);
  if(score>=96)return "GENERATIONAL";
  if(score>=92)return "ELITE";
  if(score>=88)return "WORLD_CLASS";
  if(score>=82)return "STRONG_F1";
  if(score>=75)return "F1_LEVEL";
  if(score>=68)return "FRINGE_F1";
  return "DEVELOPMENTAL";
}

function profileFlags(row,attributes){
  const flags=[];
  if(num(row?.sample?.starts,0)===0)flags.push("NO_F1_RACE_EVIDENCE");
  if(num(row?.confidence?.score,0)<40)flags.push("LOW_PROFILE_CONFIDENCE");
  if(Object.values(attributes).some(item=>item?.source==="proxy")){
    flags.push("CONTAINS_PROXY_ATTRIBUTES");
  }
  flags.push("WET_SKILL_NOT_DIRECTLY_OBSERVED");
  flags.push("TECHNICAL_AND_TEAM_TRAITS_PROXY_ONLY");
  flags.push("AGGRESSION_AND_CRASH_TENDENCY_NOT_INFERRED");
  flags.push("CURRENT_ABILITY_NOT_INFERRED_IN_R1C");
  return [...new Set(flags)];
}

export function inferDriverTalentProfile(row){
  const attributes={};
  const attribute_confidence={};
  for(const [key,spec] of Object.entries(ATTRIBUTE_SPECS)){
    const inferred=inferAttribute(row,key,spec);
    attributes[key]=inferred;
    attribute_confidence[key]={
      score:inferred.confidence_score,
      band:inferred.confidence_band,
      source:inferred.source,
    };
  }

  const peakAbility=peakAbilityFromAttributes(attributes,row);
  const ceilings=Object.fromEntries(
    Object.entries(attributes).map(([key,value])=>[key,value.ceiling])
  );

  return {
    driver_id:String(row?.driver_id||""),
    display_name:String(row?.display_name||row?.driver_id||""),
    stage:"D7.R1C",
    authority:"analysis_only",
    model:"historical_evidence_to_talent_profile_v1",
    profile_confidence:{
      score:round1(num(row?.confidence?.score,0)),
      band:String(row?.confidence?.band||confidenceBand(row?.confidence?.score)),
      evidence_scope:String(row?.evidence_scope||"historical_f1_results"),
    },
    talent_band:talentBand(peakAbility),
    peak_ability:peakAbility,
    ceilings,
    tendencies:{
      aggression:null,
      crash_likelihood:null,
      status:"not_inferred_from_generic_race_results",
    },
    attribute_evidence:Object.fromEntries(
      Object.entries(attributes).map(([key,value])=>[
        key,
        {
          evidence_percentile:value.evidence_percentile,
          regularized_percentile:value.regularized_percentile,
          source:value.source,
        },
      ])
    ),
    attribute_confidence,
    evidence_summary:{
      qualifying:round1(num(row?.comparative_evidence_percentiles?.qualifying,null)),
      race:round1(num(row?.comparative_evidence_percentiles?.race,null)),
      peak:round1(num(row?.comparative_evidence_percentiles?.peak,null)),
      consistency:round1(num(row?.comparative_evidence_percentiles?.consistency,null)),
      composite:round1(num(row?.comparative_evidence_percentiles?.composite,null)),
      starts:num(row?.sample?.starts,0),
      seasons:num(row?.sample?.seasons,0),
      teams:num(row?.sample?.teams,0),
    },
    inference_flags:profileFlags(row,attributes),
  };
}

export function inferDriverTalentProfiles(rows=[]){
  return (Array.isArray(rows)?rows:[])
    .map(inferDriverTalentProfile)
    .sort((a,b)=>String(a.driver_id).localeCompare(String(b.driver_id)));
}

function distributionBucket(value){
  const score=num(value,0);
  if(score>=95)return "95-99";
  if(score>=90)return "90-94";
  if(score>=85)return "85-89";
  if(score>=80)return "80-84";
  if(score>=75)return "75-79";
  if(score>=70)return "70-74";
  if(score>=60)return "60-69";
  return "<60";
}

export function buildDriverTalentProfileAudit(profiles=[]){
  const source=Array.isArray(profiles)?profiles:[];
  const distribution={};
  const confidence_counts={};
  const band_counts={};
  for(const row of source){
    const bucket=distributionBucket(row?.peak_ability);
    distribution[bucket]=(distribution[bucket]||0)+1;
    const confidence=String(row?.profile_confidence?.band||"INSUFFICIENT");
    confidence_counts[confidence]=(confidence_counts[confidence]||0)+1;
    const band=String(row?.talent_band||"UNKNOWN");
    band_counts[band]=(band_counts[band]||0)+1;
  }

  const top_profiles=source
    .filter(row=>num(row?.evidence_summary?.starts,0)>0)
    .sort((a,b)=>
      num(b?.peak_ability,0)-num(a?.peak_ability,0)||
      num(b?.profile_confidence?.score,0)-num(a?.profile_confidence?.score,0)||
      String(a?.display_name||"").localeCompare(String(b?.display_name||""))
    )
    .slice(0,30)
    .map(row=>({
      driver_id:row.driver_id,
      display_name:row.display_name,
      peak_ability:row.peak_ability,
      talent_band:row.talent_band,
      confidence:row.profile_confidence.band,
      starts:row.evidence_summary.starts,
      pace:row.ceilings.pace,
      qualifying:row.ceilings.qualifying,
      racecraft:row.ceilings.racecraft,
    }));

  return {
    format:"f1ml-driver-talent-profile-audit",
    schema_version:1,
    generated_at:null,
    stage:"D7.R1C",
    authority:"analysis_only",
    total_profiles:source.length,
    profiles_with_f1_starts:source.filter(row=>num(row?.evidence_summary?.starts,0)>0).length,
    profiles_without_f1_starts:source.filter(row=>num(row?.evidence_summary?.starts,0)===0).length,
    peak_ability_distribution:distribution,
    profile_confidence_counts:confidence_counts,
    talent_band_counts:band_counts,
    top_profiles,
    notes:[
      "These are candidate permanent Talent Profile ceilings, not current ratings and not runtime authority.",
      "No annual rating snapshots are consumed by the R1C inference model.",
      "Low-confidence historical samples are regressed toward a neutral percentile before conversion to ceilings.",
      "Wet skill, technical feedback, ERS/fuel management, leadership, team-player and car-development ceilings are conservative proxies until dedicated evidence exists.",
      "Aggression and crash likelihood remain uninferred because generic DNFs do not distinguish mechanical failure from driver error.",
      "D7.R2 will later materialize current starting attributes by year from Talent Profile + career stage; R1C does not do that.",
    ],
  };
}

export const DRIVER_TALENT_ATTRIBUTE_SPECS=ATTRIBUTE_SPECS;
