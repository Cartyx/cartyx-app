import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { captureException } from '~/providers/TelemetryProvider';
import { compressImage } from '~/utils/compressImage';
import { uploadToR2 } from '~/utils/uploadToR2';
import { queryKeys } from '~/utils/queryKeys';
import {
  campaignInputSchema,
  updateCampaignInputSchema,
  getCampaignSchema,
  joinCampaignSchema,
} from '~/types/schemas/campaigns';

const listCampaignsFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { listCampaigns } = await import('~/server/functions/campaigns');
  return listCampaigns();
});

const getCampaignFn = createServerFn({ method: 'GET' })
  .inputValidator(getCampaignSchema)
  .handler(async ({ data }) => {
    const { getCampaign } = await import('~/server/functions/campaigns');
    return getCampaign({ data });
  });

const createCampaignFn = createServerFn({ method: 'POST' })
  .inputValidator(campaignInputSchema)
  .handler(async ({ data }) => {
    const { createCampaign } = await import('~/server/functions/campaigns');
    return createCampaign({ data });
  });

const updateCampaignFn = createServerFn({ method: 'POST' })
  .inputValidator(updateCampaignInputSchema)
  .handler(async ({ data }) => {
    const { updateCampaign } = await import('~/server/functions/campaigns');
    return updateCampaign({ data });
  });

const joinCampaignFn = createServerFn({ method: 'POST' })
  .inputValidator(joinCampaignSchema)
  .handler(async ({ data }) => {
    const { joinCampaign } = await import('~/server/functions/campaigns');
    return joinCampaign({ data });
  });

/** Max file size after compression that the server will accept (3MB decoded → ~4MB base64) */
const MAX_POST_COMPRESSION_SIZE = 3 * 1024 * 1024;

interface CreateCampaignInput {
  name: string;
  description: string;
  schedFreq?: string;
  schedDay?: string;
  schedTime?: string;
  schedTz?: string;
  links?: Array<{ name: string; url: string }>;
  maxPlayers?: number;
  imageFile?: File | null;
  loadSrdData?: boolean;
}

async function encodeImage(
  file: File
): Promise<{ imageData: string; imageMime: string; imageName: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // result is "data:image/png;base64,AAAA..."
      const base64 = result.split(',')[1]!;
      resolve({ imageData: base64, imageMime: file.type, imageName: file.name });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function buildImagePayload(imageFile: File): Promise<Record<string, string>> {
  const compressed = await compressImage(imageFile);
  try {
    // Try direct R2 upload first (production)
    const { publicUrl } = await uploadToR2(compressed);
    return { imagePath: publicUrl };
  } catch (err) {
    // Only fall back to base64 for local dev (CDN_URL not configured)
    const msg = err instanceof Error ? err.message : '';
    if (!msg.includes('CDN_URL')) {
      throw err; // Surface real upload errors in production
    }
    // Local dev fallback: base64 via server
    if (compressed.size > MAX_POST_COMPRESSION_SIZE) {
      throw new Error(
        'Image is too large even after compression. Try a smaller file or a non-GIF format.'
      );
    }
    return encodeImage(compressed);
  }
}

export function useCampaigns() {
  const queryClient = useQueryClient();
  const {
    data: campaigns = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.campaigns.list(),
    queryFn: () => listCampaignsFn(),
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.list() });
  };

  return {
    campaigns,
    isLoading,
    error: error instanceof Error ? error.message : error ? String(error) : null,
    refresh,
  };
}

export function useCampaign(id: string) {
  const {
    data: campaign = null,
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.campaigns.detail(id),
    queryFn: () => getCampaignFn({ data: { id } }),
  });
  return {
    campaign,
    isLoading,
    error: error instanceof Error ? error.message : error ? String(error) : null,
  };
}

export function useCreateCampaign() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (input: CreateCampaignInput) => {
      const imagePayload = input.imageFile ? await buildImagePayload(input.imageFile) : {};
      return createCampaignFn({
        data: {
          name: input.name,
          description: input.description,
          schedFreq: input.schedFreq,
          schedDay: input.schedDay,
          schedTime: input.schedTime,
          schedTz: input.schedTz,
          links: input.links,
          maxPlayers: input.maxPlayers,
          loadSrdData: input.loadSrdData,
          ...imagePayload,
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.list() });
    },
    onError: (e) => {
      captureException(e, { action: 'createCampaign' });
    },
  });

  const create = async (input: CreateCampaignInput) => {
    try {
      return await mutation.mutateAsync(input);
    } catch {
      return null;
    }
  };

  return {
    create,
    isLoading: mutation.isPending,
    error:
      mutation.error instanceof Error
        ? mutation.error.message
        : mutation.error
          ? String(mutation.error)
          : null,
  };
}

export function useUpdateCampaign() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async ({ id, input }: { id: string; input: CreateCampaignInput }) => {
      const imagePayload = input.imageFile ? await buildImagePayload(input.imageFile) : {};
      return updateCampaignFn({
        data: {
          id,
          name: input.name,
          description: input.description,
          schedFreq: input.schedFreq,
          schedDay: input.schedDay,
          schedTime: input.schedTime,
          schedTz: input.schedTz,
          links: input.links,
          maxPlayers: input.maxPlayers,
          ...imagePayload,
        },
      });
    },
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.list() });
      queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.detail(id) });
    },
    onError: (e, { id }) => {
      captureException(e, { action: 'updateCampaign', campaignId: id });
    },
  });

  const update = async (id: string, input: CreateCampaignInput) => {
    try {
      return await mutation.mutateAsync({ id, input });
    } catch {
      return null;
    }
  };

  return {
    update,
    isLoading: mutation.isPending,
    error:
      mutation.error instanceof Error
        ? mutation.error.message
        : mutation.error
          ? String(mutation.error)
          : null,
  };
}

export function useJoinCampaign() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (inviteCode: string) => joinCampaignFn({ data: { inviteCode } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.list() });
    },
    onError: (e) => {
      captureException(e, { action: 'joinCampaign' });
    },
  });

  const join = async (inviteCode: string) => {
    try {
      return await mutation.mutateAsync(inviteCode);
    } catch {
      return null;
    }
  };

  return {
    join,
    isLoading: mutation.isPending,
    error:
      mutation.error instanceof Error
        ? mutation.error.message
        : mutation.error
          ? String(mutation.error)
          : null,
  };
}
