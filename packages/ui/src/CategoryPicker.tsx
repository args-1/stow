import { activeCategories, type Category } from '@stow/core';
import { CategoryIcon } from './CategoryIcon';
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
  const selected = options.find((c) => c.id === value);
  return (
    <div className="relative">
      <select
        id={id}
        className={selected ? `${inputClass} pl-9` : inputClass}
        value={selected?.id ?? ''}
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
      {selected && (
        <CategoryIcon
          icon={selected.icon}
          color={selected.color}
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
        />
      )}
    </div>
  );
}
