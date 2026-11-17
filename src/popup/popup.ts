import { en } from "../i18n/en";
import { chromeKv } from "../shared/kv";
import { JOB_KEY, LOGS_KEY, appendLogEntries, readJob } from "../shared/job-store";
import { createLogger, makeEntry, type Logger } from "../shared/log";
import type { StartRequest, StartResponse, TargetTab } from "../shared/messages";
import { DPR_OPTIONS, isDelay, isDpr, type CaptureMode, type Dpr, type Delay, type JobState, type LogEntry, type Prefs, type SizePreset, type Theme } from "../shared/types";
import { DEFAULT_PREFS, loadPrefs, resetPrefs, savePrefs } from "../settings/settings-store";
import { ALL_PRESETS, DEVICE_PRESETS, RESOLUTION_PRESETS, addSavedSize, monitorPreset, removeSavedSize } from "../settings/presets";
import { FREE, RATIOS, heightFor, isRatioId, ratioOfSize, widthFor } from "../validation/ratios";
import { allowedDprs, assessOutput, LIMITS, toMegapixels, validateCaptureOptions, validateRequest, type FieldKey } from "../validation/dimensions";
import { ConsolePanel } from "./console-panel";
import { createBackdrop, type Backdrop } from "./backdrop";
import { Dropdown } from "./dropdown";
import { attachRipples, cancelCountUp, countUp, placeThumb, pulse, scramble, setMotion, switchTheme } from "./motion";
import { hydrateButtons } from "../ui/button";
import { enrichMotion } from "../ui/motion-extra";
import { applyBrandTheme } from "../ui/brand";

const local = chromeKv(chrome.storage.local);
const session = chromeKv(chrome.storage.session);

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
};

const presetSelect = el<HTMLSelectElement>("preset");
const widthInput = el<HTMLInputElement>("width");
const heightInput = el<HTMLInputElement>("height");
const swapButton = el<HTMLButtonElement>("swap");
const ratioSelect = el<HTMLSelectElement>("ratio");
const viewfinder = document.querySelector<HTMLElement>(".viewfinder")!;
const ratioShape = el<HTMLElement>("ratio-shape");
const estPx = el<HTMLElement>("est-px");
const estMp = el<HTMLElement>("est-mp");
const receiptValue = el<HTMLElement>("receipt-v");
const modeGroup = el<HTMLElement>("mode");
const modeInputs = document.querySelectorAll<HTMLInputElement>('input[name="mode"]');
const dprSelect = el<HTMLSelectElement>("dpr");
const dprHint = el<HTMLElement>("dpr-hint");
const formatSelect = el<HTMLSelectElement>("format");
const qualityInput = el<HTMLInputElement>("quality");
const warmUpBox = el<HTMLInputElement>("warm-up");
const motionBox = el<HTMLInputElement>("motion");
const delaySelect = el<HTMLSelectElement>("delay");
const darkModeBox = el<HTMLInputElement>("dark-mode");
const hideFixedBox = el<HTMLInputElement>("hide-fixed");
const saveAsBox = el<HTMLInputElement>("save-as");
const copyBox = el<HTMLInputElement>("copy-clipboard");
const annotateBox = el<HTMLInputElement>("annotate");
const notificationsBox = el<HTMLInputElement>("notifications");
const pickTimeoutBox = el<HTMLInputElement>("pick-timeout");
const saveSizeBtn = el<HTMLButtonElement>("save-size");
const deleteSizeBtn = el<HTMLButtonElement>("delete-size");
const resetBtn = el<HTMLButtonElement>("reset");
const captureBtn = el<HTMLButtonElement>("capture");
const captureLabel = el<HTMLElement>("capture-label");
const progressCells = Array.from(el("progress").children) as HTMLElement[];
const statusEl = el<HTMLElement>("status");
const statusText = el<HTMLElement>("status-text");
const statusLive = el<HTMLElement>("status-live");
const frame = el<HTMLElement>("frame");
const fieldError = el<HTMLElement>("field-error");
const title = el<HTMLElement>("title");
const themeToggle = el<HTMLButtonElement>("theme-toggle");
const helpLink = el<HTMLAnchorElement>("help-link");
const tabBar = document.querySelector<HTMLElement>(".tab-bar")!;
const tabs = [1, 2, 3, 4].map((n) => el<HTMLButtonElement>(`tab-${n}`));
const pages = [1, 2, 3, 4].map((n) => el(`page-${n}`));

