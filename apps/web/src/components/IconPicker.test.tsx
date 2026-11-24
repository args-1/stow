import { CATEGORY_ICONS } from '@stow/core';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { IconPicker } from './IconPicker';

describe('IconPicker', () => {
  it('offers every curated icon as a radio in a labelled group, with the value checked', () => {
    render(<IconPicker value="folder" color="#ef4444" onChange={vi.fn()} />);
    const group = within(screen.getByRole('group', { name: 'Icon' }));
    const radios = group.getAllByRole('radio') as HTMLInputElement[];

    expect(radios.map((r) => r.value)).toEqual([...CATEGORY_ICONS]);
    expect(radios.filter((r) => r.checked).map((r) => r.value)).toEqual(['folder']);
    expect((group.getByRole('radio', { name: 'Folder' }) as HTMLInputElement).checked).toBe(true);
  });

  it('previews every icon in the given colour', () => {
    const { container } = render(<IconPicker value="folder" color="#3b82f6" onChange={vi.fn()} />);
    const svgs = [...container.querySelectorAll('svg')];
    expect(svgs).toHaveLength(CATEGORY_ICONS.length);
    expect(svgs.every((svg) => svg.style.color === 'rgb(59, 130, 246)')).toBe(true);
  });

  it('reports the picked icon', () => {
    const onChange = vi.fn();
    render(<IconPicker value="folder" color="#ef4444" onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Briefcase' }));
    expect(onChange).toHaveBeenCalledWith('briefcase');
  });
});
