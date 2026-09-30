import test from "node:test";
import assert from "node:assert/strict";
import { staffRatingForYear } from "../src/domain/staffPerformance.js";

const gs={
  activeYear:1985,
  staffRatings:[
    {staff_id:"S1",year:1980,technical:70},
    {staff_id:"S1",year:1985,technical:80},
    {staff_id:"S1",year:1990,technical:90},
    {staff_id:"S2",season_year:1992,technical:92},
  ],
};

test("S2.0B1 resolves the exact Staff rating for the requested year",()=>{
  assert.equal(staffRatingForYear(gs,"S1",1985).technical,80);
});

test("S2.0B1 carries forward only the latest historical Staff rating",()=>{
  assert.equal(staffRatingForYear(gs,"S1",1988).technical,80);
});

test("S2.0B1 never leaks a future-only Staff rating into an earlier career",()=>{
  assert.deepEqual(staffRatingForYear(gs,"S2",1985),{});
});

test("S2.0B1 accepts season_year while preserving the temporal boundary",()=>{
  assert.equal(staffRatingForYear(gs,"S2",1992).technical,92);
  assert.deepEqual(staffRatingForYear(gs,"S2",1991),{});
});
