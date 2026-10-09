import test from "node:test";
import assert from "node:assert/strict";
import { createRaceStrategyState, setRaceStrategySelection } from "../src/engine/RaceStrategyEngine.js";
import { genericTyresForYear, tyresForTeam } from "../src/domain/raceTyreModel.js";
import { initialRaceResources } from "../src/race2/core/RaceResources.js";

const gp={gp_id:"gp_463",gp_name:"Australian Grand Prix",track_id:"tr_0019",
  year:2000,race_date:"2000-03-12",weather:"SUNNY"};

function grid({seed="tyre-mix-2000-regression",tyreWear=65,highSkills=false,lowSkills=false}={}){
  const teams=Array.from({length:11},(_,i)=>({
    team_id:`team_${i+1}`,team_name:`Team ${i+1}`,
  }));
  const drivers=Array.from({length:22},(_,i)=>({
    driver_id:`driver_${i+1}`,display_name:`Driver ${i+1}`,
    team_id:teams[Math.floor(i/2)].team_id,
  }));
  const driverRatings=drivers.map((d,i)=>({
    driver_id:d.driver_id,
    tire_management:highSkills?90:lowSkills?35:49+(i*7)%43,
    race_intelligence:highSkills?90:lowSkills?45:50+(i*11)%40,
    aggression:highSkills?90:lowSkills?35:45+(i*13)%45,
    overtaking:highSkills?90:lowSkills?35:50+(i*17)%42,
  }));
  return {
    activeYear:2000,currentDateISO:"2000-03-12",saveMeta:{seed},
    raceWeekendState:{engine_version:"rw2"},
    team:teams[0],teams,drivers,driverRatings,
    tyres:genericTyresForYear(2000),
    coreTracks:[{
      track_id:"tr_0019",track_name:"Albert Park",tyre_wear:tyreWear,
      lap_length_km:5.303,laps_default:58,pit_lane_loss_s:23,
    }],
    trackLayoutByYear:[{
      track_id:"tr_0019",year_from:1996,year_to:2004,
      lap_length_km:5.303,laps:58,pit_lane_loss_s:23,
    }],
    raceEntryState:{entries:drivers.map(d=>({
      driver_id:d.driver_id,team_id:d.team_id,status:"confirmed",
    }))},
  };
}
function choices(world){
  return createRaceStrategyState(world,{gp,raceEntryState:world.raceEntryState}).state.selections;
}
function aiCompounds(world){
  return Object.values(choices(world)).filter(s=>s.team_id!=="team_1")
    .map(s=>s.start_tyre_id);
}
const softCount=(world)=>aiCompounds(world).filter(id=>id==="generic_2000_soft").length;

test("2000 high-wear track still creates meaningful deterministic dry-tyre differences",()=>{
  const world=grid();
  const a=choices(world),b=choices(world);
  assert.deepEqual(a,b,"same save, round and drivers must produce identical AI decisions");
  const ai=aiCompounds(world);
  assert.equal(ai.length,20);
  assert.ok(ai.includes("generic_2000_soft"),"not every AI car can start on Hards");
  assert.ok(ai.includes("generic_2000_hard"),"high-wear tracks must still reward durability");
  assert.equal(a.driver_1.start_tyre_id,"generic_2000_hard",
    "the player's historical safe default must not silently change");
  assert.ok(Object.values(a).every(s=>s.next_tyre_id&&s.pace_mode),
    "each driver must keep a valid plan and strategy");
});
test("AI compound risk respects driver tyre management, race intelligence and high wear",()=>{
  const high=grid({highSkills:true});
  const low=grid({lowSkills:true});
  const highSoft=softCount(high),lowSoft=softCount(low);
  assert.ok(highSoft>lowSoft,
    `better-equipped aggressive drivers should tolerate more soft starts (${highSoft} vs ${lowSoft})`);
  const baselineSoft=softCount(grid({tyreWear:65}));
  const extremeWearSoft=softCount(grid({tyreWear:95}));
  assert.ok(extremeWearSoft<=baselineSoft,
    "increasing track tyre wear should not create more soft-start AI decisions");
});
test("legacy live-race saves keep the old high-wear durable tyre defaults",()=>{
  const legacy={...grid(),raceWeekendState:{engine_version:"legacy"}};
  const options=aiCompounds(legacy);
  assert.ok(options.every(id=>id==="generic_2000_hard"));
});
test("AI tyre diversity responds deterministically to the Save World seed",()=>{
  const first=aiCompounds(grid({seed:"tyre-mix-2000-regression"}));
  const other=aiCompounds(grid({seed:"alternate-career-save"}));
  assert.notDeepEqual(first,other,"distinct Save seeds should allow distinct tactical opening plans");
});

