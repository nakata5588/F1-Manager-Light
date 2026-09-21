// src/core/careerBoundary.js
//
// Lightweight version of the Global Database -> Season World boundary used by
// F1-Manager-Sim. The db* collections remain the immutable editorial/global
// source. A career owns the mutable active world and only consults the global
// source for structural future information and newly eligible entity identity.

const num=(v,fb=NaN)=>{const n=Number(v);return Number.isFinite(n)?n:fb;};
const text=(v)=>v==null?"":String(v);
const pick=(o,keys,fb=undefined)=>{for(const k of keys){const v=o?.[k];if(v!==undefined&&v!==null&&v!=="")return v;}return fb;};

function yearOf(row){
  for(const key of ["year","season_year","season","yr"]){
    const n=num(pick(row,[key],NaN));
    if(Number.isFinite(n))return n;
  }
  for(const key of ["race_date","date","start_date","contract_start","contract_end_sort"]){
    const raw=pick(row,[key],"");
    const m=String(raw).match(/^(\d{4})/);
    if(m)return Number(m[1]);
  }
  return NaN;
}

function idOfDriver(row){return text(pick(row,["driver_id","person_id","id"],""));}
function idOfStaff(row){return text(pick(row,["staff_id","person_id","id"],""));}
function idOfTeam(row){return text(pick(row,["team_id","constructor_id","id","team","constructor"],""));}

function dateShift(value,targetYear){
  const raw=String(value||"").slice(0,10);
  const m=raw.match(/^\d{4}-(\d{2})-(\d{2})$/);
  if(!m)return null;
  const month=Number(m[1]),day=Number(m[2]);
  const d=new Date(Date.UTC(targetYear,month-1,day));
  if(d.getUTCMonth()!==month-1)d.setUTCDate(0);
  return d.toISOString().slice(0,10);
}

function stripFutureOutcomeFields(row){
  const copy={...row};
  for(const key of [
    "winner","winner_id","winner_driver_id","winner_team_id",
    "podium","result","results","classification","points",
    "champion","championship_position","fastest_lap_driver_id",
    "pole_driver_id","race_winner","winning_driver"
  ]) delete copy[key];
  return copy;
}

function materializeCalendar(state,targetYear){
  const exact=(state.dbCalendar||[])
    .filter((row)=>yearOf(row)===targetYear)
    .map((row,index)=>({
      ...stripFutureOutcomeFields(row),
      year:targetYear,
      season_year:targetYear,
      round:num(row.round,index+1),
      gp_id:row.gp_id??row.race_id??`${targetYear}:${num(row.round,index+1)}:${row.track_id??row.circuit_id??index+1}`,
      historical_structure_reference:true,
      generation_source:"global_calendar_structure",
    }));
  if(exact.length)return exact.sort((a,b)=>num(a.round,999)-num(b.round,999));

  const previous=[...(state.calendar||[])].sort((a,b)=>num(a.round,999)-num(b.round,999));
  return previous.map((row,index)=>{
    const round=num(row.round,index+1);
    const suffix=row.track_id??row.circuit_id??row.gp_name??row.name??index+1;
    const date=dateShift(row.race_date??row.date,targetYear);
    return {
      ...stripFutureOutcomeFields(row),
      year:targetYear,
      season_year:targetYear,
      round,
      gp_id:`${targetYear}:${round}:${String(suffix).replace(/\s+/g,"-").toLowerCase()}`,
      race_date:date,
      date,
      generated:true,
      generation_source:"previous_season_calendar_fallback",
    };
  });
}

function effectiveRow(rows,targetYear){
  const list=Array.isArray(rows)?rows:[];
  const exact=list.filter((r)=>yearOf(r)===targetYear);
  if(exact.length)return exact;
  const prior=list.filter((r)=>Number.isFinite(yearOf(r))&&yearOf(r)<=targetYear)
    .sort((a,b)=>yearOf(b)-yearOf(a));
  return prior.length?[prior[0]]:[];
}

