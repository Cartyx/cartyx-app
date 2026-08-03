import React, { useState } from 'react';
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
 * Same `Controlled` shape `MasterBar.stories.tsx` and `MoodEditor.stories.tsx`
 * use, and here it is doing real work rather than ceremony: `onOverwrite` and
 * `onDiscard` are REQUIRED props with no defaults, so a story that supplied
 * only `savedAt` would render two enabled buttons wired to
 * `onClick={undefined}` — a canvas that looks interactive and silently does
 * nothing. That would still typecheck (`const meta: Meta<typeof …>` is an
 * explicit annotation rather than `satisfies`, which erases the required-args
 * narrowing) and `test:storybook` would still pass, because no story here has
 * a `play` that clicks. Wiring both handlers to state also makes the canvas
 * behave the way the editor does: overwriting goes busy, discarding dismisses.
 */
function Controlled(args: React.ComponentProps<typeof PackageConflictNotice>) {
  const [busy, setBusy] = useState(args.busy ?? false);
  const [chose, setChose] = useState<'overwrite' | 'discard' | null>(null);

  if (chose === 'discard') {
    return <p className="text-sm text-slate-400">Discarded — reloading the saved version…</p>;
  }

  return (
    <>
      <PackageConflictNotice
        {...args}
        busy={busy}
        onOverwrite={() => {
          setChose('overwrite');
          setBusy(true);
        }}
        onDiscard={() => setChose('discard')}
      />
      {chose === 'overwrite' && (
        <p className="mt-2 text-sm text-slate-400">Keeping your edits and overwriting…</p>
      )}
    </>
  );
}

/**
 * The normal case: `updatePackage` refused the save because the stored
 * package moved on. Both ways out are offered, both say what they cost.
 */
export const Conflict: Story = {
  render: (args) => <Controlled {...args} />,
};

/**
 * The overwrite is in flight. Both buttons are disabled — a second click
 * would fire a second write against the same precondition, and the "discard"
 * path would race the save it is sitting next to.
 */
export const Overwriting: Story = {
  render: (args) => <Controlled {...args} />,
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
  render: (args) => <Controlled {...args} />,
  args: { savedAt: '' },
};
