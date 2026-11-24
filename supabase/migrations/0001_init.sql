-- Stow schema. Run once per project: paste into the Supabase SQL editor and press Run.

create table public.categories (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 50),
  color text not null check (color ~ '^#[0-9a-f]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.links (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  url text not null check (url ~ '^https?://'),
  url_key text not null,
  title text not null default '' check (char_length(title) <= 300),
  custom_title text check (char_length(custom_title) <= 300),
  description text check (char_length(description) <= 1000),
  favicon_url text,
  notes text check (char_length(notes) <= 5000),
  tags text[] not null default '{}' check (cardinality(tags) <= 20),
  category_id uuid references public.categories (id) on delete set null,
  is_favorite boolean not null default false,
  is_archived boolean not null default false,
  visit_count integer not null default 0 check (visit_count >= 0),
  last_visited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Pull queries (updated_at > cursor), duplicate lookup by url_key, and category clean-up.
create index categories_user_updated_idx on public.categories (user_id, updated_at);
create index links_user_updated_idx on public.links (user_id, updated_at);
create index links_user_url_key_idx on public.links (user_id, url_key) where deleted_at is null;
create index links_category_idx on public.links (category_id);

-- The server owns updated_at so every client sees one clock. clock_timestamp() (not now())
-- keeps it close to commit time, which the clients' 5 s pull overlap relies on.
create function public.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger categories_set_updated_at before insert or update on public.categories
  for each row execute function public.set_updated_at();
create trigger links_set_updated_at before insert or update on public.links
  for each row execute function public.set_updated_at();

-- Deletes are soft (deleted_at), so "on delete set null" never fires; do the same by hand.
create function public.clear_deleted_category() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.links set category_id = null
  where category_id = new.id and user_id = new.user_id;
  return null;
end;
$$;

create trigger categories_clear_deleted after update of deleted_at on public.categories
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function public.clear_deleted_category();

-- Atomic visit counter, so visits from several devices add up instead of overwriting each other.
-- security invoker: row level security still limits it to the caller's own links.
create function public.increment_visit(link_id uuid) returns void
language sql
security invoker
set search_path = ''
as $$
  update public.links
  set visit_count = visit_count + 1, last_visited_at = now()
  where id = link_id;
$$;

revoke execute on function public.increment_visit(uuid) from public, anon;
grant execute on function public.increment_visit(uuid) to authenticated;

alter table public.categories enable row level security;
alter table public.links enable row level security;

create policy "Users read own categories" on public.categories
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users insert own categories" on public.categories
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update own categories" on public.categories
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete own categories" on public.categories
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Users read own links" on public.links
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users insert own links" on public.links
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update own links" on public.links
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete own links" on public.links
  for delete to authenticated using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.categories, public.links to authenticated;

alter publication supabase_realtime add table public.categories, public.links;
