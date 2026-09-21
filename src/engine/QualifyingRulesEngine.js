// src/engine/QualifyingRulesEngine.js
// Era-aware qualifying rule resolution and persistent weekend session planning.
//
// Historical data seeds a career. Once a Race Weekend starts, the resolved rule
// is copied into raceWeekendState.qualifying_rule_snapshot and that snapshot is
// authoritative for the rest of the event.

const clampISO=(iso)=>String(iso||"").slice(0,10);

function parseISO(iso){
  const [y,m,d]=clampISO(iso).split("-").map(Number);
  return new Date(Date.UTC(y||0,(m||1)-1,d||1));
}

function addDaysISO(iso,days){
  const date=parseISO(iso);
  if(Number.isNaN(+date))return clampISO(iso);
  date.setUTCDate(date.getUTCDate()+Number(days||0));
  return date.toISOString().slice(0,10);
}

function gpDateISO(gp){
  return clampISO(gp?.dateISO||gp?.date||gp?.race_date||gp?.start_date||gp?.end_date||gp?.raceDate);
}

function asNumber(value,fallback=null){
  const n=Number(value);
  return Number.isFinite(n)?n:fallback;
}

function asPositiveInt(value,fallback=null){
  const n=asNumber(value,null);
  return n!=null&&n>0?Math.max(1,Math.round(n)):fallback;
}

function parseList(value){
  if(Array.isArray(value))return value;
  if(value==null||value==="")return [];
  if(typeof value==="number")return [value];
  const text=String(value).trim();
  if(!text)return [];
  try{
    const parsed=JSON.parse(text);
    if(Array.isArray(parsed))return parsed;
  }catch{}
  return text.split(/[;,|]/).map((x)=>x.trim()).filter(Boolean);
}

function normalizeStrategy(raw){
  const text=String(raw||"").trim().toLowerCase().replace(/[-\s]+/g,"_");
  if(/sprint/.test(text))return "sprint_shootout";
  if(/knock|q1|q2|q3|elimin/.test(text))return "knockout";
  if(/aggregate|combined|sum/.test(text))return "aggregate_time";
  if(/single/.test(text))return "single_session";
  return "best_time_across_sessions";
}

function overrideMatches(override,gp){
  const gpId=String(gp?.gp_id??gp?.id??"");
  const trackId=String(gp?.track_id??gp?.circuit_id??"");
  const targetGp=String(override?.gp_id??override?.event_id??"");
  const targetTrack=String(override?.track_id??override?.circuit_id??"");
  if(targetGp&&targetGp!==gpId)return false;
  if(targetTrack&&targetTrack!==trackId)return false;
  return Boolean(targetGp||targetTrack);
}

function normalizeOffsets(raw,count){
  const parsed=parseList(raw).map((x)=>asNumber(x,null)).filter(Number.isFinite);
  if(parsed.length>=count)return parsed.slice(0,count);
  if(count<=1)return [-1];
  const out=[];
  for(let i=0;i<count;i++){
    // Multiple sessions may share a day. The final qualifying session is the
    // day before the race; earlier sessions start two days before by default.
    out.push(i===count-1?-1:-2);
  }
  return out;
}

function normalizeAdvanceCounts(raw,count){
  const parsed=parseList(raw).map((x)=>asPositiveInt(x,null));
  const out=Array.from({length:Math.max(0,count-1)},(_,index)=>parsed[index]??null);
  return out;
}

export function normalizeQualifyingRule(raw={}){
  const format=raw?.strategy??raw?.format_code??raw?.format??raw?.rule??"best lap";
  const sessionCount=asPositiveInt(
    raw?.session_count??raw?.sessions??raw?.qualifying_sessions??raw?.number_of_sessions,
    1
  );
  const maxStarters=asPositiveInt(
    raw?.max_starters??raw?.race_grid_size??raw?.grid_size??raw?.max_grid_size,
    null
  );
  const prequalEnabled=Boolean(
    raw?.prequalifying_enabled??raw?.pre_qualifying_enabled??raw?.prequalifying
  );
  const prequalAdvance=asPositiveInt(
    raw?.prequalifying_advance_count??raw?.prequalifying_max_advance??raw?.prequalifying_limit,
    null
  );

  return {
    ...raw,
    rule_id:String(raw?.rule_id??raw?.id??"qualifying_rule"),
    strategy:normalizeStrategy(format),
    session_count:sessionCount,
    session_length:raw?.session_length??raw?.length??raw?.lenght??null,
    max_starters:maxStarters,
    practice_day_offset:asNumber(raw?.practice_day_offset,-2),
    session_day_offsets:normalizeOffsets(
      raw?.session_day_offsets??raw?.qualifying_day_offsets,
      sessionCount
    ),
    grid_day_offset:asNumber(raw?.grid_day_offset,-1),
    prequalifying_enabled:prequalEnabled,
    prequalifying_day_offset:asNumber(raw?.prequalifying_day_offset,-3),
    prequalifying_advance_count:prequalAdvance,
    session_advance_counts:normalizeAdvanceCounts(
      raw?.session_advance_counts??raw?.advance_counts,
      sessionCount
    ),
  };
}

