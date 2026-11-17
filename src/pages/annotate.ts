/**
 * Annotate page: draws the pending capture at full resolution into a scrollable canvas, offers a
 * small set of stroke tools drawn over a committed snapshot, and saves the result as a PNG download.
 * No external libraries and no network access.
 */

export {};

import { switchTheme } from "../popup/motion";

import { safeDownloadName } from "../validation/filename";

const PENDING_KEY = "spectra-pending-image";
const MAX_UNDO = 20;

interface PendingImage {
  jobId: string;
  base64: string;
  mime: "image/png" | "image/jpeg";
  filename: string;
}

type Tool = "select" | "pen" | "arrow" | "rect" | "ellipse" | "highlight" | "blur" | "text";
type Swatch = "ink" | "vermilion" | "indigo" | "white" | "black" | "highlight";
type StatusState = "idle" | "done" | "error";

interface Point {
  x: number;
  y: number;
}

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
};

const app = el<HTMLElement>("app");
const canvas = el<HTMLCanvasElement>("canvas");
const ctx = canvas.getContext("2d")!;
const dims = el<HTMLElement>("dims");
const statusEl = el<HTMLElement>("status");
const statusText = el<HTMLElement>("status-text");
const statusLive = el<HTMLElement>("status-live");
const strokeInput = el<HTMLInputElement>("stroke");
const strokeOut = el<HTMLOutputElement>("stroke-out");
const themeToggle = el<HTMLButtonElement>("theme-toggle");
const undoBtn = el<HTMLButtonElement>("undo");
const clearBtn = el<HTMLButtonElement>("clear");
const saveBtn = el<HTMLButtonElement>("save");
const toolButtons = Array.from(document.querySelectorAll<HTMLButtonElement>(".tool[data-tool]"));
const swatchButtons = Array.from(document.querySelectorAll<HTMLButtonElement>(".swatch[data-swatch]"));

const TOOLS: readonly Tool[] = ["select", "pen", "arrow", "rect", "ellipse", "highlight", "blur", "text"];
const SWATCHES: readonly Swatch[] = ["ink", "vermilion", "indigo", "white", "black", "highlight"];

let pending: PendingImage | null = null;
let baseImage: HTMLImageElement | null = null;
let imageUrl: string | null = null;
let tool: Tool = "select";
let swatch: Swatch = "ink";
let strokeWidth = 3;
let drawing = false;
let start: Point = { x: 0, y: 0 };
let cur: Point = { x: 0, y: 0 };
let points: Point[] = [];
let textValue = "";
/** Pixels as they were before the in-progress stroke, used to redraw clean previews. */
let committed: ImageData | null = null;
/** Offscreen copy of `committed`, used as the source region for blur/redact. */
let scratch: HTMLCanvasElement | null = null;
const undoStack: ImageData[] = [];

function isTool(value: string | undefined): value is Tool {
  return TOOLS.includes(value as Tool);
}

