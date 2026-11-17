/**
 * Builds the unpacked Chromium Manifest V3 extension into dist/ with Bun's bundler.
 * There is no Node.js step. Output is readable (no minification) so it can be reviewed directly.
 */
import { existsSync, readdirSync } from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { validateDist } from "./validate";

const root = join(import.meta.dir, "..");
const dist = join(root, "dist");

// Preflight BEFORE touching dist: refuse to build if any source asset is missing. The build copies
// assets (it never moves or deletes them), but a clear error here prevents a broken dist from being
// mistaken for lost source files, and stops an empty build from overwriting a good one.
const required = [
  "docs/screenshots",
  "licenses/INTER_OFL-1.1.txt",
  "licenses/THIRD_PARTY_LICENSES.txt",
  "public/manifest.json",
  "assets/fonts/inter-latin-variable.woff2",
  "LICENSE",
  "NOTICE",
];
const missing = required.filter((relative) => !existsSync(join(root, relative)));
if (missing.length > 0) {
  console.error(`✗ source preflight failed — missing: ${missing.join(", ")}`);
  console.error("  Restore these files from the source archive before building. dist/ was not touched.");
  process.exit(1);
}
if (readdirSync(join(root, "docs/screenshots")).filter((f) => f.endsWith(".png")).length === 0) {
  console.error("✗ source preflight failed — docs/screenshots has no PNG images. dist/ was not touched.");
  process.exit(1);
}

// A File Explorer window or an unzipped tool can briefly lock dist/ on Windows. Retry a few times
// before failing, so a harmless transient lock does not look like a broken build.
async function clearDist(): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(dist, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 4) {
        console.error("✗ cannot clear dist/ — close any File Explorer window or tool using it, then retry.");
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}
await clearDist();
await mkdir(dist, { recursive: true });

const result = await Bun.build({
  entrypoints: [
    "src/background/service-worker.ts",
    "src/popup/popup.ts",
    "src/offscreen/offscreen.ts",
    "src/help/help.ts",
    "src/pages/copy.ts",
    "src/pages/annotate.ts",
  ].map((entry) => join(root, entry)),
  outdir: dist,
  target: "browser",
  format: "esm",
  minify: false,
  sourcemap: "none",
  naming: "[name].js",
});
if (!result.success) {
  for (const message of result.logs) console.error(message);
  process.exit(1);
}

const copies: Array<[string, string]> = [
  ["src/popup/popup.html", "popup.html"],
  ["src/popup/popup.css", "popup.css"],
  ["src/help/help.html", "help.html"],
  ["src/help/help.css", "help.css"],
  ["src/shared/tokens.css", "tokens.css"],
  ["src/ui/button.css", "button.css"],
  ["src/ui/motion.css", "motion.css"],
  ["public/manifest.json", "manifest.json"],
  ["LICENSE", "LICENSE.txt"],
  ["NOTICE", "NOTICE.txt"],
  ["licenses/THIRD_PARTY_LICENSES.txt", "THIRD_PARTY_LICENSES.txt"],
  ["src/offscreen/offscreen.html", "offscreen.html"],
  ["src/pages/copy.html", "copy.html"],
  ["src/pages/copy.css", "copy.css"],
  ["src/pages/annotate.html", "annotate.html"],
  ["src/pages/annotate.css", "annotate.css"],
];
for (const [from, to] of copies) {
  await Bun.write(join(dist, to), Bun.file(join(root, from)));
}
await cp(join(root, "public/icons"), join(dist, "icons"), { recursive: true });
await cp(join(root, "brand"), join(dist, "brand"), { recursive: true });
await cp(join(root, "docs/screenshots"), join(dist, "screenshots"), { recursive: true });

// One bundled typeface: Inter 4.001, variable weight 100-900. No other font is shipped.
await mkdir(join(dist, "fonts"), { recursive: true });
await Bun.write(join(dist, "fonts", "inter-latin-variable.woff2"), Bun.file(join(root, "assets/fonts/inter-latin-variable.woff2")));
await Bun.write(join(dist, "fonts", "OFL-1.1-Inter.txt"), Bun.file(join(root, "licenses/INTER_OFL-1.1.txt")));

const problems = await validateDist(dist);
if (problems.length > 0) {
  for (const p of problems) console.error(`✗ ${p}`);
  process.exit(1);
}
console.log(`✓ mv3: built ${result.outputs.length} bundles + static files into dist/`);
for (const output of result.outputs) console.log(`  - ${output.path.replace(root + "/", "")} (${output.size} bytes)`);
