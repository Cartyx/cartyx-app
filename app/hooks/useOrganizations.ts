import { createServerFn } from '@tanstack/react-start';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  OrganizationData,
  OrganizationListItem,
  OrganizationMembershipData,
  MemberKind,
} from '~/types/organization';
import { captureException } from '~/providers/TelemetryProvider';
import { queryKeys } from '~/utils/queryKeys';
import {
  listOrganizationsSchema,
  getOrganizationSchema,
  createOrganizationSchema,
  updateOrganizationSchema,
  deleteOrganizationSchema,
  addMembershipSchema,
  updateMembershipSchema,
  removeMembershipSchema,
  listMembershipsForOrgSchema,
  listMembershipsForMemberSchema,
} from '~/types/schemas/organizations';

// --- Server function wrappers (dynamic import keeps mongoose server-only) ---

const listOrganizationsFn = createServerFn({ method: 'GET' })
  .inputValidator(listOrganizationsSchema)
  .handler(async ({ data }) => {
    const { listOrganizations } = await import('~/server/functions/organizations');
    return listOrganizations({ data });
  });

const getOrganizationFn = createServerFn({ method: 'GET' })
  .inputValidator(getOrganizationSchema)
  .handler(async ({ data }) => {
    const { getOrganization } = await import('~/server/functions/organizations');
    return getOrganization({ data });
  });

const createOrganizationFn = createServerFn({ method: 'POST' })
  .inputValidator(createOrganizationSchema)
  .handler(async ({ data }) => {
    const { createOrganization } = await import('~/server/functions/organizations');
    return createOrganization({ data });
  });

const updateOrganizationFn = createServerFn({ method: 'POST' })
  .inputValidator(updateOrganizationSchema)
  .handler(async ({ data }) => {
    const { updateOrganization } = await import('~/server/functions/organizations');
    return updateOrganization({ data });
  });

const deleteOrganizationFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteOrganizationSchema)
  .handler(async ({ data }) => {
    const { deleteOrganization } = await import('~/server/functions/organizations');
    return deleteOrganization({ data });
  });

const listMembershipsForOrgFn = createServerFn({ method: 'GET' })
  .inputValidator(listMembershipsForOrgSchema)
  .handler(async ({ data }) => {
    const { listMembershipsForOrg } = await import('~/server/functions/organizations');
    return listMembershipsForOrg({ data });
  });

const listMembershipsForMemberFn = createServerFn({ method: 'GET' })
  .inputValidator(listMembershipsForMemberSchema)
  .handler(async ({ data }) => {
    const { listMembershipsForMember } = await import('~/server/functions/organizations');
    return listMembershipsForMember({ data });
  });

const addMembershipFn = createServerFn({ method: 'POST' })
  .inputValidator(addMembershipSchema)
  .handler(async ({ data }) => {
    const { addMembership } = await import('~/server/functions/organizations');
    return addMembership({ data });
  });

const updateMembershipFn = createServerFn({ method: 'POST' })
  .inputValidator(updateMembershipSchema)
  .handler(async ({ data }) => {
    const { updateMembership } = await import('~/server/functions/organizations');
    return updateMembership({ data });
  });

const removeMembershipFn = createServerFn({ method: 'POST' })
  .inputValidator(removeMembershipSchema)
  .handler(async ({ data }) => {
    const { removeMembership } = await import('~/server/functions/organizations');
    return removeMembership({ data });
  });

// --- List / detail hooks ---

interface ListOrganizationsFilters {
  search?: string;
  tags?: string[];
  locationIds?: string[];
  enabled?: boolean;
}

export function useOrganizations(campaignId: string, filters?: ListOrganizationsFilters) {
  const { search, tags, locationIds } = filters ?? {};
  const {
    data: organizations = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.organizations.list(campaignId, search, tags, locationIds),
    queryFn: () => listOrganizationsFn({ data: { campaignId, search, tags, locationIds } }),
    enabled: (filters?.enabled ?? true) && !!campaignId,
  });
  return {
    organizations: organizations as OrganizationListItem[],
    isLoading,
    error: error instanceof Error ? error.message : error ? String(error) : null,
  };
}

export function useOrganization(id: string, campaignId: string) {
  const {
    data: organization = null,
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.organizations.detail(id, campaignId),
    queryFn: () => getOrganizationFn({ data: { id, campaignId } }),
    enabled: !!id && !!campaignId,
  });
  return {
    organization: organization as OrganizationData | null,
    isLoading,
    error: error instanceof Error ? error.message : error ? String(error) : null,
  };
}