function isSwatch(value: string | undefined): value is Swatch {
  return SWATCHES.includes(value as Swatch);
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function colorOf(key: Swatch): string {
  switch (key) {
    case "ink": return cssVar("--ink") || "#2e2118";
    case "vermilion": return cssVar("--accent") || "#c2402b";
    case "indigo": return cssVar("--indigo") || "#23406b";
    case "white": return "#ffffff";
    case "black": return "#000000";
    case "highlight": return "#f5d200";
  }
}

function setStatus(message: string, state: StatusState = "idle"): void {
  statusText.textContent = message;
  statusLive.textContent = message;
  statusEl.classList.toggle("is-done", state === "done");
  statusEl.classList.toggle("is-error", state === "error");
}

function setTool(next: Tool): void {
  tool = next;
  app.dataset.tool = next;
  for (const button of toolButtons) button.setAttribute("aria-pressed", String(button.dataset.tool === next));
}

function setSwatch(next: Swatch): void {
  swatch = next;
  for (const button of swatchButtons) button.setAttribute("aria-pressed", String(button.dataset.swatch === next));
}

function updateUndoState(): void {
  undoBtn.disabled = undoStack.length === 0;
}

function toCanvasPoint(event: PointerEvent): Point {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}

/** Refreshes the offscreen source used to sample blurred content from the committed image. */
function syncScratch(): void {
  if (!committed) return;
  if (!scratch) scratch = document.createElement("canvas");
  scratch.width = canvas.width;
  scratch.height = canvas.height;
  const scratchCtx = scratch.getContext("2d");
  if (scratchCtx) scratchCtx.putImageData(committed, 0, 0);
}

/** Blurs the committed pixels inside the current rectangle. */
function drawBlur(context: CanvasRenderingContext2D): void {
  if (!scratch) return;
  const x = Math.min(start.x, cur.x);
  const y = Math.min(start.y, cur.y);
  const width = Math.abs(cur.x - start.x);
  const height = Math.abs(cur.y - start.y);
  if (width < 1 || height < 1) return;
  context.save();
  context.beginPath();
  context.rect(x, y, width, height);
  context.clip();
  context.filter = "blur(12px)";
  context.drawImage(scratch, 0, 0);
  context.restore();
}

/** Draws the current in-progress shape onto the given context. */
function drawShape(context: CanvasRenderingContext2D): void {
  const isHighlight = tool === "highlight";
  const color = isHighlight ? "#f5d200" : colorOf(swatch);
  const width = isHighlight ? Math.max(strokeWidth * 3, 10) : strokeWidth;

  context.save();
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = width;
  context.lineCap = isHighlight ? "butt" : "round";
  context.lineJoin = "round";
  context.globalAlpha = isHighlight ? 0.45 : 1;

  if (tool === "pen") {
    context.beginPath();
    const first = points[0] ?? start;
    context.moveTo(first.x, first.y);
    for (let i = 1; i < points.length; i += 1) {
      const point = points[i]!;
      context.lineTo(point.x, point.y);
    }
    context.stroke();
  } else if (tool === "arrow") {
    const angle = Math.atan2(cur.y - start.y, cur.x - start.x);
    const head = Math.max(10, width * 3);
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(cur.x, cur.y);
    context.stroke();
    context.beginPath();
    context.moveTo(cur.x, cur.y);
    context.lineTo(cur.x - head * Math.cos(angle - Math.PI / 7), cur.y - head * Math.sin(angle - Math.PI / 7));
    context.lineTo(cur.x - head * Math.cos(angle + Math.PI / 7), cur.y - head * Math.sin(angle + Math.PI / 7));
    context.closePath();
    context.fill();
  } else if (tool === "rect") {
    context.strokeRect(
      Math.min(start.x, cur.x),
      Math.min(start.y, cur.y),
      Math.abs(cur.x - start.x),
      Math.abs(cur.y - start.y),
    );
  } else if (tool === "ellipse") {
    context.beginPath();
    context.ellipse(
      (start.x + cur.x) / 2,
      (start.y + cur.y) / 2,
      Math.abs(cur.x - start.x) / 2,
      Math.abs(cur.y - start.y) / 2,
      0, 0, Math.PI * 2,
    );
    context.stroke();
  } else if (tool === "blur") {
    context.globalAlpha = 1;
    drawBlur(context);
  } else if (tool === "text" && textValue) {
    const size = Math.max(14, strokeWidth * 4);
    context.font = `700 ${size}px Inter, sans-serif`;
    context.fillText(textValue, start.x, start.y);
  }

  context.restore();
}

/** Redraws the committed pixels, then the current shape on top, without destroying the base. */
function preview(): void {
  if (!committed) return;
  ctx.putImageData(committed, 0, 0);
  if (tool !== "select") drawShape(ctx);
}

function pushUndo(snapshot: ImageData): void {
  undoStack.push(snapshot);
  if (undoStack.length > MAX_UNDO) undoStack.shift();
}

function commitShape(): void {
  if (!committed) return;
  pushUndo(committed);
  committed = ctx.getImageData(0, 0, canvas.width, canvas.height);
  updateUndoState();
}

function onPointerDown(event: PointerEvent): void {
  if (!baseImage || !committed || event.button !== 0 || tool === "select") return;
  const point = toCanvasPoint(event);
  start = point;
  cur = point;
  points = [point];
  textValue = "";

  if (tool === "text") {
    const value = window.prompt("Text to place on the image:");
    if (value === null || value.trim() === "") return;
    textValue = value.trim();
  }

  committed = ctx.getImageData(0, 0, canvas.width, canvas.height);
  syncScratch();
  drawing = true;
  try { canvas.setPointerCapture(event.pointerId); } catch { /* capture is best-effort */ }
  preview();
}

function onPointerMove(event: PointerEvent): void {
  if (!drawing) return;
  const point = toCanvasPoint(event);
  cur = point;
  if (tool === "pen") points.push(point);
  preview();
}

function onPointerUp(event: PointerEvent): void {
  if (!drawing) return;
  const point = toCanvasPoint(event);
  cur = point;
  if (tool === "pen") points.push(point);
  preview();
  commitShape();
  drawing = false;
  points = [];
  textValue = "";
  try { canvas.releasePointerCapture(event.pointerId); } catch { /* capture is best-effort */ }
}

function undo(): void {
  const previous = undoStack.pop();
  if (!previous) return;
  ctx.putImageData(previous, 0, 0);
  committed = previous;
  updateUndoState();
  setStatus("Undid last mark");
}

function clearAll(): void {
  if (!baseImage || !committed) return;
  pushUndo(committed);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(baseImage, 0, 0);
  committed = ctx.getImageData(0, 0, canvas.width, canvas.height);
  updateUndoState();
  setStatus("Cleared annotations");
}

async function closeSoon(delay = 2000): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, delay));
  try {
    const tab = await chrome.tabs.getCurrent();
    if (typeof tab?.id === "number") await chrome.tabs.remove(tab.id);
  } catch {
    // The tab may already be closed.
  }
}