const fieldNodes: Record<FieldKey, HTMLInputElement | HTMLSelectElement | null> = {
  width: widthInput,
  height: heightInput,
  dpr: dprSelect,
  mode: null,
  format: formatSelect,
  quality: qualityInput,
};

let prefs: Prefs = DEFAULT_PREFS;
/** The dynamic "Monitor" preset, built once from window.screen when the popup opens. */
let monitorEntry: SizePreset | null = null;
/** The density the user actually chose. Kept separate from the displayed value, which may be
 * temporarily clamped to the highest valid one for the current size/mode. */
let desiredDpr: Dpr = DEFAULT_PREFS.dpr;
let job: JobState | null = null;
let swLogs: LogEntry[] = [];
let popupLogs: LogEntry[] = [];
let awaitingConfirm = false;
let confirmDismissed = false;
let currentPage = 1;
let lastStatus: JobState["status"] | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let pendingSave = false;

const backdrop: Backdrop | null = createBackdrop(el<HTMLCanvasElement>("backdrop"));

const log: Logger = createLogger((level, message) => {
  popupLogs = appendLogEntries(popupLogs, makeEntry(level, message, "popup"));
  renderConsole();
});

const consolePanel = new ConsolePanel(el("page-4"), el("console-badge"), {
  onClear: () => {
    popupLogs = [];
    swLogs = [];
    void session.set({ [LOGS_KEY]: [] });
    renderConsole();
  },
  onCopy: (text) => {
    navigator.clipboard
      .writeText(text)
      .then(() => log.info(en.ui.copied))
      .catch(() => log.warn(en.ui.copyBlocked));
  },
});

/** Every select in the form gets the animated dropdown. The selects keep the values. */
const dropdowns = [presetSelect, ratioSelect, dprSelect, formatSelect, delaySelect].map((select) => new Dropdown(select));
const refreshDropdowns = (): void => dropdowns.forEach((dropdown) => dropdown.refresh());

const reducedMotion = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;

function renderConsole(): void {
  consolePanel.render([...swLogs, ...popupLogs].sort((a, b) => a.time - b.time).slice(-400));
}

/** A whole number from a text field, or null while the text is not a valid number. */
function toInt(value: string): number | null {
  const text = value.trim();
  return /^\d+$/.test(text) ? Number(text) : null;
}

function currentMode(): CaptureMode {
  const value = [...modeInputs].find((input) => input.checked)?.value;
  return value === "fullpage" || value === "region" || value === "element" ? value : "viewport";
}

function currentDelay(): Delay {
  const value = Number(delaySelect.value);
  return isDelay(value) ? value : 0;
}

function currentDpr(): Dpr {
  const value = Number(dprSelect.value);
  return isDpr(value) ? value : prefs.dpr;
}

/** The raw form values, checked by the same validator the service worker uses. */
function readForm(): Record<string, unknown> {
  return {
    width: widthInput.value,
    height: heightInput.value,
    dpr: dprSelect.value,
    mode: currentMode(),
    format: formatSelect.value,
    quality: formatSelect.value === "jpeg" ? qualityInput.value : DEFAULT_PREFS.quality,
    warmUp: warmUpBox.checked,
    confirmLarge: awaitingConfirm,
    delay: currentDelay(),
    darkMode: darkModeBox.checked,
    hideFixed: hideFixedBox.checked,
    saveAs: saveAsBox.checked,
    copyToClipboard: copyBox.checked,
    annotate: annotateBox.checked,
    theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light",
    // Picker motion is part of the main Motion switch (and reduced motion).
    overlayMotion: motionBox.checked && !reducedMotion(),
    pickTimeout: pickTimeoutBox.checked,
  };
}

/** Preferences from the form. An invalid size keeps the last valid value. */
function snapshotPrefs(): Prefs {
  return {
    ...prefs,
    width: toInt(widthInput.value) ?? prefs.width,
    height: toInt(heightInput.value) ?? prefs.height,
    dpr: desiredDpr,
    mode: currentMode(),
    format: formatSelect.value === "jpeg" ? "jpeg" : "png",
    quality: toInt(qualityInput.value) ?? prefs.quality,
    warmUp: warmUpBox.checked,
    motion: motionBox.checked,
    delay: currentDelay(),
    darkMode: darkModeBox.checked,
    hideFixed: hideFixedBox.checked,
    saveAs: saveAsBox.checked,
    copyToClipboard: copyBox.checked,
    annotate: annotateBox.checked,
    notifications: notificationsBox.checked,
    pickTimeout: pickTimeoutBox.checked,
  };
}

