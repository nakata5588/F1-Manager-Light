import test from "node:test";
import assert from "node:assert/strict";
import { entityProfilePath, entityTypeFromProfilePath } from "../src/domain/entityRoutes.js";

test("entity profile routes are canonical and URL-safe",()=>{
  assert.equal(entityProfilePath("driver","D1"),"/drivers/D1");
  assert.equal(entityProfilePath("team","T Ferrari"),"/teams/T%20Ferrari");
  assert.equal(entityProfilePath("staff","S_0023"),"/staff/S_0023");
  assert.equal(entityProfilePath("sponsor","SP1"),null);
});

test("entity profile path detection distinguishes navigable entity pages",()=>{
  assert.equal(entityTypeFromProfilePath("/drivers/D_0001"),"driver");
  assert.equal(entityTypeFromProfilePath("/teams/T_FERRARI"),"team");
  assert.equal(entityTypeFromProfilePath("/staff/S_0023"),"staff");
  assert.equal(entityTypeFromProfilePath("/Drivers"),null);
  assert.equal(entityTypeFromProfilePath("/Car"),null);
});