function rangeRow(rows,targetYear){
  const list=Array.isArray(rows)?rows:[];
  const matches=list.filter((row)=>{
    const from=num(pick(row,["year_from","start_year","from_year","year"],NaN));
    const to=num(pick(row,["year_to","end_year","to_year"],Infinity),Infinity);
    return Number.isFinite(from)&&targetYear>=from&&targetYear<=to;
  });
  if(matches.length)return matches;
  return effectiveRow(list,targetYear);
}

function birthYear(row){
  const raw=pick(row,["dob","birthdate","date_of_birth","birth_date"],"");
  const m=String(raw).match(/^(\d{4})/);
  return m?Number(m[1]):NaN;
}
function ageInYear(row,year){
  const born=birthYear(row);
  return Number.isFinite(born)?Math.max(0,year-born):row?.age??null;
}

function driverWorldVisibleFrom(driver){
  const explicit=num(pick(driver,["world_visible_from","career_start_year"],NaN));
  if(Number.isFinite(explicit))return explicit;
  const debut=num(pick(driver,["f1_rookie_season","f1_debut_year"],NaN));
  if(Number.isFinite(debut))return debut-3;
  const born=birthYear(driver);
  return Number.isFinite(born)?born+16:Infinity;
}
function driverF1EligibleFrom(driver){
  const explicit=num(pick(driver,["f1_eligible_from"],NaN));
  if(Number.isFinite(explicit))return explicit;

  // Historical F1 debut is not a hard lock once the career branches away from
  // reality. A visible lower-series driver may be signed early if old enough.
  const visible=driverWorldVisibleFrom(driver);
  const born=birthYear(driver);
  const ageGate=Number.isFinite(born)?born+18:-Infinity;
  return Math.max(visible,ageGate);
}

function sanitizeFutureDriver(driver,targetYear){
  const copy={...driver};
  const visible=driverWorldVisibleFrom(driver);
  const eligible=driverF1EligibleFrom(driver);
  const age=ageInYear(driver,targetYear);
  delete copy.team_id;
  delete copy.team_name;
  delete copy.current_team;
  delete copy.current_team_id;
  delete copy.career_end_year;
  delete copy.retirement_year;
  delete copy.last_f1_season;
  const deathYear=num(String(copy.death_date||"").slice(0,4),NaN);
  if(Number.isFinite(deathYear)&&deathYear>=targetYear)delete copy.death_date;
  const historicalDebut=num(pick(driver,["f1_rookie_season","f1_debut_year"],NaN));
  const historicalF1=Number.isFinite(historicalDebut)&&historicalDebut<=targetYear;
  const canHireF1=eligible<=targetYear;
  const youth=Number.isFinite(Number(age))&&Number(age)<=19&&!historicalF1;
  return {
    ...copy,
    driver_id:idOfDriver(driver),
    display_name:driver.display_name||driver.driver_name||driver.name||idOfDriver(driver),
    name:driver.display_name||driver.driver_name||driver.name||idOfDriver(driver),
    age,
    world_visible_from:visible,
    f1_eligible_from:eligible,
    active_lower_series:!historicalF1,
    youth_eligible:youth,
    canHireAcademy:youth,
    canHireF1,
    status:historicalF1?"eligible":(youth?"junior_only":"lower_series"),
    source:"global_identity_pool",
  };
}

function ratingBaseline(rows,id,targetYear,idFn){
  const candidates=(rows||[]).filter((r)=>idFn(r)===id);
  if(!candidates.length)return null;
  // Never import a future historical rating into an earlier alternate-history
  // season. If no rating exists on/before targetYear the runtime uses its
  // neutral/career-derived fallback until the new Rating Model V2 replaces it.
  const past=candidates.filter((r)=>Number.isFinite(yearOf(r))&&yearOf(r)<=targetYear)
    .sort((a,b)=>yearOf(b)-yearOf(a));
  const source=past[0]||null;
  return source?{...source,year:targetYear,source_baseline_year:yearOf(source),source:"global_identity_baseline"}:null;
}