function markInvalid(fields: FieldKey[], message = ""): void {
  for (const [name, node] of Object.entries(fieldNodes) as Array<[FieldKey, HTMLElement | null]>) {
    if (!node) continue;
    const invalid = fields.includes(name);
    node.setAttribute("aria-invalid", String(invalid));
    if (invalid) node.setAttribute("aria-describedby", "field-error");
    else node.removeAttribute("aria-describedby");
  }
  fieldError.textContent = message;
}

/** Saves the form after a short pause. The pending change is also saved when the popup closes. */
function scheduleSave(): void {
  pendingSave = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 300);
}

function flushSave(): void {
  if (!pendingSave) return;
  pendingSave = false;
  clearTimeout(saveTimer);
  if (toInt(widthInput.value) === null || toInt(heightInput.value) === null) return;
  prefs = snapshotPrefs();
  void savePrefs(local, prefs);
}

function option(value: string, text: string): HTMLOptionElement {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = text;
  return node;
}

/** All selectable presets, with the dynamic Monitor entry first so it wins any size collision. */
function allPresets(): SizePreset[] {
  return monitorEntry
    ? [monitorEntry, ...ALL_PRESETS, ...prefs.savedSizes]
    : [...ALL_PRESETS, ...prefs.savedSizes];
}

function renderPresetSelect(): void {
  const groups: Array<[string, readonly SizePreset[]]> = [
    [en.presets.monitorGroup, monitorEntry ? [monitorEntry] : []],
    [en.ui.devices, DEVICE_PRESETS],
    [en.ui.resolutions, RESOLUTION_PRESETS],
    [en.ui.savedSizes, prefs.savedSizes],
  ];
  presetSelect.replaceChildren(option("custom", en.ui.customSize));
  for (const [label, list] of groups) {
    if (list.length === 0) continue;
    const group = document.createElement("optgroup");
    group.label = label;
    for (const p of list) group.append(option(p.id, `${p.label} · ${p.width} × ${p.height} @${p.dpr}×`));
    presetSelect.append(group);
  }
  syncPresetSelect();
  // The native <select> is rebuilt here; refresh the custom dropdown's visible label with it.
  refreshDropdowns();
}

function renderRatioSelect(): void {
  ratioSelect.replaceChildren(option(FREE, en.ui.ratioFree), ...RATIOS.map((r) => option(r.id, r.id)));
}

/** Shows the preset that matches the current size and density, or "Custom size" when none does. */
function syncPresetSelect(): void {
  const w = toInt(widthInput.value);
  const h = toInt(heightInput.value);
  const dpr = currentDpr();
  const match = allPresets().find((p) => p.width === w && p.height === h && p.dpr === dpr);
  presetSelect.value = match?.id ?? "custom";
  deleteSizeBtn.disabled = !prefs.savedSizes.some((p) => p.id === presetSelect.value);
}

function onPresetChange(): void {
  const preset = allPresets().find((p) => p.id === presetSelect.value);
  if (!preset) return;
  widthInput.value = String(preset.width);
  heightInput.value = String(preset.height);
  dprSelect.value = String(preset.dpr);
  if (isDpr(preset.dpr)) desiredDpr = preset.dpr;
  prefs = { ...snapshotPrefs(), ratio: ratioOfSize(preset.width, preset.height) };
  ratioSelect.value = prefs.ratio;
  commit();
}

/** Picks a ratio. When one is set, the height follows the width (or the width follows the height). */
function applyRatio(id: string): void {
  if (id !== FREE && !isRatioId(id)) return;
  prefs = { ...prefs, ratio: id as Prefs["ratio"] };
  ratioSelect.value = id;
  if (id !== FREE) {
    const w = toInt(widthInput.value);
    const h = toInt(heightInput.value);
    if (w !== null) heightInput.value = String(heightFor(w, id));
    else if (h !== null) widthInput.value = String(widthFor(h, id));
  }
  pulse(viewfinder, "flash");
  commit();
}

