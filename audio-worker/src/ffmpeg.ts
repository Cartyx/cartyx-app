import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Canonical loudness target, matching the ttrpg-sfx POC's normalize.sh: all
 * generated and hand-uploaded audio lands at the same perceived level, so
 * phase 2 never needs per-asset gain-riding.
 */
export const LOUDNORM = 'loudnorm=I=-20:TP=-1.5:LRA=11';

export type ProbeResult = { durationMs: number; sampleRate: number; channels: number };

/**
 * Duration MUST come from here, not from a decoded AudioBuffer: AAC carries
 * encoder delay/padding, so `AudioBuffer.duration` overshoots the real
 * content length. Phase 2's soundboard uses durationMs to gapless-loop
 * ambience tracks (`loopEnd = durationMs / 1000`); a value sourced from a
 * decoded buffer instead of ffprobe would tick on every repeat on Safari —
 * exactly the browser the AAC rendition exists to serve. Always probe the
 * source (or, in tests, a rendition) directly with ffprobe.
 */
export async function probe(path: string): Promise<ProbeResult> {
  const { stdout } = await run('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'a:0',
    '-show_entries',
    'stream=sample_rate,channels:format=duration',
    '-of',
    'json',
    path,
  ]);
  const parsed = JSON.parse(stdout) as {
    streams?: { sample_rate?: string; channels?: number }[];
    format?: { duration?: string };
  };
  const stream = parsed.streams?.[0] ?? {};
  return {
    durationMs: Math.round(Number(parsed.format?.duration ?? 0) * 1000),
    sampleRate: Number(stream.sample_rate ?? 0),
    channels: Number(stream.channels ?? 0),
  };
}

export type Codec = 'opus' | 'aac';

/**
 * Opus (libopus, Ogg) covers Chrome/Firefox at small file sizes; AAC (M4A,
 * AudioToolbox/native aac encoder) covers Safari/iOS. The client picks a
 * rendition via `canPlayType`, and players are on browsers we don't control —
 * emitting only one codec is not a size optimization, it's a broken player
 * for half the table. Callers must always produce both.
 */
export async function transcode(src: string, out: string, codec: Codec): Promise<void> {
  const args =
    codec === 'opus'
      ? ['-c:a', 'libopus', '-b:a', '96k']
      : ['-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart'];

  await run('ffmpeg', ['-v', 'error', '-i', src, '-af', LOUDNORM, ...args, '-y', out]);
}
