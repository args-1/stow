import type { CategoryIconName } from '@stow/core';
import { CATEGORY_ICON_OPTIONS, CategoryIcon, labelClass } from '@stow/ui';
import { useId } from 'react';

export interface IconPickerProps {
  value: string;
  color: string;
  onChange(icon: CategoryIconName): void;
  label?: string;
}

export function IconPicker({ value, color, onChange, label = 'Icon' }: IconPickerProps) {
  const name = useId();
  return (
    <fieldset className="space-y-1">
      <legend className={labelClass}>{label}</legend>
      <div className="flex flex-wrap gap-2 pt-1">
        {CATEGORY_ICON_OPTIONS.map((option) => (
          <label key={option.name} className="cursor-pointer">
            <input
              type="radio"
              name={name}
              value={option.name}
              checked={value === option.name}
              onChange={() => onChange(option.name)}
              aria-label={option.label}
              className="peer sr-only"
            />
            <span
              aria-hidden="true"
              title={option.label}
              className={
                'flex size-9 items-center justify-center rounded-lg bg-slate-100 ring-offset-2 ring-offset-white ' +
                'peer-checked:ring-2 peer-checked:ring-slate-900 peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500 ' +
                'dark:bg-slate-800 dark:ring-offset-slate-900 dark:peer-checked:ring-white'
              }
            >
              <CategoryIcon icon={option.name} color={color} className="size-5" />
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
