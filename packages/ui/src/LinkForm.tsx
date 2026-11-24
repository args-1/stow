import {
  activeCategories,
  formatTags,
  parseLinkInput,
  parseTagString,
  type Category,
  type Link,
  type PageMetadataInput,
  type ParsedLinkInput,
} from '@linkstash/core';
import { useId, useState, type FormEvent } from 'react';
import { CategoryPicker } from './CategoryPicker';
import { Field } from './Field';
import { buttonClass, inputClass, secondaryButtonClass } from './styles';

export interface LinkFormValues {
  url: string;
  customTitle: string;
  /** '' means "No category". */
  categoryId: string;
  /** Comma-separated. */
  tags: string;
  notes: string;
}

export interface LinkFormProps {
  /** Read once, on mount. Remount with a React `key` to reset the form. */
  initial?: Partial<LinkFormValues>;
  /** Page title, description and favicon, sent along with the form values. */
  metadata?: PageMetadataInput;
  categories: readonly Category[];
  submitLabel?: string;
  busy?: boolean;
  urlReadOnly?: boolean;
  titlePlaceholder?: string;
  onSubmit(input: ParsedLinkInput): void | Promise<void>;
  onCancel?(): void;
}

const EMPTY: LinkFormValues = { url: '', customTitle: '', categoryId: '', tags: '', notes: '' };

/** The starting values for editing a saved link. */
export function linkFormValues(link: Link): LinkFormValues {
  return {
    url: link.url,
    customTitle: link.custom_title ?? '',
    categoryId: link.category_id ?? '',
    tags: formatTags(link.tags),
    notes: link.notes ?? '',
  };
}

export function LinkForm({
  initial,
  metadata,
  categories,
  submitLabel = 'Save',
  busy = false,
  urlReadOnly = false,
  titlePlaceholder = 'Defaults to the page title',
  onSubmit,
  onCancel,
}: LinkFormProps) {
  const id = useId();
  const [values, setValues] = useState<LinkFormValues>(() => ({ ...EMPTY, ...initial }));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const update = (key: keyof LinkFormValues, value: string) => setValues((v) => ({ ...v, [key]: value }));

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const categoryIsActive = activeCategories(categories).some((c) => c.id === values.categoryId);
    const parsed = parseLinkInput({
      ...metadata,
      url: values.url,
      customTitle: values.customTitle,
      notes: values.notes,
      tags: parseTagString(values.tags),
      categoryId: categoryIsActive ? values.categoryId : null,
    });
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError(null);
    setPending(true);
    try {
      await onSubmit(parsed.value);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="space-y-3">
      <Field id={`${id}-url`} label="URL">
        <input
          id={`${id}-url`}
          className={inputClass}
          inputMode="url"
          autoComplete="url"
          placeholder="https://example.com"
          readOnly={urlReadOnly}
          value={values.url}
          onChange={(e) => update('url', e.target.value)}
        />
      </Field>
      <Field id={`${id}-title`} label="Title">
        <input
          id={`${id}-title`}
          className={inputClass}
          placeholder={titlePlaceholder}
          value={values.customTitle}
          onChange={(e) => update('customTitle', e.target.value)}
        />
      </Field>
      <Field id={`${id}-category`} label="Category">
        <CategoryPicker
          id={`${id}-category`}
          categories={categories}
          value={values.categoryId}
          onChange={(value) => update('categoryId', value)}
        />
      </Field>
      <Field id={`${id}-tags`} label="Tags" hint="Comma-separated, e.g. recipes, to-read">
        <input
          id={`${id}-tags`}
          className={inputClass}
          value={values.tags}
          onChange={(e) => update('tags', e.target.value)}
        />
      </Field>
      <Field id={`${id}-notes`} label="Notes">
        <textarea
          id={`${id}-notes`}
          className={inputClass}
          rows={3}
          value={values.notes}
          onChange={(e) => update('notes', e.target.value)}
        />
      </Field>
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-1">
        {onCancel && (
          <button type="button" className={secondaryButtonClass} onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className={buttonClass} disabled={busy || pending}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
