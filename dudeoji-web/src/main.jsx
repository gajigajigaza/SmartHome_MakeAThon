import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";
import FlowApp from "./features/auth/FlowApp.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <FlowApp />
  </StrictMode>,
);
