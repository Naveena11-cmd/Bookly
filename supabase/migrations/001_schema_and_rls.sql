create extension if not exists btree_gist;
create extension if not exists pgcrypto;

-- ===== Tables =====
create table businesses (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  timezone text not null default 'UTC',
  phone text, email text,
  status text not null default 'active' check (status in ('active','suspended')),
  created_at timestamptz not null default now()
);
create table business_members (
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner','admin')),
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);
create index on business_members(user_id);

create table services (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  description text,
  duration_minutes int not null check (duration_minutes between 5 and 480),
  price_cents int not null check (price_cents between 0 and 10000000),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index on services(business_id);

create table providers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null, active boolean not null default true
);
create index on providers(business_id);
-- A provider with NO rows here can perform every service.
create table provider_services (
  provider_id uuid references providers(id) on delete cascade,
  service_id uuid references services(id) on delete cascade,
  primary key (provider_id, service_id)
);

create table business_hours (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  day_of_week int not null check (day_of_week between 0 and 6), -- 0 = Sunday
  start_time time not null, end_time time not null check (end_time > start_time),
  enabled boolean not null default true,
  unique (business_id, day_of_week)
);
-- If a provider has ANY rows here, they fully override business hours.
create table provider_hours (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references providers(id) on delete cascade,
  day_of_week int not null check (day_of_week between 0 and 6),
  start_time time not null, end_time time not null check (end_time > start_time),
  enabled boolean not null default true,
  unique (provider_id, day_of_week)
);
create table blocked_periods (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  provider_id uuid references providers(id) on delete cascade, -- null = whole business
  starts_at timestamptz not null, ends_at timestamptz not null check (ends_at > starts_at),
  reason text
);
create index on blocked_periods(business_id, starts_at);

-- Phone stored normalised (digits and +), email lower-cased -> dedupe per tenant.
create table clients (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null, email text, phone text, notes text,
  created_at timestamptz not null default now()
);
create unique index clients_email_uq on clients(business_id, email) where email is not null;
create unique index clients_phone_uq on clients(business_id, phone) where phone is not null;

create table bookings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  service_id uuid not null references services(id),
  provider_id uuid not null references providers(id),
  client_id uuid not null references clients(id),
  starts_at timestamptz not null, ends_at timestamptz not null,
  status text not null default 'confirmed'
    check (status in ('pending','confirmed','cancelled','completed','no_show')),
  price_cents int not null check (price_cents >= 0),
  source text not null default 'public',
  notes text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  -- FINAL double-booking guarantee. [start,end) so back-to-back bookings are allowed.
  constraint bookings_no_overlap exclude using gist
    (provider_id with =, tstzrange(starts_at, ends_at, '[)') with &&)
    where (status in ('pending','confirmed'))
);
create index on bookings(business_id, starts_at);
create index on bookings(client_id);

create table booking_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  booking_id uuid not null references bookings(id) on delete cascade,
  event_type text not null, actor_id uuid, metadata jsonb,
  created_at timestamptz not null default now()
);
create index on booking_events(booking_id);

create table reminders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  booking_id uuid not null references bookings(id) on delete cascade,
  channel text not null default 'email',
  scheduled_for timestamptz not null default now(),
  sent_at timestamptz,
  status text not null default 'pending' check (status in ('pending','sending','sent','failed')),
  attempts int not null default 0, last_error text,
  unique (booking_id, channel) -- idempotency: one reminder per booking/channel
);
create table notification_logs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  booking_id uuid references bookings(id) on delete set null,
  channel text, template text, status text, provider_message_id text, error text,
  created_at timestamptz not null default now()
);
create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references businesses(id) on delete cascade,
  provider_customer_id text, provider_subscription_id text,
  plan text not null default 'monthly',
  status text not null check (status in ('active','trialing','past_due','cancelled','incomplete')),
  current_period_end timestamptz
);
create table processed_webhook_events (   -- replay protection; service role only
  id text primary key, type text, received_at timestamptz not null default now()
);

-- Cross-tenant reference guard (a booking may only reference rows of its own tenant)
create function bookings_tenant_guard() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from services  where id=new.service_id  and business_id=new.business_id)
  or not exists (select 1 from providers where id=new.provider_id and business_id=new.business_id)
  or not exists (select 1 from clients   where id=new.client_id   and business_id=new.business_id)
  then raise exception 'cross_tenant_reference' using errcode='42501'; end if;
  return new;
end $$;
create trigger bookings_tenant_guard before insert or update on bookings
  for each row execute function bookings_tenant_guard();

-- ===== RLS =====
create function is_member(bid uuid) returns boolean language sql stable security definer
set search_path = public as $$
  select exists (select 1 from business_members where business_id = bid and user_id = auth.uid())
$$;

alter table businesses enable row level security;
alter table business_members enable row level security;
alter table provider_services enable row level security;
alter table provider_hours enable row level security;
alter table processed_webhook_events enable row level security; -- no policies = service role only

create policy biz_select on businesses for select to authenticated using (is_member(id));
create policy biz_update on businesses for update to authenticated
  using (is_member(id)) with check (is_member(id));
create policy members_select on business_members for select to authenticated using (user_id = auth.uid());
create policy ps_all on provider_services for all to authenticated
  using (exists (select 1 from providers p where p.id = provider_id and is_member(p.business_id)))
  with check (exists (select 1 from providers p where p.id = provider_id and is_member(p.business_id)));
