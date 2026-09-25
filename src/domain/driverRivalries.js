// src/domain/driverRivalries.js
// D6.3E — persistent Driver ↔ Driver rivalries.
// Rivalry is a Save World outcome. Historical real-life rivalries are not seeded
// here: starting conditions remain factual, while alternative-future rivalries
// emerge from races completed inside the career.

export const DRIVER_RIVALRY_VERSION=1;

const text=(value)=>String(value??"").trim();
const num=(value,fb=null)=>{
  const n=Number(value);
  return Number.isFinite(n)?n:fb;
};
const clamp100=(value)=>Math.max(0,Math.min(100,Number(value)||0));

export function rivalryPairKey(driverA,driverB){
  const ids=[text(driverA),text(driverB)].filter(Boolean).sort();
  return ids.length===2&&ids[0]!==ids[1]?ids.join("|"):"";
}

export function globalRivalryBand(value){
  const rivalry=Number(value);
  if(!Number.isFinite(rivalry)||rivalry<15)return "emerging";
  if(rivalry<35)return "competitive";
  if(rivalry<60)return "rivalry";
  if(rivalry<80)return "intense";
  return "defining";
}

function normalizeContainer(gs){
  const raw=gs?.driverRivalries;
  return {
    version:DRIVER_RIVALRY_VERSION,
    pairs:raw?.pairs&&typeof raw.pairs==="object"&&!Array.isArray(raw.pairs)
      ?{...raw.pairs}
      :{},
    log:Array.isArray(raw?.log)?raw.log.slice():[],
  };
}

function basePair(driverA,driverB,{year=null,dateISO=null}={}){
  const [a,b]=[text(driverA),text(driverB)].sort();
  return {
    driver_a_id:a,
    driver_b_id:b,
    rivalry:0,
    respect_a_to_b:50,
    respect_b_to_a:50,
    status:"emerging",
    active:false,
    first_year:Number.isFinite(Number(year))?Number(year):null,
    last_year:Number.isFinite(Number(year))?Number(year):null,
    years:Number.isFinite(Number(year))?[Number(year)]:[],
    first_event_date:dateISO||null,
    last_event_date:dateISO||null,
    events_count:0,
    close_battles:0,
    collisions:0,
    championship_battles:0,
    last_source:null,
    last_reason:null,
  };
}

function respectField(pair,driverId){
  return text(driverId)===text(pair?.driver_a_id)?"respect_a_to_b":"respect_b_to_a";
}

function orderedPairDeltas(pair,driverA,driverB,respectDeltaA,respectDeltaB){
  const aField=respectField(pair,driverA);
  const bField=respectField(pair,driverB);
  return {
    [aField]:Number(respectDeltaA)||0,
    [bField]:Number(respectDeltaB)||0,
  };
}

export function applyDriverRivalryEvent(gs,{
  driverA,
  driverB,
  rivalryDelta=0,
  respectDeltaA=0,
  respectDeltaB=0,
  source="driver_rivalry",
  reason="Competitive interaction",
  meta=null,
  counters={},
}={}){
  if(!gs||typeof gs!=="object")return gs;
  const aid=text(driverA),bid=text(driverB);
  const key=rivalryPairKey(aid,bid);
  if(!key)return gs;

  const container=normalizeContainer(gs);
  const dateISO=text(gs?.currentDateISO).slice(0,10)||null;
  const year=num(gs?.activeYear??String(dateISO||"").slice(0,4),null);
  const before=container.pairs[key]||basePair(aid,bid,{year,dateISO});
  const respectDeltas=orderedPairDeltas(before,aid,bid,respectDeltaA,respectDeltaB);

  const next={...before};
  const changes=[];

  const rivalryBefore=num(before?.rivalry,0);
  const rivalryAfter=clamp100(rivalryBefore+(Number(rivalryDelta)||0));
  if(Math.abs(rivalryAfter-rivalryBefore)>0.0001){
    next.rivalry=Number(rivalryAfter.toFixed(2));
    changes.push({field:"rivalry",delta:Number((rivalryAfter-rivalryBefore).toFixed(2)),before:rivalryBefore,after:Number(rivalryAfter.toFixed(2))});
  }

  for(const field of ["respect_a_to_b","respect_b_to_a"]){
    const delta=Number(respectDeltas[field])||0;
    if(Math.abs(delta)<0.0001)continue;
    const prior=num(before?.[field],50);
    const after=clamp100(prior+delta);
    next[field]=Number(after.toFixed(2));
    changes.push({field,delta:Number((after-prior).toFixed(2)),before:prior,after:Number(after.toFixed(2))});
  }

  const nextYears=new Set((Array.isArray(before?.years)?before.years:[]).map(Number).filter(Number.isFinite));
  if(Number.isFinite(year))nextYears.add(year);
  next.years=[...nextYears].sort((a,b)=>a-b);
  next.first_year=next.years[0]??before?.first_year??null;
  next.last_year=next.years.at(-1)??before?.last_year??null;
  next.first_event_date=before?.first_event_date||dateISO;
  next.last_event_date=dateISO||before?.last_event_date||null;
  next.events_count=Math.max(0,Number(before?.events_count)||0)+1;
  next.close_battles=Math.max(0,Number(before?.close_battles)||0)+Math.max(0,Number(counters?.close_battles)||0);
  next.collisions=Math.max(0,Number(before?.collisions)||0)+Math.max(0,Number(counters?.collisions)||0);
  next.championship_battles=Math.max(0,Number(before?.championship_battles)||0)+Math.max(0,Number(counters?.championship_battles)||0);
  next.status=globalRivalryBand(next.rivalry);
  next.active=Number(next.rivalry)>=15;
  next.last_source=source;
  next.last_reason=reason;
  container.pairs[key]=next;

  const logEntry={
    id:["rivalry",dateISO||"date",key,source,container.log.length+1].join(":"),
    dateISO,
    pair_key:key,
    driver_a_id:next.driver_a_id,
    driver_b_id:next.driver_b_id,
    source,
    reason,
    rivalry_before:rivalryBefore,
    rivalry_after:next.rivalry,
    rivalry_delta:Number((next.rivalry-rivalryBefore).toFixed(2)),
    respect_delta_a:next.driver_a_id===aid?Number(respectDeltaA)||0:Number(respectDeltaB)||0,
    respect_delta_b:next.driver_b_id===bid?Number(respectDeltaB)||0:Number(respectDeltaA)||0,
    meta:meta&&typeof meta==="object"?{...meta}:null,
  };
  container.log=[logEntry,...container.log].slice(0,500);

  return {...gs,driverRivalries:container};
}

