import test from "node:test";
import assert from "node:assert/strict";

import { availableCarComponentSlots } from "../src/domain/carComponents.js";
import {
  discoverableCarTechnologies,
  processTechnologyAdoption,
  processTechnologyDiscoveryNews,
  startTechnologyAdoption,
  technologyAdoptionQuote,
} from "../src/domain/technologyAdoption.js";

function fixture(){
  return {
    activeYear:1980,
    currentDateISO:"1980-02-01",
    team:{team_id:"PLAYER",team_name:"Player Team",budget:5_000_000},
    finances:{budget:5_000_000,balance:5_000_000,season_spend:0,season_income:0},
    teams:[
      {team_id:"PLAYER",team_name:"Player Team"},
      {team_id:"RENAULT",team_name:"Renault"},
      {team_id:"WILLIAMS",team_name:"Williams"},
    ],
    carStats:[
      {year:1980,team_id:"PLAYER",chassis_spec:80,aero_spec:80,gearbox_spec:80,cooling_spec:80,turbo_spec:0},
      {year:1980,team_id:"RENAULT",chassis_spec:76,aero_spec:78,gearbox_spec:74,cooling_spec:72,turbo_spec:82},
      {year:1980,team_id:"WILLIAMS",chassis_spec:84,aero_spec:83,gearbox_spec:82,cooling_spec:80,turbo_spec:0},
    ],
    teamEngines:[
      {year:1980,team_id:"PLAYER",engine_name:"Ford Cosworth DFV",power:82,reliability:82},
      {year:1980,team_id:"RENAULT",engine_name:"Renault EF1 Turbo",power:86,reliability:68},
      {year:1980,team_id:"WILLIAMS",engine_name:"Ford Cosworth DFV",power:82,reliability:82},
    ],
    facilities:[
      {year:1980,team_id:"PLAYER",manufacturing_leve:7,aero_dept_level:7,wind_tunnel_level:7,_chassis_shop_level:7},
      {year:1980,team_id:"RENAULT",manufacturing_leve:7,aero_dept_level:7,wind_tunnel_level:7,_chassis_shop_level:7},
      {year:1980,team_id:"WILLIAMS",manufacturing_leve:8,aero_dept_level:8,wind_tunnel_level:8,_chassis_shop_level:8},
    ],
    teamOperationalState:{PLAYER:{team_id:"PLAYER",morale:50}},
    development:{projects:[],parts:[],partUnits:[],manufacturing:[],research:[],technologyProjects:[]},
    technicalUnlocks:{},
    technologyDiscoverySeen:{},
    inbox:[],
    financeLog:[],
    garage:{cars:[],serviceJobs:[],baseComponentStock:{},reserveCarBuilt:false},
  };
}

test("Renault turbo creates an era-legal technology opportunity for a normally aspirated team",()=>{
  const gs=fixture();
  assert.equal(availableCarComponentSlots(gs,"RENAULT").includes("turbocharger"),true);
  assert.equal(availableCarComponentSlots(gs,"PLAYER").includes("turbocharger"),false);

  const opportunities=discoverableCarTechnologies(gs,"PLAYER");
  const turbo=opportunities.find((row)=>row.slot==="turbocharger");
  assert.ok(turbo);
  assert.deepEqual(turbo.source_team_ids,["RENAULT"]);
  assert.match(turbo.label,/Turbo/i);
});

test("technology discovery produces one actionable paddock news item without spam",()=>{
  const gs=fixture();
  const first=processTechnologyDiscoveryNews(gs);
  const news=first.inbox.find((row)=>String(row.id).includes("technology_opportunity")&&/Turbo/i.test(row.subject));
  assert.ok(news);
  assert.match(news.body,/Renault/i);
  assert.ok(news.actions.some((action)=>String(action.route).includes("tab=research")));

  const second=processTechnologyDiscoveryNews(first);
  assert.equal(
    second.inbox.filter((row)=>String(row.id)===String(news.id)).length,
    1,
    "daily discovery checks must not duplicate the same technology story"
  );
});

test("player technology adoption costs money and takes time before eligibility changes",()=>{
  const gs=fixture();
  const quote=technologyAdoptionQuote(gs,"PLAYER","turbocharger");
  const started=startTechnologyAdoption(gs,"PLAYER","turbocharger",{origin:"player"});
  const project=started.development.technologyProjects[0];

  assert.ok(project);
  assert.equal(project.status,"active");
  assert.equal(started.team.budget,gs.team.budget-quote.cost);
  assert.ok(project.finishes_at>project.started_at);
  assert.equal(availableCarComponentSlots(started,"PLAYER").includes("turbocharger"),false);

  const completed=processTechnologyAdoption({...started,currentDateISO:project.finishes_at});
  assert.equal(completed.development.technologyProjects[0].status,"completed");
  assert.equal(availableCarComponentSlots(completed,"PLAYER").includes("turbocharger"),true);
  assert.ok(completed.technicalUnlocks.PLAYER.turbocharger);
  assert.match(completed.inbox[0].body,/designed and manufactured/i);
});

test("technology adoption unlocks an R&D area but never creates a free physical part",()=>{
  const gs=fixture();
  const started=startTechnologyAdoption(gs,"PLAYER","turbocharger");
  const project=started.development.technologyProjects[0];
  const completed=processTechnologyAdoption({...started,currentDateISO:project.finishes_at});

  assert.equal(completed.development.parts.length,0);
  assert.equal(completed.development.partUnits.length,0);
  assert.equal(completed.garage.cars.length,0);
  assert.equal(availableCarComponentSlots(completed,"PLAYER").includes("turbocharger"),true);
});

test("without a rival source, a team cannot start an unavailable special technology programme",()=>{
  const gs=fixture();
  const noTurbo={
    ...gs,
    carStats:gs.carStats.map((row)=>row.team_id==="RENAULT"?{...row,turbo_spec:0}:row),
    teamEngines:gs.teamEngines.map((row)=>row.team_id==="RENAULT"?{...row,engine_name:"Renault EF1"}:row),
  };
  assert.equal(discoverableCarTechnologies(noTurbo,"PLAYER").some((row)=>row.slot==="turbocharger"),false);
  const attempted=startTechnologyAdoption(noTurbo,"PLAYER","turbocharger");
  assert.equal(attempted,noTurbo);
});
