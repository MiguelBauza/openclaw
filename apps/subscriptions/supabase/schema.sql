-- Mis Suscripciones: run once in Supabase → SQL Editor → New query → Run.
-- Each row is one subscription (or the "__settings" row) stored as JSON, owned
-- by the signed-in user. Row level security keeps every user's rows private.

create table if not exists public.subscriptions (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.subscriptions enable row level security;

drop policy if exists "subscriptions: read own" on public.subscriptions;
create policy "subscriptions: read own" on public.subscriptions
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "subscriptions: insert own" on public.subscriptions;
create policy "subscriptions: insert own" on public.subscriptions
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "subscriptions: update own" on public.subscriptions;
create policy "subscriptions: update own" on public.subscriptions
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "subscriptions: delete own" on public.subscriptions;
create policy "subscriptions: delete own" on public.subscriptions
  for delete to authenticated using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.subscriptions to authenticated;
