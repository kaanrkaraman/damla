import { cpSync, mkdirSync, rmSync } from "node:fs";
import { build } from "esbuild";

const SOURCE = "extension";
const OUT = "extension/dist";
const STATIC = ["manifest.json", "popup.html", "popup.css", "icons", "_locales"];
const ENTRIES = ["background", "content", "popup"];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const name of STATIC) cpSync(`${SOURCE}/${name}`, `${OUT}/${name}`, { recursive: true });

await build({
  entryPoints: ENTRIES.map((name) => `${SOURCE}/src/${name}.ts`),
  outdir: OUT,
  bundle: true,
  format: "iife",
  target: ["safari17", "chrome120"],
  legalComments: "none",
});
