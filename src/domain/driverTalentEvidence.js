// src/domain/driverTalentEvidence.js
// D7.R1A — Historical Talent Evidence Foundation.
//
// IMPORTANT: this module does NOT produce gameplay ratings or talent ceilings.
// It extracts deterministic, context-aware evidence from historical results so
// later stages can infer a permanent Talent Profile without annual attributes.

import { historicalResultInfo } from "./historicalRaceStatus.js";

const clamp=(value,min=0,max=1)=>Math.max(min,Math.min(max,value));
const round=(value,digits=4)=>{
  if(!Number.isFinite(value))return null;
  const factor=10**digits;
  return Math.round(value*factor)/factor;
};
const unwrap=(value)=>{
  if(value&&typeof value==="object"&&!Array.isArray(value)){
    if(value.result!==undefined&&value.result!==null&&value.result!=="")return unwrap(value.result);
    if(value.value!==undefined&&value.value!==null&&value.value!=="")return unwrap(value.value);
  }
  return value;
};
const num=(value,fallback=null)=>{
  if(value===undefined||value===null||value==="")return fallback;
  const parsed=Number(unwrap(value));
  return Number.isFinite(parsed)?parsed:fallback;
};
const first=(row,keys,fallback=null)=>{
  for(const key of keys){
    const value=unwrap(row?.[key]);
    if(value!==undefined&&value!==null&&value!=="")return value;
  }
  return fallback;
};
const mean=(values)=>{
  const finite=(values||[]).filter(Number.isFinite);
  return finite.length?finite.reduce((sum,value)=>sum+value,0)/finite.length:null;
};
const deviation=(values)=>{
  const finite=(values||[]).filter(Number.isFinite);
  if(finite.length<2)return null;
  const average=mean(finite);
  return Math.sqrt(finite.reduce((sum,value)=>sum+(value-average)**2,0)/finite.length);
};
const driverId=(row)=>String(first(row,["driver_id","driverId","person_id","id"],"")||"");
const teamId=(row)=>String(first(row,["team_id","constructor_id","teamId"],"")||"");
const driverName=(row)=>String(first(row,["display_name","driver_name","name","full_name"],driverId(row))||driverId(row));

function positionPercentile(position,fieldSize){
  const pos=num(position,null);
  const size=Math.max(1,num(fieldSize,1));
  if(pos==null||pos<=0)return null;
  if(size<=1)return 1;
  return clamp(1-(pos-1)/(size-1),0,1);
}

function normalizedPositionDelta(own,other,fieldSize){
  const a=num(own,null);
  const b=num(other,null);
  const size=Math.max(2,num(fieldSize,2));
  if(a==null||b==null||a<=0||b<=0)return null;
  return clamp((b-a)/(size-1),-1,1);
}

function reliabilityAdjusted(value,sampleSize,priorWeight=12){
  if(!Number.isFinite(value))return null;
  const n=Math.max(0,num(sampleSize,0));
  return value*(n/(n+Math.max(0,priorWeight)));
}

function confidenceBand(score){
  if(score>=75)return "HIGH";
  if(score>=60)return "MEDIUM-HIGH";
  if(score>=40)return "MEDIUM";
  if(score>=15)return "LOW";
  return "INSUFFICIENT";
}

function evidenceConfidence(sample){
  const starts=Math.max(0,num(sample?.starts,0));
  if(starts===0)return {score:0,band:"INSUFFICIENT"};

  const sampleCoverage=clamp(starts/80);
  const teammateCoverage=clamp((num(sample?.teammate_qualifying,0)+num(sample?.teammate_race,0))/100);
  const carCoverage=clamp(num(sample?.car_context,0)/Math.max(1,starts));
  const qualifyingCoverage=clamp(num(sample?.qualifying,0)/Math.max(1,starts));
  const seasonCoverage=clamp(num(sample?.seasons,0)/7);

  let score=100*(
    0.34*sampleCoverage+
    0.24*teammateCoverage+
    0.18*carCoverage+
    0.12*qualifyingCoverage+
    0.12*seasonCoverage
  );

  // Tiny careers may contain spectacular single-event outliers. Keep those
  // visible as evidence, but never pretend the confidence is high.
  if(starts<3)score=Math.min(score,15);
  else if(starts<10)score=Math.min(score,35);
  else if(starts<25)score=Math.min(score,55);
  else if(starts<50)score=Math.min(score,72);

  score=round(score,1);
  return {score,band:confidenceBand(score)};
}

