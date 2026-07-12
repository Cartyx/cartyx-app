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

  it('switching modal tools swaps the modal window', () => {
    const s = applyToolClick(idle, 'text');
    expect(applyToolClick(s, 'ruler')).toEqual({ activeTool: 'ruler', openWindows: ['ruler'] });
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

  it('selecting pointer/hand closes the modal window but keeps dice/layer open', () => {
    const s = applyToolClick(applyToolClick(idle, 'dice'), 'text');
    expect(applyToolClick(s, 'hand')).toEqual({ activeTool: 'hand', openWindows: ['dice'] });
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
