# Historical visual assets

F1 Manager Light supports season-aware visual assets for drivers, staff and teams.

## Preferred folders

```text
public/assets/drivers/
public/assets/staff/
public/assets/teams/
```

Legacy assets under `public/portraits/drivers`, `public/portraits/staff` and
`public/logos/teams` remain supported. Files in `public/assets/*` take priority
when the same identity/year exists in both locations.

## Naming

Use the stable entity ID as the preferred filename.

```text
# timeless defaults
d_0117.webp
st_0017.webp
t_0001.webp

# effective from a season onward
d_0117_1985.webp
st_0017_1985.webp
t_0001_1981.webp
t_0001_1985.webp
```

The suffix is an **effective season**, not a one-season-only asset.

For example:

```text
t_0001.webp
t_0001_1981.webp
t_0001_1985.webp
```

resolves as:

- 1980: `t_0001.webp`
- 1981–1984: `t_0001_1981.webp`
- 1985 onward: `t_0001_1985.webp`

If no timeless default exists and the career is earlier than the first dated
asset, the nearest future asset is used as a coverage fallback.

## IDs and aliases

Stable IDs are always preferred:

- drivers: `d_XXXX`
- staff: `st_XXXX`
- teams: `t_XXXX`

Name-based files are also accepted as aliases, for example
`williams_1981.webp`. Runtime resolution tries the stable ID first and then
normalized display/short names.

## Supported formats

`.webp`, `.png`, `.jpg`, `.jpeg` and `.svg` are indexed.

## Performance

The browser never scans directories. `scripts/build-historical-assets.mjs`
generates `src/generated/historicalAssets.js` before dev/build.

At runtime, resolution is an in-memory alias lookup plus a binary search through
the entity's short year timeline. Visual components subscribe only to
`activeYear`, so day/race state updates do not cause asset-year recalculation.

## Workflow

After adding or replacing image files, run:

```bash
npm run season:generate
```

`npm run dev` and `npm run build` already run this automatically.
