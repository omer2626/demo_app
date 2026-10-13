-- Run once in the SQL editor of a new Supabase project.
begin;
create table public.customers (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id),
 name text not null check (length(trim(name)) between 1 and 200),
 phone text check (length(phone) <= 40),
 created_at timestamptz not null default now(),
 unique (id, owner_id)
);
create table public.bills (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id),
 bill_number bigint generated always as identity (start with 1001) unique,
 customer_id uuid not null,
 customer_name text not null,
 sale_date date not null,
 paid boolean not null default false,
 total numeric(18,2) not null check (total >= 0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 foreign key (customer_id,owner_id) references public.customers(id,owner_id)
);
create table public.sale_items (
 id uuid primary key default gen_random_uuid(),
 bill_id uuid not null references public.bills(id) on delete cascade,
 position integer not null,
 size text not null check (size in ('17x32','19x39','18x40','19x44','21x48','23x50','24x55','27x58','29x49','30x65','32x75','32x72','36x75','38x75','31x100','44x75')),
 quantity integer not null check (quantity between 1 and 1000000),
 rate numeric(12,2) not null check (rate > 0 and rate <= 1000000)
);
create index bills_owner_date on public.bills(owner_id,sale_date);
create index sale_items_bill on public.sale_items(bill_id,position);
alter table public.customers enable row level security;
alter table public.bills enable row level security;
alter table public.sale_items enable row level security;
create policy customers_owner on public.customers for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy bills_read on public.bills for select to authenticated using (owner_id = (select auth.uid()));
create policy bills_delete on public.bills for delete to authenticated using (owner_id = (select auth.uid()));
create policy items_read on public.sale_items for select to authenticated using (exists(select 1 from public.bills b where b.id = bill_id and b.owner_id = (select auth.uid())));
revoke all on public.customers,public.bills,public.sale_items from anon,authenticated;
grant select,insert,update on public.customers to authenticated;
grant select,delete on public.bills to authenticated;
grant select on public.sale_items to authenticated;
-- All writes to bills and items use this atomic, authenticated function.
create function public.save_bill(p_id uuid,p_customer_id uuid,p_date date,p_paid boolean,p_items jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
 v_owner uuid := auth.uid();
 v_name text;
 v_id uuid;
 v_total numeric := 0;
 v_item jsonb;
 v_quantity numeric;
 v_rate numeric;
 v_position integer := 0;
begin
 if v_owner is null then raise exception 'Please sign in.'; end if;
 if p_date is null or p_paid is null then raise exception 'Date and status are required.'; end if;
 select name into v_name from public.customers where id=p_customer_id and owner_id=v_owner;
 if not found then raise exception 'Customer not found.'; end if;
 if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Items must be an array.'; end if;
 if jsonb_array_length(p_items) not between 1 and 100 then raise exception 'Use between 1 and 100 items.'; end if;
 for v_item in select value from jsonb_array_elements(p_items) loop
  v_quantity := (v_item->>'quantity')::numeric;
  v_rate := (v_item->>'rate')::numeric;
  if v_quantity is null or v_quantity <> trunc(v_quantity) or v_quantity not between 1 and 1000000 then raise exception 'Bundles must be a positive whole number.'; end if;
  if v_rate is null or v_rate <= 0 or v_rate > 1000000 or v_rate <> round(v_rate,2) then raise exception 'Enter a positive price with at most two decimal places.'; end if;
  if v_item->>'size' is null or not (v_item->>'size' = any(array['17x32','19x39','18x40','19x44','21x48','23x50','24x55','27x58','29x49','30x65','32x75','32x72','36x75','38x75','31x100','44x75'])) then raise exception 'Invalid bag size.'; end if;
  v_total := v_total + v_quantity * v_rate;
 end loop;
 if p_id is null then
  insert into public.bills(owner_id,customer_id,customer_name,sale_date,paid,total) values(v_owner,p_customer_id,v_name,p_date,p_paid,v_total) returning id into v_id;
 else
  update public.bills set customer_id=p_customer_id,customer_name=v_name,sale_date=p_date,paid=p_paid,total=v_total,updated_at=now() where id=p_id and owner_id=v_owner returning id into v_id;
  if not found then raise exception 'Bill not found.'; end if;
  delete from public.sale_items where bill_id=v_id;
 end if;
 for v_item in select value from jsonb_array_elements(p_items) loop
  insert into public.sale_items(bill_id,position,size,quantity,rate) values(v_id,v_position,v_item->>'size',(v_item->>'quantity')::integer,(v_item->>'rate')::numeric);
  v_position := v_position + 1;
 end loop;
 return v_id;
end;
$$;
revoke all on function public.save_bill(uuid,uuid,date,boolean,jsonb) from public,anon;
grant execute on function public.save_bill(uuid,uuid,date,boolean,jsonb) to authenticated;
commit;

-- Editable catalog upgrade (also required for fresh projects).
-- Apply once to your existing project. Keeps all customers, bills and items.
begin;
create table if not exists public.bag_sizes (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id),
 name text not null check (name ~ '^[1-9][0-9]{0,3}x[1-9][0-9]{0,3}$'),
 created_at timestamptz not null default now(),
 unique(owner_id,name)
);
alter table public.bag_sizes enable row level security;
drop policy if exists bag_sizes_owner on public.bag_sizes;
create policy bag_sizes_owner on public.bag_sizes for all to authenticated
 using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
