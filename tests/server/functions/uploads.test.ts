import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { MockS3Client, MockPutObjectCommand, mockGetSignedUrl } = vi.hoisted(() => {
  function MockS3Client(this: unknown, ...args: unknown[]) {
    (MockS3Client as unknown as { lastArgs: unknown[] }).lastArgs = args;
  }
  function MockPutObjectCommand(this: unknown, ...args: unknown[]) {
    Object.assign(this as object, args[0] as object);
    (MockPutObjectCommand as unknown as { lastArgs: unknown[] }).lastArgs = args;
  }
  const mockGetSignedUrl = vi.fn();
  return { MockS3Client, MockPutObjectCommand, mockGetSignedUrl };
});

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    inputValidator: () => ({
      handler: (fn: unknown) => fn,
    }),
    handler: (fn: unknown) => fn,
  }),
}));

vi.mock('~/server/session', () => ({ getSession: vi.fn() }));
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: MockS3Client,
  PutObjectCommand: MockPutObjectCommand,
}));
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => mockGetSignedUrl(...args),
}));

import { getSession } from '~/server/session';
import { getUploadUrl } from '~/server/functions/uploads';

const mockSession = {
  id: 'session-user-1',
  provider: 'google',
  name: 'Test User',
  email: 'test@example.com',
  avatar: null,
  role: 'gm',
  accessToken: null,
  refreshToken: null,
  tokenIssuedAt: 0,
};

const _getUploadUrl = getUploadUrl as unknown as (args: {
  data: { contentType: string; subdir?: string };
}) => Promise<{ uploadUrl: string; imageKey: string; publicUrl: string }>;

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(mockSession);
  mockGetSignedUrl.mockResolvedValue('https://bucket.r2.cloudflarestorage.com/presigned-url');
  process.env.CDN_URL = 'https://cdn.example.com';
  process.env.R2_ACCOUNT_ID = 'test-account-id';
  process.env.R2_ACCESS_KEY_ID = 'test-access-key';
  process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
  process.env.R2_BUCKET = 'test-bucket';
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('getUploadUrl', () => {
  it('throws when not authenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(null);

    await expect(
      _getUploadUrl({ data: { contentType: 'image/webp', subdir: 'uploads/campaigns' } })
    ).rejects.toThrow('Not authenticated');
  });

  it('throws for invalid content type', async () => {
    await expect(
      _getUploadUrl({ data: { contentType: 'image/svg+xml', subdir: 'uploads/campaigns' } })
    ).rejects.toThrow('Only PNG, JPEG, GIF, and WebP images are allowed');
  });

  it('throws when CDN_URL is not set', async () => {
    delete process.env.CDN_URL;

    await expect(
      _getUploadUrl({ data: { contentType: 'image/webp', subdir: 'uploads/campaigns' } })
    ).rejects.toThrow('Direct uploads require CDN_URL configuration');
  });

  it('throws when R2 configuration is incomplete', async () => {
    delete process.env.R2_ACCOUNT_ID;

    await expect(
      _getUploadUrl({ data: { contentType: 'image/webp', subdir: 'uploads/campaigns' } })
    ).rejects.toThrow('R2 configuration incomplete');
  });

  it('returns uploadUrl, imageKey, and publicUrl', async () => {
    const result = await _getUploadUrl({
      data: { contentType: 'image/webp', subdir: 'uploads/campaigns' },
    });

    expect(result).toHaveProperty('uploadUrl');
    expect(result).toHaveProperty('imageKey');
    expect(result).toHaveProperty('publicUrl');
    expect(result.uploadUrl).toBe('https://bucket.r2.cloudflarestorage.com/presigned-url');
  });

  it('imageKey matches expected pattern', async () => {
    const result = await _getUploadUrl({
      data: { contentType: 'image/webp', subdir: 'uploads/campaigns' },
    });

    expect(result.imageKey).toMatch(/^uploads\/campaigns\/\d+-[a-f0-9]+\.webp$/);
  });

  it('publicUrl is CDN_URL + "/" + imageKey', async () => {
    const result = await _getUploadUrl({
      data: { contentType: 'image/png', subdir: 'uploads/campaigns' },
    });

    expect(result.publicUrl).toBe(`https://cdn.example.com/${result.imageKey}`);
  });

  it('strips trailing slash from CDN_URL in publicUrl', async () => {
    process.env.CDN_URL = 'https://cdn.example.com/';
    const result = await _getUploadUrl({
      data: { contentType: 'image/png', subdir: 'uploads/campaigns' },
    });

    // No double slash after the domain
    expect(result.publicUrl.replace('https://', '')).not.toContain('//');
  });

  it('accepts all allowed content types', async () => {
    for (const type of ['image/webp', 'image/png', 'image/jpeg', 'image/gif']) {
      const result = await _getUploadUrl({
        data: { contentType: type, subdir: 'uploads/campaigns' },
      });
      expect(result).toHaveProperty('uploadUrl');
    }
  });

  it('uses provided subdir in imageKey', async () => {
    const result = await _getUploadUrl({
      data: { contentType: 'image/webp', subdir: 'uploads/avatars' },
    });

    expect(result.imageKey).toMatch(/^uploads\/avatars\//);
  });

  it('constructs S3Client with correct R2 endpoint', async () => {
    await _getUploadUrl({ data: { contentType: 'image/webp', subdir: 'uploads/campaigns' } });

    const constructorArg = (MockS3Client as unknown as { lastArgs: unknown[] })
      .lastArgs[0] as Record<string, unknown>;
    expect(constructorArg.endpoint).toBe('https://test-account-id.r2.cloudflarestorage.com');
    expect((constructorArg.credentials as Record<string, string>).accessKeyId).toBe(
      'test-access-key'
    );
  });

  it('calls getSignedUrl with 300-second expiry', async () => {
    await _getUploadUrl({ data: { contentType: 'image/webp', subdir: 'uploads/campaigns' } });

    expect(mockGetSignedUrl).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      expiresIn: 300,
    });
  });
});
