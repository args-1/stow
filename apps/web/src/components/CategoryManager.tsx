import {
  activeCategories,
  countByCategory,
  LIMITS,
  nextCategoryColor,
  type Category,
  type CategoryInput,
  type Link,
  type Result,
} from '@stow/core';
import { buttonClass, ColorDot, Field, inputClass, secondaryButtonClass } from '@stow/ui';
import { Pencil, Trash2 } from 'lucide-react';
import { useId, useMemo, useState, type FormEvent } from 'react';
import type { Actions } from '../actions';
import { errorText, toast } from '../toast';
import { ColorPalette } from './ColorPalette';
import { IconButton } from './IconButton';

export type CategoryActions = Pick<Actions, 'addCategory' | 'editCategory' | 'deleteCategory'>;

export interface CategoryManagerProps {
  categories: readonly Category[];
  links: readonly Link[];
  actions: CategoryActions;
}

interface CategoryFormProps {
  label: string;
  initial: CategoryInput;
  submitLabel: string;
  onSubmit(input: CategoryInput): Promise<Result<Category>>;
  onDone(category: Category): void;
  onCancel?(): void;
}

function CategoryForm({ label, initial, submitLabel, onSubmit, onDone, onCancel }: CategoryFormProps) {
  const id = useId();
  const [name, setName] = useState(initial.name);
  const [color, setColor] = useState(initial.color);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      const result = await onSubmit({ name, color });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      onDone(result.value);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <form aria-label={label} noValidate onSubmit={handleSubmit} className="space-y-3">
      <Field id={`${id}-name`} label="Name">
        <input
          id={`${id}-name`}
          className={inputClass}
          maxLength={LIMITS.categoryName}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <ColorPalette value={color} onChange={setColor} />
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <button type="button" className={secondaryButtonClass} onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className={buttonClass} disabled={pending}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

const linkCount = (n: number) => (n === 1 ? '1 link' : `${n} links`);

export function CategoryManager({ categories, links, actions }: CategoryManagerProps) {
  const list = useMemo(() => activeCategories(categories), [categories]);
  const counts = useMemo(() => countByCategory(links), [links]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addForm, setAddForm] = useState(() => ({ key: 0, color: nextCategoryColor(categories) }));

  function remove(category: Category) {
    if (!window.confirm(`Delete "${category.name}"? Its links will stay saved, without a category.`)) return;
    actions.deleteCategory(category.id).catch((error: unknown) => toast.error(errorText(error)));
  }

  return (
    <div className="space-y-6">
      <CategoryForm
        key={addForm.key}
        label="New category"
        initial={{ name: '', color: addForm.color }}
        submitLabel="Add category"
        onSubmit={actions.addCategory}
        onDone={(created) =>
          setAddForm((form) => ({ key: form.key + 1, color: nextCategoryColor([...categories, created]) }))
        }
      />
      {list.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No categories yet.</p>
      ) : (
        <ul aria-label="Categories" className="divide-y divide-slate-200 dark:divide-slate-800">
          {list.map((category) => (
            <li key={category.id} className="py-2">
              {editingId === category.id ? (
                <CategoryForm
                  label={`Edit ${category.name}`}
                  initial={{ name: category.name, color: category.color }}
                  submitLabel="Save"
                  onSubmit={(input) => actions.editCategory(category.id, input)}
                  onDone={() => setEditingId(null)}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <div className="flex items-center gap-3">
                  <ColorDot color={category.color} />
                  <span className="min-w-0 flex-1 truncate font-medium">{category.name}</span>
                  <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
                    {linkCount(counts[category.id] ?? 0)}
                  </span>
                  <IconButton label={`Edit ${category.name}`} onClick={() => setEditingId(category.id)}>
                    <Pencil className="size-4" />
                  </IconButton>
                  <IconButton
                    label={`Delete ${category.name}`}
                    onClick={() => remove(category)}
                    className="hover:text-red-600 dark:hover:text-red-400"
                  >
                    <Trash2 className="size-4" />
                  </IconButton>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
