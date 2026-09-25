import test from "node:test";
import assert from "node:assert/strict";
import {
  driverPortraitSet,
  hydrateDriverPortraitRows,
  resolveDriverPortrait,
  resolvePortraitSet,
} from "../src/domain/driverPortraits.js";

test("default portrait resolves in any era for a canonical runtime driver id", () => {
  assert.equal(resolveDriverPortrait("d_0117", 1975), "/portraits/drivers/d_0117.webp");
  assert.equal(resolveDriverPortrait("d_0117", 1980), "/portraits/drivers/d_0117.webp");
  assert.equal(resolveDriverPortrait("d_0117", 1990), "/portraits/drivers/d_0117.webp");
});

test("legacy ids no longer resolve to the wrong driver portrait", () => {
  assert.equal(resolveDriverPortrait("d_0017", 1980), "");
  assert.equal(resolveDriverPortrait("d_0001", 1980), "");
});

test("historical resolver prefers latest portrait at or before the active year", () => {
  const set = {
    default: "/portraits/drivers/d_test.webp",
    history: [
      { year: 1980, path: "/portraits/drivers/history/1980/d_test.webp" },
      { year: 1985, path: "/portraits/drivers/history/1985/d_test.jpg" },
      { year: 1990, path: "/portraits/drivers/history/1990/d_test.png" },
    ],
  };

  assert.equal(resolvePortraitSet(set, 1980), "/portraits/drivers/history/1980/d_test.webp");
  assert.equal(resolvePortraitSet(set, 1987), "/portraits/drivers/history/1985/d_test.jpg");
  assert.equal(resolvePortraitSet(set, 2000), "/portraits/drivers/history/1990/d_test.png");
});

test("historical resolver keeps the timeless default before the first dated override", () => {
  const set = {
    default: "/portraits/drivers/d_test.webp",
    history: [
      { year: 1976, path: "/portraits/drivers/history/1976/d_test.jpg" },
      { year: 1980, path: "/portraits/drivers/history/1980/d_test.webp" },
    ],
  };

  assert.equal(resolvePortraitSet(set, 1975), "/portraits/drivers/d_test.webp");
});

test("timeless default is used when a driver has no historical variants", () => {
  const set = { default: "/portraits/drivers/d_test.jpeg", history: [] };
  assert.equal(resolvePortraitSet(set, 1950), "/portraits/drivers/d_test.jpeg");
  assert.equal(resolvePortraitSet(set, 2026), "/portraits/drivers/d_test.jpeg");
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

test("loaded save driver rows are rehydrated with canonical timeless portraits", () => {
  const rows = hydrateDriverPortraitRows([
    { driver_id: "d_0117", display_name: "Alain Prost", portrait_path: "" },
    { driver_id: "d_0017", display_name: "Another Driver", portrait_path: "/portraits/drivers/1980/d_0017.webp" },
    { driver_id: "custom", display_name: "External Portrait", portrait_path: "/custom/photo.png" },
  ], 1978);

  assert.equal(rows[0].portrait_path, "/portraits/drivers/d_0117.webp");
  assert.equal(rows[1].portrait_path, "");
  assert.equal(rows[2].portrait_path, "/custom/photo.png");
});

test("registry contains all 23 imported canonical timeless portraits", () => {
  const ids = [
    "d_0110","d_0117","d_0119","d_0137","d_0152","d_0163","d_0172","d_0173",
    "d_0177","d_0178","d_0187","d_0197","d_0199","d_0200","d_0202","d_0203",
    "d_0205","d_0206","d_0207","d_0213","d_0219","d_0222","d_0224",
  ];
  for (const id of ids) {
    const set = driverPortraitSet(id);
    assert.equal(set.default, `/portraits/drivers/${id}.webp`, id);
    assert.equal(set.history.length, 0, id);
  }
});
