import { RequestLogConsole } from "./components/RequestLogConsole";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";
import "./api/types";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

createRoot(root).render(
  <StrictMode>
    <div className="flex h-full min-h-0 overflow-hidden">
      <div className="h-full min-w-0 flex-1 overflow-auto">
        <App />
      </div>
      <RequestLogConsole />
    </div>
  </StrictMode>,
);
