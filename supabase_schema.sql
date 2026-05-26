-- ============================================================
-- BinVentory database schema
-- Run this in your Supabase project: SQL Editor > New query > paste > Run
-- ============================================================

-- Containers table: one row per labeled box/bin.
create table if not exists public.containers (
  id          text primary key,            -- the value encoded in the QR code
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null default 'Untitled',
  location    text default '',
  category    text default '',
  description text default '',
  photos      jsonb not null default '[]'::jsonb,   -- array of public image URLs
  contents    jsonb not null default '[]'::jsonb,   -- array of item objects
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Per-user settings (e.g. reseller mode on/off).
create table if not exists public.settings (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  reseller_mode  boolean not null default false,
  updated_at     timestamptz not null default now()
);

-- Keep updated_at fresh on every write.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists containers_touch on public.containers;
create trigger containers_touch before update on public.containers
  for each row execute function public.touch_updated_at();

-- ============================================================
-- Row Level Security: each user can only see/edit their own rows.
-- ============================================================
alter table public.containers enable row level security;
alter table public.settings  enable row level security;

drop policy if exists "own containers" on public.containers;
create policy "own containers" on public.containers
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own settings" on public.settings;
create policy "own settings" on public.settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- Storage bucket for container photos.
-- ============================================================
insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do nothing;

drop policy if exists "own photo uploads" on storage.objects;
create policy "own photo uploads" on storage.objects
  for insert with check (
    bucket_id = 'photos' and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "own photo deletes" on storage.objects;
create policy "own photo deletes" on storage.objects
  for delete using (
    bucket_id = 'photos' and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "public photo reads" on storage.objects;
create policy "public photo reads" on storage.objects
  for select using (bucket_id = 'photos');
