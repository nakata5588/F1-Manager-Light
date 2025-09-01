import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
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
import MainScreen from "./pages/MainScreen.jsx";
import NewGame from "./pages/NewGame.jsx";
import Scouting from "./pages/Scouting.jsx";
import Settings from "./pages/Settings.jsx";
import Staff from "./pages/Staff.jsx";
import Standings from "./pages/Standings.jsx";
import Team from "./pages/Team.jsx";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<HubLayout />}>
          <Route index element={<Navigate to="/Home" replace />} />
          <Route path="/Home" element={<Home />} />
          <Route path="/Inbox" element={<Inbox />} />
          <Route path="/Drivers" element={<Drivers />} />
          <Route path="/Team" element={<Team />} />
          <Route path="/Standings" element={<Standings />} />
          <Route path="/Settings" element={<Settings />} />

          {/* extra páginas do teu projeto */}
          <Route path="/CalendarPage" element={<CalendarPage />} />
          <Route path="/Development" element={<Development />} />
          <Route path="/HQ" element={<HQ />} />
          <Route path="/Finances" element={<Finances />} />
          <Route path="/Board" element={<Board />} />
          <Route path="/Scouting" element={<Scouting />} />
          <Route path="/Academy" element={<Academy />} />
          <Route path="/Staff" element={<Staff />} />
          <Route path="/MainMenu" element={<MainMenu />} />
          <Route path="/MainScreen" element={<MainScreen />} />
          <Route path="/NewGame" element={<NewGame />} />
          <Route path="/LoadGame" element={<LoadGame />} />
          <Route path="/AssetTest" element={<AssetTest />} />
        </Route>

        {/* fallback */}
        <Route path="*" element={<Navigate to="/Home" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
