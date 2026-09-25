import test from "node:test";
import assert from "node:assert/strict";
import {
  historicalAssetCandidatesFromSet,
  historicalAssetManifest,
  mergeHistoricalAssetSets,
  normalizeHistoricalAssetAlias,
  resolveHistoricalAsset,
} from "../src/domain/historicalAssets.js";
import { visualAssetOverrideSet, withVisualAssetOverride } from "../src/domain/visualAssetOverrides.js";

test("historical asset aliases normalize stable ids and display names", () => {
  assert.equal(normalizeHistoricalAssetAlias("t_0001"), "t0001");
  assert.equal(normalizeHistoricalAssetAlias("st_0017"), "st0017");
  assert.equal(normalizeHistoricalAssetAlias("Alfa Romeo"), "alfaromeo");
});

test("current legacy assets are indexed without runtime directory scans", () => {
  const manifest=historicalAssetManifest();
  assert.equal(manifest.drivers.d0117.default, "/portraits/drivers/d_0117.webp");
  assert.equal(manifest.teams.t0001.default, "/logos/teams/t_0001.png");
});

test("stable ids resolve current driver portraits and numeric team logos", () => {
  assert.equal(resolveHistoricalAsset("drivers", ["d_0117","Alain Prost"], 1980), "/portraits/drivers/d_0117.webp");
  assert.equal(resolveHistoricalAsset("teams", ["t_0001","Williams"], 1980), "/logos/teams/t_0001.png");
});

test("dated assets switch automatically from their effective season", () => {
  const set={
    default:"/assets/teams/t_0001.webp",
    history:[
      {year:1981,path:"/assets/teams/t_0001_1981.webp"},
      {year:1985,path:"/assets/teams/t_0001_1985.webp"},
    ],
  };

  assert.equal(historicalAssetCandidatesFromSet(set,1980)[0],"/assets/teams/t_0001.webp");
  assert.equal(historicalAssetCandidatesFromSet(set,1981)[0],"/assets/teams/t_0001_1981.webp");
  assert.equal(historicalAssetCandidatesFromSet(set,1984)[0],"/assets/teams/t_0001_1981.webp");
  assert.equal(historicalAssetCandidatesFromSet(set,1985)[0],"/assets/teams/t_0001_1985.webp");
  assert.equal(historicalAssetCandidatesFromSet(set,1990)[0],"/assets/teams/t_0001_1985.webp");
});

test("nearest future asset is only used when no timeless default exists", () => {
  const withDefault={
    default:"/assets/staff/st_0017.webp",
    history:[{year:1985,path:"/assets/staff/st_0017_1985.webp"}],
  };
  const withoutDefault={
    default:"",
    history:[{year:1985,path:"/assets/staff/st_0017_1985.webp"}],
  };

  assert.equal(historicalAssetCandidatesFromSet(withDefault,1980)[0],"/assets/staff/st_0017.webp");
  assert.equal(historicalAssetCandidatesFromSet(withoutDefault,1980)[0],"/assets/staff/st_0017_1985.webp");
});


test("uploaded current-season image overrides the same or older historical asset", () => {
  const base={
    default:"/assets/drivers/d_0117.webp",
    history:[
      {year:1980,path:"/assets/drivers/d_0117_1980.webp"},
      {year:1981,path:"/assets/drivers/d_0117_1981.webp"},
    ],
  };
  const dataUrl="data:image/webp;base64,CUSTOM1980";
  const overrides=withVisualAssetOverride({},{
    type:"drivers",
    entityId:"d_0117",
    year:1980,
    path:dataUrl,
  });
  const overrideSet=visualAssetOverrideSet(overrides,"drivers","d_0117");
  const merged=mergeHistoricalAssetSets(base,overrideSet);

  assert.equal(historicalAssetCandidatesFromSet(merged,1980)[0],dataUrl);
  assert.equal(historicalAssetCandidatesFromSet(merged,1981)[0],"/assets/drivers/d_0117_1981.webp");
});

test("uploaded image wins over repository asset for the same effective year", () => {
  const base={
    default:"/assets/teams/t_0001.webp",
    history:[{year:1981,path:"/assets/teams/t_0001_1981.webp"}],
  };
  const dataUrl="data:image/webp;base64,CUSTOM1981";
  const overrides=withVisualAssetOverride({},{
    type:"teams",
    entityId:"t_0001",
    year:1981,
    path:dataUrl,
  });
  const merged=mergeHistoricalAssetSets(
    base,
    visualAssetOverrideSet(overrides,"teams","t_0001")
  );

  assert.equal(historicalAssetCandidatesFromSet(merged,1981)[0],dataUrl);
  assert.equal(historicalAssetCandidatesFromSet(merged,1985)[0],dataUrl);
});
