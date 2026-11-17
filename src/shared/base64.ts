/** Returns a prefix whose length is a multiple of 4, so it decodes on its own. */
export function base64Prefix(data: string, chars: number): string {
  const n = Math.min(data.length, chars);
  return data.slice(0, n - (n % 4));
}

/** Decodes standard base64 into bytes. Throws if the input is not valid base64. */
export function decodeBase64(data: string): Uint8Array<ArrayBuffer> {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Cheap structural check. It does not decode the whole payload. */
export function looksLikeBase64(data: string): boolean {
  return data.length >= 64 && data.length % 4 === 0;
}

/** Encodes bytes to base64 without overflowing the call stack on large images. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Decodes a data URL into a Blob. Works in a service worker (no DOM needed). */
export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("bad data url");
  const base64 = dataUrl.slice(comma + 1);
  const bytes = decodeBase64(base64);
  return new Blob([bytes as BlobPart], { type: "image/png" });
}

