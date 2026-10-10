// Bundles the app into one self-contained HTML body for publishing as a Claude
// artifact (the viewer adds its own <html>/<head> skeleton).
// Usage: node apps/subscriptions/scripts/build-artifact.mjs [out.html]
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("..", import.meta.url));
const read = (file) => readFileSync(dir + file, "utf8");

const html = read("index.html");
const page = html.slice(html.indexOf("<!-- PAGE-START"), html.indexOf("<!-- PAGE-END -->"));
const scripts = ["schedule.js", "ics.js", "store.js", "app.js"].map(
  (f) => `<script>\n${read(f)}</script>`,
);

const out = [
  "<title>Mis Suscripciones</title>",
  `<style>\n${read("styles.css")}</style>`,
  page.replace(/^<!-- PAGE-START[^>]*-->\n/, ""),
  ...scripts,
  "",
].join("\n");

const target = process.argv[2] || "suscripciones-artifact.html";
writeFileSync(target, out);
console.log(`wrote ${target} (${out.length} bytes)`);
