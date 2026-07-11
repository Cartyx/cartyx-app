import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
  createFileRoute: vi.fn(() => vi.fn(() => ({ useRouteContext: vi.fn(), useLoaderData: vi.fn() }))),
  redirect: vi.fn(),
  useNavigate: vi.fn(() => vi.fn()),
}));

vi.mock('~/components/Topbar', () => ({ Topbar: () => <nav data-testid="topbar" /> }));
vi.mock('~/components/Toast', () => ({ Toast: () => <div />, showToast: vi.fn() }));
vi.mock('~/hooks/useCampaigns', () => ({
  useCreateCampaign: vi.fn(() => ({ create: vi.fn(), isLoading: false, error: null })),
}));
vi.mock('~/server/functions/auth', () => ({ getMe: vi.fn() }));
vi.mock('~/constants/timezones', () => ({
  TIMEZONES: [['America/Chicago', 'Central Time (CT)']],
}));

import { NewCampaignPage } from '~/routes/campaigns/new';

describe('Create-campaign wizard — step 1 image guidance (#302)', () => {
  it('renders recommended image-size guidance text', () => {
    render(<NewCampaignPage />);
    expect(screen.getByText(/Recommended: 1200/)).toBeInTheDocument();
    expect(screen.getByText(/400px or larger/)).toBeInTheDocument();
  });

  it('renders allowed file-type and size limits', () => {
    render(<NewCampaignPage />);
    expect(screen.getByText(/PNG, JPG, WebP up to 10MB/)).toBeInTheDocument();
    expect(screen.getByText(/GIF up to 3MB/)).toBeInTheDocument();
  });

  it('file input accepts only PNG, JPEG, GIF, and WebP', () => {
    render(<NewCampaignPage />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();
    expect(fileInput.accept).toBe('image/png,image/jpeg,image/gif,image/webp');
  });
});
