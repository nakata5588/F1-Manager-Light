import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createRng, gameplayRngFor } from "../src/core/random.js";
import { pickWeighted } from "../src/utils/weather.js";

const PROJECT_ROOT=fileURLToPath(new URL("../",import.meta.url));
const SRC_ROOT=path.join(PROJECT_ROOT,"src");

async function walk(dir){
  const out=[];
  for(const entry of await readdir(dir,{withFileTypes:true})){
    const target=path.join(dir,entry.name);
    if(entry.isDirectory())out.push(...await walk(target));
    else if(/\.(?:js|jsx|mjs)$/.test(entry.name))out.push(target);
  }
  return out;
}

const ALLOWED_NON_GAMEPLAY_RANDOM=[
  {path:"src/pages/CreateTeam.jsx",token:"Math.floor(Math.random() * copy.length)",reason:"pre-career user-triggered Randomize button"},
  {path:"src/pages/Board.jsx",token:"board_msg_${Date.now()}_${Math.random().toString(36).slice(2,5)}",reason:"technical inbox id only"},
  {path:"src/engine/EconomyEngine.js",token:"tx_${Date.now()}_${Math.random().toString(36).slice(2,7)}",reason:"technical ledger id only; gameplay dedupe uses sig"},
  {path:"src/engine/EventEngine.js",token:"inb_${Date.now()}_${Math.random().toString(36).slice(2,7)}",reason:"technical inbox id only"},
  {path:"src/engine/EventEngine.js",token:"ev_${Date.now()}_${Math.random().toString(36).slice(2,7)}",reason:"technical event id only"},
  {path:"src/state/GameStore.js",token:"t_${Date.now()}_${Math.random().toString(36).slice(2,6)}",reason:"ephemeral UI toast id only"},
  {path:"src/state/GameStore.js",token:"ev_${Date.now()}_${Math.random().toString(36).slice(2,7)}",reason:"technical queued-event id only"},
];

test("gameplay RNG is deterministic, Save World seeded and scope isolated",()=>{
  const gs={saveMeta:{seed:"career-f0.1"}};
  const first=gameplayRngFor(gs,"board-budget-request","1980-05-01:T1:attempt-1");
  const second=gameplayRngFor(gs,"board-budget-request","1980-05-01:T1:attempt-1");
  assert.deepEqual(
    [first.next(),first.int(1,100),first.pick(["a","b","c"])],
    [second.next(),second.int(1,100),second.pick(["a","b","c"])]
  );

  const boardRoll=gameplayRngFor(gs,"board-budget-request","same-key").next();
  const sponsorRoll=gameplayRngFor(gs,"sponsor-negotiation","same-key").next();
  assert.notEqual(boardRoll,sponsorRoll);
  assert.throws(()=>gameplayRngFor(gs,"","key"),/non-empty scope/);
});

test("weighted weather helper is deterministic only through an injected RNG",()=>{
  const weights={SUNNY:60,CLOUDY:25,LIGHT_RAIN:15};
  const a=createRng("weather-f0.1");
  const b=createRng("weather-f0.1");
  assert.equal(pickWeighted(weights,a),pickWeighted(weights,b));
  assert.throws(()=>pickWeighted(weights),/injected RNG source/);
});

test("source contains no unapproved direct Math.random gameplay rolls",async()=>{
  const violations=[];
  for(const file of await walk(SRC_ROOT)){
    const rel=path.relative(PROJECT_ROOT,file).split(path.sep).join("/");
    const lines=(await readFile(file,"utf8")).split("\n");
    lines.forEach((line,index)=>{
      if(!line.includes("Math.random("))return;
      const allowed=ALLOWED_NON_GAMEPLAY_RANDOM.some((rule)=>rule.path===rel&&line.includes(rule.token));
      if(!allowed)violations.push(`${rel}:${index+1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(violations,[],`Unseeded gameplay randomness detected:\n${violations.join("\n")}`);
});
