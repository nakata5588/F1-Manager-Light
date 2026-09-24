import test from "node:test";
import assert from "node:assert/strict";
import { driverPortraitTimeline, resolveDriverPortrait } from "../src/domain/driverPortraits.js";

test("1980 portrait resolves by stable driver id", () => {
  assert.equal(resolveDriverPortrait("d_0017", 1980), "/portraits/drivers/1980/d_0017.webp");
});

test("historical portrait carries forward until a newer portrait exists", () => {
  assert.equal(resolveDriverPortrait("d_0005", 1986), "/portraits/drivers/1980/d_0005.webp");
});

test("portrait resolver does not leak a future portrait into an earlier season", () => {
  assert.equal(resolveDriverPortrait("d_0017", 1979, "/fallback/alain.jpg"), "/fallback/alain.jpg");
});

test("fallback paths may use any browser-supported image extension", () => {
  assert.equal(resolveDriverPortrait("missing-driver", 1980, "/custom/driver.png"), "/custom/driver.png");
  assert.equal(resolveDriverPortrait("missing-driver", 1980, "/custom/driver.jpg"), "/custom/driver.jpg");
  assert.equal(resolveDriverPortrait("missing-driver", 1980, "/custom/driver.jpeg"), "/custom/driver.jpeg");
  assert.equal(resolveDriverPortrait("missing-driver", 1980, "/custom/driver.webp"), "/custom/driver.webp");
});

test("1980 registry contains all imported portraits", () => {
  const ids = [
    "d_0001","d_0002","d_0003","d_0004","d_0005","d_0006","d_0007","d_0008",
    "d_0009","d_0010","d_0011","d_0012","d_0013","d_0014","d_0015","d_0016",
    "d_0017","d_0018","d_0019","d_0020","d_0110","d_0205","d_0213",
  ];
  for (const id of ids) assert.equal(driverPortraitTimeline(id).length, 1, id);
});
