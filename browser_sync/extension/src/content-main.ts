import { bootstrapContentScript } from "./content/bootstrap";

console.log("[BS-EXT] content-script loaded v1.0.5", window.location.href);
void bootstrapContentScript();
