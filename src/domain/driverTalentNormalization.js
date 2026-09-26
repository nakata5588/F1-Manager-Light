// src/domain/driverTalentNormalization.js
// D7.R1B — Era & Opposition Normalization.
//
// This remains analysis-only. It normalizes the R1A historical evidence inside
// each season, then applies a conservative teammate/opposition-strength pass.
// It does NOT create gameplay ratings, potential or permanent Talent ceilings.

import { historicalResultInfo } from "./historicalRaceStatus.js";

const clamp=(value,min=0,max=1)=>Math.max(min,Math.min(max,value));
const round=(value,digits=4)=>{
  if(!Number.isFinite(value))return null;
  const factor=10**digits;
  return Math.round(value*factor)/factor;
};
const num=(value,fallback=null)=>{
  if(value===undefined||value===null||value==="")return fallback;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const first=(row,keys,fallback=null)=>{
  for(const key of keys){
    const value=row?.[key];
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

function positionPercentile(position,fieldSize){
  const pos=num(position,null);
  const size=Math.max(1,num(fieldSize,1));
  if(pos==null||pos<=0)return null;
  if(size<=1)return 0.5;
  return clamp(1-(pos-1)/(size-1));
}

function normalizedPositionDelta(own,other,fieldSize){
  const a=num(own,null);
  const b=num(other,null);
  const size=Math.max(2,num(fieldSize,2));
  if(a==null||b==null||a<=0||b<=0)return null;
  return clamp((b-a)/(size-1),-1,1);
}

function reliabilityAdjusted(value,sampleSize,priorWeight=6){
  if(!Number.isFinite(value))return null;
  const n=Math.max(0,num(sampleSize,0));
  return value*(n/(n+Math.max(0,priorWeight)));
}

function percentileForValue(values,value){
  const sorted=(values||[]).filter(Number.isFinite).sort((a,b)=>a-b);
  if(!sorted.length||!Number.isFinite(value))return null;
  if(sorted.length===1)return 50;
  let firstIndex=sorted.findIndex(item=>item===value);
  if(firstIndex<0){
    let lower=0;
    while(lower<sorted.length&&sorted[lower]<value)lower+=1;
    return round((lower/(sorted.length-1))*100,1);
  }
  let lastIndex=firstIndex;
  while(lastIndex+1<sorted.length&&sorted[lastIndex+1]===value)lastIndex+=1;
  return round((((firstIndex+lastIndex)/2)/(sorted.length-1))*100,1);
}

function weightedAverage(parts=[]){
  let total=0;
  let weight=0;
  for(const [value,w] of parts){
    if(!Number.isFinite(value)||!Number.isFinite(w)||w<=0)continue;
    total+=value*w;
    weight+=w;
  }
  return weight?total/weight:null;
}

function topMean(values,fraction=0.10){
  const finite=(values||[]).filter(Number.isFinite).sort((a,b)=>b-a);
  if(!finite.length)return null;
  const count=Math.max(1,Math.min(5,Math.ceil(finite.length*fraction)));
  return mean(finite.slice(0,count));
}

function carPercentileIndex(rows=[]){
  const byYear=new Map();
  for(const row of Array.isArray(rows)?rows:[]){
    const year=num(first(row,["year","season_year"],null),null);
    const tid=teamId(row);
    if(year==null||!tid)continue;
    if(!byYear.has(year))byYear.set(year,[]);
    byYear.get(year).push(row);
  }

  const index=new Map();
  for(const [year,yearRows] of byYear.entries()){
    const qualifyingValues=yearRows
      .map(row=>num(first(row,["qualifying_index","overall_competitiveness_proxy"],null),null))
      .filter(Number.isFinite);
    const raceValues=yearRows
      .map(row=>num(first(row,["overall_competitiveness_proxy","finish_index"],null),null))
      .filter(Number.isFinite);

    for(const row of yearRows){
      const tid=teamId(row);
      const qualifyingRaw=num(first(row,["qualifying_index","overall_competitiveness_proxy"],null),null);
      const raceRaw=num(first(row,["overall_competitiveness_proxy","finish_index"],null),null);
      index.set(String(year)+"|"+tid,{
        qualifying:qualifyingRaw==null?null:percentileForValue(qualifyingValues,qualifyingRaw)/100,
        race:raceRaw==null?null:percentileForValue(raceValues,raceRaw)/100,
      });
    }
  }
  return index;
}

function freshSeason(driver_id,year){
  return {
    driver_id,
    year,
    starts:0,
    qualifying:0,
    classified_finishes:0,
    gridPercentiles:[],
    finishPercentiles:[],
    teammateQualifying:[],
    teammateRace:[],
    teammateQualifyingComparisons:[],
    teammateRaceComparisons:[],
    carAdjustedQualifying:[],
    carAdjustedRace:[],
    raceExecution:[],
    eventPerformance:[],
  };
}

function getSeason(index,did,year){
  const key=did+"|"+year;
  if(!index.has(key))index.set(key,freshSeason(did,year));
  return index.get(key);
}

function finishEligible(item){
  const position=num(first(item?.row,["position","finish_position","pos"],null),null);
  return Boolean(
    item?.info?.started&&
    position!=null&&position>0&&
    !["dnf","dsq","excluded"].includes(item?.info?.key)
  );
}

function buildSeasonEvidence(events=[],carCompetitiveness=[]){
  const seasons=new Map();
  const carIndex=carPercentileIndex(carCompetitiveness);

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
      if(!did||!info.started)continue;

      const season=getSeason(seasons,did,year);
      season.starts+=1;

      const tid=teamId(row);
      const grid=num(first(row,["grid","grid_position","starting_grid"],null),null);
      const position=num(first(row,["position","finish_position","pos"],null),null);
      const validGrid=grid!=null&&grid>0;
      const eligibleFinish=finishEligible(item);
      const peers=(teamRows.get(tid)||[]).filter(peer=>driverId(peer.row)!==did);
      const car=carIndex.get(String(year)+"|"+tid)||{};
      const eventSignals=[];
      const eventTeammateSignals=[];

      let gridPct=null;
      if(validGrid){
        season.qualifying+=1;
        gridPct=positionPercentile(grid,fieldSize);
        if(gridPct!=null)season.gridPercentiles.push(gridPct);

        for(const peer of peers){
          const peerGrid=first(peer.row,["grid","grid_position","starting_grid"],null);
          const value=normalizedPositionDelta(grid,peerGrid,fieldSize);
          if(!Number.isFinite(value))continue;
          season.teammateQualifying.push(value);
          eventTeammateSignals.push(value);
          season.teammateQualifyingComparisons.push({
            peer_id:driverId(peer.row),
            value,
          });
        }

        if(Number.isFinite(car.qualifying)&&gridPct!=null){
          const adjusted=clamp(gridPct-car.qualifying,-1,1);
          season.carAdjustedQualifying.push(adjusted);
          eventSignals.push(adjusted);
        }
      }

      if(eligibleFinish){
        season.classified_finishes+=1;
        const finishPct=positionPercentile(position,fieldSize);
        if(finishPct!=null)season.finishPercentiles.push(finishPct);

        for(const peer of peers.filter(finishEligible)){
          const peerPosition=first(peer.row,["position","finish_position","pos"],null);
          const value=normalizedPositionDelta(position,peerPosition,fieldSize);
          if(!Number.isFinite(value))continue;
          season.teammateRace.push(value);
          eventTeammateSignals.push(value);
          season.teammateRaceComparisons.push({
            peer_id:driverId(peer.row),
            value,
          });
        }

        if(Number.isFinite(car.race)&&finishPct!=null){
          const adjusted=clamp(finishPct-car.race,-1,1);
          season.carAdjustedRace.push(adjusted);
          eventSignals.push(adjusted);
        }

        // R1A used only positions gained/lost. That systematically under-valued
        // drivers starting near the front because P1 -> P1 has zero "gain".
        // R1B instead measures the residual against an expected finish derived
        // from grid quality and machinery context, while finish quality remains
        // an independent signal in the season-normalized race score.
        if(finishPct!=null){
          const expectationParts=[];
          if(gridPct!=null)expectationParts.push([gridPct,0.70]);
          if(Number.isFinite(car.race))expectationParts.push([car.race,0.30]);
          const expected=weightedAverage(expectationParts);
          if(Number.isFinite(expected)){
            const residual=clamp(finishPct-expected,-1,1);
            season.raceExecution.push(residual);
            eventSignals.push(residual);
          }
          // Raw finish quality is intentionally represented in peak evidence:
          // a dominant front-running result is evidence even when no positions
          // were available to gain.
          eventSignals.push(finishPct-0.5);
        }
      }

      if(eventTeammateSignals.length)eventSignals.push(mean(eventTeammateSignals));
      if(eventSignals.length)season.eventPerformance.push(mean(eventSignals));
    }
  }

  return [...seasons.values()].map(season=>{
    const raw={
      mean_grid_percentile:round(mean(season.gridPercentiles)),
      mean_finish_percentile:round(mean(season.finishPercentiles)),
      teammate_qualifying_advantage:round(mean(season.teammateQualifying)),
      teammate_race_advantage:round(mean(season.teammateRace)),
      car_adjusted_qualifying:round(mean(season.carAdjustedQualifying)),
      car_adjusted_race:round(mean(season.carAdjustedRace)),
      race_execution_vs_expectation:round(mean(season.raceExecution)),
      peak_relative_performance:round(topMean(season.eventPerformance)),
      performance_variability:round(deviation(season.eventPerformance)),
    };
    const adjusted={
      teammate_qualifying_advantage:round(reliabilityAdjusted(
        raw.teammate_qualifying_advantage,season.teammateQualifying.length,4
      )),
      teammate_race_advantage:round(reliabilityAdjusted(
        raw.teammate_race_advantage,season.teammateRace.length,4
      )),
      car_adjusted_qualifying:round(reliabilityAdjusted(
        raw.car_adjusted_qualifying,season.carAdjustedQualifying.length,4
      )),
      car_adjusted_race:round(reliabilityAdjusted(
        raw.car_adjusted_race,season.carAdjustedRace.length,4
      )),
      race_execution_vs_expectation:round(reliabilityAdjusted(
        raw.race_execution_vs_expectation,season.raceExecution.length,4
      )),
      peak_relative_performance:round(reliabilityAdjusted(
        raw.peak_relative_performance,season.eventPerformance.length,6
      )),
    };
    return {
      ...season,
      raw_signals:raw,
      reliability_adjusted_signals:adjusted,
    };
  });
}

function percentileMap(rows,valueFn){
  const values=rows.map(valueFn).filter(Number.isFinite);
  const map=new Map();
  for(const row of rows){
    const value=valueFn(row);
    if(!Number.isFinite(value))continue;
    map.set(row.driver_id,percentileForValue(values,value));
  }
  return map;
}

function normalizeSeasons(seasonRows=[]){
  const byYear=new Map();
  for(const row of seasonRows){
    if(!byYear.has(row.year))byYear.set(row.year,[]);
    byYear.get(row.year).push(row);
  }

  const normalized=[];
  for(const [year,rows] of byYear.entries()){
    const adjusted=(row,key)=>num(row?.reliability_adjusted_signals?.[key],null);
    const raw=(row,key)=>num(row?.raw_signals?.[key],null);
    const maps={
      grid:percentileMap(rows,row=>raw(row,"mean_grid_percentile")),
      finish:percentileMap(rows,row=>raw(row,"mean_finish_percentile")),
      teammateQ:percentileMap(rows,row=>adjusted(row,"teammate_qualifying_advantage")),
      teammateR:percentileMap(rows,row=>adjusted(row,"teammate_race_advantage")),
      carQ:percentileMap(rows,row=>adjusted(row,"car_adjusted_qualifying")),
      carR:percentileMap(rows,row=>adjusted(row,"car_adjusted_race")),
      execution:percentileMap(rows,row=>adjusted(row,"race_execution_vs_expectation")),
      peak:percentileMap(rows,row=>adjusted(row,"peak_relative_performance")),
      consistency:percentileMap(rows,row=>{
        const value=raw(row,"performance_variability");
        return Number.isFinite(value)?-value:null;
      }),
    };

    for(const row of rows){
      const id=row.driver_id;
      const qualifying=weightedAverage([
        [maps.grid.get(id),0.20],
        [maps.teammateQ.get(id),0.45],
        [maps.carQ.get(id),0.35],
      ]);
      const race=weightedAverage([
        [maps.finish.get(id),0.30],
        [maps.teammateR.get(id),0.30],
        [maps.carR.get(id),0.20],
        [maps.execution.get(id),0.20],
      ]);
      const peak=maps.peak.get(id)??null;
      const consistency=maps.consistency.get(id)??null;
      const composite=weightedAverage([
        [qualifying,0.35],
        [race,0.40],
        [peak,0.20],
        [consistency,0.05],
      ]);

      normalized.push({
        ...row,
        season_percentiles:{
          qualifying:round(qualifying,1),
          race:round(race,1),
          peak:round(peak,1),
          consistency:round(consistency,1),
          composite:round(composite,1),
        },
      });
    }
  }
  return normalized.sort((a,b)=>a.year-b.year||a.driver_id.localeCompare(b.driver_id));
}

function aggregateEraNormalized(rows=[]){
  const byDriver=new Map();
  for(const row of rows){
    if(!byDriver.has(row.driver_id))byDriver.set(row.driver_id,[]);
    byDriver.get(row.driver_id).push(row);
  }

  const out=new Map();
  for(const [did,seasons] of byDriver.entries()){
    const parts=(key)=>seasons.map(row=>[
      num(row?.season_percentiles?.[key],null),
      Math.max(0.15,Math.min(1,num(row?.starts,0)/10)),
    ]);
    const qualifying=round(weightedAverage(parts("qualifying")),1);
    const race=round(weightedAverage(parts("race")),1);
    const consistency=round(weightedAverage(parts("consistency")),1);

    // Peak is intentionally NOT a career-average signal. Averaging every
    // season punishes long careers because development/decline years dilute
    // the driver's actual peak. Use the best quarter of season-level peak
    // evidence (capped by topMean) and keep career-average Q/R separate.
    const peak=round(topMean(
      seasons.map(row=>num(row?.season_percentiles?.peak,null)).filter(Number.isFinite),
      0.25
    ),1);
    const composite=round(weightedAverage([
      [qualifying,0.35],
      [race,0.40],
      [peak,0.20],
      [consistency,0.05],
    ]),1);

    out.set(did,{
      qualifying,
      race,
      peak,
      consistency,
      composite,
      seasons:seasons.length,
    });
  }
  return out;
}

function comparisonContext(seasonRows=[],baselineStrength=new Map()){
  const byDriver=new Map();
  for(const row of seasonRows){
    if(!byDriver.has(row.driver_id)){
      byDriver.set(row.driver_id,{
        q:[],race:[],teammateStrength:[],
      });
    }
    const rec=byDriver.get(row.driver_id);
    for(const comp of row.teammateQualifyingComparisons||[]){
      const strength=num(baselineStrength.get(comp.peer_id),50);
      rec.teammateStrength.push(strength);
      // Maximum correction is +/-0.10 in normalized-position units.
      rec.q.push(clamp(comp.value+((strength-50)/500),-1,1));
    }
    for(const comp of row.teammateRaceComparisons||[]){
      const strength=num(baselineStrength.get(comp.peer_id),50);
      rec.teammateStrength.push(strength);
      rec.race.push(clamp(comp.value+((strength-50)/500),-1,1));
    }
  }
  return byDriver;
}

function fieldStrengthContext(events=[],baselineStrength=new Map()){
  const byDriver=new Map();
  for(const event of Array.isArray(events)?events:[]){
    const infoRows=(Array.isArray(event?.classification)?event.classification:[])
      .map(row=>({row,info:historicalResultInfo(row)}))
      .filter(item=>item.info.started&&driverId(item.row));
    const ids=infoRows.map(item=>driverId(item.row));
    for(const did of ids){
      const peers=ids
        .filter(id=>id!==did)
        .map(id=>num(baselineStrength.get(id),null))
        .filter(Number.isFinite);
      if(!peers.length)continue;
      if(!byDriver.has(did))byDriver.set(did,[]);
      byDriver.get(did).push(mean(peers));
    }
  }
  return new Map([...byDriver.entries()].map(([did,values])=>[did,mean(values)]));
}

function finalOppositionNormalization({
  baseEvidence=[],
  seasonRows=[],
  eraByDriver=new Map(),
  events=[],
}={}){
  const baselineStrength=new Map(
    baseEvidence.map(row=>[
      row.driver_id,
      num(eraByDriver.get(row.driver_id)?.composite,50),
    ])
  );
  const comparisons=comparisonContext(seasonRows,baselineStrength);
  const fields=fieldStrengthContext(events,baselineStrength);

  const oppRows=baseEvidence.map(row=>{
    const did=row.driver_id;
    const rec=comparisons.get(did)||{q:[],race:[],teammateStrength:[]};
    return {
      driver_id:did,
      q:round(reliabilityAdjusted(mean(rec.q),rec.q.length,10)),
      race:round(reliabilityAdjusted(mean(rec.race),rec.race.length,10)),
      teammate_strength:round(mean(rec.teammateStrength),1),
      field_strength:round(fields.get(did),1),
    };
  });
  const qMap=percentileMap(oppRows,row=>row.q);
  const raceMap=percentileMap(oppRows,row=>row.race);

  return baseEvidence.map(row=>{
    const did=row.driver_id;
    const era=eraByDriver.get(did)||{};
    const opp=oppRows.find(item=>item.driver_id===did)||{};
    const field=num(opp.field_strength,50);
    const fieldAdjustment=(field-50)*0.06;

    const qualifying=clamp(
      weightedAverage([
        [num(era.qualifying,null),0.80],
        [num(qMap.get(did),null),0.20],
      ])??num(era.qualifying,50),
      0,100
    );
    const race=clamp(
      weightedAverage([
        [num(era.race,null),0.78],
        [num(raceMap.get(did),null),0.22],
      ])??num(era.race,50),
      0,100
    );
    const peak=Number.isFinite(num(era.peak,null))
      ?clamp(num(era.peak,50)+fieldAdjustment*0.50,0,100)
      :null;
    const consistency=num(era.consistency,null);

    const finalQ=clamp(qualifying+fieldAdjustment,0,100);
    const finalRace=clamp(race+fieldAdjustment,0,100);
    const composite=weightedAverage([
      [finalQ,0.35],
      [finalRace,0.40],
      [peak,0.20],
      [consistency,0.05],
    ]);

    const seasonSummary=seasonRows
      .filter(item=>item.driver_id===did)
      .map(item=>({
        year:item.year,
        starts:item.starts,
        qualifying:item.season_percentiles.qualifying,
        race:item.season_percentiles.race,
        peak:item.season_percentiles.peak,
        consistency:item.season_percentiles.consistency,
        composite:item.season_percentiles.composite,
      }));

    return {
      ...row,
      r1a_comparative_evidence_percentiles:row.comparative_evidence_percentiles,
      era_normalized_percentiles:{
        qualifying:num(era.qualifying,null),
        race:num(era.race,null),
        peak:num(era.peak,null),
        consistency:num(era.consistency,null),
        composite:num(era.composite,null),
      },
      opposition_context:{
        average_teammate_strength:num(opp.teammate_strength,null),
        average_field_strength:num(opp.field_strength,null),
        opponent_adjusted_qualifying_signal:num(opp.q,null),
        opponent_adjusted_race_signal:num(opp.race,null),
        opponent_adjusted_qualifying_percentile:num(qMap.get(did),null),
        opponent_adjusted_race_percentile:num(raceMap.get(did),null),
      },
      comparative_evidence_percentiles:{
        qualifying:round(finalQ,1),
        race:round(finalRace,1),
        peak:round(peak,1),
        consistency:round(consistency,1),
        composite:round(composite,1),
      },
      normalization_context:{
        stage:"D7.R1B",
        model:"season_percentile_plus_opposition_strength_v1",
        car_context:"within-season team percentile",
        active_seasons:num(era.seasons,0),
        season_evidence:seasonSummary,
      },
    };
  });
}

export function applyDriverTalentNormalization({
  baseEvidence=[],
  events=[],
  carCompetitiveness=[],
}={}){
  const source=Array.isArray(baseEvidence)?baseEvidence:[];
  if(!source.length)return [];

  const seasonEvidence=buildSeasonEvidence(events,carCompetitiveness);
  const normalizedSeasons=normalizeSeasons(seasonEvidence);
  const eraByDriver=aggregateEraNormalized(normalizedSeasons);

  return finalOppositionNormalization({
    baseEvidence:source,
    seasonRows:normalizedSeasons,
    eraByDriver,
    events,
  });
}

export const __driverTalentNormalizationInternals={
  carPercentileIndex,
  buildSeasonEvidence,
  normalizeSeasons,
  aggregateEraNormalized,
};