function carContextIndex(rows=[]){
  const index=new Map();
  for(const row of Array.isArray(rows)?rows:[]){
    const year=num(first(row,["year","season_year"],null),null);
    const tid=teamId(row);
    if(year==null||!tid)continue;
    index.set(String(year)+"|"+tid,row);
  }
  return index;
}

function careerContextIndex(rows=[]){
  const index=new Map();
  for(const row of Array.isArray(rows)?rows:[]){
    const did=driverId(row);
    if(!did)continue;
    if(!index.has(did)){
      index.set(did,{
        f1Years:new Set(),lowerYears:new Set(),teams:new Set(),
        starts:0,wins:0,podiums:0,poles:0,
      });
    }
    const rec=index.get(did);
    const year=num(first(row,["year","season_year"],null),null);
    const series=String(first(row,["series_division","series","division"],"F1")||"F1").toUpperCase();
    if(year!=null){
      if(series==="F1"||series==="FORMULA 1"||series==="FORMULA_1")rec.f1Years.add(year);
      else rec.lowerYears.add(year);
    }
    const tid=teamId(row); if(tid)rec.teams.add(tid);
    rec.starts+=Math.max(0,num(first(row,["starts","races"],0),0));
    rec.wins+=Math.max(0,num(first(row,["wins"],0),0));
    rec.podiums+=Math.max(0,num(first(row,["podiums"],0),0));
    rec.poles+=Math.max(0,num(first(row,["poles"],0),0));
  }
  return index;
}

function freshAccumulator(driver){
  return {
    driver_id:driverId(driver),
    display_name:driverName(driver),
    eventYears:new Set(),
    teamIds:new Set(),
    event_records:0,
    starts:0,
    qualifying:0,
    classified_finishes:0,
    teammate_qualifying:0,
    teammate_race:0,
    car_context:0,
    dnq:0,
    dnf:0,
    wins:0,
    podiums:0,
    poles:0,
    fastest_laps:0,
    points:0,
    gridPercentiles:[],
    finishPercentiles:[],
    teammateQualifying:[],
    teammateRace:[],
    carAdjustedQualifying:[],
    carAdjustedRace:[],
    gridToFinish:[],
    eventRelativePerformance:[],
  };
}

function topMean(values,fraction=0.10){
  const finite=(values||[]).filter(Number.isFinite).sort((a,b)=>b-a);
  if(!finite.length)return null;
  const count=Math.max(1,Math.min(5,Math.ceil(finite.length*fraction)));
  return mean(finite.slice(0,count));
}

function finalizeAccumulator(acc,careerContext){
  const starts=acc.starts;
  const rawSignals={
    mean_grid_percentile:round(mean(acc.gridPercentiles)),
    mean_finish_percentile:round(mean(acc.finishPercentiles)),
    teammate_qualifying_advantage:round(mean(acc.teammateQualifying)),
    teammate_race_advantage:round(mean(acc.teammateRace)),
    car_adjusted_qualifying:round(mean(acc.carAdjustedQualifying)),
    car_adjusted_race:round(mean(acc.carAdjustedRace)),
    grid_to_finish:round(mean(acc.gridToFinish)),
    peak_relative_performance:round(topMean(acc.eventRelativePerformance)),
    performance_variability:round(deviation(acc.eventRelativePerformance)),
  };

  const adjustedSignals={
    teammate_qualifying_advantage:round(reliabilityAdjusted(rawSignals.teammate_qualifying_advantage,acc.teammateQualifying.length,10)),
    teammate_race_advantage:round(reliabilityAdjusted(rawSignals.teammate_race_advantage,acc.teammateRace.length,10)),
    car_adjusted_qualifying:round(reliabilityAdjusted(rawSignals.car_adjusted_qualifying,acc.carAdjustedQualifying.length,8)),
    car_adjusted_race:round(reliabilityAdjusted(rawSignals.car_adjusted_race,acc.carAdjustedRace.length,8)),
    grid_to_finish:round(reliabilityAdjusted(rawSignals.grid_to_finish,acc.gridToFinish.length,8)),
    peak_relative_performance:round(reliabilityAdjusted(rawSignals.peak_relative_performance,acc.eventRelativePerformance.length,12)),
  };

  const sample={
    event_records:acc.event_records,
    starts,
    seasons:acc.eventYears.size,
    teams:acc.teamIds.size,
    qualifying:acc.qualifying,
    classified_finishes:acc.classified_finishes,
    teammate_qualifying:acc.teammateQualifying.length,
    teammate_race:acc.teammateRace.length,
    car_context:acc.car_context,
    dnq:acc.dnq,
    dnf:acc.dnf,
  };
  const confidence=evidenceConfidence(sample);
  const flags=[];
  if(acc.event_records===0)flags.push("NO_F1_RACE_EVIDENCE");
  else if(starts<10)flags.push("LOW_RACE_SAMPLE");
  if(starts>0&&acc.teammateQualifying.length<Math.min(10,starts*0.25))flags.push("SPARSE_TEAMMATE_QUALIFYING");
  if(starts>0&&acc.teammateRace.length<Math.min(10,starts*0.25))flags.push("SPARSE_TEAMMATE_RACE");
  if(starts>0&&acc.car_context<starts*0.5)flags.push("SPARSE_CAR_CONTEXT");
  if(starts>0&&acc.qualifying<starts*0.5)flags.push("SPARSE_GRID_DATA");

  return {
    driver_id:acc.driver_id,
    display_name:acc.display_name,
    evidence_scope:"historical_f1_results",
    sample,
    achievement_context:{
      wins:acc.wins,
      podiums:acc.podiums,
      poles:acc.poles,
      fastest_laps:acc.fastest_laps,
      points:round(acc.points,3),
      win_rate:starts?round(acc.wins/starts):null,
      podium_rate:starts?round(acc.podiums/starts):null,
      pole_rate:acc.qualifying?round(acc.poles/acc.qualifying):null,
      dnf_rate:starts?round(acc.dnf/starts):null,
    },
    career_context:{
      f1_seasons:careerContext?.f1Years?.size??0,
      lower_series_seasons:careerContext?.lowerYears?.size??0,
      historical_teams:careerContext?.teams?.size??0,
      career_rows_starts:careerContext?.starts??0,
      career_rows_wins:careerContext?.wins??0,
      career_rows_podiums:careerContext?.podiums??0,
      career_rows_poles:careerContext?.poles??0,
    },
    raw_signals:rawSignals,
    reliability_adjusted_signals:adjustedSignals,
    confidence,
    evidence_flags:flags,
  };
}

