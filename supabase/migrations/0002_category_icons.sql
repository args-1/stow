-- Stow: category icons. Run once, after 0001_init.sql and before using a build with category icons.
alter table public.categories
  add column icon text not null default 'folder'
  constraint categories_icon_format check (icon ~ '^[a-z0-9-]{1,40}$');
