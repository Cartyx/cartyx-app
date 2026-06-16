import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { LoreModal } from '~/components/wiki/lore/LoreModal';

vi.mock('~/hooks/useLore', () => ({
  useLoreEntry: () => ({ lore: null, isLoading: false }),
  useCreateLore: () => ({ create: vi.fn(), isLoading: false, error: null }),
  useUpdateLore: () => ({ update: vi.fn(), isLoading: false, error: null }),
}));
vi.mock('~/hooks/useCampaigns', () => ({ useCampaign: () => ({ campaign: { isGM: true } }) }));
vi.mock('~/hooks/useCharacters', () => ({ useCharacters: () => ({ characters: [] }) }));
vi.mock('~/hooks/usePlayers', () => ({ usePlayers: () => ({ players: [] }) }));
vi.mock('~/hooks/useLocations', () => ({ useLocations: () => ({ locations: [] }) }));
vi.mock('~/hooks/useRaces', () => ({ useRaces: () => ({ races: [] }) }));
vi.mock('~/hooks/useTags', () => ({ useTags: () => ({ tags: [] }) }));
vi.mock('~/hooks/useTabletopScreens', () => ({
  useTabletopScreenList: () => ({ screens: [] }),
  useTabletopMutations: () => ({
    openWindow: { mutate: vi.fn(), isPending: false },
  }),
}));

// Mock CodeMirror so MarkdownEditor renders without DOM issues
vi.mock('@codemirror/view', () => {
  class FakeEditorView {
    dom: HTMLDivElement;
    contentDOM: HTMLDivElement;
    state = { doc: { toString: () => '' } };
    constructor(opts: { state: { doc: string }; parent: HTMLElement }) {
      this.dom = document.createElement('div');
      this.contentDOM = document.createElement('div');
      this.dom.appendChild(this.contentDOM);
      opts.parent.appendChild(this.dom);
    }
    dispatch() {}
    focus() {}
    destroy() {}
  }
  return {
    EditorView: Object.assign(FakeEditorView, {
      theme: () => [],
      updateListener: {
        of: () => [],
      },
      lineWrapping: [],
    }),
    placeholder: () => [],
    keymap: { of: () => [] },
  };
});
vi.mock('@codemirror/state', () => {
  class FakeCompartment {
    of(ext: unknown) {
      return ext;
    }
    reconfigure(ext: unknown) {
      return ext;
    }
  }
  return {
    EditorState: {
      create: (opts: { doc: string }) => ({ doc: opts.doc }),
      readOnly: { of: () => [] },
    },
    Compartment: FakeCompartment,
  };
});
vi.mock('@codemirror/lang-markdown', () => ({ markdown: () => [], markdownLanguage: {} }));
vi.mock('@codemirror/commands', () => ({
  defaultKeymap: [],
  history: () => [],
  historyKeymap: [],
}));
vi.mock('@codemirror/language', () => ({ syntaxHighlighting: () => [] }));
vi.mock('@codemirror/theme-one-dark', () => ({ oneDarkHighlightStyle: {} }));

describe('LoreModal', () => {
  it('renders a title input and the links editor in create mode', () => {
    render(<LoreModal isOpen onClose={() => {}} campaignId="c1" />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('lore-links-editor')).toBeInTheDocument();
  });

  it('requires a title before saving', async () => {
    render(<LoreModal isOpen onClose={() => {}} campaignId="c1" />);
    await act(async () => {
      fireEvent.submit(screen.getByRole('dialog'));
    });
    expect(screen.getByText(/title is required/i)).toBeInTheDocument();
  });
});