/** With a ratio locked, typing a width sets the height, and typing a height sets the width. */
function onSizeInput(source: HTMLInputElement): void {
  const ratio = isRatioId(prefs.ratio) ? prefs.ratio : FREE;
  const value = toInt(source.value);
  if (ratio !== FREE && value !== null) {
    if (source === widthInput) heightInput.value = String(heightFor(value, ratio));
    else widthInput.value = String(widthFor(value, ratio));
  }
  renderAll();
}

/** Swaps width and height. A ratio that no longer fits becomes the ratio of the new shape, or Free. */
function onSwap(): void {
  const width = widthInput.value;
  widthInput.value = heightInput.value;
  heightInput.value = width;
  const w = toInt(widthInput.value);
  const h = toInt(heightInput.value);
  if (w !== null && h !== null) prefs = { ...prefs, ratio: ratioOfSize(w, h) };
  ratioSelect.value = prefs.ratio;
  pulse(swapButton, "spin");
  commit();
}

function renderDensity(): void {
  const w = toInt(widthInput.value);
  const h = toInt(heightInput.value) ?? 0;
  const mode = currentMode();
  const allowed = new Set<number>(mode === "region" || mode === "element" || w === null
    ? DPR_OPTIONS
    : allowedDprs(w, h, mode));
  for (const option of dprSelect.options) option.disabled = !allowed.has(Number(option.value));
  const highest = Math.max(...allowed);
  // Show the user's chosen density whenever this size/mode allows it. If it does not, show the
  // highest valid one — but never overwrite `desiredDpr`, so switching back restores their choice.
  dprSelect.value = String(allowed.has(desiredDpr) ? desiredDpr : highest);
  dprHint.textContent = highest < 3 ? en.ui.maxDensity(String(highest)) : "";
}

/** Draws the shape of the current size inside the viewfinder. */
function renderRatioShape(): void {
  const w = toInt(widthInput.value);
  const h = toInt(heightInput.value);
  if (!w || !h) return;
  const scale = 56 / Math.max(w, h);
  ratioShape.style.width = `${Math.round(w * scale)}px`;
  ratioShape.style.height = `${Math.round(h * scale)}px`;
}

function renderSizeInfo(): void {
  const checked = validateCaptureOptions(readForm());
  if (!checked.ok) {
    cancelCountUp(estMp);
    estPx.textContent = "";
    estMp.textContent = "";
    receiptValue.textContent = "";
    el<HTMLElement>("fullpage-hint").hidden = true;
    return;
  }
  const o = checked.value;
  const format = o.format.toUpperCase();
  const dpr = `${o.dpr}×`;
  const fullPageHint = el<HTMLElement>("fullpage-hint");
  if (o.mode === "region" || o.mode === "element") {
    cancelCountUp(estMp);
    estPx.textContent = en.ui.selecting;
    estMp.textContent = "";
    fullPageHint.hidden = true;
    receiptValue.textContent = `${format} · ${dpr}`;
    return;
  }
  if (o.mode === "fullpage") {
    const estimate = assessOutput(o.width, LIMITS.fullPageEstimateHeight, o.dpr);
    cancelCountUp(estMp);
    estPx.textContent = en.ui.estimateFull(Math.round(o.width * o.dpr));
    estMp.textContent = "";
    fullPageHint.textContent = en.ui.fullPageBudget(estimate.outW, estimate.outH, String(toMegapixels(estimate.pixels)));
    fullPageHint.hidden = false;
    receiptValue.textContent = en.ui.receiptFull(Math.round(o.width * o.dpr), format, dpr);
    return;
  }
  fullPageHint.hidden = true;
  const a = assessOutput(o.width, o.height, o.dpr);
  estPx.textContent = en.ui.estimateSize(a.outW, a.outH);
  receiptValue.textContent = en.ui.receipt(a.outW, a.outH, format, dpr);
  const mp = toMegapixels(a.pixels);
  if (estMp.dataset.value !== String(mp)) {
    estMp.dataset.value = String(mp);
    countUp(estMp, mp, " MP");
  }
}

/** Runs after any change to a size, density, mode or ratio. */
function renderAll(): void {
  renderDensity();
  renderRatioShape();
  renderSizeInfo();
  syncPresetSelect();
  refreshDropdowns();
  scheduleSave();
}

