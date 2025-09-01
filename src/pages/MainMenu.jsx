import React from "react";
import { Link } from "react-router-dom";
export default function MainMenu() {
  return (
    <div className="max-w-xl mx-auto bg-white rounded-xl shadow p-6">
      <h2 className="text-xl font-semibold">Main Menu</h2>
      <div className="mt-4 grid gap-2">
        <Link className="border rounded-md px-4 py-2 hover:bg-gray-50" to="/NewGame">New Game</Link>
        <Link className="border rounded-md px-4 py-2 hover:bg-gray-50" to="/LoadGame">Load Game</Link>
        <Link className="border rounded-md px-4 py-2 hover:bg-gray-50" to="/Settings">Settings</Link>
      </div>
    </div>
  );
}
