import { CATEGORY_ICONS } from '@stow/core';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CATEGORY_ICON_OPTIONS, CategoryIcon } from './CategoryIcon';

describe('CATEGORY_ICON_OPTIONS', () => {
  it('covers every curated icon, in order, with a unique label and the matching lucide component', () => {
    expect(CATEGORY_ICON_OPTIONS.map((option) => option.name)).toEqual([...CATEGORY_ICONS]);
    const labels = CATEGORY_ICON_OPTIONS.map((option) => option.label);
    expect(labels.every((label) => label.trim() !== '')).toBe(true);
    expect(new Set(labels).size).toBe(CATEGORY_ICONS.length);

    for (const { name, Icon } of CATEGORY_ICON_OPTIONS) {
      const { container, unmount } = render(<Icon />);
      expect(container.querySelector(`svg.lucide-${name}`), name).not.toBeNull();
      unmount();
    }
  });
});

describe('CategoryIcon', () => {
  it('draws the icon in the category colour, hidden from assistive technology', () => {
    const { container } = render(<CategoryIcon icon="briefcase" color="#ef4444" />);
    const svg = container.querySelector('svg')!;
    expect(svg.classList.contains('lucide-briefcase')).toBe(true);
    expect(svg.classList.contains('shrink-0')).toBe(true);
    expect(svg.classList.contains('size-4')).toBe(true);
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.style.color).toBe('rgb(239, 68, 68)');
  });

  it('uses the given size class instead of the default', () => {
    const { container } = render(<CategoryIcon icon="leaf" color="#22c55e" className="size-5" />);
    const svg = container.querySelector('svg.lucide-leaf')!;
    expect(svg.classList.contains('size-5')).toBe(true);
    expect(svg.classList.contains('size-4')).toBe(false);
  });

  it.each([undefined, 'unicorn', 42])('falls back to the folder for %s', (icon) => {
    const { container } = render(<CategoryIcon icon={icon} color="#64748b" />);
    expect(container.querySelector('svg.lucide-folder')).not.toBeNull();
  });
});
