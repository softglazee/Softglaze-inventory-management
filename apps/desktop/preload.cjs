/**
 * Preload (context-isolated). Nothing is exposed to the web app today — it talks to
 * the local server over HTTP just like the browser build. Kept as a safe seam for
 * future native features (silent thermal printing, scale/scanner, tray).
 */
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("softglaze", {
  desktop: true,
  version: process.env.npm_package_version || "0.1.0",
});