export function driverRivalry(gs,driverA,driverB){
  const key=rivalryPairKey(driverA,driverB);
  return key?gs?.driverRivalries?.pairs?.[key]||null:null;
}

export function driverRivalryRecords(gs,driverId,{includeEmerging=true}={}){
  const did=text(driverId);
  if(!did)return [];
  return Object.values(gs?.driverRivalries?.pairs||{})
    .filter((pair)=>text(pair?.driver_a_id)===did||text(pair?.driver_b_id)===did)
    .map((pair)=>{
      const isA=text(pair.driver_a_id)===did;
      return {
        ...pair,
        driver_id:did,
        target_type:"rival",
        target_id:isA?pair.driver_b_id:pair.driver_a_id,
        respect:isA?num(pair.respect_a_to_b,50):num(pair.respect_b_to_a,50),
        target_respect:isA?num(pair.respect_b_to_a,50):num(pair.respect_a_to_b,50),
      };
    })
    .filter((pair)=>includeEmerging||Number(pair?.rivalry)>=15)
    .sort((a,b)=>Number(b?.rivalry||0)-Number(a?.rivalry||0)||Number(b?.last_year||0)-Number(a?.last_year||0));
}

export function driverRivalryEventLogForDriver(gs,driverId){
  const did=text(driverId);
  if(!did)return [];
  return (gs?.driverRivalries?.log||[])
    .filter((entry)=>text(entry?.driver_a_id)===did||text(entry?.driver_b_id)===did)
    .map((entry)=>{
      const isA=text(entry.driver_a_id)===did;
      const respectDelta=isA?Number(entry?.respect_delta_a||0):Number(entry?.respect_delta_b||0);
      const respectBefore=null;
      return {
        id:entry.id,
        dateISO:entry.dateISO,
        driver_id:did,
        target_type:"rival",
        target_id:isA?entry.driver_b_id:entry.driver_a_id,
        source:entry.source,
        reason:entry.reason,
        changes:[
          ...(Math.abs(Number(entry?.rivalry_delta||0))>0.0001?[{field:"rivalry",delta:Number(entry.rivalry_delta),before:entry.rivalry_before,after:entry.rivalry_after}]:[]),
          ...(Math.abs(respectDelta)>0.0001?[{field:"respect",delta:respectDelta,before:respectBefore,after:null}]:[]),
        ],
        meta:entry.meta||null,
      };
    });
}

function isRetired(row){
  return Boolean(row?.retired)||String(row?.status||"").toUpperCase()==="DNF";
}

function collisionLike(value){
  return /collision|contact|accident|crash/i.test(text(value));
}

function incidentPairEvents(resultEntry){
  const events=[];
  const controlIncidents=resultEntry?.raceStrategy?.race_control?.incidents||[];
  for(const incident of controlIncidents){
    const a=text(incident?.driver_id),b=text(incident?.other_driver_id);
    if(!a||!b||a===b)continue;
    if(!collisionLike(incident?.kind)&&!collisionLike(incident?.reason))continue;
    events.push({
      a,b,
      severity:num(incident?.severity_score,0.35),
      lap:num(incident?.lap,null),
      reason:incident?.reason||incident?.kind||"Collision",
    });
  }

  for(const row of resultEntry?.classification||[]){
    const a=text(row?.driver_id),b=text(row?.incident_with_driver_id);
    if(!a||!b||a===b)continue;
    if(!collisionLike(row?.retirement_reason??row?.incident_reason))continue;
    events.push({
      a,b,
      severity:num(row?.incident_severity_score,0.35),
      lap:num(row?.incident_lap,null),
      reason:row?.retirement_reason||"Collision",
    });
  }
  return events;
}

