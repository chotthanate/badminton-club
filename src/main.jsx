import React from "react";
import { createRoot } from "react-dom/client";
import BadmintonApp from "./BadmintonApp.jsx";
import "./badminton.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BadmintonApp />
  </React.StrictMode>,
);
