import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Team Profile initializes display name before historical logo candidates", async()=>{
  const source=await readFile(new URL("../src/components/entity/TeamModal.jsx",import.meta.url),"utf8");
  const nameIndex=source.indexOf("const name = team?.team_name");
  const logoIndex=source.indexOf("const logoCandidates = useMemo");
  assert.ok(nameIndex>=0,"Team Profile display name declaration must exist");
  assert.ok(logoIndex>=0,"Team Profile logo resolver must exist");
  assert.ok(nameIndex<logoIndex,"Team display name must be initialized before logo candidate resolution");
});
