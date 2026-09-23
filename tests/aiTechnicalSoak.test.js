import test from "node:test";
import assert from "node:assert/strict";

import {
  aiTechnicalTeamState,
  applyAIRaceComponentWear,
  normalizeAITechnicalWorld,
  tickAITechnicalWorld,
} from "../src/engine/AITechnicalEngine.js";
import { materializeNextCareerSeason } from "../src/core/careerBoundary.js";
import { teamCarPerformance } from "../src/domain/carPerformance.js";

const AI_TEAMS=["FERRARI","WILLIAMS","RENAULT","ATS"];

function isoDate(year,month,day){
  return `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
}
function addDays(iso,days){
  const d=new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate()+days);
  return d.toISOString().slice(0,10);
}
function calendarFor(year){
  return [
    {year,round:1,gp_id:`${year}:ARG`,date:isoDate(year,1,20),race_date:isoDate(year,1,20),track_id:"ARG"},
    {year,round:2,gp_id:`${year}:BRA`,date:isoDate(year,3,2),race_date:isoDate(year,3,2),track_id:"BRA"},
    {year,round:3,gp_id:`${year}:BEL`,date:isoDate(year,5,4),race_date:isoDate(year,5,4),track_id:"BEL"},
    {year,round:4,gp_id:`${year}:GBR`,date:isoDate(year,7,13),race_date:isoDate(year,7,13),track_id:"GBR"},
    {year,round:5,gp_id:`${year}:ITA`,date:isoDate(year,9,14),race_date:isoDate(year,9,14),track_id:"ITA"},
    {year,round:6,gp_id:`${year}:USA`,date:isoDate(year,10,5),race_date:isoDate(year,10,5),track_id:"USA"},
  ];
}

function driversAndContracts(){
  const drivers=[];
  const contracts=[];
  for(const team of AI_TEAMS){
    for(let car=1;car<=2;car+=1){
      const id=`${team}_D${car}`;
      drivers.push({driver_id:id,display_name:id,dob:"1950-01-01",status:"eligible"});
      contracts.push({
        year:1980,season_year:1980,team_id:team,driver_id:id,
        role:car===1?"Main Driver":"Second Driver",
        status:"active",contract_start_year:1980,contract_until_year:1985,
      });
    }
  }
  return {drivers,contracts};
}

function soakFixture(){
  const {drivers,contracts}=driversAndContracts();
  return {
    activeYear:1980,
    currentDateISO:"1980-01-01",
    currentRound:0,
    team:{team_id:"PLAYER",budget:5_000_000},
    finances:{balance:5_000_000},
    teams:[
      {team_id:"PLAYER",team_name:"Player"},
      {team_id:"FERRARI",team_name:"Ferrari"},
      {team_id:"WILLIAMS",team_name:"Williams"},
      {team_id:"RENAULT",team_name:"Renault"},
      {team_id:"ATS",team_name:"ATS"},
    ],
    drivers,
    contracts,
    driverRatings:[],
    staffCore:[],staffRatings:[],staffContracts:[],
    teamBrands:[],
    calendar:calendarFor(1980),
    dbCalendar:[],
    carStats:[
      {year:1980,team_id:"PLAYER",chassis_spec:80,aero_spec:80,gearbox_spec:80,suspension_spec:80,brakes_spec:80,cooling_spec:80,reliability:0.78,weight:595},
      {year:1980,team_id:"FERRARI",chassis_spec:86,aero_spec:86,gearbox_spec:85,suspension_spec:84,brakes_spec:85,cooling_spec:82,reliability:0.76,weight:600},
      {year:1980,team_id:"WILLIAMS",chassis_spec:84,aero_spec:83,gearbox_spec:82,suspension_spec:82,brakes_spec:81,cooling_spec:80,reliability:0.82,weight:590},
      {year:1980,team_id:"RENAULT",chassis_spec:76,aero_spec:78,gearbox_spec:74,suspension_spec:75,brakes_spec:77,cooling_spec:72,turbo_spec:82,reliability:0.68,weight:600},
      {year:1980,team_id:"ATS",chassis_spec:70,aero_spec:69,gearbox_spec:71,suspension_spec:70,brakes_spec:72,cooling_spec:68,reliability:0.70,weight:605},
    ],
    // Deliberately impossible future historical values: career rollover must not import them.
    dbCarStats:[
      {year:1981,team_id:"RENAULT",chassis_spec:99,aero_spec:99,gearbox_spec:99,suspension_spec:99,brakes_spec:99,cooling_spec:99,reliability:0.99},
    ],
    teamEngines:[
      {year:1980,team_id:"PLAYER",engine_name:"Ford Cosworth DFV",power:81,reliability:0.80},
      {year:1980,team_id:"FERRARI",engine_name:"Ferrari 015",power:86,reliability:0.74},
      {year:1980,team_id:"WILLIAMS",engine_name:"Ford Cosworth DFV",power:82,reliability:0.82},
      {year:1980,team_id:"RENAULT",engine_name:"Renault EF1 Turbo",power:86,reliability:0.68},
      {year:1980,team_id:"ATS",engine_name:"Ford Cosworth DFV",power:76,reliability:0.72},
    ],
    facilities:[
      {year:1980,team_id:"FERRARI",aero_dept_level:9,wind_tunnel_level:9,manufacturing_leve:9,_chassis_shop_level:9},
      {year:1980,team_id:"WILLIAMS",aero_dept_level:8,wind_tunnel_level:8,manufacturing_leve:8,_chassis_shop_level:8},
      {year:1980,team_id:"RENAULT",aero_dept_level:7,wind_tunnel_level:7,manufacturing_leve:7,_chassis_shop_level:7},
      {year:1980,team_id:"ATS",aero_dept_level:4,wind_tunnel_level:4,manufacturing_leve:4,_chassis_shop_level:4},
    ],
    teamOperationalState:Object.fromEntries(AI_TEAMS.map(team=>[team,{team_id:team,morale:50}])),
    standings:{drivers:[],teams:[]},
    results:[],
    historySeasons:[],
    inbox:[],
    development:{projects:[],parts:[],partUnits:[],manufacturing:[],research:[]},
    garage:{cars:[]},
    dbDrivers:drivers,
    dbDriverRatings:[],
    dbStaffCore:[],dbStaffRatings:[],dbStaffContracts:[],
    dbTeams:[
      {team_id:"PLAYER",founded_year:1970},
      ...AI_TEAMS.map(team=>({team_id:team,founded_year:1970})),
    ],
    dbTeamSeasons:[],dbTeamBrands:[],dbContracts:[],
    dbRules:[],dbEraSafety:[],dbAccidentModel:[],dbPointsSystems:[],
    dbTyres:[],dbPenaltiesRules:[],dbFinancialRules:[],dbAgendaBlocks:[],
  };
}

function raceRows(gs){
  const rows=[];
  for(const team of AI_TEAMS){
    for(let car=1;car<=2;car+=1){
      const driverId=`${team}_D${car}`;
      rows.push({
        team_id:team,
        driver_id:driverId,
        driver:{driver_id:driverId},
        retired:false,
        laps_completed:60,
        race_laps:60,
      });
    }
  }
  return rows;
}

function standingsFromPerformance(gs){
  return AI_TEAMS
    .map(team=>({team_id:team,overall:teamCarPerformance(gs,team).overall}))
    .sort((a,b)=>b.overall-a.overall||a.team_id.localeCompare(b.team_id))
    .map((row,index)=>({
      team_id:row.team_id,
      position:index+1,
      points:(AI_TEAMS.length-index)*10,
    }));
}

function seasonSummary(gs,year){
  return Object.fromEntries(AI_TEAMS.map(team=>{
    const state=aiTechnicalTeamState(gs,team);
    const projects=(state?.development?.projects||[]).filter(row=>Number(String(row?.started_at||"").slice(0,4))===year);
    const strengths=(state?.development?.parts||[]).map(part=>Number(part?.perf||0));
    return [team,{
      budget:Number(state?.budget||0),
      projects:projects.length,
      designs:(state?.development?.parts||[]).length,
      units:(state?.development?.partUnits||[]).length,
      max_design_strength:strengths.length?Math.max(...strengths):0,
      overall:teamCarPerformance(gs,team).overall,
    }];
  }));
}

function runSeason(gs,year){
  let next={...gs,activeYear:year,currentDateISO:isoDate(year,1,1)};
  next=normalizeAITechnicalWorld(next);
  const raceDates=new Set((next.calendar||[]).map(row=>String(row?.race_date??row?.date).slice(0,10)));
  let date=isoDate(year,1,1);
  const end=isoDate(year,10,12);
  while(date<=end){
    next={...next,currentDateISO:date};
    next=tickAITechnicalWorld(next);
    if(raceDates.has(date)){
      next=applyAIRaceComponentWear(next,{gp:{gp_id:`${year}:${date}`},race:raceRows(next)});
    }
    date=addDays(date,7);
  }
  next={...next,standings:{...next.standings,teams:standingsFromPerformance(next)}};
  return next;
}

function runSoak(){
  let gs=normalizeAITechnicalWorld(soakFixture());
  const seasons=[];
  for(let year=1980;year<=1985;year+=1){
    gs=runSeason(gs,year);
    seasons.push({year,summary:seasonSummary(gs,year)});
    if(year<1985){
      gs=materializeNextCareerSeason(gs,year+1);
      gs=normalizeAITechnicalWorld(gs);
    }
  }
  return {gs,seasons};
}

const SOAK_A=runSoak();
const SOAK_B=runSoak();

test("career rollover keeps simulated car baseline instead of importing future historical carStats",()=>{
  let gs=normalizeAITechnicalWorld(soakFixture());
  gs=runSeason(gs,1980);
  const renault1980=gs.carStats.find(row=>row.team_id==="RENAULT");
  assert.equal(renault1980.chassis_spec,76);

  gs=materializeNextCareerSeason(gs,1981);
  const renault1981=gs.carStats.find(row=>row.team_id==="RENAULT");
  assert.equal(renault1981.year,1981);
  assert.equal(renault1981.chassis_spec,76);
  assert.notEqual(renault1981.chassis_spec,99);
});

test("season rollover replenishes a bounded AI technical envelope without infinite money",()=>{
  const {gs}=SOAK_A;
  for(const team of AI_TEAMS){
    const state=aiTechnicalTeamState(gs,team);
    assert.ok(state.season_history.length>=5,`${team} should archive each completed technical season`);
    assert.equal(state.economy.season_year,1985);
    assert.ok(state.economy.last_allocation>0);
    assert.ok(state.budget>=0);
    assert.ok(state.economy.opening_budget<=state.initial_budget*1.21);
    const allocations=state.finance_log.filter(row=>row.category==="Technical Budget");
    assert.equal(allocations.length,5,`${team} should receive exactly one allocation for 1981-1985`);
  }
});

test("multi-season AI development stays capacity-limited and design strength is bounded",()=>{
  const {gs,seasons}=SOAK_A;
  for(const season of seasons){
    for(const team of AI_TEAMS){
      assert.ok(season.summary[team].projects<=5,`${team} exceeded seasonal project ceiling in ${season.year}`);
      assert.ok(season.summary[team].budget>=0,`${team} went negative in ${season.year}`);
      assert.ok(season.summary[team].overall>=0&&season.summary[team].overall<=100);
      assert.ok(season.summary[team].max_design_strength<=6.001);
    }
  }

  for(const team of AI_TEAMS){
    const state=aiTechnicalTeamState(gs,team);
    const bySlot=new Map();
    for(const part of state.development.parts){
      const list=bySlot.get(part.slot)||[];
      list.push(Number(part.perf||0));
      bySlot.set(part.slot,list);
    }
    for(const strengths of bySlot.values()){
      for(let i=1;i<strengths.length;i+=1){
        assert.ok(strengths[i]>=strengths[i-1]-0.001,"successive designs must not regress their specification");
      }
    }
  }
});

test("weaker and stronger teams retain unequal resources instead of receiving identical hidden funding",()=>{
  let gs=normalizeAITechnicalWorld(soakFixture());
  gs=runSeason(gs,1980);
  gs=materializeNextCareerSeason(gs,1981);
  gs=normalizeAITechnicalWorld(gs);

  const ferrari=aiTechnicalTeamState(gs,"FERRARI");
  const ats=aiTechnicalTeamState(gs,"ATS");
  assert.ok(ferrari.economy.last_allocation>ats.economy.last_allocation);
  assert.notEqual(ferrari.economy.resource_factor,ats.economy.resource_factor);
});

test("five-season technical soak is deterministic and does not freeze the whole grid",()=>{
  const a=SOAK_A;
  const b=SOAK_B;
  assert.deepEqual(a.seasons,b.seasons);

  const totalProjects=a.seasons.reduce((sum,season)=>
    sum+AI_TEAMS.reduce((inner,team)=>inner+season.summary[team].projects,0),0
  );
  assert.ok(totalProjects>4,"the grid should continue making selective technical progress over multiple seasons");

  const teamsWithDevelopment=new Set();
  for(const season of a.seasons){
    for(const team of AI_TEAMS){
      if(season.summary[team].projects>0)teamsWithDevelopment.add(team);
    }
  }
  assert.ok(teamsWithDevelopment.size>=2,"development should not collapse to a single AI team");
});
