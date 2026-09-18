import { start } from "./main";

// One entry point, run when the page is ready. Nothing runs on import.
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
else start();
