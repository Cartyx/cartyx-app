import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCommand, mockConnectDB, mockIsDBConnected, mongooseState } = vi.hoisted(() => ({
  mockCommand: vi.fn(),
  mockConnectDB: vi.fn(),
  mockIsDBConnected: vi.fn(),
  mongooseState: { db: undefined as unknown },
}));

vi.mock('mongoose', () => ({
  default: {
    connection: {
      get db() {
        return mongooseState.db;
      },
    },
  },
}));

vi.mock('~/server/db/connection', () => ({
  connectDB: mockConnectDB,
  isDBConnected: mockIsDBConnected,
}));

import { healthCheck } from '~/server/functions/health';

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDBConnected.mockReturnValue(true);
  mockCommand.mockResolvedValue({ ok: 1 });
  mongooseState.db = { admin: () => ({ command: mockCommand }) };
});

describe('healthCheck', () => {
  it('connects, pings Mongo, and reports ok', async () => {
    await expect(healthCheck()).resolves.toEqual({ ok: true });
    expect(mockConnectDB).toHaveBeenCalled();
    expect(mockCommand).toHaveBeenCalledWith({ ping: 1 });
  });

  it('throws when the DB is not connected', async () => {
    mockIsDBConnected.mockReturnValue(false);
    await expect(healthCheck()).rejects.toThrow('Database not connected');
    expect(mockCommand).not.toHaveBeenCalled();
  });

  it('tags the "not connected" error with status 503 when isDBConnected is false', async () => {
    mockIsDBConnected.mockReturnValue(false);
    await expect(healthCheck()).rejects.toMatchObject({
      status: 503,
      message: 'Database not connected',
    });
  });

  it('tags the "not connected" error with status 503 when mongoose.connection.db is undefined', async () => {
    mongooseState.db = undefined;
    await expect(healthCheck()).rejects.toMatchObject({
      status: 503,
      message: 'Database not connected',
    });
  });

  it('propagates ping failures', async () => {
    mockCommand.mockRejectedValue(new Error('no reachable servers'));
    await expect(healthCheck()).rejects.toThrow('no reachable servers');
  });
});
