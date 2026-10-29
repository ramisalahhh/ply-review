// Copy the browser Stockfish build from node_modules into public/engine/,
// so Vite serves it (dev) and ships it (build). Kept out of git.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "stockfish");
const out = join(root, "public", "engine");
mkdirSync(out, { recursive: true });
for (const f of ["stockfish-19-lite-single.js", "stockfish-19-lite-single.wasm"]) {
  copyFileSync(join(src, "bin", f), join(out, f));
}
copyFileSync(join(src, "Copying.txt"), join(out, "COPYING.txt")); // Stockfish is GPL-3.0
console.log("engine files copied to public/engine/");
