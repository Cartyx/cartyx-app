import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RulesPanel } from '~/components/wiki/rules/RulesPanel';
import { useRules, useRule, useCreateRule, useUpdateRule, useDeleteRule } from '~/hooks/useRules';
import { useCampaign } from '~/hooks/useCampaigns';

vi.mock('~/hooks/useRules');
vi.mock('~/hooks/useCampaigns');
vi.mock('~/hooks/useTags', () => ({
  useTags: () => ({ tags: [], isLoading: false, error: null }),
}));
vi.mock('~/hooks/useTabletopScreens', () => ({
  useTabletopScreenList: () => ({ screens: [], isLoading: false, error: null }),
  useTabletopMutations: () => ({
    openWindow: { mutate: vi.fn(), isPending: false },
  }),
}));
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ campaignId: 'campaign-123' }),
}));

const mockRules = [
  {
    id: 'rule-1',
    campaignId: 'campaign-123',
    title: 'Critical Hit Rule',
    tags: ['combat', 'damage'],
    isPublic: true,
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    createdBy: 'user-1',
  },
];

function setupMocks(overrides: { isGM?: boolean; rules?: typeof mockRules } = {}) {
  const { isGM = true, rules = mockRules } = overrides;
  (useCampaign as any).mockReturnValue({
    campaign: { isGM, sessions: [] },
    isLoading: false,
    error: null,
  });
  (useRules as any).mockReturnValue({
    rules,
    isLoading: false,
    error: null,
  });
  (useRule as any).mockReturnValue({
    rule: null,
    isLoading: false,
    error: null,
  });
  (useCreateRule as any).mockReturnValue({
    create: vi.fn(),
    isLoading: false,
    error: null,
  });
  (useUpdateRule as any).mockReturnValue({
    update: vi.fn(),
    isLoading: false,
    error: null,
  });
  (useDeleteRule as any).mockReturnValue({
    remove: vi.fn(),
    isLoading: false,
    error: null,
  });
}

describe('RulesPanel', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders search, create button, and rules list for GM', async () => {
    setupMocks();
    render(<RulesPanel onBack={vi.fn()} />);

    expect(screen.getByPlaceholderText('Search rules...')).toBeInTheDocument();
    expect(screen.getByLabelText('Create new item')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Critical Hit Rule')).toBeInTheDocument();
      expect(screen.getByText('#combat')).toBeInTheDocument();
      expect(screen.getByText('#damage')).toBeInTheDocument();
    });
  });

  it('hides create button for non-GM players', () => {
    setupMocks({ isGM: false });
    render(<RulesPanel onBack={vi.fn()} />);

    expect(screen.queryByLabelText('Create new item')).not.toBeInTheDocument();
  });

  it('hides visibility filter for non-GM players', () => {
    setupMocks({ isGM: false });
    render(<RulesPanel onBack={vi.fn()} />);

    expect(screen.queryByLabelText('Filter by visibility')).not.toBeInTheDocument();
  });

  it('shows visibility filter for GMs', () => {
    setupMocks({ isGM: true });
    render(<RulesPanel onBack={vi.fn()} />);

    expect(screen.getByLabelText('Filter by visibility')).toBeInTheDocument();
  });

  it('does not show session filter (rules are session-independent)', () => {
    setupMocks();
    render(<RulesPanel onBack={vi.fn()} />);

    expect(screen.queryByLabelText('Filter by session')).not.toBeInTheDocument();
  });

  it('GM clicking a rule opens edit modal', async () => {
    setupMocks({ isGM: true });
    const user = userEvent.setup();
    render(<RulesPanel onBack={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Critical Hit Rule')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Critical Hit Rule'));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Edit Rule' })).toBeInTheDocument();
  });

  it('player clicking a rule opens read-only view modal', async () => {
    setupMocks({ isGM: false });
    const user = userEvent.setup();
    render(<RulesPanel onBack={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Critical Hit Rule')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Critical Hit Rule'));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Rule' })).toBeInTheDocument();
  });

  it('GM clicking create button opens create modal', async () => {
    setupMocks({ isGM: true });
    const user = userEvent.setup();
    render(<RulesPanel onBack={vi.fn()} />);

    await user.click(screen.getByLabelText('Create new item'));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Create Rule' })).toBeInTheDocument();
  });

  it('updates filters when search input changes', async () => {
    setupMocks();
    const user = userEvent.setup();
    render(<RulesPanel onBack={vi.fn()} />);

    const searchInput = screen.getByPlaceholderText('Search rules...');
    await user.type(searchInput, 'critical');

    expect(useRules).toHaveBeenLastCalledWith(
      'campaign-123',
      expect.objectContaining({
        search: 'critical',
      })
    );
  });

  it('updates filters when visibility select changes', async () => {
    setupMocks({ isGM: true });
    const user = userEvent.setup();
    render(<RulesPanel onBack={vi.fn()} />);

    const visibilitySelect = screen.getByLabelText('Filter by visibility');
    await user.selectOptions(visibilitySelect, 'public');

    expect(useRules).toHaveBeenLastCalledWith(
      'campaign-123',
      expect.objectContaining({
        visibility: 'public',
      })
    );
  });

  it('shows loading state', () => {
    setupMocks();
    (useRules as any).mockReturnValue({
      rules: [],
      isLoading: true,
      error: null,
    });

    render(<RulesPanel onBack={vi.fn()} />);
    expect(screen.getByText('Loading rules...')).toBeInTheDocument();
  });

  it('shows empty state', () => {
    setupMocks({ rules: [] });

    render(<RulesPanel onBack={vi.fn()} />);
    expect(screen.getByText('No rules found matching your filters.')).toBeInTheDocument();
  });

  it('shows error state', () => {
    setupMocks();
    (useRules as any).mockReturnValue({
      rules: [],
      isLoading: false,
      error: 'Failed to fetch',
    });

    render(<RulesPanel onBack={vi.fn()} />);
    expect(screen.getByText('Failed to fetch')).toBeInTheDocument();
  });

  it('calls onBack when header back button is clicked', async () => {
    setupMocks();
    const onBack = vi.fn();
    const user = userEvent.setup();
    render(<RulesPanel onBack={onBack} />);

    await user.click(screen.getByLabelText('Back'));

    expect(onBack).toHaveBeenCalled();
  });
});
