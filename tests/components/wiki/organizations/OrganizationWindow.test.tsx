import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OrganizationWindow } from '~/components/wiki/organizations/OrganizationWindow';
import type { OrganizationData } from '~/types/organization';

vi.mock('~/hooks/useOrganizations', () => ({
  useMembershipsForOrg: () => ({ memberships: [], isLoading: false }),
}));

const org: OrganizationData = {
  id: 'o1',
  campaignId: 'c1',
  createdBy: 'u1',
  name: 'Thieves Guild',
  publicInfo: 'A shadowy guild.',
  privateInfo: 'GM secret plans.',
  isPublic: true,
  tags: ['faction'],
  locations: [{ locationId: 'l1', label: 'Waterdeep', publicInfo: 'HQ here.', privateInfo: '' }],
  canEdit: false,
  createdAt: '',
  updatedAt: '',
};

describe('OrganizationWindow', () => {
  it('renders public info and location links', () => {
    render(<OrganizationWindow organization={org} />);
    expect(screen.getByText('A shadowy guild.')).toBeInTheDocument();
    expect(screen.getByText('Waterdeep')).toBeInTheDocument();
  });

  it('shows GM private info only when present', () => {
    render(<OrganizationWindow organization={org} />);
    expect(screen.getByText('GM secret plans.')).toBeInTheDocument();
  });

  it('hides the private section when privateInfo is empty', () => {
    render(<OrganizationWindow organization={{ ...org, privateInfo: '' }} />);
    expect(screen.queryByText('GM Only')).not.toBeInTheDocument();
  });
});
