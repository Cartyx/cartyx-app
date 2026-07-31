import type { Meta, StoryObj } from '@storybook/react-vite';
import { PackageConflictNotice } from './PackageConflictNotice';

const meta: Meta<typeof PackageConflictNotice> = {
  title: 'Soundboard/PackageConflictNotice',
  component: PackageConflictNotice,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="max-w-2xl bg-[#080A12] p-4">
        <Story />
      </div>
    ),
  ],
  args: {
    savedAt: '2026-07-31T14:32:07.000Z',
  },
};
export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The normal case: `updatePackage` refused the save because the stored
 * package moved on. Both ways out are offered, both say what they cost.
 */
export const Conflict: Story = {};

/**
 * The overwrite is in flight. Both buttons are disabled — a second click
 * would fire a second write against the same precondition, and the "discard"
 * path would race the save it is sitting next to.
 */
export const Overwriting: Story = {
  args: { busy: true },
};

/**
 * `savedAt` absent — the refusal crossed a wire that dropped the extra
 * property (see `~/lib/soundboard/stale-write.ts` on why callers must treat
 * it as optional). The notice still explains itself and still offers both
 * choices; it just says no "when", rather than rendering "Invalid Date". The
 * discard path is unaffected — it re-reads the package rather than using this
 * value.
 */
export const WithoutATimestamp: Story = {
  args: { savedAt: '' },
};
