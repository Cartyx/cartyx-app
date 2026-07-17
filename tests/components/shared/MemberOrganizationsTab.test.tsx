import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemberOrganizationsTab } from '~/components/shared/MemberOrganizationsTab';

// Hoisted, mutable membership fixture so each test can vary what the reverse
// lookup returns (in particular each membership's own `canEdit`).
const h = vi.hoisted(() => ({ memberships: [] as Record<string, unknown>[] }));

vi.mock('~/hooks/useOrganizations', () => ({
  useMembershipsForMember: () => ({ memberships: h.memberships, isLoading: false }),
  useOrganizations: () => ({ organizations: [], isLoading: false, error: null }),
  useAddMembership: () => ({ mutate: vi.fn(), isLoading: false, error: null }),
  useUpdateMembership: () => ({ mutate: vi.fn(), isLoading: false, error: null }),
  useRemoveMembership: () => ({ mutate: vi.fn(), isLoading: false, error: null }),
}));

const membership = (over: Record<string, unknown> = {}) => ({
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
  ...over,
});

beforeEach(() => {
  h.memberships = [membership()];
});

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

  it('gates per-row edit/remove on each membership canEdit, not the tab canManage', () => {
    // Two memberships: one the viewer can manage, one (a GM-owned org) they can't.
    h.memberships = [
      membership({ id: 'm1', organizationName: 'Owned Guild', canEdit: true }),
      membership({ id: 'm2', organizationName: 'GM Guild', canEdit: false }),
    ];
    render(
      <MemberOrganizationsTab
        campaignId="c1"
        memberKind="character"
        memberId="ch1"
        isGM={false}
        canManage={true}
      />
    );
    // canEdit row shows manage buttons...
    expect(screen.getByLabelText('Edit membership in Owned Guild')).toBeInTheDocument();
    expect(screen.getByLabelText('Remove membership in Owned Guild')).toBeInTheDocument();
    // ...the non-canEdit row does NOT, even though canManage is true.
    expect(screen.queryByLabelText('Edit membership in GM Guild')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Remove membership in GM Guild')).not.toBeInTheDocument();
  });
});