test("Australian GP 2000 takes Bridgestone Soft/Medium rather than generic Hard/Soft",()=>{
  const world={...grid(),tyres:[],raceWeekendState:{engine_version:"rw2",track_id:"tr_0019"}};
  const allocation=tyresForTeam(world,"team_2");
  assert.deepEqual(allocation.filter(tyre=>tyre.category==="dry").map(tyre=>tyre.compound_name),
    ["Medium","Soft"]);
  assert.ok(allocation.every(tyre=>tyre.supplier==="Bridgestone"));
  assert.ok(allocation.every(tyre=>tyre.model_parameters_estimated===true));
  const saved={...world,raceWeekendState:{
    engine_version:"rw2",track_id:"tr_0019",
    race_strategy:{selections:{driver_1:{
      driver_id:"driver_1",team_id:"team_1",
      start_tyre_id:"generic_2000_hard",next_tyre_id:"generic_2000_soft",
    }}},
  }};
  assert.ok(tyresForTeam(saved,"team_1").some(row=>row.tyre_id==="generic_2000_hard"),
    "old race-weekend saves retain their exact historical-in-save tyre IDs");
  assert.ok(tyresForTeam(saved,"team_2").some(row=>row.tyre_id==="bs_2000_aus_medium"),
    "other teams can still consume verified event allocation");
  const strategy=createRaceStrategyState(world,{gp,raceEntryState:world.raceEntryState});
  const selections=Object.values(strategy.state.selections);
  assert.equal(strategy.state.rules_snapshot.dry_specification_locked,true);
  assert.ok(selections.every(s=>
    s.start_tyre_id!=="bs_2000_aus_medium"&&s.start_tyre_id!=="bs_2000_aus_soft"
      ?true:s.next_tyre_id===s.start_tyre_id
  ));
  const compounds=new Set(selections.map(s=>s.start_tyre_id));
  assert.ok(compounds.has("bs_2000_aus_soft")&&compounds.has("bs_2000_aus_medium"),
    "driver choices can differ although each driver's dry specification stays fixed");
});

test("2000 manual tyre edits and canonical pit inventory respect one dry specification",()=>{
  const world={...grid(),tyres:[],raceWeekendState:{engine_version:"rw2",track_id:"tr_0019"}};
  const created=createRaceStrategyState(world,{gp,raceEntryState:world.raceEntryState});
  const gameState={
    ...created.gameState,
    raceWeekendState:{
      ...world.raceWeekendState,
      phase:"grid_ready",year:2000,race_strategy:created.state,
    },
  };
  const chosen=setRaceStrategySelection(gameState,{
    driverId:"driver_1",
    patch:{start_tyre_id:"bs_2000_aus_soft",next_tyre_id:"bs_2000_aus_medium"},
  });
  const selected=chosen.raceWeekendState.race_strategy.selections.driver_1;
  assert.equal(selected.start_tyre_id,"bs_2000_aus_soft");
  assert.equal(selected.next_tyre_id,"bs_2000_aus_soft",
    "a pit stop may fit fresh Softs, but not switch to a forbidden Medium");
  const original=tyresForTeam(chosen,"team_1");
  const carInput={
    resourceSetup:{
      tyres:original,
      strategy:{startTyreId:selected.start_tyre_id,nextTyreId:"bs_2000_aus_medium",drySpecificationLocked:true},
    },
  };
  const resources=initialRaceResources({year:2000,track:{year:2000}},carInput,{performance:{}});
  assert.equal(resources.tyre.compound,"Soft");
  assert.equal(resources.resources.strategy.nextTyreId,"bs_2000_aus_soft");
  assert.deepEqual(resources.resources.availableTyres
    .filter(t=>t.category==="dry").map(t=>t.tyre_id),["bs_2000_aus_soft"]);
  assert.ok(resources.resources.availableTyres.some(t=>t.category==="wet"),
    "wet-weather tyre switches remain legal");

  const argentina={...grid(),activeYear:1980,tyres:genericTyresForYear(1980),
    raceWeekendState:{engine_version:"rw2",track_id:"tr_0018"}};
  assert.ok(tyresForTeam(argentina,"team_1").some(t=>t.tyre_id==="generic_1980_hard"));
});
