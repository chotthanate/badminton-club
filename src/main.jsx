import React from "react";
import { createRoot } from "react-dom/client";
import BadmintonApp from "./BadmintonApp.jsx";
import LiffSignupApp from "./LiffSignupApp.jsx";
import "./badminton.css";

const isLiffSignup = new URLSearchParams(window.location.search).get("liff") === "signup";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {isLiffSignup ? <LiffSignupApp /> : <BadmintonApp />}
  </React.StrictMode>,
);