function percentileMap(rows,valueFn){
  const values=[];
  for(const row of rows){
    const value=valueFn(row);
    if(Number.isFinite(value))values.push({id:row.driver_id,value});
  }
  const sorted=values.map(item=>item.value).sort((a,b)=>a-b);
  const map=new Map();
  if(!sorted.length)return map;

  for(const item of values){
    let first=sorted.findIndex(value=>value===item.value);
    let last=first;
    while(last+1<sorted.length&&sorted[last+1]===item.value)last+=1;
    const averageIndex=(first+last)/2;
    const percentile=sorted.length===1?50:(averageIndex/(sorted.length-1))*100;
    map.set(item.id,round(percentile,1));
  }
  return map;
}

function weightedAvailable(parts=[]){
  let total=0;
  let weight=0;
  for(const [value,w] of parts){
    if(!Number.isFinite(value)||!Number.isFinite(w)||w<=0)continue;
    total+=value*w;
    weight+=w;
  }
  return weight?round(total/weight,1):null;
}

export function attachTalentEvidencePercentiles(rows=[]){
  const source=(Array.isArray(rows)?rows:[]).map(row=>({...row}));
  const adjusted=(row,key)=>num(row?.reliability_adjusted_signals?.[key],null);
  const raw=(row,key)=>num(row?.raw_signals?.[key],null);

  const maps={
    teammate_qualifying:percentileMap(source,row=>adjusted(row,"teammate_qualifying_advantage")),
    teammate_race:percentileMap(source,row=>adjusted(row,"teammate_race_advantage")),
    car_qualifying:percentileMap(source,row=>adjusted(row,"car_adjusted_qualifying")),
    car_race:percentileMap(source,row=>adjusted(row,"car_adjusted_race")),
    grid_to_finish:percentileMap(source,row=>adjusted(row,"grid_to_finish")),
    peak:percentileMap(source,row=>adjusted(row,"peak_relative_performance")),
    consistency:percentileMap(source,row=>{
      const value=raw(row,"performance_variability");
      return Number.isFinite(value)?-value:null;
    }),
  };

  return source.map(row=>{
    const id=row.driver_id;
    const qualifying=weightedAvailable([
      [maps.teammate_qualifying.get(id),0.60],
      [maps.car_qualifying.get(id),0.40],
    ]);
    const race=weightedAvailable([
      [maps.teammate_race.get(id),0.45],
      [maps.car_race.get(id),0.35],
      [maps.grid_to_finish.get(id),0.20],
    ]);
    const peak=maps.peak.get(id)??null;
    const consistency=maps.consistency.get(id)??null;
    const composite=weightedAvailable([
      [qualifying,0.35],
      [race,0.40],
      [peak,0.20],
      [consistency,0.05],
    ]);
    return {
      ...row,
      comparative_evidence_percentiles:{
        qualifying,
        race,
        peak,
        consistency,
        composite,
      },
    };
  });
}

