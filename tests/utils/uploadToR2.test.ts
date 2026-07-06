import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockIsBackendDown, mockCaptureException, mockGetUploadUrl } = vi.hoisted(() => ({
  mockIsBackendDown: vi.fn(() => false),
  mockCaptureException: vi.fn(),
  mockGetUploadUrl: vi.fn(),
}));

vi.mock('~/utils/backend-health', () => ({ isBackendDown: mockIsBackendDown }));
vi.mock('~/providers/PostHogProvider', () => ({ captureException: mockCaptureException }));
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    inputValidator: () => ({ handler: () => mockGetUploadUrl }),
  }),
}));

import { uploadToR2 } from '~/utils/uploadToR2';
import { BackendUnavailableError } from '~/utils/error-classification';

const file = new File(['content'], 'map.png', { type: 'image/png' });

beforeEach(() => {
  vi.clearAllMocks();
  mockIsBackendDown.mockReturnValue(false);
});

describe('uploadToR2 breaker guard', () => {
  it('fails fast with BackendUnavailableError while the breaker is open, without calling the server or PostHog', async () => {
    mockIsBackendDown.mockReturnValue(true);
    await expect(uploadToR2(file)).rejects.toBeInstanceOf(BackendUnavailableError);
    expect(mockGetUploadUrl).not.toHaveBeenCalled();
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it('proceeds normally when the backend is healthy', async () => {
    mockGetUploadUrl.mockResolvedValue({
      uploadUrl: 'https://r2.example/put',
      imageKey: 'k',
      publicUrl: 'https://cdn.example/k',
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));
    await expect(uploadToR2(file)).resolves.toEqual({
      imageKey: 'k',
      publicUrl: 'https://cdn.example/k',
    });
    fetchSpy.mockRestore();
  });
});
