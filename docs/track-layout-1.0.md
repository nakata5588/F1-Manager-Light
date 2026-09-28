# Track Layout 1.0

## Contract

Track Layout keeps four concerns separate:

1. **Functional geometry** — authoritative centreline, pit lane, start/finish progress, sectors, direction and lap metadata. It is independent from artwork.
2. **Historical environment** — one static raster asset per historical layout, preferably WebP, plus native dimensions/view box.
3. **Visual calibration** — a presentation-only affine transform (`x`, `y`, `scale_x`, `scale_y`, `rotation_deg`, origin) that projects functional geometry into the environment coordinate space.
4. **Dynamic presentation** — cars, Track Intel, incidents, flags, pit markers and camera/focus overlays.

The Race Engine never reads the environment image or the visual calibration transform.

## Coordinate decision

Track Layout 1.0 does **not** rewrite existing centreline datasets to normalized 0..1 coordinates. Historical geometry may retain the native reference coordinate space it was traced in. This avoids changing already-verified paths and keeps the engine independent of display resolution.

Responsive rendering comes from SVG view boxes. Per-layout calibration handles any difference between the functional trace and the artwork. A future importer/calibration tool may accept normalized coordinates, but normalization is not required by the runtime contract.

## Historical environment rule

A historical environment is rendered from one image asset. Do not rebuild one approved reference by slicing it into multiple raster strips or recreating scenery as React/SVG nodes.

SVG remains appropriate for lightweight dynamic overlays and debug/calibration guides.

## Buenos Aires 1980

- Layout: Circuit No. 15
- Environment: `/tracks/historical/buenos-aires-no15-1980.webp`
- Native space: 1649 × 954
- Functional geometry: `src/data/historicalTrackGeometry.js`
- Start/finish: upper straight
- Direction immediately after S/F: right
- Lap length: 5.968 km
- Calibration: identity at migration; future visual corrections belong in `calibration_transform`, not in the functional centreline.

## Reusable workflow

For a new historical layout:

1. add one approved environment image;
2. register native dimensions/view box;
3. provide or trace functional centreline and pit lane;
4. define S/F, direction, sectors and pit entry/exit metadata;
5. calibrate functional geometry to the environment through the visual transform;
6. verify Track Intel overlays independently from the bitmap;
7. test asset integrity, geometry independence and calibration;
8. playtest only after CI green and merge to `main`.

A dedicated calibration/debug UI can be built on top of the transform contract without changing Race Engine data.