export function useMembershipsForOrg(campaignId: string, organizationId: string, enabled = true) {
  const { data: memberships = [], isLoading } = useQuery({
    queryKey: queryKeys.memberships.forOrg(campaignId, organizationId),
    queryFn: () => listMembershipsForOrgFn({ data: { campaignId, organizationId } }),
    enabled: enabled && !!campaignId && !!organizationId,
  });
  return { memberships: memberships as OrganizationMembershipData[], isLoading };
}

export function useMembershipsForMember(
  campaignId: string,
  memberKind: MemberKind,
  memberId: string,
  enabled = true
) {
  const { data: memberships = [], isLoading } = useQuery({
    queryKey: queryKeys.memberships.forMember(campaignId, memberKind, memberId),
    queryFn: () => listMembershipsForMemberFn({ data: { campaignId, memberKind, memberId } }),
    enabled: enabled && !!campaignId && !!memberId,
  });
  return { memberships: memberships as OrganizationMembershipData[], isLoading };
}

// --- Mutation hooks ---

function errMsg(e: unknown): string | null {
  return e instanceof Error ? e.message : e ? String(e) : null;
}

export function useCreateOrganization() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (input: Parameters<typeof createOrganizationFn>[0]['data']) =>
      createOrganizationFn({ data: input }),
    onSuccess: (_d, { campaignId }) => {
      qc.invalidateQueries({ queryKey: ['organizations', 'list', campaignId], exact: false });
      qc.invalidateQueries({ queryKey: queryKeys.tags.list(campaignId) });
    },
    onError: (e) => captureException(e, { action: 'createOrganization' }),
  });
  return {
    create: async (input: Parameters<typeof createOrganizationFn>[0]['data']) => {
      try {
        return await mutation.mutateAsync(input);
      } catch {
        return null;
      }
    },
    isLoading: mutation.isPending,
    error: errMsg(mutation.error),
  };
}

export function useUpdateOrganization() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (input: Parameters<typeof updateOrganizationFn>[0]['data']) =>
      updateOrganizationFn({ data: input }),
    onSuccess: (_d, variables) => {
      qc.invalidateQueries({
        queryKey: ['organizations', 'list', variables.campaignId],
        exact: false,
      });
      qc.invalidateQueries({
        queryKey: queryKeys.organizations.detail(variables.id, variables.campaignId),
      });
      qc.invalidateQueries({ queryKey: queryKeys.tags.list(variables.campaignId) });
      qc.invalidateQueries({ queryKey: queryKeys.gmscreens.all });
    },
    onError: (e) => captureException(e, { action: 'updateOrganization' }),
  });
  return {
    update: async (input: Parameters<typeof updateOrganizationFn>[0]['data']) => {
      try {
        return await mutation.mutateAsync(input);
      } catch {
        return null;
      }
    },
    isLoading: mutation.isPending,
    error: errMsg(mutation.error),
  };
}

export function useDeleteOrganization() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (input: { id: string; campaignId: string }) =>
      deleteOrganizationFn({ data: input }),
    onSuccess: (_d, variables) => {
      qc.invalidateQueries({
        queryKey: ['organizations', 'list', variables.campaignId],
        exact: false,
      });
      qc.removeQueries({
        queryKey: queryKeys.organizations.detail(variables.id, variables.campaignId),
      });
      qc.invalidateQueries({ queryKey: queryKeys.memberships.all, exact: false });
      qc.invalidateQueries({ queryKey: queryKeys.gmscreens.all });
    },
    onError: (e) => captureException(e, { action: 'deleteOrganization' }),
  });
  return {
    remove: async (input: { id: string; campaignId: string }) => {
      try {
        return await mutation.mutateAsync(input);
      } catch {
        return null;
      }
    },
    isLoading: mutation.isPending,
    error: errMsg(mutation.error),
  };
}

function useMembershipMutation<TInput>(fn: (input: TInput) => Promise<unknown>, action: string) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (input: TInput) => fn(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.memberships.all, exact: false });
      qc.invalidateQueries({ queryKey: queryKeys.gmscreens.all });
    },
    onError: (e) => captureException(e, { action }),
  });
  return {
    mutate: async (input: TInput) => {
      try {
        return await mutation.mutateAsync(input);
      } catch {
        return null;
      }
    },
    isLoading: mutation.isPending,
    error: errMsg(mutation.error),
  };
}

export function useAddMembership() {
  return useMembershipMutation(
    (input: Parameters<typeof addMembershipFn>[0]['data']) => addMembershipFn({ data: input }),
    'addMembership'
  );
}

export function useUpdateMembership() {
  return useMembershipMutation(
    (input: Parameters<typeof updateMembershipFn>[0]['data']) =>
      updateMembershipFn({ data: input }),
    'updateMembership'
  );
}

export function useRemoveMembership() {
  return useMembershipMutation(
    (input: { id: string; campaignId: string }) => removeMembershipFn({ data: input }),
    'removeMembership'
  );
}
