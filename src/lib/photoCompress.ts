import { MAX_PHOTO_BYTES } from '../types/plant';

function dataUrlByteSize(dataUrl: string): number {
  const base64 = dataUrl.split(',')[1] || '';
  return Math.ceil((base64.length * 3) / 4);
}

function loadImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('File gambar tidak dapat dibaca.'));
    };
    img.src = objectUrl;
  });
}

/**
 * Compresses any uploaded or camera-captured plant/conservation photo
 * strictly under 150 KB so IndexedDB and PostgreSQL remain lightweight.
 */
export async function compressImageToMax150KB(
  file: File
): Promise<{ dataUrl: string; byteSize: number }> {
  if (!file.type.startsWith('image/')) {
    throw new Error('File lampiran harus berupa foto/gambar.');
  }

  const img = await loadImageElement(file);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Browser tidak mendukung pemrosesan kanvas gambar.');
  }

  const dimensionSteps = [1024, 800, 640, 480, 360];
  const qualitySteps = [0.78, 0.65, 0.52, 0.4, 0.3];

  for (const maxDim of dimensionSteps) {
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const targetW = Math.max(120, Math.round(img.width * scale));
    const targetH = Math.max(120, Math.round(img.height * scale));
    canvas.width = targetW;
    canvas.height = targetH;
    ctx.clearRect(0, 0, targetW, targetH);
    ctx.drawImage(img, 0, 0, targetW, targetH);

    for (const q of qualitySteps) {
      const jpegUrl = canvas.toDataURL('image/jpeg', q);
      const size = dataUrlByteSize(jpegUrl);
      if (size <= MAX_PHOTO_BYTES) {
        return { dataUrl: jpegUrl, byteSize: size };
      }
    }
  }

  throw new Error(
    'Ukuran foto masih terlalu besar setelah kompresi. Gunakan foto dengan pencahayaan lebih sederhana.'
  );
}
