// src/core/season.js
import { materializeNextCareerSeason } from "./careerBoundary.js";
import { synchronizeDriverRelationships } from "../domain/driverRelationships.js";

/**
 * Pure season rollover.
 *
 * The Global Database (db*) is an immutable/editorial source. The active
 * career world is carried forward and only structural future information
 * (calendar/rules/safety) plus newly eligible identities may enter it.
 */
export function rolloverSeasonPure(state, nextYear) {
  const next=materializeNextCareerSeason(state, nextYear);
  return synchronizeDriverRelationships(next,{source:"season_rollover_staff_sync"});
}
