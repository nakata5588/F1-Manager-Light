# Circuit 2D layouts

The Race Weekend 2D foundation was derived from the 14 circuit SVGs supplied for the 1980 calendar. The runtime stores a normalized display centerline rather than making the source artwork part of race physics.

The supplied artwork is intentionally marked **provisional** because several files depict a later circuit configuration. The resolver keeps circuit identity separate from layout chronology and resolves layouts in this order:

1. exact `year_from..year_to` match;
2. latest available past layout;
3. earliest available future layout;
4. undated provisional layout;
5. no layout (the race continues without a 2D map).

To add a verified historical version later, add a manifest entry with a real year range plus matching normalized geometry. Existing careers do not need a migration because layout selection is derived from `track_id + activeYear` at render time.

The geometry is **display-only**. It must not become the source of truth for lap time, overtaking, race control or incidents; those remain engine-owned.


## Track intelligence overlays

Race View can render track intelligence independently from race physics.

Every layout may progressively define these optional manifest fields:

- `start_finish_progress`: normalized 0..1 position on the display centerline.
- `sector_boundaries`: two normalized positions marking the S1→S2 and S2→S3 boundaries.
- `pit_entry_progress` / `pit_exit_progress`: normalized positions used only when historically verified.
- `track_intelligence_status`: for example `verified` or `derived_provisional`.
- `pit_lane_points` in display geometry: an optional independent pit-lane polyline.

Until verified metadata exists, the UI uses clearly-labelled provisional thirds for sector visualization. Incident markers prefer an engine-provided `track_progress`; if that is unavailable they are placed in the middle of the reported race sector. This fallback is visualization-only.

Pit entry, pit exit and pit-lane geometry are deliberately not fabricated. The rendering hooks exist now, but the overlay appears only after a layout supplies those data.
