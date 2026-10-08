import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { readTheme } from './appearance';
import { initializeFocusModality } from './focus-modality';
import "./styles.css";
import "./appearance.css";
import './focus.css';

const root = document.getElementById("root");
if (!root) throw new Error('Missing root element');
document.documentElement.dataset.theme = readTheme();
const stopFocusModality = initializeFocusModality();
import.meta.hot?.dispose(stopFocusModality);

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
