import { createServerFn } from '@tanstack/react-start';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { captureException } from '~/providers/TelemetryProvider';
import { queryKeys } from '~/utils/queryKeys';
import {
  scanOrphanImagesSchema,
  deleteOrphanImagesSchema,
  type DeleteOrphanImagesResult,
  type ScanOrphanImagesResult,
} from '~/types/schemas/cleanup';

// ---------------------------------------------------------------------------
// Server function wrappers — dynamic imports keep Mongoose server-only.
// ---------------------------------------------------------------------------

const scanOrphanImagesFn = createServerFn({ method: 'GET' })
  .inputValidator(scanOrphanImagesSchema)
  .handler(async ({ data }) => {
    const { scanOrphanImages } = await import('~/server/functions/cleanup');
    return scanOrphanImages({ data });
  });

const deleteOrphanImagesFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteOrphanImagesSchema)
  .handler(async ({ data }) => {
    const { deleteOrphanImages } = await import('~/server/functions/cleanup');
    return deleteOrphanImages({ data });
  });

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Scan R2 for objects under tracked upload prefixes that aren't referenced by
 * any document in the system. Disabled by default — callers opt in via
 * `enabled` so a Settings panel mount doesn't kick off the scan automatically.
 */
export function useScanOrphanImages(campaignId: string, enabled: boolean) {
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: queryKeys.cleanup.orphanImages(campaignId),
    queryFn: () => scanOrphanImagesFn({ data: { campaignId } }),
    enabled: enabled && !!campaignId,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  return {
    result: data ?? null,
    isLoading,
    isFetching,
    error: error instanceof Error ? error.message : error ? String(error) : null,
    refetch,
  };
}

export function useDeleteOrphanImages() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (input: { campaignId: string; imageKeys: string[] }) =>
      deleteOrphanImagesFn({ data: input }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.cleanup.orphanImages(variables.campaignId),
      });
    },
    onError: (e, variables) => {
      captureException(e, { action: 'deleteOrphanImages', campaignId: variables.campaignId });
    },
  });

  const deleteOrphans = async (input: {
    campaignId: string;
    imageKeys: string[];
  }): Promise<DeleteOrphanImagesResult | null> => {
    try {
      return await mutation.mutateAsync(input);
    } catch {
      return null;
    }
  };

  return { deleteOrphans, isLoading: mutation.isPending };
}

export type { ScanOrphanImagesResult, DeleteOrphanImagesResult };
