-- Ask Muse (AI tutor chat): chat storage and the daily question quota.
-- Claude, 2026-11-14. Approved by Alireza (chats saved in the database, 10 questions a day).
-- Additive only: two new tables and new functions. No existing table is changed.
--
-- Who uses what
--   functions/api/assistant.js (Cloudflare, called with the learner's own login token):
--       ai_chat_begin  -> checks the quota, stores the question, returns the learner profile + history
--       ai_chat_finish -> stores Muse's answer and the token usage
--       ai_chat_fail   -> marks the question as failed when DeepSeek failed (it is not counted)
--   the app (src/app/17-ask-muse.js):   ai_chat_today  -> today's chat + how many questions are left
--   the admin panel (/manage/ask-muse): ai_chat_admin  -> usage, cost and recent questions
--
-- Daily limits (per learner's local day, profiles.timezone, default Asia/Tehran): see ai_chat_limit().
-- The tables have RLS on and no policies: nobody reads or writes them directly, only through
-- these functions. ai_chat_finish / ai_chat_fail need the one-time nonce that ai_chat_begin gave
-- the server, so a learner cannot mark a question as failed to get their quota back.
-- Nothing in this file deletes data. (on delete cascade: when an admin deletes a user account,
-- that user's chats go with it, like the rest of their data.)

create table if not exists public.ai_chat_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  profile text not null default '',          -- learner summary sent to the model, frozen for the thread
  created_at timestamptz not null default now()
);
create index if not exists ai_chat_threads_user_idx on public.ai_chat_threads (user_id, created_at desc);

create table if not exists public.ai_chat_messages (
  id bigint generated always as identity primary key,
  thread_id uuid not null references public.ai_chat_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  body text not null,                        -- what the learner sees
  prompt text,                               -- user turns: the exact text sent to the model (screen + question)
  context jsonb,                             -- user turns: where in the app the question was asked
  reply_to bigint unique references public.ai_chat_messages(id) on delete cascade,
  usage jsonb,                               -- assistant turns: tokens, cache hits, cost
  nonce uuid,                                -- user turns: secret for finish / fail
  failed boolean not null default false,     -- user turns: DeepSeek failed, not counted, not shown
  day date not null,                         -- learner's local day (quota)
  created_at timestamptz not null default now()
);
create index if not exists ai_chat_messages_quota_idx on public.ai_chat_messages (user_id, day) where role = 'user' and not failed;
create index if not exists ai_chat_messages_thread_idx on public.ai_chat_messages (thread_id, id);
create index if not exists ai_chat_messages_created_idx on public.ai_chat_messages (created_at desc);

alter table public.ai_chat_threads enable row level security;
alter table public.ai_chat_messages enable row level security;
revoke all on public.ai_chat_threads from anon, authenticated;
revoke all on public.ai_chat_messages from anon, authenticated;

-- The learner's time zone (profiles.timezone if valid, else Asia/Tehran).
create or replace function public.ai_chat_tz(p_uid uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare tz text;
begin
  select timezone into tz from profiles where id = p_uid;
  if tz is null or tz = '' then return 'Asia/Tehran'; end if;
  begin
    perform now() at time zone tz;
  exception when others then
    return 'Asia/Tehran';
  end;
  return tz;
end $$;

-- Questions per day. Change the numbers here.
create or replace function public.ai_chat_limit(p_uid uuid)
returns integer language sql stable security definer set search_path = public as $$
  select case
    when public.is_admin() then 100
    when exists (select 1 from teachers t where t.user_id = p_uid and t.status = 'approved') then 100
    when coalesce((select p.is_vip from profiles p where p.id = p_uid), false) then 50
    else 10
  end;
$$;

-- The learner summary the model gets (built once per thread, then frozen so the prompt prefix
-- stays identical and DeepSeek bills it at the cache-hit price).
create or replace function public.ai_chat_profile(p_uid uuid, p_day date, p_lang text, p_vip boolean)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  pr record; tname text; lang text; lvl text; act_days int; act_min int;
  quizzes text; weak text; mcount int; mlist text; hw text; scount int; slist text;
begin
  select display_name, level, current_streak, longest_streak, created_at, referred_by
    into pr from profiles where id = p_uid;
  lvl := upper(coalesce(nullif(pr.level, ''), 'unknown'));
  lang := case
    when p_lang = 'fa' then 'Persian'
    when p_lang = 'en' then 'English'
    when lower(coalesce(pr.level, '')) in ('a1', 'a2', 'b1', '') then 'Persian'
    else 'English' end;
  if pr.referred_by is not null then
    select display_name into tname from teachers where ref_code = pr.referred_by and status = 'approved' limit 1;
  end if;

  select count(*) filter (where seconds_in_app > 0), coalesce(sum(seconds_in_app), 0) / 60
    into act_days, act_min
    from daily_stats where user_id = p_uid and day > p_day - 14;

  select string_agg(line, '; ') into quizzes from (
    select format('%s %s%s %s/%s', coalesce(date, created_at::date::text), kind,
                  case when coalesce(theme, '') = '' then '' else ' "' || left(theme, 40) || '"' end, score, total) as line
      from quiz_attempts where user_id = p_uid and created_at > now() - interval '30 days'
      order by created_at desc limit 8) q;

  select string_agg(line, '; ') into weak from (
    select format('%s%s %s%% (%s questions)', kind,
                  case when coalesce(theme, '') = '' then '' else ' "' || left(theme, 40) || '"' end,
                  round(100.0 * sum(score) / nullif(sum(total), 0)), sum(total)) as line
      from quiz_attempts where user_id = p_uid and created_at > now() - interval '30 days' and total > 0
      group by kind, theme
      having sum(total) >= 5 and sum(score)::numeric / sum(total) < 0.8
      order by sum(score)::numeric / sum(total) asc limit 4) w;

  select count(*) into mcount from mistakes where user_id = p_uid;
  select string_agg(line, E'\n') into mlist from (
    select format('- "%s" | their answer: %s | correct: %s%s', left(regexp_replace(question, '\s+', ' ', 'g'), 140),
                  coalesce(left(options ->> picked, 60), '?'), coalesce(left(options ->> answer, 60), '?'),
                  case when coalesce(kind, '') = '' then '' else ' (' || kind || ')' end) as line
      from mistakes where user_id = p_uid order by created_at desc limit 8) m;

  select string_agg(line, '; ') into hw from (
    select format('"%s" %s/%s on %s', left(coalesce(a.topic_label, a.title, 'homework'), 50), r.score, r.total,
                  r.completed_at::date) as line
      from assignment_results r join assignments a on a.id = r.assignment_id
      where r.student_id = p_uid order by r.completed_at desc nulls last limit 5) h;

  select count(*) into scount from saved_words where user_id = p_uid;
  select string_agg(word, ', ') into slist from (
    select left(word, 30) as word from saved_words where user_id = p_uid order by created_at desc limit 10) s;

  return concat_ws(E'\n',
    'LEARNER PROFILE (from this learner''s real activity in the app)',
    format('Today (learner''s local date): %s', p_day),
    format('Name: %s | Level: %s | Reply language: %s | Plan: %s | Teacher: %s',
           coalesce(nullif(left(regexp_replace(coalesce(pr.display_name, ''), '\s+', ' ', 'g'), 40), ''), 'not set'), lvl, lang,
           case when p_vip then 'VIP' else 'free' end, coalesce(tname, 'none')),
    format('Days since joining: %s | Streak: %s days (best %s) | Active days in the last 14: %s, about %s minutes',
           coalesce((p_day - pr.created_at::date)::text, '?'), coalesce(pr.current_streak, 0), coalesce(pr.longest_streak, 0),
           coalesce(act_days, 0), coalesce(act_min, 0)),
    'Recent quizzes (newest first): ' || coalesce(quizzes, 'none yet'),
    'Weakest topics (last 30 days): ' || coalesce(weak, 'none below 80%'),
    format('Mistakes waiting for review: %s%s', mcount, case when mlist is null then '' else E'. Latest:\n' || mlist end),
    'Homework from teacher (newest first): ' || coalesce(hw, 'none'),
    format('Saved words: %s%s', scount, case when slist is null then '' else ' (latest: ' || slist || ')' end)
  );
end $$;

-- Called by functions/api/assistant.js before asking DeepSeek.
create or replace function public.ai_chat_begin(p_body text, p_prompt text, p_context jsonb, p_new boolean, p_lang text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); tz text; d date; lim int; used int; vip boolean;
  th_id uuid; th_profile text; n int; mid bigint; nn uuid := gen_random_uuid(); hist jsonb;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p_body is null or char_length(trim(p_body)) = 0 or char_length(p_body) > 1000
     or p_prompt is null or char_length(p_prompt) > 6000
     or (p_context is not null and octet_length(p_context::text) > 4000) then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ai_chat:' || uid::text, 0));
  tz := ai_chat_tz(uid);
  d := (now() at time zone tz)::date;
  lim := ai_chat_limit(uid);
  vip := coalesce((select is_vip from profiles where id = uid), false);
  select count(*) into used from ai_chat_messages where user_id = uid and role = 'user' and day = d and not failed;
  if used >= lim then
    return jsonb_build_object('ok', false, 'reason', 'limit', 'used', used, 'limit', lim, 'vip', vip);
  end if;

  if not coalesce(p_new, false) then
    select t.id, t.profile into th_id, th_profile from ai_chat_threads t
      where t.user_id = uid and t.day = d order by t.created_at desc limit 1;
    if th_id is not null then
      select count(*) into n from ai_chat_messages where thread_id = th_id;
      if n >= 30 then th_id := null; end if;
    end if;
  end if;
  if th_id is null then
    th_profile := ai_chat_profile(uid, d, coalesce(p_lang, ''), vip);
    insert into ai_chat_threads (user_id, day, profile) values (uid, d, th_profile) returning id into th_id;
  end if;

  -- answered pairs only (question + Muse's answer), the last 12, oldest first. User turns use the
  -- exact text the model saw, so the prompt prefix is byte-identical to the earlier request.
  with pairs as (
    select q.id as qid, coalesce(q.prompt, q.body) as qtext, a.body as atext
      from ai_chat_messages q join ai_chat_messages a on a.reply_to = q.id
      where q.thread_id = th_id and q.role = 'user'
      order by q.id desc limit 12)
  select coalesce(jsonb_agg(s.m order by s.qid, s.ord), '[]'::jsonb) into hist from (
    select qid, 0 as ord, jsonb_build_object('role', 'user', 'content', qtext) as m from pairs
    union all
    select qid, 1, jsonb_build_object('role', 'assistant', 'content', atext) from pairs) s;

  insert into ai_chat_messages (thread_id, user_id, role, body, prompt, context, nonce, day)
    values (th_id, uid, 'user', trim(p_body), p_prompt, p_context, nn, d) returning id into mid;

  return jsonb_build_object('ok', true, 'thread_id', th_id, 'message_id', mid, 'nonce', nn,
    'used', used + 1, 'limit', lim, 'remaining', lim - used - 1, 'vip', vip,
    'profile', th_profile, 'history', hist);
end $$;

-- Numbers from the usage object (anything else counts as 0).
create or replace function public.ai_chat_num(p text)
returns numeric language plpgsql immutable as $$
begin
  if p ~ '^[0-9]{1,12}([.][0-9]{1,10})?$' then return p::numeric; end if;
  return 0;
end $$;

-- Store Muse's answer (server only: needs the nonce from ai_chat_begin).
create or replace function public.ai_chat_finish(p_message_id bigint, p_nonce uuid, p_body text, p_usage jsonb)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare uid uuid := auth.uid(); m record;
begin
  if uid is null or p_body is null or char_length(trim(p_body)) = 0 then return false; end if;
  select * into m from ai_chat_messages
    where id = p_message_id and user_id = uid and role = 'user' and nonce = p_nonce and not failed
      and created_at > now() - interval '15 minutes';
  if not found then return false; end if;
  if exists (select 1 from ai_chat_messages where reply_to = p_message_id) then return false; end if;
  insert into ai_chat_messages (thread_id, user_id, role, body, reply_to, usage, day)
    values (m.thread_id, uid, 'assistant', left(p_body, 8000), p_message_id,
            case when p_usage is null then null else jsonb_build_object(
              'model', left(coalesce(p_usage ->> 'model', ''), 40),
              'hit', ai_chat_num(p_usage ->> 'hit'), 'miss', ai_chat_num(p_usage ->> 'miss'),
              'out', ai_chat_num(p_usage ->> 'out'), 'reasoning', ai_chat_num(p_usage ->> 'reasoning'),
              'cost_usd', ai_chat_num(p_usage ->> 'cost_usd'), 'peak', coalesce((p_usage ->> 'peak') = 'true', false),
              'ms', ai_chat_num(p_usage ->> 'ms')) end,
            m.day);
  update ai_chat_messages set nonce = null where id = p_message_id;
  return true;
end $$;

-- DeepSeek failed: mark the question so it does not count (server only: needs the nonce). Nothing is deleted.
create or replace function public.ai_chat_fail(p_message_id bigint, p_nonce uuid)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return false; end if;
  update ai_chat_messages set failed = true, nonce = null
    where id = p_message_id and user_id = uid and role = 'user' and nonce = p_nonce and not failed
      and created_at > now() - interval '15 minutes'
      and not exists (select 1 from ai_chat_messages a where a.reply_to = p_message_id);
  return found;
end $$;

-- For the app: today's chat and the quota.
create or replace function public.ai_chat_today()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); d date; lim int; used int; th_id uuid; msgs jsonb;
begin
  if uid is null then return jsonb_build_object('ok', false); end if;
  d := (now() at time zone ai_chat_tz(uid))::date;
  lim := ai_chat_limit(uid);
  select count(*) into used from ai_chat_messages where user_id = uid and role = 'user' and day = d and not failed;
  select id into th_id from ai_chat_threads where user_id = uid and day = d order by created_at desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'role', role, 'body', body, 'at', created_at) order by id), '[]'::jsonb)
    into msgs from ai_chat_messages where thread_id = th_id and not failed;
  return jsonb_build_object('ok', true, 'used', used, 'limit', lim, 'remaining', greatest(lim - used, 0),
    'vip', coalesce((select is_vip from profiles where id = uid), false), 'thread_id', th_id, 'messages', coalesce(msgs, '[]'::jsonb));
