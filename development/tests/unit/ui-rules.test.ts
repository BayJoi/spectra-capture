import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { en } from "../../../src/i18n/en";

const root = join(import.meta.dir, "../../..");
const read = (rel: string): string => readFileSync(join(root, rel), "utf8");
const filesUnder = (dir: string): string[] =>
  readdirSync(join(root, dir), { recursive: true })
    .map(String)
    .filter((f) => /\.(ts|html|css|json)$/.test(f))
    .map((f) => join(dir, f));
const lookup = (key: string): unknown => key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], en);
const styleFiles = ["src/shared/tokens.css", "src/ui/button.css", "src/ui/motion.css", "src/popup/popup.css", "src/help/help.css"];

/**
 * The unicode ranges of the Google Fonts "latin" subset of Inter 4.001, the bundled font
 * (see assets/fonts/README.md). Anything outside these ranges is drawn as SVG, never by a
 * system fallback font.
 */
const LATIN_SUBSET: Array<[number, number]> = [
  [0x0000, 0x00ff], [0x0131, 0x0131], [0x0152, 0x0153], [0x02bb, 0x02bc], [0x02c6, 0x02c6], [0x02da, 0x02da],
  [0x02dc, 0x02dc], [0x0304, 0x0304], [0x0308, 0x0308], [0x0329, 0x0329], [0x2000, 0x206f],
  [0x20ac, 0x20ac], [0x2122, 0x2122], [0x2191, 0x2191], [0x2193, 0x2193], [0x2212, 0x2212],
  [0x2215, 0x2215], [0xfeff, 0xfeff], [0xfffd, 0xfffd],
];

describe("English only", () => {
  test("no Japanese, Chinese or Korean characters anywhere in the source or public files", () => {
    const cjk = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uff00-\uffef]/;
    for (const file of [...filesUnder("src"), ...filesUnder("public")]) {
      expect({ file, hit: cjk.test(read(file)) }).toEqual({ file, hit: false });
    }
  });

  test("every data-i18n key in the popup exists in the English file", () => {
    const html = read("src/popup/popup.html");
    const keys = [...html.matchAll(/data-i18n(?:-title|-aria)?="([^"]+)"/g)].map((m) => m[1] ?? "");
    expect(keys.length).toBeGreaterThan(20);
    for (const key of keys) expect({ key, found: typeof lookup(key) === "string" }).toEqual({ key, found: true });
  });
});

describe("one bundled typeface: Inter", () => {
  test("every font-family is the Inter-first token, with system fallbacks", () => {
    for (const file of [...styleFiles, "src/help/help.html", "src/popup/popup.html"]) {
      const text = read(file);
      for (const m of text.matchAll(/font-family:\s*([^;}]+)/g)) {
        const value = (m[1] ?? "").trim();
        expect({ file, value }).toEqual({
          file,
          value: expect.stringMatching(/^("Inter"|var\(--font\)|"Inter", -apple-system.*)$/),
        });
      }
    }
    const tokens = read("src/shared/tokens.css");
    expect(tokens).toMatch(/--font:\s*"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto/);
    for (const fallback of ["Noto Sans", "Liberation Sans", "sans-serif"]) expect(tokens).toContain(fallback);
    // No element may silently fall back to a monospace system font.
    expect(tokens).toMatch(/html, body, button, input, select, textarea, code, kbd, samp, pre \{ font-family: var\(--font\); \}/);
    for (const file of styleFiles) expect(read(file)).not.toMatch(/font-family:\s*monospace/);
  });

  test("the only bundled font file is the Inter variable woff2", () => {
    expect(read("scripts/build.ts")).toContain("inter-latin-variable.woff2");
    expect(read("src/shared/tokens.css")).not.toMatch(/src:\s*url\("(?!fonts\/inter-latin-variable\.woff2")/);
  });

  test("font-weight values are 300, 500, 700, the variable range, or inherit", () => {
    const css = styleFiles.map(read).join("\n");
    for (const m of css.matchAll(/font-weight:\s*([^;}\n]+)/g)) {
      const value = (m[1] ?? "").trim();
      expect(["300", "500", "700", "100 900", "inherit"]).toContain(value);
    }
  });

  test("every non-ASCII character in the visible text is one the font contains", () => {
    const covered = (code: number): boolean => LATIN_SUBSET.some(([a, b]) => code >= a && code <= b);
    const texts = [read("src/popup/popup.html"), read("src/help/help.html"), read("src/i18n/en.ts")];
    for (const text of texts) {
      for (const ch of new Set(text)) {
        const code = ch.codePointAt(0) ?? 0;
        if (code < 128) continue;
        expect({ ch, code: code.toString(16), covered: covered(code) }).toEqual({ ch, code: code.toString(16), covered: true });
      }
    }
  });
});

