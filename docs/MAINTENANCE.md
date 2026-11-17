# Maintenance and release checklist

Use this every time a feature is added, removed or changed. The rule is simple: **code, tests, screenshots and docs move together in the same change.**

## 1. Version numbers

1. Bump `version` in `package.json` and in `public/manifest.json`.
2. If the behaviour or a limitation changed, update the version strings in `README.md`, `INSTALL.txt`, `src/help/help.html` and `docs/TESTING.md`.

## 2. Code and tests

1. Run `bun run typecheck` (strict, including unused-code checks).
2. Add or update a unit test in `development/tests/unit/` for any pure logic change.
3. Add or update a Playwright test in `development/tests/playwright/` for any UI or browser behaviour change.
4. Run `bun test` and `bun run check` — the build must validate.
5. Run `bun run e2e:pw`, `bun run e2e:pw:popup`, `bun run e2e:pw:guide` and `bun run e2e:pw:picker`.

## 3. Screenshots

1. Run `bun run screenshots:pw` after **every visual change**. It regenerates every image in `docs/screenshots/` from the real built extension.
2. The script also copies the fresh images into `dist/screenshots/` — without that step the loaded extension kept showing stale pictures until the next `bun run build`. Check the images by eye before committing; the guide page embeds them.
3. Remove screenshots that no longer represent the UI; stale images are worse than none.

## 4. Documentation

Update the matching document in the same commit:

| Change | Document to update |
| --- | --- |
| New API support | `COMPATIBILITY.md`, `BUILDS.md`, `INSTALL.txt` |
| New permission or capture mode | `SECURITY.md`, `BUILDS.md`, `COMPATIBILITY.md`, README features |
| Visual / motion / font change | `DESIGN.md`, `RESEARCH.md` if the research behind it changed |
| New command or test | `TESTING.md`, README command table, `package.json` |
| New dependency or licence | `licenses/THIRD_PARTY_LICENSES.txt`, `NOTICE` if attribution is required |
| Any of the above | `docs/README.md` index if a file was added |

Keep claims traceable: a statement in the docs should be backed by a test or a dated source in `RESEARCH.md`. Do not reintroduce "supports X" claims that were removed because they were false.

## 5. Licensing

All licence texts are kept together in `licenses/`: the project's Apache notice stays at the root in
`NOTICE`, the Inter font licence is `licenses/INTER_OFL-1.1.txt`, and third-party licences plus
inspiration credits are in `licenses/THIRD_PARTY_LICENSES.txt`. The build copies the latter into the
root of `dist/` as `THIRD_PARTY_LICENSES.txt`.

- New runtime or dev dependency: add its name, version, licence and URL to `licenses/THIRD_PARTY_LICENSES.txt`.
- If the dependency is bundled into `dist/`, include its licence text in the build via `scripts/build.ts`.
- If you take code from an external project, do **not** copy it unless its licence permits and `licenses/THIRD_PARTY_LICENSES.txt` records it. The motion layer is original; React Bits is inspiration only (MIT + Commons Clause).

## 6. Final gate

```sh
bun install
bun run build:dev   # typecheck + tests + build + validation + Playwright + screenshots
bun run build:user  # confirm the dependency-free user build still works
git diff --stat     # confirm docs and screenshots are in the change
```

Release only when all commands pass and the docs match what actually shipped.

## 7. Publishing the prebuilt zip

The git-ignored `RELEASE-ZIP-GUIDE.txt` at the repo root documents how to create and verify the
prebuilt `spectra-capture-<version>.zip` for GitHub Releases: build with `bun run build:user`,
inspect `dist/`, grep for personal/machine paths, zip only `dist/`, verify the entries, smoke-test the
unzipped folder in Chromium, and attach only that zip to the release. Keep personal directories,
user names and local paths out of the archive.