create policy ph_all on provider_hours for all to authenticated
  using (exists (select 1 from providers p where p.id = provider_id and is_member(p.business_id)))
  with check (exists (select 1 from providers p where p.id = provider_id and is_member(p.business_id)));

do $$ declare t text; begin
  foreach t in array array['services','providers','business_hours','blocked_periods','clients','bookings','booking_events'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy tenant_all on %I for all to authenticated using (is_member(business_id)) with check (is_member(business_id))', t);
  end loop;
  -- read-only for tenants; written by trusted server code (service role)
  foreach t in array array['reminders','notification_logs','subscriptions'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy tenant_read on %I for select to authenticated using (is_member(business_id))', t);
  end loop;
end $$;
-- Anonymous visitors have NO policies: public pages are served by the API with explicit column lists.

-- ===== Functions =====
create function create_business(p_name text, p_slug text, p_timezone text) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); bid uuid;
begin
  if uid is null then raise exception 'unauthenticated'; end if;
  if exists (select 1 from business_members where user_id = uid) then raise exception 'already_has_business'; end if;
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then raise exception 'invalid_timezone'; end if;
  insert into businesses(owner_user_id,name,slug,timezone) values (uid,p_name,lower(p_slug),p_timezone) returning id into bid;
  insert into business_members(business_id,user_id,role) values (bid,uid,'owner');
  insert into providers(business_id,name) values (bid,p_name);
  insert into business_hours(business_id,day_of_week,start_time,end_time,enabled)
    select bid, d, '09:00', '17:00', d between 1 and 5 from generate_series(0,6) d;
  insert into subscriptions(business_id,status,current_period_end) values (bid,'trialing',now() + interval '14 days');
  return bid;
end $$;
grant execute on function create_business(text,text,text) to authenticated;

create function create_booking(p_business uuid, p_service uuid, p_provider uuid, p_start timestamptz,
  p_name text, p_email text, p_phone text, p_notes text, p_source text default 'public') returns uuid
language plpgsql security definer set search_path = public as $$
declare s services%rowtype; cid uuid; bid uuid;
  em text := nullif(lower(trim(coalesce(p_email,''))),'');
  ph text := nullif(regexp_replace(coalesce(p_phone,''),'[^0-9+]','','g'),'');
begin
  select * into s from services where id=p_service and business_id=p_business and active;
  if not found then raise exception 'service_not_found'; end if;
  if not exists (select 1 from providers where id=p_provider and business_id=p_business and active) then
    raise exception 'provider_not_found'; end if;
  if p_start <= now() then raise exception 'in_the_past'; end if;
  perform pg_advisory_xact_lock(hashtext(p_business::text || coalesce(em, ph, '')));
  select id into cid from clients where business_id=p_business
    and ((em is not null and email=em) or (em is null and ph is not null and phone=ph)) limit 1;
  if cid is null then
    insert into clients(business_id,name,email,phone) values (p_business,p_name,em,ph) returning id into cid;
  else
    update clients set phone = coalesce(phone, ph) where id = cid;
  end if;
  insert into bookings(business_id,service_id,provider_id,client_id,starts_at,ends_at,status,price_cents,source,notes)
  values (p_business,p_service,p_provider,cid,p_start,p_start + make_interval(mins => s.duration_minutes),
          'confirmed',s.price_cents,p_source,p_notes) returning id into bid;
  insert into booking_events(business_id,booking_id,event_type,metadata)
    values (p_business,bid,'created',jsonb_build_object('source',p_source));
  return bid;
exception when exclusion_violation then
  raise exception 'slot_taken';
end $$;
revoke all on function create_booking(uuid,uuid,uuid,timestamptz,text,text,text,text,text) from public, anon, authenticated;
grant execute on function create_booking(uuid,uuid,uuid,timestamptz,text,text,text,text,text) to service_role;

-- SECURITY INVOKER views/functions: the caller's RLS applies.
create view client_stats with (security_invoker = true) as
select c.*,
  coalesce(sum(b.price_cents) filter (where b.status='completed'),0)::int as lifetime_value_cents,
  count(b.id) filter (where b.status='completed') as completed_count,
  count(b.id) as total_bookings,
  max(b.starts_at) filter (where b.status='completed') as last_appointment,
  min(b.starts_at) filter (where b.status in ('pending','confirmed') and b.starts_at > now()) as next_appointment
from clients c left join bookings b on b.client_id = c.id group by c.id;

-- Revenue = confirmed + completed (cancelled / no_show excluded).
-- No-show rate = no_show / (completed + no_show).
create function dashboard_summary(p_business uuid, p_day_start timestamptz, p_day_end timestamptz)
returns json language sql stable security invoker as $$
select json_build_object(
 'today', (select count(*) from bookings where business_id=p_business and starts_at>=p_day_start and starts_at<p_day_end and status in ('pending','confirmed','completed')),
 'upcoming', (select count(*) from bookings where business_id=p_business and starts_at>now() and status in ('pending','confirmed')),
 'revenue_cents', (select coalesce(sum(price_cents),0) from bookings where business_id=p_business and status in ('confirmed','completed')),
 'clients', (select count(*) from clients where business_id=p_business),
 'no_show_rate', (select coalesce(round(100.0 * count(*) filter (where status='no_show') / nullif(count(*) filter (where status in ('completed','no_show')),0),1),0) from bookings where business_id=p_business))
$$;
  