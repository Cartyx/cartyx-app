import { describe, it, expect, vi, beforeEach } from 'vitest';

// happy-dom doesn't fully support Canvas API — provide minimal mocks
function setupCanvasMock(blobSize = 500 * 1024) {
  const mockCtx = { drawImage: vi.fn() };
  const mockCanvas = {
    width: 0,
    height: 0,
    getContext: vi.fn().mockReturnValue(mockCtx),
    toBlob: vi.fn((cb: (b: Blob | null) => void, _type: string, _quality: number) => {
      cb(new Blob([new Uint8Array(blobSize)], { type: 'image/webp' }));
    }),
  };
  const originalCreateElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag === 'canvas') return mockCanvas as unknown as HTMLCanvasElement;
    return originalCreateElement(tag);
  });
  return { mockCanvas, mockCtx };
}

function setupCreateImageBitmapMock(width = 800, height = 600) {
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn().mockResolvedValue({
      width,
      height,
      close: vi.fn(),
    })
  );
}

function makeFile(name: string, type: string, sizeBytes: number): File {
  return new File([new Uint8Array(sizeBytes)], name, { type });
}

describe('compressImage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns original file for GIFs without compression', async () => {
    const { compressImage } = await import('~/utils/compressImage');
    const file = makeFile('animation.gif', 'image/gif', 5 * 1024 * 1024);
    const result = await compressImage(file);
    expect(result).toBe(file);
  });

  it('returns original file for files under 1MB', async () => {
    const { compressImage } = await import('~/utils/compressImage');
    const file = makeFile('small.png', 'image/png', 500 * 1024);
    const result = await compressImage(file);
    expect(result).toBe(file);
  });

  it('returns a WebP File for PNG input over 1MB', async () => {
    setupCreateImageBitmapMock(1024, 768);
    setupCanvasMock(500 * 1024); // blob well under 2MB
    const { compressImage } = await import('~/utils/compressImage');
    const file = makeFile('photo.png', 'image/png', 2 * 1024 * 1024);
    const result = await compressImage(file);
    expect(result).not.toBe(file);
    expect(result.type).toBe('image/webp');
  });

  it('returns a WebP File for JPEG input over 1MB', async () => {
    setupCreateImageBitmapMock(1200, 900);
    setupCanvasMock(400 * 1024);
    const { compressImage } = await import('~/utils/compressImage');
    const file = makeFile('photo.jpg', 'image/jpeg', 3 * 1024 * 1024);
    const result = await compressImage(file);
    expect(result.type).toBe('image/webp');
  });

  it('changes file extension to .webp', async () => {
    setupCreateImageBitmapMock(800, 600);
    setupCanvasMock(300 * 1024);
    const { compressImage } = await import('~/utils/compressImage');
    const file = makeFile('banner.png', 'image/png', 2 * 1024 * 1024);
    const result = await compressImage(file);
    expect(result.name).toBe('banner.webp');
  });

  it('handles files with no extension in name', async () => {
    setupCreateImageBitmapMock(800, 600);
    setupCanvasMock(300 * 1024);
    const { compressImage } = await import('~/utils/compressImage');
    const file = makeFile('noextension', 'image/jpeg', 2 * 1024 * 1024);
    const result = await compressImage(file);
    expect(result.name).toBe('noextension.webp');
  });

  it('caps image dimensions to 2048px on the longest side', async () => {
    setupCreateImageBitmapMock(4096, 2048); // landscape, needs downscaling
    const { mockCanvas } = setupCanvasMock(400 * 1024);
    const { compressImage } = await import('~/utils/compressImage');
    const file = makeFile('large.jpg', 'image/jpeg', 5 * 1024 * 1024);
    await compressImage(file);
    expect(mockCanvas.width).toBe(2048);
    expect(mockCanvas.height).toBe(1024);
  });

  it('caps portrait image dimensions correctly', async () => {
    setupCreateImageBitmapMock(1000, 4000); // portrait
    const { mockCanvas } = setupCanvasMock(400 * 1024);
    const { compressImage } = await import('~/utils/compressImage');
    const file = makeFile('tall.jpg', 'image/jpeg', 5 * 1024 * 1024);
    await compressImage(file);
    expect(mockCanvas.height).toBe(2048);
    expect(mockCanvas.width).toBe(512);
  });

  it('does not upscale small images', async () => {
    setupCreateImageBitmapMock(400, 300); // already under 2048px
    const { mockCanvas } = setupCanvasMock(400 * 1024);
    const { compressImage } = await import('~/utils/compressImage');
    const file = makeFile('medium.jpg', 'image/jpeg', 2 * 1024 * 1024);
    await compressImage(file);
    expect(mockCanvas.width).toBe(400);
    expect(mockCanvas.height).toBe(300);
  });

  it('returns original file if canvas context is unavailable', async () => {
    setupCreateImageBitmapMock(800, 600);
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: vi.fn().mockReturnValue(null),
        } as unknown as HTMLCanvasElement;
      }
      return originalCreateElement(tag);
    });
    const { compressImage } = await import('~/utils/compressImage');
    const file = makeFile('photo.png', 'image/png', 2 * 1024 * 1024);
    const result = await compressImage(file);
    expect(result).toBe(file);
  });

  it('returns original file on unexpected error', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('decode failed')));
    const { compressImage } = await import('~/utils/compressImage');
    const file = makeFile('broken.jpg', 'image/jpeg', 2 * 1024 * 1024);
    const result = await compressImage(file);
    expect(result).toBe(file);
  });
});
