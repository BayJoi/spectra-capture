/** Aspect ratios offered in the popup. "free" means the width and height are independent. */
export const FREE = "free";

export const RATIOS = [
  { id: "21:9", w: 21, h: 9 },
  { id: "16:9", w: 16, h: 9 },
  { id: "16:10", w: 16, h: 10 },
  { id: "3:2", w: 3, h: 2 },
  { id: "4:3", w: 4, h: 3 },
  { id: "5:4", w: 5, h: 4 },
  { id: "1:1", w: 1, h: 1 },
  { id: "4:5", w: 4, h: 5 },
  { id: "9:16", w: 9, h: 16 },
] as const;

export type RatioId = typeof FREE | (typeof RATIOS)[number]["id"];

export function isRatioId(value: unknown): value is RatioId {
  return value === FREE || RATIOS.some((r) => r.id === value);
}

function ratioParts(id: RatioId): { w: number; h: number } | null {
  return RATIOS.find((r) => r.id === id) ?? null;
}

/** The height that keeps the ratio for this width. Null when the ratio is free. */
export function heightFor(width: number, id: RatioId): number | null {
  const parts = ratioParts(id);
  return parts ? Math.round((width * parts.h) / parts.w) : null;
}

/** The width that keeps the ratio for this height. Null when the ratio is free. */
export function widthFor(height: number, id: RatioId): number | null {
  const parts = ratioParts(id);
  return parts ? Math.round((height * parts.w) / parts.h) : null;
}

/** The ratio this exact size matches, or "free" when none does. */
export function ratioOfSize(width: number, height: number): RatioId {
  return RATIOS.find((r) => width * r.h === height * r.w)?.id ?? FREE;
}
