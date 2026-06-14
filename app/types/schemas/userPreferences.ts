import { z } from 'zod';

/** Default measurement (ruler) line color when a user hasn't chosen one. */
export const DEFAULT_RULER_COLOR = '#fbbf24';

/** A full 6-digit hex color, e.g. `#fbbf24`. */
export const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a 6-digit hex value like #fbbf24');

export const setRulerColorSchema = z.object({
  rulerColor: hexColorSchema,
});

export type SetRulerColorInput = z.infer<typeof setRulerColorSchema>;

export interface UserPreferences {
  rulerColor: string;
}