function rowYear(row){
  const n=Number(row?.year??row?.season_year??row?.season);
  return Number.isFinite(n)?n:null;
}

function ruleAppliesInYear(row,year){
  const from=Number(row?.year_from??row?.from_year??rowYear(row)??-Infinity);
  const to=Number(row?.year_to??row?.to_year??rowYear(row)??Infinity);
  return year>=from&&year<=to;
}

function legacyDatabaseRule(gs,gp){
  const year=Number(gs?.activeYear??gp?.year);
  const baseRows=Array.isArray(gs?.dbQualifyingRules)?gs.dbQualifyingRules:[];
  const historical=baseRows
    .filter((row)=>{
      const ry=rowYear(row);
      return ry!=null&&(!Number.isFinite(year)||ry<=year);
    })
    .sort((a,b)=>(rowYear(b)??-Infinity)-(rowYear(a)??-Infinity))[0]||{};
  const overrides=(Array.isArray(gs?.dbQualifyingRuleOverrides)?gs.dbQualifyingRuleOverrides:[])
    .filter((row)=>!Number.isFinite(year)||ruleAppliesInYear(row,year));
  const generic=overrides.filter((row)=>!overrideMatches(row,gp)&&!(
    row?.gp_id||row?.event_id||row?.track_id||row?.circuit_id
  ));
  const eventOverrides=overrides.filter((row)=>(
    row?.gp_id||row?.event_id||row?.track_id||row?.circuit_id
  ));
  return {
    ...historical,
    ...generic.reduce((acc,row)=>({...acc,...row}),{}),
    year:Number.isFinite(year)?year:rowYear(historical),
    rule_source:"legacy_save_database_fallback",
    event_overrides:eventOverrides,
  };
}

export function resolveQualifyingRules(gs,gp={}){
  // The active Save World is authoritative. db* is consulted only to recover
  // a legacy save that predates RW3 and therefore has no live rule snapshot.
  const live=gs?.qualifyingRules&&typeof gs.qualifyingRules==="object"&&!Array.isArray(gs.qualifyingRules)
    ?gs.qualifyingRules
    :null;
  const base=live||legacyDatabaseRule(gs,gp);
  const eventOverrides=Array.isArray(base?.event_overrides)
    ?base.event_overrides
    :[];
  const eventOverride=eventOverrides.find((row)=>overrideMatches(row,gp))||{};
  return normalizeQualifyingRule({...base,...eventOverride,event_overrides:eventOverrides});
}

export function buildWeekendSessions(ruleInput,gp={}){
  const rule=normalizeQualifyingRule(ruleInput);
  const raceDate=gpDateISO(gp);
  const sessions=[];
  let order=0;

  const effectivePracticeOffset=rule.prequalifying_enabled
    ?Math.min(rule.practice_day_offset,rule.prequalifying_day_offset)
    :rule.practice_day_offset;
  sessions.push({
    id:"practice",
    type:"practice",
    label:"Practice",
    order:order++,
    dateISO:addDaysISO(raceDate,effectivePracticeOffset),
    day_offset:effectivePracticeOffset,
    status:"pending",
  });

  if(rule.prequalifying_enabled){
    sessions.push({
      id:"prequalifying",
      type:"prequalifying",
      label:"Pre-Qualifying",
      order:order++,
      dateISO:addDaysISO(raceDate,rule.prequalifying_day_offset),
      day_offset:rule.prequalifying_day_offset,
      status:"pending",
      advance_count:rule.prequalifying_advance_count,
    });
  }

  for(let index=0;index<rule.session_count;index++){
    const dayOffset=rule.session_day_offsets[index]??-1;
    sessions.push({
      id:`qualifying_${index+1}`,
      type:"qualifying",
      label:rule.session_count===1?"Qualifying":`Qualifying Session ${index+1}`,
      order:order++,
      session_index:index+1,
      dateISO:addDaysISO(raceDate,dayOffset),
      day_offset:dayOffset,
      status:"pending",
      advance_count:rule.session_advance_counts[index]??null,
    });
  }

  sessions.push({
    id:"grid",
    type:"grid",
    label:"Starting Grid",
    order:order++,
    dateISO:addDaysISO(raceDate,rule.grid_day_offset),
    day_offset:rule.grid_day_offset,
    status:"pending",
  });
  sessions.push({
    id:"race",
    type:"race",
    label:"Race",
    order:order++,
    dateISO:raceDate,
    day_offset:0,
    status:"pending",
  });

  return sessions.sort((a,b)=>a.order-b.order);
}

