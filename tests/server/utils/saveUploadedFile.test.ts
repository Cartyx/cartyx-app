import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockSend, MockS3Client, MockPutObjectCommand, mockMkdir, mockWriteFile } = vi.hoisted(
  () => {
    const mockSend = vi.fn();
    function MockS3Client(this: unknown, ...args: unknown[]) {
      (this as { send: typeof mockSend }).send = mockSend;
      (MockS3Client as unknown as { lastArgs: unknown[] }).lastArgs = args;
    }
    function MockPutObjectCommand(this: unknown, ...args: unknown[]) {
      Object.assign(this as object, args[0] as object);
      (MockPutObjectCommand as unknown as { lastArgs: unknown[] }).lastArgs = args;
    }
    const mockMkdir = vi.fn();
    const mockWriteFile = vi.fn();
    return { mockSend, MockS3Client, MockPutObjectCommand, mockMkdir, mockWriteFile };
  }
);

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: MockS3Client,
  PutObjectCommand: MockPutObjectCommand,
}));

vi.mock('node:fs/promises', () => ({
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
}));

function makeFile(type: string, sizeBytes: number): File {
  const content = new Uint8Array(sizeBytes);
  return new File([content], 'test-image', { type });
}

describe('saveUploadedFile', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
    vi.mocked(mockMkdir).mockReset();
    vi.mocked(mockWriteFile).mockReset();
    mockSend.mockResolvedValue({});
    vi.mocked(mockMkdir).mockResolvedValue(undefined);
    vi.mocked(mockWriteFile).mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('rejects unsupported file types', async () => {
    const { saveUploadedFile } = await import('~/server/utils/helpers');
    const file = makeFile('image/svg+xml', 100);
    await expect(saveUploadedFile(file, 'uploads')).rejects.toThrow(
      'Only PNG, JPEG, GIF, and WebP images are allowed'
    );
  });

  it('rejects files over 3MB', async () => {
    const { saveUploadedFile } = await import('~/server/utils/helpers');
    const file = makeFile('image/png', 3 * 1024 * 1024 + 1);
    await expect(saveUploadedFile(file, 'uploads')).rejects.toThrow('Image must be under 3MB');
  });

  describe('when CDN_URL is set', () => {
    beforeEach(() => {
      process.env.CDN_URL = 'https://cdn.example.com';
      process.env.R2_ACCOUNT_ID = 'test-account-id';
      process.env.R2_ACCESS_KEY_ID = 'test-access-key';
      process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
      process.env.R2_BUCKET = 'test-bucket';
    });

    it('calls S3Client with correct endpoint', async () => {
      const { saveUploadedFile } = await import('~/server/utils/helpers');
      const file = makeFile('image/png', 100);
      await saveUploadedFile(file, 'uploads');

      const constructorArg = (MockS3Client as unknown as { lastArgs: unknown[] })
        .lastArgs[0] as Record<string, unknown>;
      expect(constructorArg.endpoint).toBe('https://test-account-id.r2.cloudflarestorage.com');
      expect((constructorArg.credentials as Record<string, string>).accessKeyId).toBe(
        'test-access-key'
      );
      expect((constructorArg.credentials as Record<string, string>).secretAccessKey).toBe(
        'test-secret'
      );
    });

    it('calls PutObjectCommand with correct bucket and content type', async () => {
      const { saveUploadedFile } = await import('~/server/utils/helpers');
      const file = makeFile('image/jpeg', 100);
      await saveUploadedFile(file, 'uploads');

      const cmdArg = (MockPutObjectCommand as unknown as { lastArgs: unknown[] })
        .lastArgs[0] as Record<string, unknown>;
      expect(cmdArg.Bucket).toBe('test-bucket');
      expect(cmdArg.ContentType).toBe('image/jpeg');
      expect(cmdArg.Key).toMatch(/^uploads\/.+\.jpg$/);
    });

    it('returns CDN_URL-based path', async () => {
      const { saveUploadedFile } = await import('~/server/utils/helpers');
      const file = makeFile('image/webp', 100);
      const result = await saveUploadedFile(file, 'uploads');

      expect(result).toMatch(/^https:\/\/cdn\.example\.com\/uploads\/.+\.webp$/);
    });

    it('does not write to local filesystem', async () => {
      const { saveUploadedFile } = await import('~/server/utils/helpers');
      const file = makeFile('image/png', 100);
      await saveUploadedFile(file, 'uploads');

      expect(mockMkdir).not.toHaveBeenCalled();
      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it('strips trailing slash from CDN_URL', async () => {
      process.env.CDN_URL = 'https://cdn.example.com/';
      const { saveUploadedFile } = await import('~/server/utils/helpers');
      const file = makeFile('image/png', 100);
      const result = await saveUploadedFile(file, 'uploads');

      expect(result).toMatch(/^https:\/\/cdn\.example\.com\/uploads\//);
      // Ensure no double slashes after the protocol
      expect(result.replace('https://', '')).not.toContain('//');
    });

    it('throws when R2 env vars are missing', async () => {
      delete process.env.R2_ACCOUNT_ID;
      const { saveUploadedFile } = await import('~/server/utils/helpers');
      const file = makeFile('image/png', 100);
      await expect(saveUploadedFile(file, 'uploads')).rejects.toThrow(
        'R2 configuration incomplete'
      );
    });
  });

  describe('when CDN_URL is not set (local fallback)', () => {
    beforeEach(() => {
      delete process.env.CDN_URL;
      process.env.APP_ENV = 'development';
      process.env.NODE_ENV = 'test';
    });

    it('writes file to local filesystem', async () => {
      const { saveUploadedFile } = await import('~/server/utils/helpers');
      const file = makeFile('image/png', 100);
      await saveUploadedFile(file, 'uploads');

      expect(mockMkdir).toHaveBeenCalled();
      expect(mockWriteFile).toHaveBeenCalled();
    });

    it('returns a local /subdir/filename path', async () => {
      const { saveUploadedFile } = await import('~/server/utils/helpers');
      const file = makeFile('image/gif', 100);
      const result = await saveUploadedFile(file, 'uploads');

      expect(result).toMatch(/^\/uploads\/.+\.gif$/);
    });

    it('does not call S3Client', async () => {
      const { saveUploadedFile } = await import('~/server/utils/helpers');
      const file = makeFile('image/png', 100);
      await saveUploadedFile(file, 'uploads');

      expect(mockSend).not.toHaveBeenCalled();
    });

    it('throws in production without CDN_URL', async () => {
      process.env.APP_ENV = 'production';
      const { saveUploadedFile } = await import('~/server/utils/helpers');
      const file = makeFile('image/png', 100);
      await expect(saveUploadedFile(file, 'uploads')).rejects.toThrow(
        'CDN_URL environment variable is required for image uploads in production'
      );
    });

    it('throws in staging without CDN_URL', async () => {
      process.env.APP_ENV = 'staging';
      const { saveUploadedFile } = await import('~/server/utils/helpers');
      const file = makeFile('image/png', 100);
      await expect(saveUploadedFile(file, 'uploads')).rejects.toThrow(
        'CDN_URL environment variable is required for image uploads in production'
      );
    });
  });
});
