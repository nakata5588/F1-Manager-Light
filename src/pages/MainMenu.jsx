import React from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../state/GameStore";
import { Play, RotateCcw, FolderOpen, Settings as SettingsIcon } from "lucide-react";

export default function MainMenu() {
  const navigate = useNavigate();
  const { hasAnySave, loadLastPlayed } = useGame();

  const handleContinue = () => {
    const ok = hasAnySave();
    if (!ok) return;
    const loaded = loadLastPlayed();
    if (loaded) navigate("/Home");
  };

  return (
    <div
      className="relative min-h-screen bg-cover bg-center"
      style={{
        backgroundImage:
          "linear-gradient(180deg, rgba(17,24,39,0.20), rgba(17,24,39,0.40)), url('/bg_f1_history_manager.png')",
      }}
    >
      <div className="relative z-10 min-h-screen flex items-center justify-center">
        <div className="bg-white/10 backdrop-blur p-10 rounded-2xl text-center space-y-6 border border-white/20">
          <h1 className="text-3xl font-bold text-white">F1 History Manager</h1>

          <div className="space-y-4">
            <button
              onClick={() => navigate("/NewGame")}
              className="w-56 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white shadow text-lg inline-flex items-center justify-center gap-2"
            >
              <Play size={18} /> New Game
            </button>

            <button
              onClick={handleContinue}
              disabled={!hasAnySave()}
              className={`w-56 py-2 rounded-xl text-lg inline-flex items-center justify-center gap-2 shadow ${
                hasAnySave()
                  ? "bg-red-500 hover:bg-red-600 text-white"
                  : "bg-red-500/40 text-white/70 cursor-not-allowed"
              }`}
            >
              <RotateCcw size={18} /> Continue
            </button>

            <button
              onClick={() => navigate("/LoadGame")}
              className="w-56 py-2 rounded-xl bg-blue-500 hover:bg-blue-600 text-white shadow text-lg inline-flex items-center justify-center gap-2"
            >
              <FolderOpen size={18} /> Load Game
            </button>

            <button
              onClick={() => navigate("/Settings")}
              className="w-56 py-2 rounded-xl bg-yellow-400 hover:bg-yellow-500 text-black shadow text-lg inline-flex items-center justify-center gap-2"
            >
              <SettingsIcon size={18} /> Settings
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