export function weekendScheduleFromSessions(sessions=[]){
  const practice=sessions.find((row)=>row.type==="practice");
  const qualifying=sessions.filter((row)=>row.type==="qualifying");
  const race=sessions.find((row)=>row.type==="race");
  const dates=sessions.map((row)=>row.dateISO).filter(Boolean).sort();
  return {
    practiceDate:practice?.dateISO||dates[0]||"",
    qualifyingDate:qualifying[0]?.dateISO||"",
    raceDate:race?.dateISO||dates.at(-1)||"",
    weekendStartDate:dates[0]||"",
  };
}

export function nextPendingCompetitiveSession(weekend){
  return (weekend?.sessions||[]).find(
    (row)=>["prequalifying","qualifying"].includes(row?.type)&&row?.status!=="completed"
  )||null;
}

export function currentQualifyingSession(weekend){
  const id=String(weekend?.active_session_id||"");
  const active=(weekend?.sessions||[]).find((row)=>String(row?.id)===id);
  if(active&&["prequalifying","qualifying"].includes(active.type)&&active.status!=="completed")return active;
  return nextPendingCompetitiveSession(weekend);
}

function sessionResults(weekend,type="qualifying"){
  return (weekend?.sessions||[])
    .filter((session)=>session.type===type&&session.status==="completed")
    .flatMap((session)=>(
      (session.results||[]).map((row)=>({...row,session_id:session.id,session_index:session.session_index??null}))
    ));
}

function bestTimeRows(weekend){
  const byDriver=new Map();
  for(const row of sessionResults(weekend,"qualifying")){
    const did=String(row?.driver_id??"");
    const lap=asNumber(row?.lap_time_ms,null);
    if(!did||lap==null)continue;
    const previous=byDriver.get(did);
    if(!previous||lap<previous.best_time_ms){
      byDriver.set(did,{
        driver_id:did,
        team_id:row?.team_id??previous?.team_id??null,
        best_time_ms:lap,
        best_session_id:row.session_id,
        performance:asNumber(row?.performance,0),
      });
    }
  }
  return [...byDriver.values()].sort(
    (a,b)=>a.best_time_ms-b.best_time_ms||a.driver_id.localeCompare(b.driver_id)
  );
}

function aggregateRows(weekend){
  const expected=(weekend?.sessions||[]).filter((row)=>row.type==="qualifying").length;
  const byDriver=new Map();
  for(const row of sessionResults(weekend,"qualifying")){
    const did=String(row?.driver_id??"");
    const lap=asNumber(row?.lap_time_ms,null);
    if(!did||lap==null)continue;
    const rec=byDriver.get(did)||{driver_id:did,team_id:row?.team_id??null,total_time_ms:0,sessions_completed:0};
    rec.total_time_ms+=lap;
    rec.sessions_completed+=1;
    byDriver.set(did,rec);
  }
  return [...byDriver.values()]
    .sort((a,b)=>{
      const ac=a.sessions_completed===expected?0:1;
      const bc=b.sessions_completed===expected?0:1;
      return ac-bc||a.total_time_ms-b.total_time_ms||a.driver_id.localeCompare(b.driver_id);
    })
    .map((row)=>({...row,best_time_ms:row.total_time_ms}));
}

function knockoutRows(weekend){
  const sessions=(weekend?.sessions||[]).filter((row)=>row.type==="qualifying"&&row.status==="completed");
  const latest=new Map();
  for(const session of sessions){
    for(const row of session.results||[]){
      const did=String(row?.driver_id??"");
      if(!did)continue;
      latest.set(did,{
        driver_id:did,
        team_id:row?.team_id??null,
        reached_session:Number(session.session_index)||1,
        best_time_ms:asNumber(row?.lap_time_ms,Number.MAX_SAFE_INTEGER),
        performance:asNumber(row?.performance,0),
        best_session_id:session.id,
      });
    }
  }
  return [...latest.values()].sort(
    (a,b)=>b.reached_session-a.reached_session||a.best_time_ms-b.best_time_ms||a.driver_id.localeCompare(b.driver_id)
  );
}

