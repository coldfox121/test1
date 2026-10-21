-- test1 云端账号与云存档
-- 使用方式：在 Supabase 控制台 -> SQL Editor 中整段执行。
-- 执行前请在 Authentication -> Providers -> Email 中关闭 Confirm email，
-- 否则注册后不会立即得到登录会话。

-- 1. 玩家档案表：一行对应一个账号，save 保存完整游戏进度
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,16}$'),
  save jsonb not null default '{}'::jsonb,
  last_seen timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. 行级权限：每个玩家只能读写自己的档案
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- 3. 读取存档：同时返回服务器当前时间，用于离线收益结算
create or replace function public.load_game()
returns table (save jsonb, last_seen timestamptz, server_now timestamptz)
language sql
security definer
set search_path = public
as $$
  select p.save, p.last_seen, now()
  from public.profiles p
  where p.id = auth.uid();
$$;

-- 4. 写入存档：只允许写自己的档案，last_seen 由服务器生成
create or replace function public.save_game(p_save jsonb)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_time timestamptz := now();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  v_name := lower(coalesce(
    auth.jwt() -> 'user_metadata' ->> 'username',
    'player_' || left(v_uid::text, 8)
  ));

  insert into public.profiles (id, username, save, last_seen, updated_at)
  values (v_uid, v_name, p_save, v_time, v_time)
  on conflict (id) do update
    set save = excluded.save,
        last_seen = excluded.last_seen,
        updated_at = excluded.updated_at;

  return v_time;
end;
$$;

-- 5. 只允许已登录玩家调用这两个函数
revoke all on function public.load_game() from public, anon;
revoke all on function public.save_game(jsonb) from public, anon;
grant execute on function public.load_game() to authenticated;
grant execute on function public.save_game(jsonb) to authenticated;
