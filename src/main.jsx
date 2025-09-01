import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
import { useGame } from "./state/GameStore.js";

// carregar dados iniciais da BD (JSON em public/data ou API)
useGame.getState().loadData();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