export function buildQualifyingClassification(weekend,ruleInput=weekend?.qualifying_rule_snapshot||{}){
  const rule=normalizeQualifyingRule(ruleInput);
  let rows=rule.strategy==="aggregate_time"
    ?aggregateRows(weekend)
    :rule.strategy==="knockout"||rule.strategy==="sprint_shootout"
      ?knockoutRows(weekend)
      :bestTimeRows(weekend);

  const prequal=(weekend?.sessions||[]).find((row)=>row.type==="prequalifying"&&row.status==="completed");
  const eliminated=new Set(
    (prequal?.results||[]).filter((row)=>row?.status==="DNPQ").map((row)=>String(row.driver_id))
  );

  rows=rows.filter((row)=>!eliminated.has(String(row.driver_id)));
  const classifiedIds=new Set(rows.map((row)=>String(row.driver_id)));
  const dnpq=(weekend?.entrants||[])
    .filter((entry)=>eliminated.has(String(entry?.driver_id??""))&&!classifiedIds.has(String(entry?.driver_id??"")))
    .map((entry)=>({
      driver_id:String(entry.driver_id),
      team_id:entry.team_id??null,
      best_time_ms:null,
      best_session_id:"prequalifying",
      performance:null,
      status:"DNPQ",
    }));

  const maxStarters=rule.max_starters??rows.length;
  const classification=rows.map((row,index)=>({
    position:index+1,
    ...row,
    status:index<maxStarters?"QUALIFIED":"DNQ",
  }));
  return [
    ...classification,
    ...dnpq.map((row,index)=>({...row,position:classification.length+index+1})),
  ];
}

export function applyGridPenalties(classification=[],penalties=[]){
  const qualified=classification.filter((row)=>row?.status==="QUALIFIED");
  const penaltyByDriver=new Map();
  for(const penalty of penalties||[]){
    const did=String(penalty?.driver_id??"");
    if(!did)continue;
    const places=Math.max(0,Math.round(asNumber(penalty?.places??penalty?.penalty_places,0)));
    penaltyByDriver.set(did,(penaltyByDriver.get(did)||0)+places);
  }

  // Sorting by an adjusted seed position gives a deterministic, stable grid
  // without mutating the Qualifying Classification.
  return qualified
    .map((row,index)=>({
      ...row,
      qualifying_position:Number(row.position??index+1),
      penalty_places:penaltyByDriver.get(String(row.driver_id))||0,
      _gridSeed:Number(row.position??index+1)+(penaltyByDriver.get(String(row.driver_id))||0),
    }))
    .sort((a,b)=>a._gridSeed-b._gridSeed||a.qualifying_position-b.qualifying_position)
    .map((row,index)=>{
      const {_gridSeed,...clean}=row;
      return {...clean,grid:index+1,status:"STARTER"};
    });
}

export function buildStartingGrid(weekend,classification,penalties=[]){
  return {
    id:`${weekend?.key||"weekend"}:starting-grid`,
    status:"final",
    source:"qualifying_classification",
    generated_at:clampISO(weekend?.currentDateISO||weekend?.raceDate||""),
    penalties:(penalties||[]).map((row)=>({...row})),
    rows:applyGridPenalties(classification,penalties),
  };
}

export function qualifyingEntrantsForSession(weekend,session){
  if(Array.isArray(session?.eligible_driver_ids)&&session.eligible_driver_ids.length){
    return session.eligible_driver_ids.map(String);
  }
  return (weekend?.entrants||[]).map((entry)=>String(entry?.driver_id??"")).filter(Boolean);
}

export function advancingDriverIds(session,ruleInput){
  const results=(session?.results||[]).slice().sort(
    (a,b)=>asNumber(a?.lap_time_ms,Infinity)-asNumber(b?.lap_time_ms,Infinity)
  );
  const rule=normalizeQualifyingRule(ruleInput||{});
  const explicit=asPositiveInt(session?.advance_count,null);
  const limit=explicit??(
    session?.type==="prequalifying"
      ?rule.prequalifying_advance_count
      :null
  );
  if(limit==null)return results.map((row)=>String(row.driver_id));
  return results.slice(0,limit).map((row)=>String(row.driver_id));
}
