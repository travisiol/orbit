// Screenshots of the site with headless Chrome + SwiftShader (WebGL without
// a GPU), for the README and for looking at the sky without a browser
// pane: `node scripts/capture.mjs [baseUrl] [outDir]`. The intro takes
// ~3.5 s of frames; the virtual-time budget lets it finish before the shot.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = process.argv[2] ?? "http://localhost:3571";
const out = process.argv[3] ?? join(process.cwd(), "captures");
const chrome = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].find((p) => existsSync(p));
if (!chrome) throw new Error("chrome.exe not found");
mkdirSync(out, { recursive: true });

const only = process.argv[4];
const shots = [
  ["intro", "/", 1600, 900],
  ["system", "/?still", 1600, 900],
  ["nvda", "/nvda?still", 1600, 900],
  ["gold", "/gold?still", 1600, 900],
  ["sun", "/sun?still", 1600, 900],
  ["docs", "/docs", 1440, 2400],
  ["deploy", "/deploy", 1440, 1400],
  ["system-phone", "/?still", 400, 860],
  ["og", "/opengraph-image", 1200, 630],
];

for (const [name, path, w, h] of shots.filter((s) => !only || s[0] === only)) {
  const file = join(out, `${name}.png`);
  execFileSync(chrome, [
    "--headless=new",
    "--no-first-run",
    `--user-data-dir=${join(tmpdir(), "orbit-shot")}`,
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
    "--hide-scrollbars",
    `--window-size=${w},${h}`,
    "--virtual-time-budget=30000",
    `--screenshot=${file}`,
    `${base}${path}`,
  ], { stdio: "ignore", timeout: 120_000 });
  console.log(`wrote ${file}`);
}
