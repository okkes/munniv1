/**
 * Client-side image downscaling for profile pictures and space images.
 * Local-first: the original file never leaves the device — only the
 * tiny (≤ maxPx, JPEG) data URL is stored and synced, so avatars ride
 * along in existing sync fields instead of needing a blob store.
 */

/** largest dimensions that fit `w × h` inside a `max` square, keeping ratio */
export function fitWithin(w: number, h: number, max: number): { width: number; height: number } {
  if (w <= max && h <= max) return { width: w, height: h };
  const scale = Math.min(max / w, max / h);
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

export const isDataImage = (value: string | null | undefined): boolean => !!value?.startsWith('data:image/');

export async function downscaleImage(file: Blob, maxPx = 256, quality = 0.82): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, maxPx);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable');
    ctx.drawImage(bitmap, 0, 0, width, height);
    // JPEG: photos compress far better than PNG at avatar sizes
    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    bitmap.close();
  }
}