export function buildDriverTalentEvidence({
  drivers=[],
  events=[],
  carCompetitiveness=[],
  careerRows=[],
}={}){
  const driverList=Array.isArray(drivers)?drivers:[];
  const accById=new Map();
  for(const driver of driverList){
    const id=driverId(driver);
    if(id&&!accById.has(id))accById.set(id,freshAccumulator(driver));
  }

  const carIndex=carContextIndex(carCompetitiveness);
  const careerIndex=careerContextIndex(careerRows);

  for(const event of Array.isArray(events)?events:[]){
    const year=num(first(event,["year","season_year"],null),null);
    const classification=Array.isArray(event?.classification)?event.classification:[];
    if(year==null||!classification.length)continue;

    const infoRows=classification.map(row=>({row,info:historicalResultInfo(row)}));
    const starters=infoRows.filter(item=>item.info.started);
    const fieldSize=Math.max(1,starters.length);

    const teamRows=new Map();
    for(const item of infoRows){
      const tid=teamId(item.row);
      if(!tid)continue;
      if(!teamRows.has(tid))teamRows.set(tid,[]);
      teamRows.get(tid).push(item);
    }

    for(const item of infoRows){
      const row=item.row;
      const info=item.info;
      const did=driverId(row);
      const acc=accById.get(did);
      if(!acc)continue;

      const tid=teamId(row);
      const grid=num(first(row,["grid","grid_position","starting_grid"],null),null);
      const position=num(first(row,["position","finish_position","pos"],null),null);
      const validGrid=grid!=null&&grid>0;
      const finishEligible=info.started&&position!=null&&position>0&&!["dnf","dsq","excluded"].includes(info.key);

      acc.event_records+=1;
      acc.eventYears.add(year);
      if(tid)acc.teamIds.add(tid);
      if(info.key==="dnq")acc.dnq+=1;
      if(!info.started)continue;

      acc.starts+=1;
      if(info.isDnf)acc.dnf+=1;
      acc.points+=Math.max(0,num(first(row,["points"],0),0));
      if(row?.fastest_lap===true)acc.fastest_laps+=1;

      const peers=(teamRows.get(tid)||[]).filter(peer=>driverId(peer.row)!==did);
      const eventSignals=[];

      if(validGrid){
        acc.qualifying+=1;
        if(grid===1)acc.poles+=1;
        const gridPct=positionPercentile(grid,fieldSize);
        if(gridPct!=null)acc.gridPercentiles.push(gridPct);

        const peerQualifying=peers
          .map(peer=>normalizedPositionDelta(grid,first(peer.row,["grid","grid_position","starting_grid"],null),fieldSize))
          .filter(Number.isFinite);
        if(peerQualifying.length){
          const peerSignal=mean(peerQualifying);
          acc.teammateQualifying.push(...peerQualifying);
          eventSignals.push(peerSignal);
        }

        const car=carIndex.get(String(year)+"|"+tid);
        const qIndex=num(first(car,["qualifying_index","overall_competitiveness_proxy"],null),null);
        if(qIndex!=null&&gridPct!=null){
          const adjusted=clamp(gridPct-clamp(qIndex/100),-1,1);
          acc.carAdjustedQualifying.push(adjusted);
          acc.car_context+=1;
          eventSignals.push(adjusted);
        }
      }

      if(finishEligible){
        acc.classified_finishes+=1;
        if(position===1)acc.wins+=1;
        if(position<=3)acc.podiums+=1;

        const finishPct=positionPercentile(position,fieldSize);
        if(finishPct!=null)acc.finishPercentiles.push(finishPct);
        if(validGrid){
          const gain=normalizedPositionDelta(position,grid,fieldSize);
          // normalizedPositionDelta(a,b) is positive when a is the better
          // position, so comparing finish to grid gives positions gained.
          if(gain!=null){
            acc.gridToFinish.push(gain);
            eventSignals.push(gain);
          }
        }

        const peerRace=peers
          .filter(peer=>{
            const peerPos=num(first(peer.row,["position","finish_position","pos"],null),null);
            return peer.info.started&&peerPos!=null&&peerPos>0&&!["dnf","dsq","excluded"].includes(peer.info.key);
          })
          .map(peer=>normalizedPositionDelta(position,first(peer.row,["position","finish_position","pos"],null),fieldSize))
          .filter(Number.isFinite);
        if(peerRace.length){
          const peerSignal=mean(peerRace);
          acc.teammateRace.push(...peerRace);
          eventSignals.push(peerSignal);
        }

        const car=carIndex.get(String(year)+"|"+tid);
        const overall=num(first(car,["overall_competitiveness_proxy","finish_index"],null),null);
        if(overall!=null&&finishPct!=null){
          const adjusted=clamp(finishPct-clamp(overall/100),-1,1);
          acc.carAdjustedRace.push(adjusted);
          if(!validGrid)acc.car_context+=1;
          eventSignals.push(adjusted);
        }
      }

      if(eventSignals.length)acc.eventRelativePerformance.push(mean(eventSignals));
    }
  }

  const finalized=[...accById.values()]
    .map(acc=>finalizeAccumulator(acc,careerIndex.get(acc.driver_id)))
    .sort((a,b)=>a.driver_id.localeCompare(b.driver_id));

  return attachTalentEvidencePercentiles(finalized);
}