end $$;

-- For /manage/ask-muse: usage, cost, recent questions (admins only).
create or replace function public.ai_chat_admin(p_days integer default 14)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare days jsonb; recent jsonb; tot jsonb;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  select coalesce(jsonb_agg(x order by x.day desc), '[]'::jsonb) into days from (
    select (m.created_at at time zone 'Asia/Tehran')::date as day,
           count(*) filter (where m.role = 'user' and not m.failed) as questions,
           count(distinct m.user_id) as learners,
           coalesce(sum(ai_chat_num(m.usage ->> 'hit')), 0) as hit,
           coalesce(sum(ai_chat_num(m.usage ->> 'miss')), 0) as miss,
           coalesce(sum(ai_chat_num(m.usage ->> 'out')), 0) as out,
           coalesce(sum(ai_chat_num(m.usage ->> 'reasoning')), 0) as reasoning,
           round(coalesce(sum(ai_chat_num(m.usage ->> 'cost_usd')), 0), 4) as cost_usd
      from ai_chat_messages m
      where m.created_at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 14), 90)))
      group by 1) x;
  select jsonb_build_object(
           'questions', count(*) filter (where role = 'user' and not failed),
           'learners', count(distinct user_id),
           'cost_usd', round(coalesce(sum(ai_chat_num(usage ->> 'cost_usd')), 0), 4))
    into tot from ai_chat_messages where created_at > now() - interval '30 days';
  select coalesce(jsonb_agg(r order by r.at desc), '[]'::jsonb) into recent from (
    select q.created_at as at, q.user_id, p.display_name as name, p.email, p.level,
           left(q.body, 300) as question, q.context ->> 'view' as view,
           left(a.body, 400) as answer
      from ai_chat_messages q
      left join ai_chat_messages a on a.reply_to = q.id
      left join profiles p on p.id = q.user_id
      where q.role = 'user' and not q.failed
      order by q.created_at desc limit 60) r;
  return jsonb_build_object('days', days, 'last30', tot, 'recent', recent);
end $$;

revoke all on function public.ai_chat_tz(uuid) from public, anon, authenticated;
revoke all on function public.ai_chat_limit(uuid) from public, anon, authenticated;
revoke all on function public.ai_chat_profile(uuid, date, text, boolean) from public, anon, authenticated;
revoke all on function public.ai_chat_num(text) from public, anon, authenticated;
revoke all on function public.ai_chat_begin(text, text, jsonb, boolean, text) from public, anon;
revoke all on function public.ai_chat_finish(bigint, uuid, text, jsonb) from public, anon;
revoke all on function public.ai_chat_fail(bigint, uuid) from public, anon;
revoke all on function public.ai_chat_today() from public, anon;
revoke all on function public.ai_chat_admin(integer) from public, anon;
grant execute on function public.ai_chat_begin(text, text, jsonb, boolean, text) to authenticated;
grant execute on function public.ai_chat_finish(bigint, uuid, text, jsonb) to authenticated;
grant execute on function public.ai_chat_fail(bigint, uuid) to authenticated;
grant execute on function public.ai_chat_today() to authenticated;
grant execute on function public.ai_chat_admin(integer) to authenticated;