function save(): void {
  if (!baseImage || !pending || saveBtn.disabled) return;
  saveBtn.disabled = true;
  setStatus("Saving…");
  canvas.toBlob((result) => {
    if (!result) {
      saveBtn.disabled = false;
      setStatus("Could not save the image", "error");
      return;
    }
    const url = URL.createObjectURL(result);
    const filename = safeDownloadName(pending!.filename.replace(/\.(png|jpe?g)$/i, "") + "-annotated.png");
    void chrome.downloads
      .download({ url, filename, conflictAction: "uniquify", saveAs: false })
      .then((id) => {
        const onChange = (delta: chrome.downloads.DownloadDelta): void => {
          const state = delta.state as { current?: string } | undefined;
          if (delta.id === id && state?.current === "complete") {
            chrome.downloads.onChanged.removeListener(onChange);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }
        };
        chrome.downloads.onChanged.addListener(onChange);
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        setStatus("Saved to Downloads", "done");
        void closeSoon(2000);
      })
      .catch(() => {
        URL.revokeObjectURL(url);
        saveBtn.disabled = false;
        setStatus("Could not save the image", "error");
      });
  }, "image/png");
}

function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function loadPending(): Promise<PendingImage | null> {
  const stored = await chrome.storage.session.get(PENDING_KEY);
  const raw: unknown = stored[PENDING_KEY];
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record["base64"] !== "string") return null;
  const mime = record["mime"];
  if (mime !== "image/png" && mime !== "image/jpeg") return null;
  return {
    jobId: typeof record["jobId"] === "string" ? record["jobId"] : "",
    base64: record["base64"],
    mime,
    filename: typeof record["filename"] === "string" ? record["filename"] : "spectra-capture.png",
  };
}

async function readPrefs(): Promise<Record<string, unknown>> {
  const stored = await chrome.storage.local.get("prefs");
  const prefs = stored["prefs"] as Record<string, unknown> | undefined;
  return prefs && typeof prefs === "object" ? prefs : {};
}

async function initTheme(): Promise<void> {
  let prefs: Record<string, unknown> = {};
  try { prefs = await readPrefs(); } catch { /* use defaults */ }
  if (prefs["theme"] === "dark") {
    document.documentElement.dataset.theme = "dark";
    themeToggle.setAttribute("aria-checked", "true");
    themeToggle.setAttribute("aria-label", "Switch to light theme");
  }
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const motionOn = prefs["motion"] !== false;
  document.documentElement.dataset.motion = motionOn && !reduced ? "on" : "off";
}

function drawBase(): void {
  if (!baseImage) return;
  canvas.width = baseImage.naturalWidth;
  canvas.height = baseImage.naturalHeight;
  ctx.drawImage(baseImage, 0, 0);
  committed = ctx.getImageData(0, 0, canvas.width, canvas.height);
  dims.textContent = `${canvas.width} × ${canvas.height} px`;
}

function wire(): void {
  for (const button of toolButtons) {
    button.addEventListener("click", () => {
      const value = button.dataset.tool;
      if (isTool(value)) setTool(value);
    });
  }
  for (const button of swatchButtons) {
    button.addEventListener("click", () => {
      const value = button.dataset.swatch;
      if (isSwatch(value)) setSwatch(value);
    });
  }
  strokeInput.addEventListener("input", () => {
    strokeWidth = Number(strokeInput.value);
    strokeOut.textContent = `${strokeWidth} px`;
  });
  undoBtn.addEventListener("click", undo);
  clearBtn.addEventListener("click", clearAll);
  saveBtn.addEventListener("click", save);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);

  themeToggle.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    switchTheme(() => { document.documentElement.dataset.theme = next; });
    themeToggle.setAttribute("aria-checked", String(next === "dark"));
    themeToggle.setAttribute("aria-label", next === "dark" ? "Switch to light theme" : "Switch to dark theme");
    void readPrefs()
      .then((prefs) => chrome.storage.local.set({ prefs: { ...prefs, theme: next } }))
      .catch(() => { /* theme is still applied for this session */ });
  });

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      undo();
      return;
    }
    if (event.key === "Escape") {
      setTool("select");
      return;
    }
    if (event.key === "Enter") {
      const target = event.target as HTMLElement | null;
      if (target?.closest("button, input, select, textarea")) return;
      event.preventDefault();
      save();
    }
  });

  window.addEventListener("pagehide", () => {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
  });
}

async function init(): Promise<void> {
  setTool("select");
  setSwatch("ink");
  wire();
  await initTheme();

  let image: PendingImage | null = null;
  try { image = await loadPending(); } catch { image = null; }
  if (!image) {
    dims.textContent = "No image";
    setStatus("No image to annotate", "error");
    undoBtn.disabled = true;
    clearBtn.disabled = true;
    saveBtn.disabled = true;
    return;
  }
  pending = image;

  try {
    imageUrl = URL.createObjectURL(base64ToBlob(image.base64, image.mime));
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Image decode failed"));
      img.src = imageUrl!;
    });
    baseImage = img;
    drawBase();
    updateUndoState();
    setStatus("Ready");
  } catch {
    setStatus("Could not open the image", "error");
    undoBtn.disabled = true;
    clearBtn.disabled = true;
    saveBtn.disabled = true;
  }
}

void init().catch((error: unknown) => {
  console.error("Spectra Capture: annotate page failed", error);
  setStatus("Something went wrong", "error");
});