function firstRelevantStaffYear(state,id){
  const years=[
    ...(state.dbStaffContracts||[]).filter((r)=>idOfStaff(r)===id).map(yearOf),
    ...(state.dbStaffRatings||[]).filter((r)=>idOfStaff(r)===id).map(yearOf),
  ].filter(Number.isFinite);
  return years.length?Math.min(...years):Infinity;
}
function sanitizeFutureStaff(staff,targetYear){
  const copy={...staff};
  delete copy.team_id;delete copy.team_name;delete copy.current_team;
  const deathYear=num(String(copy.death_date||"").slice(0,4),NaN);
  if(Number.isFinite(deathYear)&&deathYear>=targetYear)delete copy.death_date;
  return {...copy,staff_id:idOfStaff(staff),age:ageInYear(staff,targetYear),market_status:"Free",source:"global_identity_pool"};
}

function firstTeamYear(state,id){
  const years=[
    ...(state.dbTeamSeasons||[]).filter((r)=>idOfTeam(r)===id).map(yearOf),
    ...(state.dbTeamBrands||[]).filter((r)=>idOfTeam(r)===id).map(yearOf),
    ...(state.dbContracts||[]).filter((r)=>idOfTeam(r)===id).map(yearOf),
  ].filter(Number.isFinite);
  const team=(state.dbTeams||[]).find((r)=>idOfTeam(r)===id);
  const founded=num(pick(team||{},["founded_year","start_year","first_year"],NaN));
  if(Number.isFinite(founded))years.push(founded);
  return years.length?Math.min(...years):Infinity;
}

function currentContractForNextSeason(row,targetYear){
  const start=num(pick(row,["contract_start_year","contract_start","start_year","year"],targetYear),targetYear);
  const end=num(pick(row,["contract_until_year","contract_until","end_year"],targetYear-1),targetYear-1);
  return start<=targetYear&&end>=targetYear;
}

function rollDriverContracts(rows,targetYear){
  return (rows||[]).map((row)=>{
    const status=String(row?.status||"active").toLowerCase();
    if(["terminated","released","bought_out","expired","inactive","void"].includes(status))return {...row};

    if(currentContractForNextSeason(row,targetYear)){
      return {
        ...row,
        year:targetYear,
        season_year:targetYear,
        status:"active",
      };
    }

    return {
      ...row,
      status:"expired",
      expired_at:`${targetYear}-01-01`,
      expiry_reason:"contract_end",
    };
  });
}

function carryStaffContracts(rows,targetYear){
  return (rows||[]).map((row)=>{
    if(currentContractForNextSeason(row,targetYear)){
      return {...row,year:targetYear,season_year:targetYear};
    }
    // Staff employment still uses continuity until the dedicated staff market lands.
    return {
      ...row,
      year:targetYear,
      season_year:targetYear,
      contract_until_year:targetYear,
      contract_until:targetYear,
      end_year:targetYear,
      continuity_renewal:true,
      source:"simulation_staff_continuity",
    };
  });
}

function updateAges(rows,targetYear){
  return (rows||[]).map((row)=>({...row,age:ageInYear(row,targetYear)}));
}

function uniqueBy(rows,idFn){
  const map=new Map();
  for(const row of rows||[]){const id=idFn(row);if(id)map.set(id,row);}
  return [...map.values()];
}

function archiveSeason(state,previousYear){
  const history=Array.isArray(state.historySeasons)?state.historySeasons.slice():[];
  if(history.some((r)=>Number(r.year)===Number(previousYear)))return history;
  history.push({
    year:previousYear,
    standings:structuredClone(state.standings||{drivers:[],teams:[]}),
    team_id:state?.team?.team_id??state?.team?.id??null,
    cash_end:state?.finances?.balance??null,
    races:(state.results||[]).filter((r)=>Number(r?.year)===Number(previousYear)).length,
  });
  return history;
}

