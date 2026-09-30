-- Migration 028: In-App Notifications and Realtime Triggers
-- Supports in-app notification center, unread counters, and automated triggers
-- including faculty notifications when evaluation results are released.

-- 1. Create notifications table
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  title text not null,
  message text not null,
  type text default 'info',         -- 'info' | 'success' | 'warning' | 'alert'
  link text,                        -- Target route, e.g. '/faculty/evaluations', '/student/dashboard'
  is_read boolean default false,
  created_at timestamptz default now()
);

-- Index for fast user queries and unread counting
create index if not exists idx_notifications_user_unread 
  on public.notifications(user_id, is_read, created_at desc);

-- 2. Enable Row Level Security (RLS)
alter table public.notifications enable row level security;

-- Drop existing policies if any
drop policy if exists "Users can view own notifications" on public.notifications;
drop policy if exists "Users can update own notifications" on public.notifications;
drop policy if exists "Users can delete own notifications" on public.notifications;
drop policy if exists "Users and system can insert notifications" on public.notifications;

-- RLS: Users can only see their own notifications
create policy "Users can view own notifications"
  on public.notifications for select
  using (auth.uid() = user_id);

-- RLS: Users can mark their own notifications as read
create policy "Users can update own notifications"
  on public.notifications for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- RLS: Users can delete their own notifications
create policy "Users can delete own notifications"
  on public.notifications for delete
  using (auth.uid() = user_id);

-- RLS: Authenticated users / triggers / service role can insert notifications
create policy "Users and system can insert notifications"
  on public.notifications for insert
  with check (auth.role() = 'authenticated' or auth.role() = 'service_role');

-- 3. Enable Supabase Realtime for notifications
do $$
begin
  if not exists (
    select 1 from pg_publication_tables 
    where pubname = 'supabase_realtime' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
exception
  when others then null;
end $$;

-- 4. RPC: Notify faculty when evaluation results are released
create or replace function public.notify_faculty_on_release(
  p_academic_year text,
  p_semester text,
  p_department text default null
)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  notified_count int := 0;
begin
  with inserted as (
    insert into public.notifications (user_id, title, message, type, link)
    select 
      u.id,
      'Evaluation Results Released',
      format('Evaluation results for %s %s have been published. You can now view your student ratings and feedback.', p_academic_year, p_semester),
      'success',
      '/faculty/evaluations'
    from public.users u
    where u.role = 'faculty'
      and (p_department is null or trim(p_department) = '' or u.department = p_department)
      and u.status != 'deleted'
      -- Avoid duplicate notification for the exact same period release within 24 hours
      and not exists (
        select 1 from public.notifications n
        where n.user_id = u.id
          and n.title = 'Evaluation Results Released'
          and n.message like format('%%%s %s%%', p_academic_year, p_semester)
          and n.created_at > now() - interval '1 day'
      )
    returning id
  )
  select count(*) into notified_count from inserted;

  return notified_count;
end;
$$;

grant execute on function public.notify_faculty_on_release(text, text, text) to authenticated;

-- 5. Trigger: Automatically invoke notify_faculty_on_release when evaluation_releases is published
create or replace function public.trg_notify_faculty_release_fn()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Trigger when approved is true and release_date is today or in the past
  if new.approved = true and new.release_date is not null and new.release_date <= current_date then
    if (tg_op = 'INSERT') 
       or (old.approved is distinct from true) 
       or (old.release_date is distinct from new.release_date) then
      perform public.notify_faculty_on_release(new.academic_year, new.semester, new.department);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_evaluation_releases_notify on public.evaluation_releases;
create trigger trg_evaluation_releases_notify
after insert or update on public.evaluation_releases
for each row execute function public.trg_notify_faculty_release_fn();

-- 6. Trigger: Automatically notify student when subject correction request is resolved or updated
create or replace function public.trg_notify_student_correction_fn()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status in ('resolved', 'rejected') and (old.status is distinct from new.status) then
    insert into public.notifications (user_id, title, message, type, link)
    values (
      new.student_id,
      case when new.status = 'resolved' then 'Subject Issue Resolved' else 'Subject Issue Update' end,
      case 
        when new.resolution_note is not null and trim(new.resolution_note) != '' 
        then format('Admin update: %s', new.resolution_note)
        else format('Your subject list issue has been marked as %s by the administrator.', new.status)
      end,
      case when new.status = 'resolved' then 'success' else 'info' end,
      '/student/dashboard'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_subject_correction_notify on public.subject_correction_requests;
create trigger trg_subject_correction_notify
after update on public.subject_correction_requests
for each row execute function public.trg_notify_student_correction_fn();

-- 7. Trigger: Automatically notify administrators when a new subject issue is submitted
create or replace function public.trg_notify_admin_new_correction_fn()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.notifications (user_id, title, message, type, link)
  select
    u.id,
    'New Subject Issue Reported',
    'A student has submitted an issue regarding their assigned subject list.',
    'warning',
    '/admin/subject-corrections'
  from public.users u
  where u.role in ('admin', 'super_admin')
    and u.status = 'active';
  return new;
end;
$$;

drop trigger if exists trg_new_subject_correction_notify on public.subject_correction_requests;
create trigger trg_new_subject_correction_notify
after insert on public.subject_correction_requests
for each row execute function public.trg_notify_admin_new_correction_fn();
