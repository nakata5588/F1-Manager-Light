import React from "react";
import { NavLink } from "react-router-dom";

const Item = ({ to, label, icon }) => (
  <NavLink
    to={to}
    className={({ isActive }) =>
      `flex items-center gap-3 px-3 py-2 rounded-md text-sm ${
        isActive ? "bg-black text-white" : "text-gray-800 hover:bg-gray-200"
      }`
    }
  >
    <span className="w-5 h-5" aria-hidden>{icon}</span>
    <span className="truncate">{label}</span>
  </NavLink>
);

export default function Sidebar() {
  return (
    <aside className="w-56 shrink-0 border-r bg-white p-3 flex flex-col gap-1">
      <div className="px-2 py-1 text-xs font-semibold text-gray-500">Main</div>
      <Item to="/MainMenu"     label="Main Menu"     icon="🏁" />
      <Item to="/MainScreen"   label="Main Screen"   icon="🖥️" />
      <Item to="/Home"         label="Home"          icon="🏠" />
      <Item to="/CalendarPage" label="Calendar"      icon="🗓️" />
      <Item to="/Inbox"        label="Inbox"         icon="📨" />

      <div className="px-2 py-1 mt-2 text-xs font-semibold text-gray-500">Team</div>
      <Item to="/Team"         label="Team"          icon="🚗" />
      <Item to="/Drivers"      label="Drivers"       icon="🧑‍✈️" />
      <Item to="/Staff"        label="Staff"         icon="👷" />
      <Item to="/Development"  label="Development"   icon="🔧" />
      <Item to="/HQ"           label="HQ"            icon="🏢" />
      <Item to="/Academy"      label="Academy"       icon="🎓" />
      <Item to="/Scouting"     label="Scouting"      icon="🔎" />

      <div className="px-2 py-1 mt-2 text-xs font-semibold text-gray-500">Season</div>
      <Item to="/Standings"    label="Standings"     icon="📊" />
      <Item to="/Finances"     label="Finances"      icon="💰" />
      <Item to="/Board"        label="Board"         icon="📋" />

      <div className="px-2 py-1 mt-2 text-xs font-semibold text-gray-500">System</div>
      <Item to="/LoadGame"     label="Load Game"     icon="📂" />
      <Item to="/NewGame"      label="New Game"      icon="✨" />
      <Item to="/Settings"     label="Settings"      icon="⚙️" />
      <Item to="/AssetTest"    label="Asset Test"    icon="🧪" />
    </aside>
  );
}