function standingsRows(gs,override){
  const rows=Array.isArray(override)?override:(gs?.standings?.drivers||[]);
  return rows.slice().sort((a,b)=>{
    const ap=num(a?.position,Infinity),bp=num(b?.position,Infinity);
    if(ap!==bp)return ap-bp;
    return num(b?.points,0)-num(a?.points,0);
  });
}

export function applyRaceDriverRivalries(gs,resultEntry,{standings=null}={}){
  if(!gs||!resultEntry)return gs;
  const rows=(resultEntry?.classification||[])
    .filter((row)=>text(row?.driver_id))
    .slice()
    .sort((a,b)=>num(a?.position,999)-num(b?.position,999));
  if(rows.length<2)return gs;

  let next=gs;
  const processedIncidents=new Set();
  const year=num(resultEntry?.year??gs?.activeYear,null);
  const round=num(resultEntry?.round,null);
  const gpId=resultEntry?.gp_id??resultEntry?.key??null;

  for(const incident of incidentPairEvents(resultEntry)){
    const key=rivalryPairKey(incident.a,incident.b);
    if(!key||processedIncidents.has(key))continue;
    processedIncidents.add(key);
    const severity=Math.max(0,Math.min(1,num(incident.severity,0.35)));
    next=applyDriverRivalryEvent(next,{
      driverA:incident.a,
      driverB:incident.b,
      rivalryDelta:7+severity*5,
      respectDeltaA:-(1.2+severity*1.8),
      respectDeltaB:-(1.2+severity*1.8),
      source:"driver_collision",
      reason:"On-track collision",
      counters:{collisions:1},
      meta:{year,round,gp_id:gpId,lap:incident.lap,severity:Number(severity.toFixed(2)),incident_reason:incident.reason},
    });
  }

  // Adjacent finishers are the only pair considered for a close-race trigger.
  // The timing threshold prevents the whole field from accumulating rivalry.
  for(let i=1;i<rows.length;i++){
    const ahead=rows[i-1],behind=rows[i];
    const aid=text(ahead?.driver_id),bid=text(behind?.driver_id);
    const key=rivalryPairKey(aid,bid);
    if(!key||processedIncidents.has(key)||isRetired(ahead)||isRetired(behind))continue;

    const gapMs=num(behind?.gap_to_previous_ms,null);
    const closeByTime=gapMs!==null&&gapMs<=3000;
    const fallbackFrontFight=gapMs===null&&num(behind?.position,999)<=6;
    if(!closeByTime&&!fallbackFrontFight)continue;

    const previous=driverRivalry(next,aid,bid);
    const repeatBonus=Number(previous?.close_battles||0)>=2?0.25:0;
    const podiumBonus=num(behind?.position,999)<=3?0.4:0;
    next=applyDriverRivalryEvent(next,{
      driverA:aid,
      driverB:bid,
      rivalryDelta:0.9+repeatBonus+podiumBonus,
      respectDeltaA:0.2,
      respectDeltaB:0.35,
      source:"close_race_battle",
      reason:"Close race finish",
      counters:{close_battles:1},
      meta:{year,round,gp_id:gpId,a_position:ahead?.position??null,b_position:behind?.position??null,gap_ms:gapMs},
    });
  }

  const standingRows=standingsRows(next,standings);
  const leaderPoints=num(standingRows[0]?.points,0);
  const totalRounds=Math.max(1,(next?.calendar||[]).filter((event)=>!year||Number(event?.year??year)===Number(year)).length||1);
  const seasonProgress=round?Math.max(0,Math.min(1,round/totalRounds)):0;
  const closePointsThreshold=Math.max(6,leaderPoints*0.12);

  // Only adjacent contenders in the top four can receive the title-fight
  // trigger. This avoids calling ordinary midfield proximity a rivalry.
  for(let i=1;i<Math.min(4,standingRows.length);i++){
    const ahead=standingRows[i-1],behind=standingRows[i];
    const aid=text(ahead?.driver_id??ahead?.id),bid=text(behind?.driver_id??behind?.id);
    const key=rivalryPairKey(aid,bid);
    if(!key||!aid||!bid||!round||round<2)continue;
    const gap=Math.abs(num(ahead?.points,0)-num(behind?.points,0));
    if(gap>closePointsThreshold)continue;

    const lateBonus=seasonProgress>=0.6?0.5:0;
    next=applyDriverRivalryEvent(next,{
      driverA:aid,
      driverB:bid,
      rivalryDelta:0.9+lateBonus,
      respectDeltaA:0.25,
      respectDeltaB:0.25,
      source:"championship_battle",
      reason:"Close championship fight",
      counters:{championship_battles:1},
      meta:{
        year,round,gp_id:gpId,
        a_position:ahead?.position??i,
        b_position:behind?.position??i+1,
        a_points:num(ahead?.points,0),
        b_points:num(behind?.points,0),
        points_gap:Number(gap.toFixed(2)),
        season_progress:Number(seasonProgress.toFixed(3)),
      },
    });
  }

  return next;
}
