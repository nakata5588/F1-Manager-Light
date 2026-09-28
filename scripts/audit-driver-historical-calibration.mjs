import fs from "node:fs/promises";
import path from "node:path";

const root=process.cwd();
const seasonsDir=path.join(root,"public","data","seasons");
const targets=[
  {year:1988,names:["Alain Prost","Ayrton Senna"]},
  {year:2011,names:["Pastor Maldonado"]},
  {year:2020,names:["Kimi Raikkonen","Kimi Räikkönen","Antonio Giovinazzi"]},
];
const profiles=JSON.parse(await fs.readFile(path.join(root,"public","data","driver_rating_profiles.json"),"utf8"));

const norm=(value)=>String(value||"")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g,"")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g,"");

const idOf=(row)=>String(row?.driver_id??row?.person_id??row?.id??"");
const nameOf=(row)=>String(row?.display_name??row?.driver_name??row?.name??"");

for(const group of targets){
  const file=path.join(seasonsDir,String(group.year),"season.json");
  const pack=JSON.parse(await fs.readFile(file,"utf8"));
  const drivers=pack?.state?.drivers||[];
  const ratings=pack?.state?.driverRatings||[];
  const contracts=pack?.state?.contracts||[];
  console.log("\nDRIVER_CALIBRATION_AUDIT",group.year);
  for(const wanted of group.names){
    const driver=drivers.find((row)=>norm(nameOf(row))===norm(wanted));
    if(!driver)continue;
    const did=idOf(driver);
    const rating=ratings.find((row)=>idOf(row)===did)||null;
    const contract=contracts.find((row)=>idOf(row)===did)||null;
    const profile=profiles.find((row)=>idOf(row)===did)||null;
    console.log(JSON.stringify({
      year:group.year,
      driver_id:did,
      name:nameOf(driver),
      age:driver.age,
      status:driver.status,
      team_id:contract?.team_id||null,
      role:contract?.role||null,
      contract_source:contract?.source||null,
      source_round:contract?.source_round??null,
      current_ability:rating?.current_ability??null,
      potential_ability:rating?.potential_ability??null,
      career_stage:rating?.career_stage??null,
      rating_source:rating?.source??null,
      rating_model:rating?.rating_model??null,
      pace:rating?.pace??null,
      qualifying:rating?.qualifying??null,
      racecraft:rating?.racecraft??null,
      consistency:rating?.consistency??null,
      reputation:rating?.reputation??null,
      profile_peak_ability:profile?.peak_ability??null,
      profile_peak_pace:profile?.peak_pace??null,
      profile_peak_qualifying:profile?.peak_qualifying??null,
      profile_peak_racecraft:profile?.peak_racecraft??null,
      profile_confidence:profile?.rating_confidence??profile?.profile_confidence??null,
      profile_tier:profile?.tier??profile?.rating_tier??null,
    }));
  }
}
