import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemberOrganizationsTab } from '~/components/shared/MemberOrganizationsTab';

vi.mock('~/hooks/useOrganizations', () => ({
  useMembershipsForMember: () => ({
    memberships: [
      {
        id: 'm1',
        campaignId: 'c1',
        organizationId: 'o1',
        organizationName: 'Thieves Guild',
        organizationIsPublic: true,
        memberKind: 'character',
        memberId: 'ch1',
        memberLabel: 'Bob',
        title: 'Guildmaster',
        publicNotes: '',
        privateNotes: '',
        canEdit: false,
        createdAt: '',
        updatedAt: '',
      },
    ],
    isLoading: false,
  }),
  useOrganizations: () => ({ organizations: [], isLoading: false, error: null }),
  useAddMembership: () => ({ mutate: vi.fn(), isLoading: false, error: null }),
  useUpdateMembership: () => ({ mutate: vi.fn(), isLoading: false, error: null }),
  useRemoveMembership: () => ({ mutate: vi.fn(), isLoading: false, error: null }),
}));

describe('MemberOrganizationsTab', () => {
  it('lists the organizations the member belongs to', () => {
    render(
      <MemberOrganizationsTab
        campaignId="c1"
        memberKind="character"
        memberId="ch1"
        isGM={false}
        canManage={false}
      />
    );
    expect(screen.getByText('Thieves Guild')).toBeInTheDocument();
    expect(screen.getByText('Guildmaster')).toBeInTheDocument();
  });

  it('shows the add button only when canManage', () => {
    const { rerender } = render(
      <MemberOrganizationsTab
        campaignId="c1"
        memberKind="character"
        memberId="ch1"
        isGM={false}
        canManage={false}
      />
    );
    expect(screen.queryByText('Add to organization')).not.toBeInTheDocument();
    rerender(
      <MemberOrganizationsTab
        campaignId="c1"
        memberKind="character"
        memberId="ch1"
        isGM={true}
        canManage={true}
      />
    );
    expect(screen.getByText('Add to organization')).toBeInTheDocument();
  });
});
