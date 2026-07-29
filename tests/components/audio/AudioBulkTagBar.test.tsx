import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AudioBulkTagBar } from '~/components/audio/AudioBulkTagBar';

describe('AudioBulkTagBar', () => {
  it('renders nothing when nothing is selected', () => {
    const { container } = render(<AudioBulkTagBar selectedCount={0} onApply={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the selected count', () => {
    render(<AudioBulkTagBar selectedCount={3} onApply={vi.fn()} />);
    expect(screen.getByText(/3 selected/i)).toBeInTheDocument();
  });

  it('applies parsed tags in add mode by default, with no other fields in the payload', async () => {
    const onApply = vi.fn();
    render(<AudioBulkTagBar selectedCount={2} onApply={onApply} />);
    await userEvent.type(screen.getByLabelText(/tags to apply/i), 'storm, rain');
    await userEvent.click(screen.getByRole('button', { name: /apply/i }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith({ tags: ['storm', 'rain'], tagMode: 'add' });
  });

  it('sends exactly the given tags in replace mode when tags are non-empty', async () => {
    const onApply = vi.fn();
    render(<AudioBulkTagBar selectedCount={2} onApply={onApply} />);
    await userEvent.type(screen.getByLabelText(/tags to apply/i), 'storm,  rain ,,rain');
    await userEvent.selectOptions(screen.getByLabelText(/tag mode/i), 'replace');
    await userEvent.click(screen.getByRole('button', { name: /apply/i }));
    expect(onApply).toHaveBeenCalledTimes(1);
    // trims whitespace, drops empties, but does not dedupe — that's the
    // caller's/schema's job, not the bar's.
    expect(onApply).toHaveBeenCalledWith({
      tags: ['storm', 'rain', 'rain'],
      tagMode: 'replace',
    });
  });

  it('does not clobber existing tags in add mode when the tag field is left empty', async () => {
    const onApply = vi.fn();
    render(<AudioBulkTagBar selectedCount={2} onApply={onApply} />);
    await userEvent.selectOptions(screen.getByLabelText(/kind to apply/i), 'music');
    await userEvent.click(screen.getByRole('button', { name: /apply/i }));
    expect(onApply).toHaveBeenCalledTimes(1);
    // No `tags` key at all: add-mode + empty input is a genuine no-op, not
    // an instruction to add nothing.
    expect(onApply).toHaveBeenCalledWith({ kind: 'music', tagMode: 'add' });
  });

  it('includes kind, environment, mood, and intensity selections in the payload', async () => {
    const onApply = vi.fn();
    render(<AudioBulkTagBar selectedCount={5} onApply={onApply} />);
    await userEvent.selectOptions(screen.getByLabelText(/kind to apply/i), 'music');
    await userEvent.click(screen.getByRole('button', { name: 'forest' }));
    await userEvent.click(screen.getByRole('button', { name: 'eerie' }));
    await userEvent.selectOptions(screen.getByLabelText(/intensity to apply/i), '4');
    await userEvent.click(screen.getByRole('button', { name: /apply/i }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith({
      kind: 'music',
      environment: ['forest'],
      mood: ['eerie'],
      intensity: 4,
      tagMode: 'add',
    });
  });

  it('supports selecting multiple environment and mood chips', async () => {
    const onApply = vi.fn();
    render(<AudioBulkTagBar selectedCount={5} onApply={onApply} />);
    await userEvent.click(screen.getByRole('button', { name: 'forest' }));
    await userEvent.click(screen.getByRole('button', { name: 'coast' }));
    await userEvent.click(screen.getByRole('button', { name: 'calm' }));
    await userEvent.click(screen.getByRole('button', { name: /apply/i }));
    expect(onApply).toHaveBeenCalledWith({
      environment: ['forest', 'coast'],
      mood: ['calm'],
      tagMode: 'add',
    });
  });

  it('deselecting a chip removes it from the payload', async () => {
    const onApply = vi.fn();
    render(<AudioBulkTagBar selectedCount={5} onApply={onApply} />);
    await userEvent.click(screen.getByRole('button', { name: 'forest' }));
    await userEvent.click(screen.getByRole('button', { name: 'forest' }));
    await userEvent.click(screen.getByRole('button', { name: /apply/i }));
    expect(onApply).toHaveBeenCalledWith({ tagMode: 'add' });
  });

  it('lets intensity be explicitly cleared via the "Clear" option', async () => {
    const onApply = vi.fn();
    render(<AudioBulkTagBar selectedCount={5} onApply={onApply} />);
    await userEvent.selectOptions(screen.getByLabelText(/intensity to apply/i), '4');
    await userEvent.selectOptions(screen.getByLabelText(/intensity to apply/i), 'clear');
    await userEvent.click(screen.getByRole('button', { name: /apply/i }));
    expect(onApply).toHaveBeenCalledWith({ intensity: null, tagMode: 'add' });
  });

  it('asks for confirmation before wiping tags with an empty replace, and does not apply on cancel', async () => {
    const onApply = vi.fn();
    render(<AudioBulkTagBar selectedCount={7} onApply={onApply} />);
    await userEvent.selectOptions(screen.getByLabelText(/tag mode/i), 'replace');
    await userEvent.click(screen.getByRole('button', { name: /apply/i }));

    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByText(/remove all tags from 7 selected asset/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.queryByText(/remove all tags from 7 selected asset/i)).not.toBeInTheDocument();
  });

  it('applies the empty-replace tag wipe once confirmed', async () => {
    const onApply = vi.fn();
    render(<AudioBulkTagBar selectedCount={7} onApply={onApply} />);
    await userEvent.selectOptions(screen.getByLabelText(/tag mode/i), 'replace');
    await userEvent.click(screen.getByRole('button', { name: /apply/i }));
    await userEvent.click(screen.getByRole('button', { name: /clear tags/i }));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith({ tags: [], tagMode: 'replace' });
  });

  it('calls onClear when the clear-selection button is clicked', async () => {
    const onClear = vi.fn();
    render(<AudioBulkTagBar selectedCount={4} onApply={vi.fn()} onClear={onClear} />);
    await userEvent.click(screen.getByRole('button', { name: /clear selection/i }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('does not render a clear-selection button when onClear is not provided', () => {
    render(<AudioBulkTagBar selectedCount={4} onApply={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /clear selection/i })).not.toBeInTheDocument();
  });
});
