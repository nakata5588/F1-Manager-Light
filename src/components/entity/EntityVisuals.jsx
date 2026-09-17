import React from "react";

const ISO3_TO_2 = {
  ARG:"AR", AUS:"AU", AUT:"AT", BEL:"BE", BRA:"BR", CAN:"CA", CHI:"CL", CHL:"CL",
  COL:"CO", CZE:"CZ", DEN:"DK", DNK:"DK", ESP:"ES", FIN:"FI", FRA:"FR", GBR:"GB",
  GER:"DE", DEU:"DE", HUN:"HU", IND:"IN", IRL:"IE", ITA:"IT", JPN:"JP", MEX:"MX",
  MON:"MC", MCO:"MC", NED:"NL", NLD:"NL", NZL:"NZ", POL:"PL", POR:"PT", PRT:"PT",
  RSA:"ZA", ZAF:"ZA", SUI:"CH", SWE:"SE", USA:"US", URU:"UY", VEN:"VE"
};

export function flagFromCountry(country = "", code = "") {
  let cc = String(code || "").trim().toUpperCase();
  if (cc.length === 3) cc = ISO3_TO_2[cc] || "";
  if (cc.length === 2 && /^[A-Z]{2}$/.test(cc)) {
    return String.fromCodePoint(...[...cc].map((c) => 0x1f1a5 + c.charCodeAt(0)));
  }
  const s = String(country || "").toLowerCase();
  const pairs = [
    ["united kingdom","GB"],["brit","GB"],["england","GB"],["scotland","GB"],
    ["argentin","AR"],["austral","AU"],["austria","AT"],["belg","BE"],["brazil","BR"],
    ["canad","CA"],["chile","CL"],["colomb","CO"],["czech","CZ"],["denmark","DK"],
    ["spain","ES"],["finland","FI"],["france","FR"],["german","DE"],["hungar","HU"],
    ["india","IN"],["ireland","IE"],["ital","IT"],["japan","JP"],["mexic","MX"],
    ["monaco","MC"],["nether","NL"],["new zealand","NZ"],["poland","PL"],["portugal","PT"],
    ["south africa","ZA"],["switz","CH"],["sweden","SE"],["united states","US"],["usa","US"],
    ["uruguay","UY"],["venezuela","VE"]
  ];
  const match = pairs.find(([needle]) => s.includes(needle));
  if (!match) return "🏳️";
  return String.fromCodePoint(...[...match[1]].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

export function DriverPortrait({ driver, size = "h-8 w-8", className = "" }) {
  const name = driver?.display_name || driver?.name || driver?.driver_name || "Driver";
  const src = driver?.portrait_path || driver?.portrait || null;
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={`${size} rounded-full object-cover bg-gray-100 ring-1 ring-black/10 ${className}`}
        onError={(e) => { e.currentTarget.style.display = "none"; }}
      />
    );
  }
  const initials = name.split(/\s+/).filter(Boolean).map((x) => x[0]).join("").slice(0,2).toUpperCase();
  return (
    <div className={`${size} rounded-full bg-gray-100 ring-1 ring-black/10 flex items-center justify-center text-[10px] font-semibold ${className}`}>
      {initials || "?"}
    </div>
  );
}

export function TeamLogo({ teamId, name = "Team", size = "h-8 w-8", className = "" }) {
  if (!teamId) {
    return <div className={`${size} rounded bg-gray-100 ${className}`} />;
  }
  return (
    <img
      src={`/logos/teams/${String(teamId).toLowerCase()}.png`}
      alt={name}
      className={`${size} object-contain rounded bg-white ${className}`}
      onError={(e) => { e.currentTarget.style.display = "none"; }}
    />
  );
}
