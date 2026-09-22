export const ACADEMY_PROGRAMS=Object.freeze({
  "General Development":Object.freeze({
    mode:"academy",
    description:"Balanced development across pace, racecraft, consistency and technical feedback.",
    deltas:Object.freeze({pace:0.05,racecraft:0.05,consistency:0.05,technical_feedback:0.03}),
  }),
  "Racecraft":Object.freeze({
    mode:"academy",
    description:"Prioritises wheel-to-wheel skill, race intelligence and consistency.",
    deltas:Object.freeze({racecraft:0.12,race_intelligence:0.08,consistency:0.04}),
  }),
  "Technical Feedback":Object.freeze({
    mode:"academy",
    description:"Improves technical feedback, adaptability and understanding of the car.",
    deltas:Object.freeze({technical_feedback:0.14,adaptability:0.06,race_intelligence:0.04}),
  }),
  "Fitness":Object.freeze({
    mode:"academy",
    description:"Targets consistency, pressure handling and race-start execution.",
    deltas:Object.freeze({consistency:0.08,pressure_handling:0.06,start_launch:0.04}),
  }),
  "Private Testing Support":Object.freeze({
    mode:"supported_prospect",
    description:"Era-appropriate private testing that improves feedback, raw pace and qualifying preparation.",
    deltas:Object.freeze({technical_feedback:0.09,pace:0.05,qualifying:0.04}),
  }),
  "Race Entry Support":Object.freeze({
    mode:"supported_prospect",
    description:"Funds competitive mileage, improving racecraft, intelligence and pressure handling.",
    deltas:Object.freeze({racecraft:0.10,race_intelligence:0.08,pressure_handling:0.05}),
  }),
  "Technical Mentoring":Object.freeze({
    mode:"supported_prospect",
    description:"Pairs the prospect with team engineers to improve feedback, consistency and adaptability.",
    deltas:Object.freeze({technical_feedback:0.12,consistency:0.05,adaptability:0.06}),
  }),
});

export function academyProgramDefinition(name){
  return ACADEMY_PROGRAMS[String(name||"")]||ACADEMY_PROGRAMS["General Development"];
}

export function academyProgramNames(mode="academy"){
  return Object.entries(ACADEMY_PROGRAMS)
    .filter(([,def])=>def.mode===mode)
    .map(([name])=>name);
}
