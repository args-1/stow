import { makeCategory } from '@stow/core/testing';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CategoryPicker } from './CategoryPicker';

const reading = makeCategory({ id: 'cat-reading', name: 'Reading', color: '#3b82f6', icon: 'book-open' });
const old = makeCategory({ id: 'cat-old', name: 'Old', icon: 'archive', deleted_at: '2026-01-02T00:00:00.000Z' });

function picker(value: string) {
  const view = render(<CategoryPicker id="category" categories={[reading, old]} value={value} onChange={vi.fn()} />);
  return { ...view, select: screen.getByRole('combobox') as HTMLSelectElement };
}

describe('CategoryPicker', () => {
  it("shows the selected category's icon inside the select and pads the text past it", () => {
    const { container, select } = picker('cat-reading');
    expect(select.value).toBe('cat-reading');
    expect(select.classList.contains('pl-9')).toBe(true);
    const svg = container.querySelector('svg.lucide-book-open');
    expect(svg).not.toBeNull();
    expect((svg as SVGElement).style.color).toBe('rgb(59, 130, 246)');
  });

  it.each(['', 'cat-old', 'cat-missing'])('shows no icon when the value is %j', (value) => {
    const { container, select } = picker(value);
    expect(select.value).toBe('');
    expect(select.classList.contains('pl-9')).toBe(false);
    expect(container.querySelector('svg')).toBeNull();
  });
});
