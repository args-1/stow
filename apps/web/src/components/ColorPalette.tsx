import { CATEGORY_COLORS } from '@linkstash/core';
import { labelClass } from '@linkstash/ui';
import { useId } from 'react';

const COLOR_NAMES: Record<(typeof CATEGORY_COLORS)[number], string> = {
  '#ef4444': 'Red',
  '#f97316': 'Orange',
  '#eab308': 'Yellow',
  '#22c55e': 'Green',
  '#14b8a6': 'Teal',
  '#3b82f6': 'Blue',
  '#6366f1': 'Indigo',
  '#a855f7': 'Purple',
  '#ec4899': 'Pink',
  '#64748b': 'Slate',
};

export interface ColorPaletteProps {
  value: string;
  onChange(color: string): void;
  label?: string;
}

export function ColorPalette({ value, onChange, label = 'Color' }: ColorPaletteProps) {
  const name = useId();
  return (
    <fieldset className="space-y-1">
      <legend className={labelClass}>{label}</legend>
      <div className="flex flex-wrap gap-2 pt-1">
        {CATEGORY_COLORS.map((color) => (
          <label key={color} className="cursor-pointer">
            <input
              type="radio"
              name={name}
              value={color}
              checked={value === color}
              onChange={() => onChange(color)}
              aria-label={COLOR_NAMES[color]}
              className="peer sr-only"
            />
            <span
              aria-hidden="true"
              title={COLOR_NAMES[color]}
              className={
                'block size-7 rounded-full ring-offset-2 ring-offset-white peer-checked:ring-2 peer-checked:ring-slate-900 ' +
                'peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500 dark:ring-offset-slate-900 dark:peer-checked:ring-white'
              }
              style={{ backgroundColor: color }}
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
}
