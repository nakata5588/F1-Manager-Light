import test from "node:test";
import assert from "node:assert/strict";
import {
  historicalIsDnf,
  historicalRaceStarted,
  historicalResultDisplay,
  historicalResultInfo,
} from "../src/domain/historicalRaceStatus.js";

test("historical positionText codes map to game result labels",()=>{
  const cases=[
    ["R","dnf","DNF","Retired",true,true],
    ["D","dsq","DSQ","Disqualified",true,false],
    ["E","excluded","EXC","Excluded",true,false],
    ["F","dnq","DNQ","Failed to qualify",false,false],
    ["N","nc","NC","Not classified",true,false],
    ["W","withdrawn","WD","Withdrew",false,false],
  ];

  for(const [code,key,display,label,started,isDnf] of cases){
    const row={positionText:code,position:99};
    const info=historicalResultInfo(row);
    assert.equal(info.key,key,code);
    assert.equal(info.display,display,code);
    assert.equal(info.label,label,code);
    assert.equal(historicalRaceStarted(row),started,code);
    assert.equal(historicalIsDnf(row),isDnf,code);
    assert.equal(historicalResultDisplay(row),display,code);
  }
});

test("normal classified results keep numeric finishing position",()=>{
  const row={positionText:"3",position:3,status:"Finished"};
  const info=historicalResultInfo(row);
  assert.equal(info.key,"finished");
  assert.equal(historicalRaceStarted(row),true);
  assert.equal(historicalResultDisplay(row),"3");
});

test("runtime retirement text is compatible with historical decoder",()=>{
  const row={position:12,retired:true,status:"Engine"};
  assert.equal(historicalResultInfo(row).key,"dnf");
  assert.equal(historicalResultDisplay(row),"DNF");
});