describe("sharp design", () => {
  test("no CSS rule uses a rounded corner (every border-radius is 0)", () => {
    for (const file of styleFiles) {
      const radii = [...read(file).matchAll(/border-radius:\s*([^;}]+)/g)].map((m) => m[1]?.trim());
      for (const value of radii) expect({ file, value }).toEqual({ file, value: expect.stringMatching(/^0( !important)?$/) });
    }
  });

  test("fonts are loaded from the extension itself, never from the internet", () => {
    expect(read("src/shared/tokens.css")).not.toMatch(/url\("https?:/);
  });
});

describe("four pages and no ratio preview", () => {
  test("the popup has four pages, each with a tab", () => {
    const html = read("src/popup/popup.html");
    for (const n of [1, 2, 3, 4]) {
      expect(html).toContain(`id="page-${n}"`);
      expect(html).toContain(`id="tab-${n}"`);
    }
    expect(html).not.toContain('id="page-5"');
    expect(html).not.toContain('id="tab-5"');
  });

  test("the tools page is third and the console is fourth", () => {
    const html = read("src/popup/popup.html");
    expect(html).toMatch(/id="tab-3"[^>]*>[\s\S]*?data-i18n="ui\.tabTools"/);
    expect(html).toMatch(/id="tab-4"[^>]*>[\s\S]*?data-i18n="ui\.tabConsole"/);
  });

  test("no code, message, element or style for the ratio preview or the live stage is left", () => {
    const banned = /runPreview|START_PREVIEW|PREVIEW_RESULT|captureScaled|ratio-grid|preview-run|preview-live|class="tile|\.tile\b|screencast|LivePreview|live-view|live-transport/;
    for (const file of filesUnder("src")) expect({ file, hit: banned.test(read(file)) }).toEqual({ file, hit: false });
    expect(existsSync(join(root, "src/capture/preview.ts"))).toBe(false);
  });

  test("the guide page uses the shared tokens and the same theme switch as the popup", () => {
    expect(read("src/help/help.html")).toContain('href="tokens.css"');
    expect(read("src/help/help.ts")).toContain('from "../popup/motion"');
    expect(read("src/help/help.html")).toContain('id="theme-toggle"');
  });
});

describe("brand files are safe to embed", () => {
  test("the mascot and mark SVGs have no scripts, no event handlers, and no remote links", () => {
    for (const file of ["brand/spectra-mascot.svg", "brand/spectra-mark.svg"]) {
      const svg = read(file);
      expect(svg).not.toMatch(/<script/i);
      expect(svg).not.toMatch(/\son[a-z]+\s*=/i);
      expect(svg).not.toMatch(/(href|src)="https?:/i);
    }
  });
});

describe("bundled font and no keyboard shortcuts", () => {
  test("the Inter variable font and its OFL licence are present (see assets/fonts/README.md)", () => {
    const font = join(root, "assets/fonts/inter-latin-variable.woff2");
    expect(existsSync(font)).toBe(true);
    expect(readFileSync(font).length).toBeGreaterThan(20000);
    expect(existsSync(join(root, "licenses/INTER_OFL-1.1.txt"))).toBe(true);
    expect(read("assets/fonts/README.md")).toContain("4.001");
  });

  test("the build copies the font from assets/fonts, not from the npm package", () => {
    const build = read("scripts/build.ts");
    expect(build).toContain("assets/fonts");
    expect(build).toContain("INTER_OFL-1.1.txt");
    expect(build).not.toContain("@fontsource");
  });

  test("source assets required by the preflight are present", () => {
    expect(readdirSync(join(root, "docs/screenshots")).filter((f) => f.endsWith(".png")).length).toBeGreaterThan(0);
    expect(existsSync(join(root, "licenses/THIRD_PARTY_LICENSES.txt"))).toBe(true);
    expect(existsSync(join(root, "licenses/INTER_OFL-1.1.txt"))).toBe(true);
    expect(existsSync(join(root, "assets/fonts/inter-latin-variable.woff2"))).toBe(true);
  });

  test("only the Inter font is bundled, with all licence texts grouped in licenses/", () => {
    expect(readdirSync(join(root, "assets/fonts")).filter((f) => f.endsWith(".woff2"))).toEqual([
      "inter-latin-variable.woff2",
    ]);
    expect(readdirSync(join(root, "licenses")).filter((f) => f.endsWith(".txt")).sort()).toEqual([
      "INTER_OFL-1.1.txt",
      "THIRD_PARTY_LICENSES.txt",
    ]);
  });

  test("no keyboard shortcut: the manifest defines no commands and the popup listens for no key combination", () => {
    expect(JSON.parse(read("public/manifest.json")).commands).toBeUndefined();
    expect(read("src/popup/popup.ts")).not.toMatch(/ctrlKey|metaKey/);
  });
});

