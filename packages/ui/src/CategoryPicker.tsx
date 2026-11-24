import { activeCategories, type Category } from '@stow/core';
import { inputClass } from './styles';

export interface CategoryPickerProps {
  id: string;
  categories: readonly Category[];
  /** '' means "No category". */
  value: string;
  onChange(value: string): void;
  disabled?: boolean;
}

export function CategoryPicker({ id, categories, value, onChange, disabled }: CategoryPickerProps) {
  const options = activeCategories(categories);
  const selected = options.some((c) => c.id === value) ? value : '';
  return (
    <select
      id={id}
      className={inputClass}
      value={selected}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">No category</option>
      {options.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}
