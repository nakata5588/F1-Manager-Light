// src/domain/raceCarLiveries.js
// Historical Race View livery profiles.
// These are original vector approximations for gameplay readability; they do
// not embed or copy third-party artwork. Sponsor strings are rendered as text
// only at close LOD.

const LIVERIES_1980=Object.freeze({
  t_0001:{team:"Williams",model:"FW07/FW07B",primary:"#F4F4EF",secondary:"#0B6B55",accent:"#087BB8",pattern:"saudia_stripes",sponsor:"SAUDIA"},
  t_0002:{team:"Ligier",model:"JS11/15",primary:"#0757A6",secondary:"#F5F7F8",accent:"#D9272E",pattern:"gitanes_blue",sponsor:"GITANES"},
  t_0003:{team:"Brabham",model:"BT49",primary:"#F1EEE6",secondary:"#172641",accent:"#D82E3A",pattern:"parmalat_navy",sponsor:"PARMALAT"},
  t_0004:{team:"Renault",model:"RE20",primary:"#F5D21A",secondary:"#F1EFE8",accent:"#111111",pattern:"renault_yellow",sponsor:"RENAULT"},
  t_0005:{team:"Lotus",model:"81/81B",primary:"#17334C",secondary:"#C8CCD0",accent:"#D33639",pattern:"essex_stripes",sponsor:"ESSEX"},
  t_0006:{team:"Tyrrell",model:"009/010",primary:"#153A70",secondary:"#F2F2EE",accent:"#D32F36",pattern:"tyrrell_blue",sponsor:"CANDY"},
  t_0007:{team:"Arrows",model:"A3",primary:"#B69B61",secondary:"#161616",accent:"#F4E6BB",pattern:"warsteiner_gold",sponsor:"WARSTEINER"},
  t_0008:{team:"Fittipaldi",model:"F7/F8",primary:"#E9C21A",secondary:"#111111",accent:"#17604F",pattern:"skol_yellow",sponsor:"SKOL"},
  t_0009:{team:"McLaren",model:"M29/M30",primary:"#F2F1EC",secondary:"#D62D32",accent:"#171717",pattern:"marlboro_chevron",sponsor:"MARLBORO"},
  t_0010:{team:"Ferrari",model:"312T5",primary:"#D8262E",secondary:"#F2F2EC",accent:"#171717",pattern:"ferrari_red",sponsor:"AGIP"},
  t_0011:{team:"Alfa Romeo",model:"179",primary:"#B92D26",secondary:"#F2F0E9",accent:"#28211D",pattern:"alfa_red",sponsor:"MARLBORO"},
  t_0012:{team:"ATS",model:"D3/D4",primary:"#E5C21A",secondary:"#171717",accent:"#F0E3A2",pattern:"ats_yellow",sponsor:"ATS"},
  t_0013:{team:"Ensign",model:"N180",primary:"#202326",secondary:"#F1F1EB",accent:"#C92E35",pattern:"ensign_dark",sponsor:"UNIPART"},
  t_0014:{team:"Osella",model:"FA1",primary:"#17699A",secondary:"#F0F2F2",accent:"#D23539",pattern:"osella_blue",sponsor:"OSELLA"},
  t_0015:{team:"Shadow",model:"DN11/DN12",primary:"#151719",secondary:"#E3B826",accent:"#F0EEE7",pattern:"shadow_black",sponsor:"SHADOW"},
});

const BY_NAME=Object.freeze(Object.fromEntries(
  Object.entries(LIVERIES_1980).map(([teamId,profile])=>[profile.team.toLowerCase(),{...profile,team_id:teamId}])
));

export function historicalRaceCarLivery({year,teamId,teamName}={}){
  if(Number(year)!==1980)return null;
  const id=String(teamId||"");
  if(LIVERIES_1980[id])return {...LIVERIES_1980[id],team_id:id,year:1980};
  const byName=BY_NAME[String(teamName||"").trim().toLowerCase()];
  return byName?{...byName,year:1980}:null;
}

export function historicalRaceCarLiveriesForYear(year){
  if(Number(year)!==1980)return [];
  return Object.entries(LIVERIES_1980).map(([team_id,profile])=>({
    team_id,
    year:1980,
    ...profile,
  }));
}
