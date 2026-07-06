import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

const mongooseMock = vi.hoisted(() => ({
  connect: vi.fn().mockResolvedValue(undefined),
  connection: { readyState: 0 },
  models: {},
}));

const bootstrapMock = vi.hoisted(() => ({
  bootstrapDB: vi.fn().mockResolvedValue(undefined),
  isBootstrapped: vi.fn().mockReturnValue(false),
}));

const policyMock = vi.hoisted(() => ({
  getBootstrapPolicy: vi.fn().mockReturnValue({
    environment: 'development',
    syncIndexes: true,
    verifyCriticalIndexes: false,
    failOnCriticalDrift: false,
    autoIndex: true,
    timeoutMs: 30_000,
  }),
}));

vi.mock('mongoose', () => ({ default: mongooseMock }));
vi.mock('~/server/db/bootstrap', () => bootstrapMock);
vi.mock('~/server/db/policy', () => policyMock);
vi.mock('~/server/utils/posthog', () => ({
  serverCaptureException: vi.fn(),
}));

import { connectDB, isDBConnected, __resetConnectPromiseForTests } from '~/server/db/connection';

const originalMongoUri = process.env.MONGODB_URI;

describe('connectDB', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetConnectPromiseForTests();
    mongooseMock.connect.mockResolvedValue(undefined);
    mongooseMock.connection.readyState = 0;
    bootstrapMock.isBootstrapped.mockReturnValue(false);
    bootstrapMock.bootstrapDB.mockResolvedValue(undefined);
    policyMock.getBootstrapPolicy.mockReturnValue({
      environment: 'development',
      syncIndexes: true,
      verifyCriticalIndexes: false,
      failOnCriticalDrift: false,
      autoIndex: true,
      timeoutMs: 30_000,
    });
    process.env.MONGODB_URI = 'mongodb://localhost/test';
  });

  afterAll(() => {
    if (originalMongoUri === undefined) {
      delete process.env.MONGODB_URI;
    } else {
      process.env.MONGODB_URI = originalMongoUri;
    }
  });

  it('connects and bootstraps on first call', async () => {
    await connectDB();

    expect(mongooseMock.connect).toHaveBeenCalledWith('mongodb://localhost/test', {
      autoIndex: true,
    });
    expect(bootstrapMock.bootstrapDB).toHaveBeenCalledTimes(1);
  });

  it('uses autoIndex from the resolved policy', async () => {
    policyMock.getBootstrapPolicy.mockReturnValue({
      environment: 'production',
      syncIndexes: false,
      verifyCriticalIndexes: true,
      failOnCriticalDrift: true,
      autoIndex: false,
      timeoutMs: 10_000,
    });

    await connectDB();

    expect(mongooseMock.connect).toHaveBeenCalledWith('mongodb://localhost/test', {
      autoIndex: false,
    });
  });

  it('passes the resolved policy to bootstrapDB', async () => {
    const policy = {
      environment: 'staging' as const,
      syncIndexes: false,
      verifyCriticalIndexes: true,
      failOnCriticalDrift: false,
      autoIndex: false,
      timeoutMs: 15_000,
    };
    policyMock.getBootstrapPolicy.mockReturnValue(policy);

    await connectDB();

    expect(bootstrapMock.bootstrapDB).toHaveBeenCalledWith(policy);
  });

  it('skips connect but retries bootstrap when already connected and bootstrap failed', async () => {
    mongooseMock.connection.readyState = 1;
    bootstrapMock.isBootstrapped.mockReturnValue(false);

    await connectDB();

    expect(mongooseMock.connect).not.toHaveBeenCalled();
    expect(bootstrapMock.bootstrapDB).toHaveBeenCalledTimes(1);
  });

  it('skips both connect and bootstrap when already connected and bootstrapped', async () => {
    mongooseMock.connection.readyState = 1;
    bootstrapMock.isBootstrapped.mockReturnValue(true);

    await connectDB();

    expect(mongooseMock.connect).not.toHaveBeenCalled();
    expect(bootstrapMock.bootstrapDB).not.toHaveBeenCalled();
  });

  it('returns early when MONGODB_URI is not set', async () => {
    delete process.env.MONGODB_URI;

    await connectDB();

    expect(mongooseMock.connect).not.toHaveBeenCalled();
    expect(bootstrapMock.bootstrapDB).not.toHaveBeenCalled();
  });

  it('waits for in-flight connection when readyState is 2 (connecting)', async () => {
    let resolveConnect!: () => void;
    mongooseMock.connect.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          mongooseMock.connection.readyState = 2;
          resolveConnect = () => {
            mongooseMock.connection.readyState = 1;
            resolve();
          };
        })
    );

    const first = connectDB();
    const second = connectDB();

    resolveConnect();
    await Promise.all([first, second]);

    expect(mongooseMock.connect).toHaveBeenCalledTimes(1);
    expect(bootstrapMock.bootstrapDB).toHaveBeenCalled();
  });

  it('shares one connect attempt when two callers race before readyState flips', async () => {
    let resolveConnect!: () => void;
    mongooseMock.connect.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveConnect = () => {
            mongooseMock.connection.readyState = 1;
            resolve();
          };
        })
    );

    const first = connectDB();
    const second = connectDB();

    resolveConnect();
    await Promise.all([first, second]);

    expect(mongooseMock.connect).toHaveBeenCalledTimes(1);
    expect(bootstrapMock.bootstrapDB).toHaveBeenCalled();
  });

  it('rethrows errors from bootstrap', async () => {
    bootstrapMock.bootstrapDB.mockRejectedValueOnce(new Error('bootstrap failed'));

    await expect(connectDB()).rejects.toThrow('bootstrap failed');
  });

  it('tags a rethrown connect error with status 503 when it has no own status', async () => {
    mongooseMock.connect.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

    await expect(connectDB()).rejects.toMatchObject({ status: 503 });
  });

  it('does not overwrite an existing status on the rethrown error', async () => {
    const err = Object.assign(new Error('boom'), { status: 401 });
    mongooseMock.connect.mockRejectedValueOnce(err);

    await expect(connectDB()).rejects.toMatchObject({ status: 401 });
  });
});

describe('isDBConnected', () => {
  it('returns true when readyState is 1', () => {
    mongooseMock.connection.readyState = 1;
    expect(isDBConnected()).toBe(true);
  });

  it('returns false when readyState is 0', () => {
    mongooseMock.connection.readyState = 0;
    expect(isDBConnected()).toBe(false);
  });
});
