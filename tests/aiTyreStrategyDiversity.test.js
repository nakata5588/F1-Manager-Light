import test from "node:test";
import assert from "node:assert/strict";
import { createRaceStrategyState } from "../src/engine/RaceStrategyEngine.js";
import { genericTyresForYear } from "../src/domain/raceTyreModel.js";

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
test("AI tyre diversity responds deterministically to the Save World seed",()=>{
  const first=aiCompounds(grid({seed:"tyre-mix-2000-regression"}));
  const other=aiCompounds(grid({seed:"alternate-career-save"}));
  assert.notDeepEqual(first,other,"distinct Save seeds should allow distinct tactical opening plans");
});
