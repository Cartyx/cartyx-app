// tests/components/mainview/tabletop/toolWindowState.test.ts
import { describe, it, expect } from 'vitest';
import {
  applyToolClick,
  applyWindowClose,
  type ToolUiState,
} from '~/components/mainview/tabletop/toolWindowState';

const idle: ToolUiState = { activeTool: 'pointer', openWindows: [] };

describe('applyToolClick', () => {
  it('activates a modal tool and opens its window', () => {
    expect(applyToolClick(idle, 'drawing')).toEqual({
      activeTool: 'drawing',
      openWindows: ['drawing'],
    });
  });

  it('re-clicking the active modal tool closes its window and reverts to pointer', () => {
    const s = applyToolClick(idle, 'ruler');
    expect(applyToolClick(s, 'ruler')).toEqual(idle);
  });

  it('switching modal tools keeps both windows open, moving only the active mode', () => {
    const s = applyToolClick(idle, 'text');
    expect(applyToolClick(s, 'ruler')).toEqual({
      activeTool: 'ruler',
      openWindows: ['text', 'ruler'],
    });
  });

  it('lets every modal window stay open at once across mode switches', () => {
    let s = applyToolClick(idle, 'drawing');
    s = applyToolClick(s, 'text');
    s = applyToolClick(s, 'ruler');
    expect(s).toEqual({ activeTool: 'ruler', openWindows: ['drawing', 'text', 'ruler'] });
  });

  it('dice toggles its window without changing the active tool', () => {
    const s = applyToolClick(applyToolClick(idle, 'ruler'), 'dice');
    expect(s).toEqual({ activeTool: 'ruler', openWindows: ['ruler', 'dice'] });
    expect(applyToolClick(s, 'dice')).toEqual({ activeTool: 'ruler', openWindows: ['ruler'] });
  });

  it('layer toggles independently alongside dice', () => {
    const s = applyToolClick(applyToolClick(idle, 'dice'), 'layer');
    expect(s).toEqual({ activeTool: 'pointer', openWindows: ['dice', 'layer'] });
  });

  it('selecting pointer/hand keeps all windows open, only changing the active tool', () => {
    const s = applyToolClick(applyToolClick(idle, 'dice'), 'text');
    expect(applyToolClick(s, 'hand')).toEqual({
      activeTool: 'hand',
      openWindows: ['dice', 'text'],
    });
  });
});

describe('applyWindowClose', () => {
  it('closing a modal window reverts the active tool to pointer', () => {
    const s = applyToolClick(idle, 'drawing');
    expect(applyWindowClose(s, 'drawing')).toEqual(idle);
  });

  it('closing dice leaves the active tool alone', () => {
    const s = applyToolClick(applyToolClick(idle, 'ruler'), 'dice');
    expect(applyWindowClose(s, 'dice')).toEqual({ activeTool: 'ruler', openWindows: ['ruler'] });
  });
});
