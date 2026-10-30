-- Paste this file once into your Supabase SQL Editor.
-- Security: all tables are private. The app accesses them only through SERVER-SIDE service role.
create extension if not exists pgcrypto;

create table if not exists public.reels (
  id uuid primary key default gen_random_uuid(),
  drive_item_id text unique,
  drive_id text,
  source text not null default 'google_drive' check (source in ('google_drive','onedrive','manual')),
  title text not null check (char_length(title) between 1 and 250),
  drive_web_url text,
  client_url text,
  duration_seconds integer check (duration_seconds is null or duration_seconds between 1 and 86400),
  status text not null default 'discovered' check (status in ('discovered','delivered','revision','approved','cancelled')),
  delivery_date date,
  notes text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists reels_delivery_date on public.reels (delivery_date desc);
create index if not exists reels_status on public.reels (status);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  week_ending date not null,
  amount numeric(12,2) not null check (amount > 0 and amount <= 100000000),
  paid_on date not null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists payments_week on public.payments (week_ending desc);

create table if not exists public.app_settings (
  id smallint primary key default 1 check (id = 1),
  folder_path text not null default '',
  last_sync_at timestamptz,
  last_sync_count integer,
  last_sync_error text
);
insert into public.app_settings (id, folder_path) values (1,'') on conflict (id) do nothing;

create table if not exists public.google_drive_connection (
  id smallint primary key default 1 check (id = 1),
  account_email text,
  account_name text,
  refresh_token_ciphertext text not null,
  connected_at timestamptz not null default now()
);

alter table public.reels enable row level security;
alter table public.payments enable row level security;
alter table public.app_settings enable row level security;
alter table public.google_drive_connection enable row level security;
-- No anon/authenticated policies. Public data is served only by the token-checked Next.js server route.
-- Never put SUPABASE_SERVICE_ROLE_KEY in NEXT_PUBLIC_* vars or expose in browser code.
