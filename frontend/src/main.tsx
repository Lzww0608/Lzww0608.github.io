import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { readTheme } from './appearance';
import "./styles.css";
import "./appearance.css";

const root = document.getElementById("root");
if (!root) throw new Error('Missing root element');
document.documentElement.dataset.theme = readTheme();

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
