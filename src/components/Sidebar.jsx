// src/components/Sidebar.jsx
import React, { useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import { useGame } from "../state/GameStore";
import {
  Home,
  Calendar,
  Inbox,
  Car,
  Users,
  Wrench,
  Building2,
  GraduationCap,
  Search,
  Trophy,
  Flag,
  PiggyBank,
  ClipboardList,
  UsersRound,
} from "lucide-react";

/* ==== Helmet icon (piloto F1) – SVG simples, segue currentColor ==== */
const HelmetIcon = ({ className = "w-5 h-5" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
       className={className} aria-hidden>
    {/* viseira */}
    <path d="M4 12h10a2 2 0 0 0 2-2V8" />
    {/* casca */}
    <path d="M21 13a9 9 0 1 0-18 0v1a2 2 0 0 0 2 2h9.5" />
    {/* queixo */}
    <path d="M17 16h3a2 2 0 0 0 2-2" />
  </svg>
);

/* ==== helpers ==== */
function resolveTeamBrand(teamBrands, teamObj) {
  if (!Array.isArray(teamBrands) || !teamBrands.length || !teamObj) return null;

  const keyId = String(teamObj.team_id ?? teamObj.id ?? "").toLowerCase();
  const keyName = String(
    teamObj.team_name ?? teamObj.name ?? teamObj.short_name ?? ""
  ).toLowerCase();

  if (keyId) {
    const byId = teamBrands.find(
      (b) => String(b.team_id ?? b.id ?? "").toLowerCase() === keyId
    );
    if (byId) return byId;
  }
  if (keyName) {
    const byName = teamBrands.find(
      (b) =>
        String(b.team_name ?? b.name ?? b.short_name ?? "").toLowerCase() ===
        keyName
    );
    if (byName) return byName;
  }
  return null;
}

const Item = ({ to, label, icon: IconComp, brand }) => {
  const primary = brand?.primary_color || "#111827";   // fundo aside
  const secondary = brand?.secondary_color || "#ffffff"; // texto geral

  return (
    <NavLink
      to={to}
      className="flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2"
      style={({ isActive }) =>
        isActive
          ? { background: secondary, color: primary, border: "1px solid currentColor" }
          : { background: "transparent", color: secondary, border: "1px solid currentColor" }
      }
    >
      <span className="w-5 h-5" aria-hidden>
        <IconComp className="w-5 h-5" />
      </span>
      <span className="truncate">{label}</span>
    </NavLink>
  );
};

export default function Sidebar() {
  const { gameState } = useGame();
  const team = gameState?.team || null;

  const [brands, setBrands] = useState([]);
  useEffect(() => {
    let alive = true;
    fetch("/data/team_brands.json")
      .then((r) => r.json())
      .then((data) => { if (alive) setBrands(Array.isArray(data) ? data : []); })
      .catch(() => setBrands([]));
    return () => { alive = false; };
  }, []);

  const brand = useMemo(() => resolveTeamBrand(brands, team), [brands, team]);

  const primary = brand?.primary_color || "#111827";
  const secondary = brand?.secondary_color || "#ffffff";
  const borderColorAside = `${secondary}2E`;

  return (
    <aside
      className="w-56 shrink-0 border-r p-3 flex flex-col gap-1"
      style={{ background: primary, color: secondary, borderColor: borderColorAside }}
    >
      <div className="px-2 py-1 text-xs font-semibold opacity-80">Main</div>
      <Item to="/Home"         label="Home"     icon={Home}     brand={brand} />
      <Item to="/CalendarPage" label="Calendar" icon={Calendar} brand={brand} />
      <Item to="/Inbox"        label="Inbox"    icon={Inbox}    brand={brand} />

      <div className="px-2 py-1 mt-2 text-xs font-semibold opacity-80">Team</div>
      <Item to="/Team"         label="My Team"    icon={Car}          brand={brand} />
      <Item to="/MyDrivers"    label="My Drivers" icon={HelmetIcon}   brand={brand} />
      <Item to="/MyStaff"      label="My Staff"   icon={Users}        brand={brand} />
      <Item to="/Development"  label="Development"icon={Wrench}       brand={brand} />
      <Item to="/HQ"           label="HQ"         icon={Building2}    brand={brand} />
      <Item to="/Academy"      label="Academy"    icon={GraduationCap}brand={brand} />
      <Item to="/Scouting"     label="Scouting"   icon={Search}       brand={brand} />
      
      <div className="px-2 py-1 mt-2 text-xs font-semibold opacity-80">Season</div>
      <Item to="/Standings"    label="Standings"  icon={Trophy}       brand={brand} />
      <Item to="/Results"      label="Results"    icon={Flag}         brand={brand} />
      <Item to="/Finances"     label="Finances"   icon={PiggyBank}    brand={brand} />
      <Item to="/Board"        label="Board"      icon={ClipboardList}brand={brand} />

      <div className="px-2 py-1 mt-2 text-xs font-semibold opacity-80">League</div>
      <Item to="/Teams"        label="All Teams"  icon={Car}          brand={brand} />      
      <Item to="/Drivers"      label="All Drivers"icon={UsersRound}   brand={brand} />
      <Item to="/Staff"        label="All Staff"  icon={Users}        brand={brand} />
    </aside>
  );
}
