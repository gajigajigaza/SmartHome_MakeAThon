import { createRoot } from "react-dom/client";

import CrawlingMole from "./features/background/CrawlingMole";
import "./index.css";

document.body.style.background =
  "linear-gradient(145deg, #eef8df 0%, #d9efc4 100%)";

createRoot(document.getElementById("root")).render(<CrawlingMole />);