/** Runs when a field is committed (blur or change). Problems are explained in the Console. */
function commit(): void {
  if (job?.status === "needs-confirm") confirmDismissed = true;
  awaitingConfirm = false;
  const checked = validateRequest(readForm());
  if (checked.ok) {
    markInvalid([]);
  } else {
    markInvalid(checked.fields, checked.message);
    log.warn(checked.message);
  }
  renderAll();
  renderJob();
}

function onModeChange(): void {
  placeThumb(modeGroup);
  pulse(modeGroup, "squish");
  commit();
}

function applyPrefs(p: Prefs): void {
  widthInput.value = String(p.width);
  heightInput.value = String(p.height);
  formatSelect.value = p.format;
  qualityInput.value = String(p.quality);
  warmUpBox.checked = p.warmUp;
  motionBox.checked = p.motion;
  delaySelect.value = String(isDelay(p.delay) ? p.delay : 0);
  darkModeBox.checked = p.darkMode;
  hideFixedBox.checked = p.hideFixed;
  saveAsBox.checked = p.saveAs;
  copyBox.checked = p.copyToClipboard;
  annotateBox.checked = p.annotate;
  notificationsBox.checked = p.notifications;
  pickTimeoutBox.checked = p.pickTimeout;
  for (const input of modeInputs) input.checked = input.value === p.mode;
  ratioSelect.value = isRatioId(p.ratio) ? p.ratio : FREE;
  desiredDpr = isDpr(p.dpr) ? p.dpr : DEFAULT_PREFS.dpr;
  dprSelect.value = String(desiredDpr);
  renderPresetSelect();
  renderAll();
  markInvalid([]);
  placeThumb(modeGroup);
}

function setTheme(theme: Theme, animate: boolean): void {
  const apply = (): void => {
    document.documentElement.dataset.theme = theme;
    backdrop?.setDark(theme === "dark");
    applyBrandTheme(theme);
  };
  if (animate) switchTheme(apply);
  else apply();
  themeToggle.setAttribute("aria-checked", String(theme === "dark"));
  themeToggle.setAttribute("aria-label", theme === "dark" ? en.ui.toLight : en.ui.toDark);
}

function applyMotion(on: boolean): void {
  const enabled = on && !reducedMotion();
  setMotion(enabled);
  backdrop?.setAnimated(enabled);
}

async function onThemeToggle(): Promise<void> {
  const next: Theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  setTheme(next, true);
  prefs = { ...snapshotPrefs(), theme: next };
  await savePrefs(local, prefs);
}

function onMotionChange(): void {
  applyMotion(motionBox.checked);
  prefs = snapshotPrefs();
  void savePrefs(local, prefs);
}

async function onSaveSize(): Promise<void> {
  const checked = validateRequest(readForm());
  if (!checked.ok) {
    markInvalid(checked.fields, checked.message);
    log.warn(checked.message);
    return;
  }
  const o = checked.value;
  prefs = { ...snapshotPrefs(), savedSizes: addSavedSize(prefs.savedSizes, o.width, o.height, o.dpr) };
  await savePrefs(local, prefs);
  renderPresetSelect();
  pulse(saveSizeBtn, "bump");
  log.info(en.ui.sizeSaved(o.width, o.height));
}

async function onDeleteSize(): Promise<void> {
  const id = presetSelect.value;
  if (!prefs.savedSizes.some((p) => p.id === id)) return;
  prefs = { ...snapshotPrefs(), savedSizes: removeSavedSize(prefs.savedSizes, id) };
  await savePrefs(local, prefs);
  renderPresetSelect();
  log.info(en.ui.sizeDeleted);
}

async function onReset(): Promise<void> {
  prefs = await resetPrefs(local);
  applyPrefs(prefs);
  setTheme(prefs.theme, false);
  applyMotion(prefs.motion);
  log.info(en.ui.settingsReset);
}

/**
 * Finds the web page to capture, freshly on every CAPTURE press (never cached at popup open, which
 * could go stale if the user switched tabs). In a normal popup the active tab is the page the user
 * clicked on. If that tab is one of our own extension pages (e.g. the Guide), we look for the web
 * page in the same window instead. The `tabs` permission ensures `tab.url` is always readable —
 * without it Chrome 153+ returns `undefined`, which looks like a restricted page.
 */
