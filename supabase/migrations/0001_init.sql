-- Takaaca - skema awal
-- Jalankan di Supabase SQL Editor (atau `supabase db push`).

create extension if not exists pgcrypto;

-- ============ PROFIL ============
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_emoji text not null default '💙',
  anniversary_date date,
  default_reminder_minutes integer not null default 60,
  created_at timestamptz not null default now()
);

-- ============ AGENDA ============
create table if not exists public.agendas (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 200),
  description text,
  event_date date not null,
  start_time time,
  end_time time,
  category text not null default 'task' check (category in ('task', 'date', 'anniversary')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  assignee uuid references public.profiles (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'done', 'cancelled')),
  completed_at timestamptz,
  reminder_enabled boolean not null default true,
  reminder_at timestamptz,
  reminder_sent_at timestamptz,
  notify_partner boolean not null default true,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agendas_event_date_idx on public.agendas (event_date);
create index if not exists agendas_status_idx on public.agendas (status);
create index if not exists agendas_reminder_idx on public.agendas (reminder_at)
  where status = 'pending' and reminder_enabled and reminder_sent_at is null;

-- ============ FOTO (Supabase Storage) ============
create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique,
  name text not null,
  mime_type text,
  size_bytes bigint,
  web_view_link text,
  uploaded_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists photos_created_at_idx on public.photos (created_at desc);

-- Bucket penyimpanan foto. Public agar gambar bisa langsung ditampilkan;
-- path file memakai uuid sehingga tidak bisa ditebak.
insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do nothing;

drop policy if exists "photos_objects_read" on storage.objects;
create policy "photos_objects_read" on storage.objects
  for select to authenticated using (bucket_id = 'photos');

-- ============ PUSH SUBSCRIPTION ============
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists push_subs_user_idx on public.push_subscriptions (user_id);

-- ============ updated_at otomatis ============
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists agendas_set_updated_at on public.agendas;
create trigger agendas_set_updated_at
  before update on public.agendas
  for each row execute function public.set_updated_at();

-- ============ PROFIL otomatis saat user baru ============
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, avatar_emoji)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    '💙'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- User yang sudah ada sebelum trigger terpasang tetap butuh profil,
-- kalau tidak agenda tidak bisa dibuat (FK created_by -> profiles).
insert into public.profiles (id, display_name, avatar_emoji)
select
  u.id,
  coalesce(u.raw_user_meta_data ->> 'display_name', split_part(u.email, '@', 1)),
  '💙'
from auth.users u
on conflict (id) do nothing;

-- ============ RLS ============
alter table public.profiles enable row level security;
alter table public.agendas enable row level security;
alter table public.photos enable row level security;
alter table public.push_subscriptions enable row level security;

-- profiles: semua user terautentikasi (hanya 2 akun pasangan) bisa lihat,
-- hanya bisa mengubah miliknya sendiri.
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select to authenticated using (true);

drop policy if exists "profiles_insert" on public.profiles;
create policy "profiles_insert" on public.profiles
  for insert to authenticated with check (id = auth.uid());

drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_update" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- agendas: pasangan saling lihat & kelola.
drop policy if exists "agendas_all" on public.agendas;
create policy "agendas_all" on public.agendas
  for all to authenticated using (true) with check (created_by = auth.uid());

-- photos: sama seperti agenda.
drop policy if exists "photos_all" on public.photos;
create policy "photos_all" on public.photos
  for all to authenticated using (true) with check (uploaded_by = auth.uid());

-- push_subscriptions: hanya milik sendiri.
drop policy if exists "push_subs_own" on public.push_subscriptions;
create policy "push_subs_own" on public.push_subscriptions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============ REALTIME ============
alter publication supabase_realtime add table public.agendas;
alter publication supabase_realtime add table public.photos;
