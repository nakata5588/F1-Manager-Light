// LS9E — runtime competition-model hardening.
// Keeps Save-World team state aligned with the active series competition model.
// In particular, centrally operated championships must never retain or invent
// team assignments, even if stale/faulty input reaches a New Game or rollover.

import { seriesHasTeamCompetition } from "./seriesCatalog.js";

const rows=(value)=>Array.isArray(value)?value:[];
const text=(value)=>value==null?"":String(value).trim();

export function sanitizeLowerSeriesCompetitionWorld(world){
  if(!world||typeof world!=="object")return world;

  const teamSeriesIds=new Set(
    rows(world.series)
      .filter(seriesHasTeamCompetition)
      .map((row)=>text(row?.series_id))
      .filter(Boolean)
  );

  const teams=Object.fromEntries(
    Object.entries(world.teams||{})
      .filter(([,team])=>teamSeriesIds.has(text(team?.series_id)))
      .map(([id,team])=>[id,{...team}])
  );

  const entries=Object.fromEntries(
    Object.entries(world.entries||{}).map(([id,entry])=>{
      const seriesId=text(entry?.series_id);
      if(!seriesId||teamSeriesIds.has(seriesId))return [id,{...entry}];
      return [id,{
        ...entry,
        lower_team_id:null,
        team_name:null,
        placement_status:entry?.series_id?"series_only":entry?.placement_status,
        lineup_source:null,
      }];
    })
  );

  return {...world,teams,entries};
}
