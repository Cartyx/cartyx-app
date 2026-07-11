import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockIsBackendDown, mockGetUploadUrl, mockReportBackendFailure } = vi.hoisted(() => ({
  mockIsBackendDown: vi.fn(() => false),
  mockGetUploadUrl: vi.fn(),
  mockReportBackendFailure: vi.fn(),
}));

vi.mock('~/utils/backend-health', () => ({
  isBackendDown: mockIsBackendDown,
  reportBackendFailure: mockReportBackendFailure,
}));
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
  it('fails fast with BackendUnavailableError while the breaker is open, without calling the server', async () => {
    mockIsBackendDown.mockReturnValue(true);
    await expect(uploadToR2(file)).rejects.toBeInstanceOf(BackendUnavailableError);
    expect(mockGetUploadUrl).not.toHaveBeenCalled();
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

  it('reports the failure to the circuit breaker', async () => {
    const error = new TypeError('Failed to fetch');
    mockGetUploadUrl.mockRejectedValue(error);

    await expect(uploadToR2(file)).rejects.toBe(error);

    expect(mockReportBackendFailure).toHaveBeenCalledWith(error);
  });
});
