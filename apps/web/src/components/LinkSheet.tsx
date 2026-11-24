import type { Category, Link, ParsedLinkInput } from '@linkstash/core';
import { LinkForm, linkFormValues } from '@linkstash/ui';
import { useState } from 'react';
import type { Actions } from '../actions';
import { toast } from '../toast';
import { Sheet } from './Sheet';

export type LinkSheetTarget = { mode: 'add'; url?: string; title?: string | null } | { mode: 'edit'; link: Link };

export interface LinkSheetProps {
  target: LinkSheetTarget;
  categories: readonly Category[];
  actions: Pick<Actions, 'addLink' | 'editLink'>;
  onClose(): void;
}

export function LinkSheet({ target: initialTarget, categories, actions, onClose }: LinkSheetProps) {
  const [target, setTarget] = useState(initialTarget);

  async function submit(input: ParsedLinkInput) {
    if (target.mode === 'add') {
      const result = await actions.addLink(input);
      if (result.status === 'duplicate') {
        toast.info('You already saved this link. You can edit it here.');
        setTarget({ mode: 'edit', link: result.link });
        return;
      }
    } else {
      const result = await actions.editLink(target.link.id, input);
      if (result.status === 'duplicate') throw new Error('Another saved link already points to this page.');
    }
    toast.info('Link saved');
    onClose();
  }

  if (target.mode === 'add') {
    return (
      <Sheet title="Add link" onClose={onClose}>
        <LinkForm
          key="add"
          initial={{ url: target.url ?? '' }}
          metadata={{ title: target.title }}
          categories={categories}
          submitLabel="Save link"
          onSubmit={submit}
          onCancel={onClose}
        />
      </Sheet>
    );
  }

  const { link } = target;
  return (
    <Sheet title="Edit link" onClose={onClose}>
      <LinkForm
        key={link.id}
        initial={linkFormValues(link)}
        titlePlaceholder={link.title}
        categories={categories}
        submitLabel="Save changes"
        onSubmit={submit}
        onCancel={onClose}
      />
    </Sheet>
  );
}
