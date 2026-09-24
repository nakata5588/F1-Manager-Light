import test from "node:test";
import assert from "node:assert/strict";
import {
  driverPortraitTimeline,
  hydrateDriverPortraitRows,
  resolveDriverPortrait,
} from "../src/domain/driverPortraits.js";

test("1980 portrait resolves by canonical runtime driver id", () => {
  assert.equal(resolveDriverPortrait("d_0117", 1980), "/portraits/drivers/1980/d_0117.webp");
  assert.equal(resolveDriverPortrait("d_0178", 1980), "/portraits/drivers/1980/d_0178.webp");
  assert.equal(resolveDriverPortrait("d_0203", 1980), "/portraits/drivers/1980/d_0203.webp");
});

test("legacy ids no longer resolve to the wrong driver portrait", () => {
  assert.equal(resolveDriverPortrait("d_0017", 1980), "");
  assert.equal(resolveDriverPortrait("d_0001", 1980), "");
});

test("historical portrait carries forward until a newer portrait exists", () => {
  assert.equal(resolveDriverPortrait("d_0137", 1986), "/portraits/drivers/1980/d_0137.webp");
});

test("portrait resolver does not leak a future portrait into an earlier season", () => {
  assert.equal(resolveDriverPortrait("d_0117", 1979, "/fallback/alain.jpg"), "/fallback/alain.jpg");
});

test("fallback paths may use any browser-supported image extension", () => {
  assert.equal(resolveDriverPortrait("missing-driver", 1980, "/custom/driver.png"), "/custom/driver.png");
  assert.equal(resolveDriverPortrait("missing-driver", 1980, "/custom/driver.jpg"), "/custom/driver.jpg");
  assert.equal(resolveDriverPortrait("missing-driver", 1980, "/custom/driver.jpeg"), "/custom/driver.jpeg");
  assert.equal(resolveDriverPortrait("missing-driver", 1980, "/custom/driver.webp"), "/custom/driver.webp");
});

test("managed portrait paths from the broken legacy mapping are not kept as fallback", () => {
  assert.equal(
    resolveDriverPortrait("d_0017", 1980, "/portraits/drivers/1980/d_0017.webp"),
    ""
  );
});

test("loaded save driver rows are rehydrated with canonical portraits", () => {
  const rows = hydrateDriverPortraitRows([
    { driver_id: "d_0117", display_name: "Alain Prost", portrait_path: "" },
    { driver_id: "d_0017", display_name: "Another Driver", portrait_path: "/portraits/drivers/1980/d_0017.webp" },
    { driver_id: "custom", display_name: "External Portrait", portrait_path: "/custom/photo.png" },
  ], 1980);

  assert.equal(rows[0].portrait_path, "/portraits/drivers/1980/d_0117.webp");
  assert.equal(rows[1].portrait_path, "");
  assert.equal(rows[2].portrait_path, "/custom/photo.png");
});

test("1980 registry contains all 23 imported canonical portraits", () => {
  const ids = [
    "d_0110","d_0117","d_0119","d_0137","d_0152","d_0163","d_0172","d_0173",
    "d_0177","d_0178","d_0187","d_0197","d_0199","d_0200","d_0202","d_0203",
    "d_0205","d_0206","d_0207","d_0213","d_0219","d_0222","d_0224",
  ];
  for (const id of ids) assert.equal(driverPortraitTimeline(id).length, 1, id);
});
