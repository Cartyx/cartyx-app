import { z } from 'zod';

// ---------------------------------------------------------------------------
// Orphan image cleanup
// ---------------------------------------------------------------------------

export const scanOrphanImagesSchema = z.object({
  campaignId: z.string().trim().min(1),
});

export const deleteOrphanImagesSchema = z.object({
  campaignId: z.string().trim().min(1),
  imageKeys: z.array(z.string().trim().min(1)).min(1).max(500),
});

export interface OrphanImage {
  imageKey: string;
  sizeBytes: number;
  lastModified: string | null;
}

export interface ScanOrphanImagesResult {
  orphans: OrphanImage[];
  /** Number of R2 keys we inspected under tracked prefixes. */
  scannedKeyCount: number;
  /** Number of in-use keys we found across all campaigns/collections. */
  inUseKeyCount: number;
  /** True if the R2 client isn't configured (orphans will always be empty). */
  r2Disabled: boolean;
}

export interface DeleteOrphanImagesResult {
  deleted: string[];
  failed: Array<{ imageKey: string; error: string }>;
}
