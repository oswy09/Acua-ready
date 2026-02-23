-- Ejecuta este script en Supabase SQL Editor

create table if not exists public.user_app_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.user_app_state enable row level security;

-- Lectura solo de tu propia fila
drop policy if exists "user_app_state_select_own" on public.user_app_state;
create policy "user_app_state_select_own"
on public.user_app_state
for select
using (auth.uid() = user_id);

-- Inserción solo de tu propia fila
drop policy if exists "user_app_state_insert_own" on public.user_app_state;
create policy "user_app_state_insert_own"
on public.user_app_state
for insert
with check (auth.uid() = user_id);

-- Actualización solo de tu propia fila
drop policy if exists "user_app_state_update_own" on public.user_app_state;
create policy "user_app_state_update_own"
on public.user_app_state
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Borrado solo de tu propia fila
drop policy if exists "user_app_state_delete_own" on public.user_app_state;
create policy "user_app_state_delete_own"
on public.user_app_state
for delete
using (auth.uid() = user_id);
