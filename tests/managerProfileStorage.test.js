import test from "node:test";
import assert from "node:assert/strict";

import {
  deleteManagerProfile,
  managerDraftId,
  readManagerProfileStore,
  rememberLastUsedManagerProfile,
  saveManagerProfile,
} from "../src/domain/managerProfileStorage.js";

function memoryStorage(){
  const data=new Map();
  return {
    getItem:(key)=>data.has(key)?data.get(key):null,
    setItem:(key,value)=>data.set(key,String(value)),
    removeItem:(key)=>data.delete(key),
  };
}

const profile={
  first_name:"Ricardo",
  last_name:"Mendes",
  nationality_name:"Portuguese",
  nationality_code:"prt",
  date_of_birth:"1988-01-01",
  place_of_birth:"Lisbon",
  background:"newcomer",
  experience_level:"rookie",
  portrait_data_url:"data:image/webp;base64,test",
  portrait_file_name:"manager.webp",
};

test("manager profile storage remembers Last Used independently of named profiles",()=>{
  const storage=memoryStorage();
  const result=rememberLastUsedManagerProfile(profile,storage);
  assert.equal(result.ok,true);

  const store=readManagerProfileStore(storage);
  assert.equal(store.lastUsed.first_name,"Ricardo");
  assert.equal(store.lastUsed.nationality_code,"PRT");
  assert.deepEqual(store.profiles,[]);
});

test("saving the same manager profile overwrites instead of duplicating",()=>{
  const storage=memoryStorage();
  saveManagerProfile(profile,storage);
  saveManagerProfile({...profile,place_of_birth:"Alfragide"},storage);

  const store=readManagerProfileStore(storage);
  assert.equal(store.profiles.length,1);
  assert.equal(store.profiles[0].id,managerDraftId(profile));
  assert.equal(store.profiles[0].profile.place_of_birth,"Alfragide");
});

test("saved manager profiles can be removed without clearing Last Used",()=>{
  const storage=memoryStorage();
  rememberLastUsedManagerProfile(profile,storage);
  saveManagerProfile(profile,storage);

  const id=readManagerProfileStore(storage).profiles[0].id;
  const result=deleteManagerProfile(id,storage);
  assert.equal(result.ok,true);

  const store=readManagerProfileStore(storage);
  assert.equal(store.profiles.length,0);
  assert.equal(store.lastUsed.first_name,"Ricardo");
});
