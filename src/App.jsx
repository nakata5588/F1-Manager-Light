import React, { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Topbar from "@/components/Topbar";
import { useGame } from "./state/GameStore";
import HubLayout from "./layouts/HubLayout.jsx";

/* Páginas */
import Academy from "./pages/Academy.jsx";
import AssetTest from "./pages/AssetTest.jsx";
import Board from "./pages/Board.jsx";
import CalendarPage from "./pages/CalendarPage.jsx";
import Development from "./pages/Development.jsx";
import Drivers from "./pages/Drivers.jsx";
import Finances from "./pages/Finances.jsx";
import Home from "./pages/Home.jsx";
import HQ from "./pages/HQ.jsx";
import Inbox from "./pages/Inbox.jsx";
import LoadGame from "./pages/LoadGame.jsx";
import MainMenu from "./pages/MainMenu.jsx";
import NewGame from "./pages/NewGame.jsx";
import CreateTeam from "./pages/CreateTeam.jsx";
import Scouting from "./pages/Scouting.jsx";
import Settings from "./pages/Settings.jsx";
import Staff from "./pages/Staff.jsx";
import Standings from "./pages/Standings.jsx";
import Team from "./pages/Team.jsx";

/** Aplica a preferência de tema à <html> (podes trocar para classe CSS se preferires) */
function ThemeBinder() {
  const uiTheme = useGame((s) => s.gameState?.settings?.uiTheme);
  useEffect(() => {
    const el = document.documentElement;
    el.dataset.theme = uiTheme || "auto";
    // opcional: togglar classe 'dark' se usares Tailwind dark mode class
    if (uiTheme === "dark") el.classList.add("dark");
    else if (uiTheme === "light") el.classList.remove("dark");
    else {
      // auto: segue prefers-color-scheme
      const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
      const apply = () => {
        if (mq?.matches) el.classList.add("dark");
        else el.classList.remove("dark");
      };
      apply();
      mq?.addEventListener?.("change", apply);
      return () => mq?.removeEventListener?.("change", apply);
    }
  }, [uiTheme]);
  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      {/* Binder opcional para tema */}
      <ThemeBinder />

      <Routes>
        {/* === Pré-jogo (SEM HubLayout) === */}
        <Route path="/" element={<MainMenu />} />
        <Route path="/NewGame" element={<NewGame />} />
        <Route path="/CreateTeam" element={<CreateTeam />} />
        <Route path="/LoadGame" element={<LoadGame />} />

        {/* === Jogo (COM HubLayout) === */}
        <Route element={<HubLayout />}>
          <Route path="/Home" element={<Home />} />
          <Route path="/Inbox" element={<Inbox />} />
          <Route path="/Drivers" element={<Drivers />} />
          <Route path="/Team" element={<Team />} />
          <Route path="/Standings" element={<Standings />} />
          <Route path="/Settings" element={<Settings />} />
          <Route path="/CalendarPage" element={<CalendarPage />} />
          <Route path="/Development" element={<Development />} />
          <Route path="/HQ" element={<HQ />} />
          <Route path="/Finances" element={<Finances />} />
          <Route path="/Board" element={<Board />} />
          <Route path="/Scouting" element={<Scouting />} />
          <Route path="/Academy" element={<Academy />} />
          <Route path="/Staff" element={<Staff />} />
          <Route path="/AssetTest" element={<AssetTest />} />
        </Route>

        {/* fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
