import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_USER_SETTINGS,
  contentMaxForLayout,
  effectiveAnimations,
  effectiveUiScale,
  mergeUserSettings,
  readUserSettings,
  viewportLayout,
  writeUserSettings,
} from "../src/domain/userPreferences.js";

function memoryStorage(){
  const data=new Map();
  return {
    getItem:(key)=>data.has(key)?data.get(key):null,
    setItem:(key,value)=>data.set(key,String(value)),
  };
}

test("responsive layout classification follows available viewport",()=>{
  assert.equal(viewportLayout(1100,800),"compact");
  assert.equal(viewportLayout(1440,900),"standard");
  assert.equal(viewportLayout(1720,1000),"wide");
  assert.equal(viewportLayout(2560,1440),"ultrawide");
  assert.equal(contentMaxForLayout("wide"),"1600px");
});

test("Auto UI Scale uses viewport while manual choices override it",()=>{
  assert.equal(effectiveUiScale("auto",1200,700),"compact");
  assert.equal(effectiveUiScale("auto",1920,1080),"standard");
  assert.equal(effectiveUiScale("auto",2560,1440),"large");
  assert.equal(effectiveUiScale("compact",2560,1440),"compact");
  assert.equal(effectiveAnimations("auto",true),"reduced");
  assert.equal(effectiveAnimations("full",true),"full");
});

test("global user settings deep-merge and persist display preferences",()=>{
  const storage=memoryStorage();
  const settings=mergeUserSettings({
    display:{uiScale:"large",informationDensity:"high"},
    gameplay:{difficulty:"hard"},
  });
  const saved=writeUserSettings(settings,storage);
  assert.equal(saved.ok,true);

  const loaded=readUserSettings(storage);
  assert.equal(loaded.display.uiScale,"large");
  assert.equal(loaded.display.informationDensity,"high");
  assert.equal(loaded.display.tooltips,DEFAULT_USER_SETTINGS.display.tooltips);
  assert.equal(loaded.gameplay.difficulty,"hard");
  assert.equal(loaded.gameplay.simSpeed,DEFAULT_USER_SETTINGS.gameplay.simSpeed);
});
