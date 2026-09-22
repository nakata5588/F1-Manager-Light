import test from "node:test";
import assert from "node:assert/strict";
import {
  driverAvailabilitySnapshot,
  driverProfileSnapshot,
  driverSeasonSnapshot,
} from "../src/domain/driverProfile.js";

function state(){
  return {
    activeYear:1980,
    currentDateISO:"1980-05-20",
    team:{team_id:"T1",team_name:"Player Team"},
    drivers:[
      {driver_id:"D1",display_name:"Driver One",country_name:"United Kingdom"},
      {driver_id:"D2",display_name:"Driver Two"},
    ],
    driverRatings:[
      {driver_id:"D1",current_ability:82,potential_ability:88,pace:84,qualifying:83,racecraft:80,consistency:81},
    ],
    contracts:[
      {year:1980,team_id:"T1",team_name:"Player Team",driver_id:"D1",role:"Main Driver",salary:500000,status:"active",contract_until_year:1981},
    ],
    teams:[{team_id:"T1",team_name:"Player Team"}],
    standings:{drivers:[{driver_id:"D1",position:3,points:15}],teams:[]},
    driverAttributes:{D1:{confidence:60,morale:55,preparation:70,fatigue:20}},
    driverAvailability:{
      D1:{driver_id:"D1",status:"injured",reason:"wrist sprain",expectedReturnDate:"1980-06-01"},
    },
    medicalHistory:[
      {driver_id:"D1",date:"1980-05-19",outcome:"injury",injury_reason:"wrist sprain",injury_severity:"minor",expected_return_date:"1980-06-01"},
    ],
    results:[
      {
        year:1980,
        qualifying:[{driver_id:"D1",position:1}],
        classification:[
          {driver_id:"D1",position:2,points:6,retired:false,fastest_lap:true},
        ],
      },
      {
        year:1980,
        qualifying:[{driver_id:"D1",position:4}],
        classification:[
          {driver_id:"D1",position:12,points:0,retired:true,status:"DNF"},
        ],
      },
    ],
  };
}

test("driver season snapshot composes live result and standings data",()=>{
  const snap=driverSeasonSnapshot(state(),"D1");
  assert.equal(snap.starts,2);
  assert.equal(snap.wins,0);
  assert.equal(snap.podiums,1);
  assert.equal(snap.poles,1);
  assert.equal(snap.fastestLaps,1);
  assert.equal(snap.dnfs,1);
  assert.equal(snap.bestFinish,2);
  assert.equal(snap.averageFinish,7);
  assert.equal(snap.championshipPosition,3);
  assert.equal(snap.points,15);
});

test("driver availability snapshot keeps medical and return context together",()=>{
  const snap=driverAvailabilitySnapshot(state(),"D1");
  assert.equal(snap.available,false);
  assert.equal(snap.status,"injured");
  assert.equal(snap.reason,"wrist sprain");
  assert.equal(snap.expectedReturnDate,"1980-06-01");
  assert.equal(snap.medical.injury_severity,"minor");
});

test("driver profile snapshot keeps permanent ability separate from condition effect",()=>{
  const snap=driverProfileSnapshot(state(),"D1");
  assert.equal(snap.driver.display_name,"Driver One");
  assert.equal(snap.teamName,"Player Team");
  assert.equal(snap.overall.value,82);
  assert.equal(snap.condition.confidence,60);
  assert.ok(Number.isFinite(snap.conditionImpact.total));
  assert.equal(snap.season.starts,2);
  assert.equal(snap.availability.status,"injured");
  assert.equal(snap.contract.role,"Main Driver");
});