revoke all on public.bag_sizes from anon,authenticated;
grant select,insert,update on public.bag_sizes to authenticated;
-- Existing owners receive the original catalog, including sizes used on past bills.
insert into public.bag_sizes(owner_id,name)
 select u.id,s.name from auth.users u cross join unnest(array['17x32','19x39','18x40','19x44','21x48','23x50','24x55','27x58','29x49','30x65','32x75','32x72','36x75','38x75','31x100','44x75']) as s(name)
 where not exists(select 1 from public.bag_sizes p where p.owner_id=u.id)
 on conflict do nothing;
insert into public.bag_sizes(owner_id,name)
 select distinct b.owner_id,i.size from public.sale_items i join public.bills b on b.id=i.bill_id
 where i.size ~ '^[1-9][0-9]{0,3}x[1-9][0-9]{0,3}$' on conflict do nothing;
create or replace function public.initialize_bag_sizes() returns void
 language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Please sign in.'; end if;
 if not exists(select 1 from public.bag_sizes where owner_id=auth.uid()) then
  insert into public.bag_sizes(owner_id,name)
   select auth.uid(),name from unnest(array['17x32','19x39','18x40','19x44','21x48','23x50','24x55','27x58','29x49','30x65','32x75','32x72','36x75','38x75','31x100','44x75']) as s(name)
   on conflict do nothing;
 end if;
end;
$$;
revoke all on function public.initialize_bag_sizes() from public,anon;
grant execute on function public.initialize_bag_sizes() to authenticated;
-- Replace only the old fixed-list constraint. Existing bill text stays unchanged.
alter table public.sale_items drop constraint if exists sale_items_size_check;
create or replace function public.save_bill(p_id uuid,p_customer_id uuid,p_date date,p_paid boolean,p_items jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
 v_owner uuid := auth.uid();
 v_name text;
 v_id uuid;
 v_total numeric := 0;
 v_item jsonb;
 v_quantity numeric;
 v_rate numeric;
 v_position integer := 0;
begin
 if v_owner is null then raise exception 'Please sign in.'; end if;
 if p_date is null or p_paid is null then raise exception 'Date and status are required.'; end if;
 select name into v_name from public.customers where id=p_customer_id and owner_id=v_owner;
 if not found then raise exception 'Customer not found.'; end if;
 if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Items must be an array.'; end if;
 if jsonb_array_length(p_items) not between 1 and 100 then raise exception 'Use between 1 and 100 items.'; end if;
 for v_item in select value from jsonb_array_elements(p_items) loop
  v_quantity := (v_item->>'quantity')::numeric;
  v_rate := (v_item->>'rate')::numeric;
  if v_quantity is null or v_quantity <> trunc(v_quantity) or v_quantity not between 1 and 1000000 then raise exception 'Bundles must be a positive whole number.'; end if;
  if v_rate is null or v_rate <= 0 or v_rate > 1000000 or v_rate <> round(v_rate,2) then raise exception 'Enter a positive price with at most two decimal places.'; end if;
  if v_item->>'size' is null or not (
   exists(select 1 from public.bag_sizes where owner_id=v_owner and name=v_item->>'size')
   or exists(select 1 from public.sale_items i join public.bills b on b.id=i.bill_id
    where b.id=p_id and b.owner_id=v_owner and i.size=v_item->>'size')
  ) then raise exception 'Invalid bag size. Select a size from your catalog.'; end if;
  v_total := v_total + v_quantity * v_rate;
 end loop;
 if p_id is null then
  insert into public.bills(owner_id,customer_id,customer_name,sale_date,paid,total) values(v_owner,p_customer_id,v_name,p_date,p_paid,v_total) returning id into v_id;
 else
  update public.bills set customer_id=p_customer_id,customer_name=v_name,sale_date=p_date,paid=p_paid,total=v_total,updated_at=now() where id=p_id and owner_id=v_owner returning id into v_id;
  if not found then raise exception 'Bill not found.'; end if;
  delete from public.sale_items where bill_id=v_id;
 end if;
 for v_item in select value from jsonb_array_elements(p_items) loop
  insert into public.sale_items(bill_id,position,size,quantity,rate) values(v_id,v_position,v_item->>'size',(v_item->>'quantity')::integer,(v_item->>'rate')::numeric);
  v_position := v_position + 1;
 end loop;
 return v_id;
end;
$$;
revoke all on function public.save_bill(uuid,uuid,date,boolean,jsonb) from public,anon;
grant execute on function public.save_bill(uuid,uuid,date,boolean,jsonb) to authenticated;
commit;
