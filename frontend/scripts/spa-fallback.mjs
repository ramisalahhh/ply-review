// GitHub Pages has no rewrite rules. It serves 404.html for unknown paths, so a
// copy of index.html there lets links like /ply-review/review/abc open the app.
import { copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
copyFileSync(join(dist, "index.html"), join(dist, "404.html"));
console.log("dist/404.html written (single-page app fallback)");
