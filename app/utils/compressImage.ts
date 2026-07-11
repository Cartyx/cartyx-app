import { captureException } from '~/providers/TelemetryProvider';

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024; // 2MB
const MAX_DIMENSION = 2048;
const QUALITY_STEPS = [0.85, 0.7, 0.5];

/**
 * Compresses an image file to WebP format using the browser Canvas API.
 * - Skips GIFs (would lose animation) and files already under 1MB.
 * - Caps dimensions to MAX_DIMENSION px on the longest side.
 * - Steps down WebP quality until output is under 2MB.
 * Returns the original file unchanged if compression is skipped or fails.
 */
export async function compressImage(file: File): Promise<File> {
  // Skip GIFs (animation would be lost) and small files
  if (file.type === 'image/gif' || file.size < 1 * 1024 * 1024) {
    return file;
  }

  try {
    const bitmap = await createImageBitmap(file);
    try {
      const { width, height } = scaleDimensions(bitmap.width, bitmap.height, MAX_DIMENSION);

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return file;
      ctx.drawImage(bitmap, 0, 0, width, height);

      for (const quality of QUALITY_STEPS) {
        const blob = await canvasToBlob(canvas, 'image/webp', quality);
        if (blob && blob.size <= MAX_OUTPUT_BYTES) {
          const webpName = file.name.replace(/\.[^.]+$/, '') + '.webp';
          return new File([blob], webpName, { type: 'image/webp' });
        }
      }

      // Compression couldn't hit target size — return original and log
      captureException(new Error('Image compression could not reduce below target size'), {
        action: 'compressImage',
        fileName: file.name,
        originalSize: file.size,
      });
      return file;
    } finally {
      bitmap.close();
    }
  } catch (e) {
    captureException(e, { action: 'compressImage', fileName: file.name });
    return file;
  }
}

function scaleDimensions(w: number, h: number, max: number): { width: number; height: number } {
  if (w <= max && h <= max) return { width: w, height: h };
  if (w >= h) {
    return { width: max, height: Math.max(1, Math.round((h / w) * max)) };
  }
  return { width: Math.max(1, Math.round((w / h) * max)), height: max };
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}
