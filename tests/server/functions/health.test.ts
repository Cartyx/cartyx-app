import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCommand, mockConnectDB, mockIsDBConnected } = vi.hoisted(() => ({
  mockCommand: vi.fn(),
  mockConnectDB: vi.fn(),
  mockIsDBConnected: vi.fn(),
}));

vi.mock('mongoose', () => ({
  default: {
    connection: {
      get db() {
        return { admin: () => ({ command: mockCommand }) };
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

  it('propagates ping failures', async () => {
    mockCommand.mockRejectedValue(new Error('no reachable servers'));
    await expect(healthCheck()).rejects.toThrow('no reachable servers');
  });
});
