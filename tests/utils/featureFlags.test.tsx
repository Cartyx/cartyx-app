import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useOptionalFeatureFlag, useOptionalFeatureFlagEnabled } from '~/utils/featureFlags';

function OptionalFlagProbe({ flag }: { flag: string }) {
  const enabled = useOptionalFeatureFlagEnabled(flag);
  return <div data-testid="result">{String(enabled)}</div>;
}

function OptionalFlagStateProbe({ flag }: { flag: string }) {
  const state = useOptionalFeatureFlag(flag);
  return (
    <>
      <div data-testid="isLoading">{String(state.isLoading)}</div>
      <div data-testid="isEnabled">{String(state.isEnabled)}</div>
    </>
  );
}

describe('featureFlags utilities', () => {
  describe('useOptionalFeatureFlagEnabled (boolean env values)', () => {
    it.each([
      ['true', true],
      ['1', true],
      ['false', false],
      ['', false],
      ['TRUE', false], // strict lowercase — documented in .env.example
      ['some-legacy-flag-name', false],
    ])('parses %j as %s', (value, expected) => {
      render(<OptionalFlagProbe flag={value} />);
      expect(screen.getByTestId('result')).toHaveTextContent(String(expected));
    });
  });

  describe('useOptionalFeatureFlag (boolean env values)', () => {
    it('is enabled and never loading for "true"', () => {
      render(<OptionalFlagStateProbe flag="true" />);
      expect(screen.getByTestId('isEnabled')).toHaveTextContent('true');
      expect(screen.getByTestId('isLoading')).toHaveTextContent('false');
    });

    it('is disabled and never loading for an unset value', () => {
      render(<OptionalFlagStateProbe flag="" />);
      expect(screen.getByTestId('isEnabled')).toHaveTextContent('false');
      expect(screen.getByTestId('isLoading')).toHaveTextContent('false');
    });
  });
});