export function createCareerMeta(state,startYear){
  const year=Number(startYear);
  return {
    started:true,
    schemaVersion:2,
    sourceSeason:year,
    currentSeason:year,
    databasePolicy:{
      source:"global_db_runtime",
      past:"historical_reference_only",
      present:"materialized_active_world",
      futureOutcomes:"excluded_from_rollover",
      futureEntities:"identity_and_eligibility_only",
      futureStructure:"calendar_rules_safety_only",
    },
    eligibleTeamCandidateIds:[],
    lastRollover:null,
  };
}

export function materializeNextCareerSeason(state,targetYearInput){
  const targetYear=Number(targetYearInput);
  const previousYear=Number(state?.activeYear??targetYear-1);
  if(!Number.isInteger(targetYear))throw new TypeError("Target season must be an integer.");

  const calendar=materializeCalendar(state,targetYear);

  // Carry the mutable world forward. Historical future contracts/assignments are
  // deliberately NOT loaded from db*.
  const activeDriverIds=new Set((state.drivers||[]).map(idOfDriver).filter(Boolean));
  const unlockedDrivers=(state.dbDrivers||[])
    .filter((d)=>{
      const id=idOfDriver(d);
      return id&&!activeDriverIds.has(id)&&driverWorldVisibleFrom(d)<=targetYear;
    })
    .map((d)=>sanitizeFutureDriver(d,targetYear));

  const activeRatings=new Map((state.driverRatings||[]).map((r)=>[idOfDriver(r),{...r,year:targetYear}]));
  for(const d of unlockedDrivers){
    const baseline=ratingBaseline(state.dbDriverRatings||[],idOfDriver(d),targetYear,idOfDriver);
    if(baseline&&!activeRatings.has(idOfDriver(d)))activeRatings.set(idOfDriver(d),baseline);
  }

  const activeStaffIds=new Set((state.staffCore||[]).map(idOfStaff).filter(Boolean));
  const unlockedStaff=(state.dbStaffCore||[])
    .filter((s)=>{
      const id=idOfStaff(s);
      return id&&!activeStaffIds.has(id)&&firstRelevantStaffYear(state,id)<=targetYear;
    })
    .map((s)=>sanitizeFutureStaff(s,targetYear));
  const activeStaffRatings=new Map((state.staffRatings||[]).map((r)=>[idOfStaff(r),{...r,year:targetYear}]));
  for(const person of unlockedStaff){
    const baseline=ratingBaseline(state.dbStaffRatings||[],idOfStaff(person),targetYear,idOfStaff);
    if(baseline&&!activeStaffRatings.has(idOfStaff(person)))activeStaffRatings.set(idOfStaff(person),baseline);
  }

  const activeTeamIds=new Set((state.teams||[]).map(idOfTeam).filter(Boolean));
  const eligibleTeamCandidateIds=(state.dbTeams||[])
    .map(idOfTeam).filter(Boolean)
    .filter((id)=>!activeTeamIds.has(id)&&firstTeamYear(state,id)<=targetYear);

  const meta={
    ...(state.careerMeta||createCareerMeta(state,previousYear)),
    started:true,
    schemaVersion:2,
    currentSeason:targetYear,
    eligibleTeamCandidateIds:[...new Set(eligibleTeamCandidateIds)],
    lastRollover:{
      from:previousYear,
      to:targetYear,
      calendarSource:calendar[0]?.generation_source||"none",
      unlockedDrivers:unlockedDrivers.map(idOfDriver),
      unlockedStaff:unlockedStaff.map(idOfStaff),
      eligibleTeamCandidates:[...new Set(eligibleTeamCandidateIds)],
    },
  };

  const rules=effectiveRow(state.dbRules,targetYear);
  const eraSafety=effectiveRow(state.dbEraSafety,targetYear);
  const accidentModel=effectiveRow(Array.isArray(state.dbAccidentModel)?state.dbAccidentModel:[],targetYear);
  const pointsSystem=rangeRow(state.dbPointsSystems,targetYear)[0]||state.pointsSystem||null;
  const tyres=rangeRow(state.dbTyres,targetYear);
  const penaltiesRules=rangeRow(state.dbPenaltiesRules,targetYear);
  const financialRules=rangeRow(state.dbFinancialRules,targetYear);
  const agendaBlocks=rangeRow(state.dbAgendaBlocks,targetYear);

  const nextDriverAttributes=Object.fromEntries(
    (state.drivers||[]).map((driver)=>{
      const id=idOfDriver(driver);
      const curr=state?.driverAttributes?.[id]||{};
      const confidence=num(curr.confidence,50);
      const morale=num(curr.morale,50);
      return [id,{
        ...curr,
        fatigue:0,
        preparation:50,
        confidence:50+(confidence-50)*0.35,
        morale:50+(morale-50)*0.35,
      }];
    }).filter(([id])=>id)
  );

  const finances={
    ...(state.finances||{}),
    season_spend:0,
    season_income:0,
    season_net:0,
    opening_balance:Number(state?.finances?.balance??state?.team?.budget??0),
  };

  const inbox=[{
    id:`season_start_${targetYear}`,
    date:`${targetYear}-01-01`,
    from:"Board",
    type:"BOARD",
    tag:"Season",
    subject:`Welcome to ${targetYear}`,
    body:[
      `The ${targetYear} season is now active.`,
      calendar.length?`${calendar.length} Grands Prix have been scheduled from the structural calendar reference.`:"No structural calendar was available.",
      unlockedDrivers.length?`${unlockedDrivers.length} new driver(s) have entered the visible talent/market pool.`:"",
      unlockedStaff.length?`${unlockedStaff.length} new staff member(s) are now visible to the market.`:"",
      eligibleTeamCandidateIds.length?`${eligibleTeamCandidateIds.length} organisation(s) are now eligible as future grid candidates.`:"",
    ].filter(Boolean).join("\n"),
    unread:true,
  },...(state.inbox||[])];

  return {
    ...state,
    activeYear:targetYear,
    currentDateISO:`${targetYear}-01-01`,
    currentRound:0,
    calendar,
    standings:{drivers:[],teams:[]},
    lastSeason:previousYear,
    historySeasons:archiveSeason(state,previousYear),
    careerMeta:meta,

    // Mutable active people/teams survive the boundary.
    teams:(state.teams||[]).map((row)=>({...row})),
    drivers:uniqueBy([...updateAges(state.drivers||[],targetYear),...unlockedDrivers],idOfDriver),
    driverRatings:[...activeRatings.values()],
    contracts:rollDriverContracts(state.contracts||[],targetYear),
    staffCore:uniqueBy([...updateAges(state.staffCore||[],targetYear),...unlockedStaff],idOfStaff),
    staffRatings:[...activeStaffRatings.values()],
    staffContracts:carryStaffContracts(state.staffContracts||[],targetYear),
    teamBrands:(state.teamBrands||[]).map((r)=>({...r,year:targetYear})),
    teamEngines:(state.teamEngines||[]).map((r)=>({...r,year:targetYear})),
    facilities:(state.facilities||[]).map((r)=>({...r,year:targetYear})),
    carStats:(state.carStats||[]).map((r)=>({...r,year:targetYear})),
    driverAttributes:nextDriverAttributes,

    // Player-created commercial state survives; historical future sponsor deals
    // are never injected automatically.
    sponsorsContracts:(state.sponsorsContracts||[]).filter((sp)=>{
      const end=num(pick(sp,["end_year","until_year"],targetYear),targetYear);
      const status=String(sp?.status||"active").toLowerCase();
      return end>=targetYear&&!["terminated","expired"].includes(status);
    }),

    rules,
    eraSafety,
    accidentModel:accidentModel.length?accidentModel:state.accidentModel,
    pointsSystem,
    tyres:tyres.length?tyres:state.tyres,
    penaltiesRules:penaltiesRules.length?penaltiesRules:state.penaltiesRules,
    financialRules:financialRules.length?financialRules:state.financialRules,
    agendaBlocks:agendaBlocks.length?agendaBlocks:state.agendaBlocks,

    finances,
    inbox,
    _seasonFinishedAt:null,
    showSeasonSummary:false,
  };
}
