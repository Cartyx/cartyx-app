import pino from 'pino';
import { logLevel } from './config.js';

export const logger = pino({
  // Validated, not read raw: pino throws on an unknown level, and this module
  // is imported at process start — so a bad LOG_LEVEL would be a crash loop
  // whose cause never reaches a log line. See `logLevel` in config.ts.
  level: logLevel(),
  base: { service: 'cartyx-audio-worker' },
});
