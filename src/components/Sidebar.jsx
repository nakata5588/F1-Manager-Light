// src/components/Sidebar.jsx
import React, { useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import { useGame } from "../state/GameStore";
import { useEventStore } from "../state/EventStore";
import {
  Home,
  Calendar,
  Inbox,
  Car,
  Users,
  Building2,
  GraduationCap,
  Search,
  Trophy,
  Medal,
  Flag,
  PiggyBank,
  ClipboardList,
  UsersRound,
  UserRound,
  Settings as SettingsIcon,
} from "lucide-react";

const HelmetIcon = ({ className = "w-5 h-5" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
       className={className} aria-hidden>
    <path d="M4 12h10a2 2 0 0 0 2-2V8" />
    <path d="M21 13a9 9 0 1 0-18 0v1a2 2 0 0 0 2 2h9.5" />
    <path d="M17 16h3a2 2 0 0 0 2-2" />
  </svg>
);

function resolvePlayerTeam(gameState) {
  if (gameState?.team) return gameState.team;
  const savedId = gameState?.saveMeta?.teamId ?? gameState?.saveMeta?.team_id ?? gameState?.teamId ?? null;
  if (!savedId) return null;
  return (gameState?.teams || []).find(
    (row) => String(row?.team_id ?? row?.id ?? "") === String(savedId)
  ) || null;
}

function resolveTeamBrand(teamBrands, teamObj) {
  if (!Array.isArray(teamBrands) || !teamBrands.length || !teamObj) return null;
  const keyId = String(teamObj.team_id ?? teamObj.id ?? "").toLowerCase();
  const keyName = String(teamObj.team_name ?? teamObj.name ?? teamObj.short_name ?? "").toLowerCase();
  if (keyId) {
    const byId = teamBrands.find((b) => String(b.team_id ?? b.id ?? "").toLowerCase() === keyId);
    if (byId) return byId;
  }
  if (keyName) {
    const byName = teamBrands.find(
      (b) => String(b.team_name ?? b.name ?? b.short_name ?? "").toLowerCase() === keyName
    );
    if (byName) return byName;
  }
  return null;
}

const Item = ({ to, label, icon: IconComp, brand, badge = 0 }) => {
  const primary = brand?.primary_color || "#111827";
  const secondary = brand?.secondary_color || "#ffffff";
  return (
    <NavLink
      to={to}
      className="relative flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-black"
      style={({ isActive }) => isActive
        ? {
            background: primary,
            color: secondary,
            border: `1px solid ${primary}`,
            boxShadow: `inset 3px 0 0 ${secondary}55`,
          }
        : {
            background: `${primary}16`,
            color: "#d7dce5",
            border: `1px solid ${primary}66`,
          }}
    >
      <span className="w-4 h-4 shrink-0" aria-hidden><IconComp className="w-4 h-4" /></span>
      <span className="truncate flex-1">{label}</span>
      {Number(badge) > 0 ? (
        <span
          className="min-w-5 h-5 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center"
          title={`${badge} item${badge === 1 ? "" : "s"} need attention`}
        >
          {badge > 9 ? "9+" : badge}
        </span>
      ) : null}
    </NavLink>
  );
};

export default function Sidebar() {
  const { gameState } = useGame();
  const eventNews = useEventStore((s) => s.news);
  const team = useMemo(() => resolvePlayerTeam(gameState), [gameState]);
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
  const primary = brand?.primary_color || "#334155";
  const secondary = brand?.secondary_color || "#ffffff";

  const attention = useMemo(() => {
    const inbox = Array.isArray(gameState?.inbox) ? gameState.inbox : [];
    const unreadSaved = inbox.filter((m) => m?.unread === true || m?.read === false || m?.is_unread === true).length;
    const unreadNews = (Array.isArray(eventNews) ? eventNews : [])
      .filter((m) => m?.unread === true || m?.read === false || m?.is_unread === true).length;
    const unreadInbox = unreadSaved + unreadNews;

    const conditions = Object.values(gameState?.driverAttributes || {});
    const driverFatigue = conditions.filter((row) => Number(row?.fatigue || 0) >= 70).length;

    const cars = gameState?.garage?.cars || [];
    const carWear = cars.filter((car) =>
      Object.values(car?.componentCondition || {}).some((value) => Number(value) < 35)
    ).length;

    const objectives = gameState?.board?.objectives || [];
    const board = objectives.filter((objective) =>
      /at risk|warning|fail|overdue|blocked/i.test(String(objective?.status ?? objective?.state ?? ""))
    ).length;

    return { inbox: unreadInbox, drivers: driverFatigue, car: carWear, board };
  }, [gameState, eventNews]);

  return (
    <aside
      className="w-40 shrink-0 border-r border-white/10 bg-[#07090d] px-2 py-2 flex flex-col gap-0.5 text-slate-200"
    >
      <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">Main</div>
      <Item to="/Home" label="Home" icon={Home} brand={brand} />
      <Item to="/ManagerProfile" label="My Profile" icon={UserRound} brand={brand} />
      <Item to="/CalendarPage" label="Calendar" icon={Calendar} brand={brand} />
      <Item to="/Inbox" label="Inbox" icon={Inbox} brand={brand} badge={attention.inbox} />

      <div className="px-2 py-1 mt-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">Team</div>
      <Item to="/Team" label="My Team" icon={Car} brand={brand} />
      <Item to="/Car" label="Cars" icon={Car} brand={brand} badge={attention.car} />
      <Item to="/MyDrivers" label="My Drivers" icon={HelmetIcon} brand={brand} badge={attention.drivers} />
      <Item to="/MyStaff" label="My Staff" icon={Users} brand={brand} />
      <Item to="/HQ" label="HQ" icon={Building2} brand={brand} />
      <Item to="/Academy" label="Academy" icon={GraduationCap} brand={brand} />
      <Item to="/Scouting" label="Scouting" icon={Search} brand={brand} />

      <div className="px-2 py-1 mt-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">Season</div>
      <Item to="/Standings" label="Standings" icon={Trophy} brand={brand} />
      <Item to="/Results" label="Results" icon={Flag} brand={brand} />
      <Item to="/Champions" label="Champions" icon={Medal} brand={brand} />
      <Item to="/Finances" label="Finances" icon={PiggyBank} brand={brand} />
      <Item to="/Board" label="Board" icon={ClipboardList} brand={brand} badge={attention.board} />

      <div className="px-2 py-1 mt-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">League</div>
      <Item to="/Teams" label="All Teams" icon={Car} brand={brand} />
      <Item to="/Drivers" label="Driver Market" icon={UsersRound} brand={brand} />
      <Item to="/Staff" label="All Staff" icon={Users} brand={brand} />

      <div className="mt-auto border-t border-white/10 pt-2">
        <Item to="/GameSettings" label="Settings" icon={SettingsIcon} brand={brand} />
      </div>
    </aside>
  );
}