async function resolveTargetTab(): Promise<TargetTab | undefined> {
  const isWebPage = (url?: string): boolean => typeof url === "string" && /^https?:\/\//.test(url);
  const toTarget = (t?: { id?: number; url?: string }): TargetTab | undefined =>
    t && typeof t.id === "number" ? { id: t.id, url: t.url } : undefined;

  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active && isWebPage(active.url)) return toTarget(active);

  const tabs = await chrome.tabs.query({ currentWindow: true });
  const webTab = tabs.find((t) => isWebPage(t.url));
  return toTarget(webTab ?? active);
}

async function onCapture(): Promise<void> {
  const confirmLarge = awaitingConfirm;
  confirmDismissed = false;
  const checked = validateRequest({ ...readForm(), confirmLarge });
  if (!checked.ok) {
    markInvalid(checked.fields, checked.message);
    log.warn(checked.message);
    return;
  }
  markInvalid([]);
  prefs = snapshotPrefs();
  await savePrefs(local, prefs);
  captureBtn.disabled = true;
  captureLabel.textContent = en.ui.starting;

  // If the worker cannot be reached, the button is turned back on. Otherwise it would stay stuck.
  let response: StartResponse | undefined;
  try {
    const target = await resolveTargetTab();
    const request: StartRequest = { type: "START_CAPTURE", options: checked.value, tab: target };
    response = (await chrome.runtime.sendMessage(request)) as StartResponse | undefined;
  } catch {
    response = undefined;
  }
  if (!response?.ok) {
    log.warn(en.logs.startFailed(response && !response.ok ? response.code : "no response"));
    renderJob();
    return;
  }
  // Interactive picking needs the whole page visible and focused. Closing the popup guarantees it
  // cannot overlap the area the user is trying to select.
  if (checked.value.mode === "region" || checked.value.mode === "element") {
    window.close();
  }
}

/** Every visible state comes from the job record, so the popup is right even after it was closed and reopened. */
function renderJob(): void {
  const status = job?.status;
  const running = status === "running";
  captureBtn.disabled = running;
  captureBtn.setAttribute("aria-busy", String(running));
  captureBtn.classList.toggle("is-running", running);

  let label: string;
  let text: string;
  if (running) {
    label = en.ui.capturing;
    text = job?.step ?? "";
  } else if (status === "needs-confirm" && !confirmDismissed) {
    awaitingConfirm = true;
    label = en.ui.confirmLarge;
    text = en.ui.statusLarge(String(toMegapixels(job?.pixels ?? 0)));
  } else {
    awaitingConfirm = false;
    label = status === "done" ? en.ui.captureAgain : en.ui.capture;
    text = status === "done" ? en.ui.statusSaved : status === "failed" ? en.ui.statusStopped : en.ui.statusReady;
  }
  if (captureLabel.textContent !== label) captureLabel.textContent = label;
  // The animated text is decorative; stable text goes to a separate live region so a screen
  // reader announces the final message once instead of every scrambled frame.
  if (statusLive.textContent !== text) statusLive.textContent = text;
  if (statusText.textContent !== text) scramble(statusText, text, 420);

  const lit = running || status === "done" || status === "failed" ? (job?.progress ?? 0) : -1;
  progressCells.forEach((cell, i) => {
    cell.dataset.on = String(i <= lit);
  });

  statusEl.classList.toggle("is-done", status === "done");
  if (status !== lastStatus) {
    if (lastStatus === "running" && status === "done") pulse(frame, "shoot");
    if (status === "failed") pulse(captureBtn, "shake");
    lastStatus = status;
  }
}

/** Moves between the three pages. The page you leave slides away, the new one slides in. */
function goToPage(target: number): void {
  if (target === currentPage || target < 1 || target > pages.length) return;
  const entering = pages[target - 1];
  if (!entering) return;
  const enterClass = target > currentPage ? "enter-next" : "enter-prev";
  currentPage = target;
  entering.classList.add(enterClass);
  void entering.getBoundingClientRect();
  pages.forEach((page, i) => page.classList.toggle("is-active", i + 1 === target));
  entering.classList.remove(enterClass);
  tabs.forEach((tab, i) => {
    tab.setAttribute("aria-selected", String(i + 1 === target));
    tab.tabIndex = i + 1 === target ? 0 : -1;
  });
  tabBar.style.setProperty("--i", String(target - 1));
}

