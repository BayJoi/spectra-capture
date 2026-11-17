/**
 * Checks the built Chromium Manifest V3 extension before it is treated as ready. It fails on:
 * wrong manifest version/permissions, host or content-script access, a loose CSP, inline scripts
 * or handlers, eval / new Function, remote URL strings in executable code, or manifest references
 * to missing files. Run with `bun scripts/validate.ts [dist]`.
 */
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";

const PERMISSIONS = new Set(["activeTab", "debugger", "downloads", "offscreen", "storage", "notifications", "tabs", "clipboardWrite"]);

const FORBIDDEN_MANIFEST_KEYS = [
  "host_permissions",
  "optional_host_permissions",
  "content_scripts",
  "externally_connectable",
  "web_accessible_resources",
  "optional_permissions",
];

export async function validateDist(dist: string): Promise<string[]> {
  const problems: string[] = [];
  const manifest = JSON.parse(await readFile(join(dist, "manifest.json"), "utf8")) as Record<string, any>;

  if (manifest.manifest_version !== 3) problems.push("manifest_version must be 3");
  for (const permission of manifest.permissions ?? []) {
    if (!PERMISSIONS.has(permission)) problems.push(`unexpected permission: ${permission}`);
  }
  for (const key of FORBIDDEN_MANIFEST_KEYS) {
    if (key in manifest) problems.push(`manifest must not declare "${key}"`);
  }

  if (!manifest.background?.service_worker || manifest.background?.scripts) {
    problems.push("MV3 must use a service worker and no background scripts");
  }
  if (!manifest.action?.default_popup) {
    problems.push("MV3 must declare action with a default popup");
  }
  if (manifest.permissions?.includes("scripting")) problems.push("the Chromium MV3 build does not need scripting");

  const csp: string = manifest.content_security_policy?.extension_pages ?? "";
  if (/unsafe-|https?:/i.test(csp)) problems.push("content security policy allows unsafe or remote sources");

  const referenced = [
    manifest.background?.service_worker,
    manifest.action?.default_popup,
    ...Object.values(manifest.icons ?? {}),
    ...Object.values(manifest.action?.default_icon ?? {}),
  ];
  for (const ref of referenced) {
    if (typeof ref !== "string" || !existsSync(join(dist, ref))) {
      problems.push(`manifest references a missing file: ${String(ref)}`);
    }
  }

  for (const cssFile of ["tokens.css", "button.css", "motion.css", "popup.css", "help.css"]) {
    const css = join(dist, cssFile);
    if (!existsSync(css)) continue;
    for (const m of (await readFile(css, "utf8")).matchAll(/url\("([^"]+)"\)/g)) {
      const ref = m[1] ?? "";
      if (/^https?:/i.test(ref)) problems.push(`${cssFile} loads a remote file: ${ref}`);
      else if (!existsSync(join(dist, ref))) problems.push(`${cssFile} references a missing file: ${ref}`);
    }
  }

  for (const file of await readdir(dist, { recursive: true })) {
    const full = join(dist, file);
    const ext = extname(file);
    if (ext === ".html") {
      const html = await readFile(full, "utf8");
      if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html)) problems.push(`${file}: inline <script> found`);
      if (/<style[\s>]/i.test(html)) problems.push(`${file}: inline <style> found`);
      if (/\son[a-z]+\s*=/i.test(html)) problems.push(`${file}: inline event-handler attribute found`);
      for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
        const ref = m[1] ?? "";
        if (/^https?:/i.test(ref)) problems.push(`${file}: remote resource ${ref}`);
        else if (!ref.startsWith("#") && !existsSync(join(dist, ref))) problems.push(`${file}: missing ${ref}`);
      }
    }
    if (ext === ".js") {
      const js = await readFile(full, "utf8");
      if (/\beval\s*\(/.test(js)) problems.push(`${file}: eval() found`);
      if (/new\s+Function\s*\(/.test(js)) problems.push(`${file}: new Function() found`);
      const remote = js.match(/https?:\/\/[^\s"'`)]+/g);
      if (remote) problems.push(`${file}: remote URL string found (${remote[0]})`);
    }
  }
  return problems;
}

if (import.meta.main) {
  const dist = process.argv[2] ?? join(import.meta.dir, "..", "dist");
  const problems = await validateDist(dist);
  if (problems.length > 0) {
    for (const p of problems) console.error(`✗ ${p}`);
    process.exit(1);
  }
  console.log("✓ mv3: manifest, permissions, CSP, and built files pass validation");
}
