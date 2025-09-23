// seasonInit.js
import { getSeasonRules } from "./seasonRules";

export function createSeasonSkeleton(newYear, data) {
  return {
    year: newYear,
    rules: getSeasonRules(newYear),
    calendar: data.calendar.filter(c => c.year === newYear), // se já tiveres no data pack
    standings: { drivers: [], teams: [] },
  };
}