export function buildDriverTalentEvidenceAudit(rows=[]){
  const source=Array.isArray(rows)?rows:[];
  const confidence_counts={};
  for(const row of source){
    const band=String(row?.confidence?.band||"INSUFFICIENT");
    confidence_counts[band]=(confidence_counts[band]||0)+1;
  }

  const signalFields=[
    "teammate_qualifying_advantage",
    "teammate_race_advantage",
    "car_adjusted_qualifying",
    "car_adjusted_race",
    "grid_to_finish",
    "peak_relative_performance",
    "performance_variability",
  ];
  const signal_coverage=Object.fromEntries(signalFields.map(key=>[
    key,
    source.filter(row=>Number.isFinite(num(
      row?.raw_signals?.[key]??row?.reliability_adjusted_signals?.[key],
      null
    ))).length,
  ]));

  const top_relative_evidence=source
    .filter(row=>num(row?.sample?.starts,0)>=20&&Number.isFinite(num(row?.comparative_evidence_percentiles?.composite,null)))
    .sort((a,b)=>
      num(b?.comparative_evidence_percentiles?.composite,0)-num(a?.comparative_evidence_percentiles?.composite,0)||
      num(b?.sample?.starts,0)-num(a?.sample?.starts,0)||
      String(a?.display_name||"").localeCompare(String(b?.display_name||""))
    )
    .slice(0,25)
    .map(row=>({
      driver_id:row.driver_id,
      display_name:row.display_name,
      starts:row.sample.starts,
      confidence:row.confidence.band,
      comparative_evidence_percentile:row.comparative_evidence_percentiles.composite,
    }));

  const high_evidence_low_confidence=source
    .filter(row=>
      num(row?.comparative_evidence_percentiles?.composite,0)>=90&&
      num(row?.confidence?.score,0)<40
    )
    .sort((a,b)=>num(b?.comparative_evidence_percentiles?.composite,0)-num(a?.comparative_evidence_percentiles?.composite,0))
    .slice(0,50)
    .map(row=>({
      driver_id:row.driver_id,
      display_name:row.display_name,
      starts:row.sample.starts,
      confidence_score:row.confidence.score,
      comparative_evidence_percentile:row.comparative_evidence_percentiles.composite,
    }));

  return {
    format:"f1ml-driver-talent-evidence-audit",
    schema_version:1,
    generated_at:null,
    stage:"D7.R1A",
    authority:"analysis_only",
    total_drivers:source.length,
    drivers_with_f1_event_records:source.filter(row=>num(row?.sample?.event_records,0)>0).length,
    drivers_with_f1_starts:source.filter(row=>num(row?.sample?.starts,0)>0).length,
    confidence_counts,
    signal_coverage,
    top_relative_evidence,
    high_evidence_low_confidence,
    notes:[
      "Comparative evidence percentiles are diagnostics, not gameplay ratings or Talent Profile ceilings.",
      "Teammate and car-adjusted signals are reliability-shrunk so tiny samples cannot masquerade as high-confidence talent.",
      "DNFs are retained as context only and are not automatically treated as driver-error or crash-talent evidence.",
      "Wet, technical feedback, leadership and team-player talent are not inferred from race results in D7.R1A without dedicated evidence.",
      "Historical achievements are reported separately from relative-performance evidence to avoid equating trophies with talent.",
    ],
  };
}
