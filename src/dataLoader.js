// Tiny helpers to load JSON data in the app (adapt to your bundler)
export async function loadJSON(path){
  const res = await fetch(path);
  if(!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

export async function loadAll(){
  const [
    drivers, teams, staff, tracks, calendar, attributes, rules, events, inbox
  ] = await Promise.all([
    loadJSON('/data/drivers.json'),
    loadJSON('/data/teams.json'),
    loadJSON('/data/staff.json'),
    loadJSON('/data/tracks.json'),
    loadJSON('/data/calendar_1980.json'),
    loadJSON('/data/attributes.json'),
    loadJSON('/data/rules_1980.json'),
    loadJSON('/data/seeds/events_seed.json'),
    loadJSON('/data/seeds/inbox_seed.json'),
  ]);
  return { drivers, teams, staff, tracks, calendar, attributes, rules, seeds: { events, inbox } };
}