function applyTranslations(): void {
  const lookup = (path: string): string | undefined =>
    path.split(".").reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], en) as string | undefined;
  for (const node of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
    const text = lookup(node.dataset.i18n ?? "");
    if (text !== undefined) node.textContent = text;
  }
  for (const node of document.querySelectorAll<HTMLElement>("[data-i18n-title]")) {
    const text = lookup(node.dataset.i18nTitle ?? "");
    if (text !== undefined) node.title = text;
  }
  for (const node of document.querySelectorAll<HTMLElement>("[data-i18n-aria]")) {
    const text = lookup(node.dataset.i18nAria ?? "");
    if (text !== undefined) node.setAttribute("aria-label", text);
  }
}

function wire(): void {
  presetSelect.addEventListener("change", onPresetChange);
  ratioSelect.addEventListener("change", () => applyRatio(ratioSelect.value));
  swapButton.addEventListener("click", onSwap);
  for (const input of [widthInput, heightInput]) {
    input.addEventListener("input", () => onSizeInput(input));
    input.addEventListener("change", commit);
  }
  for (const input of modeInputs) input.addEventListener("change", onModeChange);
  dprSelect.addEventListener("change", () => {
    const value = Number(dprSelect.value);
    if (isDpr(value)) desiredDpr = value;
  });
  for (const node of [
    dprSelect, formatSelect, warmUpBox, delaySelect,
    darkModeBox, hideFixedBox, saveAsBox, copyBox, annotateBox, notificationsBox, pickTimeoutBox,
  ]) node.addEventListener("change", commit);
  qualityInput.addEventListener("change", commit);
  qualityInput.addEventListener("input", renderAll);
  motionBox.addEventListener("change", onMotionChange);
  themeToggle.addEventListener("click", () => void onThemeToggle());
  captureBtn.addEventListener("click", () => void onCapture());
  saveSizeBtn.addEventListener("click", () => void onSaveSize());
  deleteSizeBtn.addEventListener("click", () => void onDeleteSize());
  resetBtn.addEventListener("click", () => void onReset());
  helpLink.addEventListener("click", (event) => {
    event.preventDefault();
    void chrome.tabs.create({ url: chrome.runtime.getURL("help.html") });
  });
  tabs.forEach((tab, i) => tab.addEventListener("click", () => goToPage(i + 1)));
  document.querySelector<HTMLElement>(".tabs")?.addEventListener("keydown", (event) => {
    if (event.key === "Home") goToPage(1);
    else if (event.key === "End") goToPage(tabs.length);
    else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      goToPage(Math.min(tabs.length, Math.max(1, currentPage + (event.key === "ArrowRight" ? 1 : -1))));
      tabs[currentPage - 1]?.focus();
    }
  });
  window.addEventListener("resize", () => placeThumb(modeGroup));
  // Save a pending size change before the popup closes, so the last edit is never lost.
  window.addEventListener("pagehide", flushSave);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "session") return;
    if (changes[JOB_KEY]) {
      job = (changes[JOB_KEY].newValue as JobState | undefined) ?? null;
      confirmDismissed = false;
      renderJob();
    }
    if (changes[LOGS_KEY]) {
      const next = changes[LOGS_KEY].newValue;
      swLogs = Array.isArray(next) ? (next as LogEntry[]) : [];
      renderConsole();
    }
  });
}

async function init(): Promise<void> {
  applyTranslations();
  modeGroup.setAttribute("aria-label", en.ui.modeLabel);
  renderRatioSelect();
  prefs = await loadPrefs(local);
  setTheme(prefs.theme, false);
  applyMotion(prefs.motion);
  // Read the display once on open. The result is a normal dynamic preset, so selection, syncing,
  // validation and density gating all work exactly as they do for the built-in resolutions.
  monitorEntry = monitorPreset(window.screen.width, window.screen.height);
  applyPrefs(prefs);
  job = await readJob(session);
  const stored = (await session.get(LOGS_KEY))[LOGS_KEY];
  swLogs = Array.isArray(stored) ? (stored as LogEntry[]) : [];
  renderJob();
  renderConsole();
  hydrateButtons(document);
  enrichMotion(document);
  attachRipples(document);
  scramble(title, en.app.name, 700);
  goToPage(1);
}

// Wire listeners first so the popup stays usable even if loading stored state fails. A failed
// storage read used to abort init() before wire(), leaving a fully rendered but inert popup.
wire();
void init().catch((error: unknown) => {
  console.error("Spectra Capture: popup initialisation failed", error);
});
