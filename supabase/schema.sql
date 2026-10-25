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

-- Deletion support for fresh projects.
-- Run once after 002_editable_bag_sizes.sql. Keeps historical sales intact.
begin;
grant delete on public.bag_sizes to authenticated;
-- Remember initialization even when an owner deletes every size.
create table if not exists public.bag_catalog_initializations (
 owner_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.bag_catalog_initializations enable row level security;
revoke all on public.bag_catalog_initializations from public,anon,authenticated;
insert into public.bag_catalog_initializations(owner_id)
 select distinct owner_id from public.bag_sizes on conflict do nothing;
create or replace function public.initialize_bag_sizes() returns void
 language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Please sign in.'; end if;
 insert into public.bag_catalog_initializations(owner_id) values(auth.uid())
  on conflict do nothing;
 if found then
  insert into public.bag_sizes(owner_id,name)
   select auth.uid(),name from unnest(array['17x32','19x39','18x40','19x44','21x48','23x50','24x55','27x58','29x49','30x65','32x75','32x72','36x75','38x75','31x100','44x75']) as s(name)
   on conflict do nothing;
 end if;
end;
$$;
revoke all on function public.initialize_bag_sizes() from public,anon;
grant execute on function public.initialize_bag_sizes() to authenticated;
commit;

-- Stock and payment upgrade (included for new projects).
-- Run once AFTER migrations 002 and 003. Existing sales do not deduct opening stock.
begin;
alter table public.bag_sizes add column if not exists stock integer not null default 0 check(stock between 0 and 1000000000);
alter table public.bag_sizes add column if not exists stock_initialized boolean not null default false;
alter table public.bag_sizes add column if not exists archived boolean not null default false;
alter table public.bills add column if not exists stock_tracked boolean not null default false;
alter table public.bills add column if not exists is_deleted boolean not null default false;
alter table public.bills add column if not exists request_id uuid;
alter table public.bills add column if not exists amount_received numeric(18,2) not null default 0 check(amount_received>=0 and amount_received<=total);
alter table public.bills add column if not exists balance numeric(18,2) generated always as (total-amount_received) stored;
create unique index if not exists bills_request_unique on public.bills(owner_id,request_id);
alter table public.sale_items add column if not exists bag_size_id uuid references public.bag_sizes(id);
update public.sale_items i set bag_size_id=p.id from public.bag_sizes p,public.bills b where i.bill_id=b.id and p.owner_id=b.owner_id and p.name=i.size and i.bag_size_id is null;
create table if not exists public.stock_movements(
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),
 bag_size_id uuid not null references public.bag_sizes(id),size_name text not null,
 bill_id uuid references public.bills(id),delta integer not null check(delta between -1000000000 and 1000000000),
 kind text not null check(kind in ('opening','delivery','correction','sale','sale_edit','sale_delete')),
 movement_date date not null, note text not null default '',created_at timestamptz not null default now(),request_id uuid,
 unique(owner_id,request_id)
);
create table if not exists public.payments(
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),
 bill_id uuid not null references public.bills(id),amount numeric(18,2) not null check(amount>0),
 payment_date date, note text not null default '',is_opening boolean not null default false,
 voided boolean not null default false,voided_at timestamptz,created_at timestamptz not null default now(),request_id uuid,
 unique(owner_id,request_id), check(is_opening or payment_date is not null)
);
create unique index if not exists payment_opening_once on public.payments(bill_id) where is_opening;
-- Preserve previously paid bills. Their original collection dates are unknown.
insert into public.payments(owner_id,bill_id,amount,is_opening,note)
 select owner_id,id,total,true,'Paid before payment tracking; collection date unknown' from public.bills where paid and total>0
 on conflict do nothing;
update public.bills b set amount_received=(select coalesce(sum(amount),0) from public.payments p where p.bill_id=b.id and not p.voided);
create index if not exists payments_owner_date on public.payments(owner_id,payment_date);
create index if not exists payments_bill on public.payments(bill_id);
create index if not exists stock_owner_product on public.stock_movements(owner_id,bag_size_id,created_at);
alter table public.stock_movements enable row level security;
alter table public.payments enable row level security;
create policy movements_owner_read on public.stock_movements for select to authenticated using(owner_id=(select auth.uid()));
create policy payments_owner_read on public.payments for select to authenticated using(owner_id=(select auth.uid()));
revoke all on public.stock_movements,public.payments from anon,authenticated;
grant select on public.stock_movements,public.payments to authenticated;
-- Clients cannot alter stock, payment totals or archive flags directly.
revoke insert,update,delete on public.bag_sizes from authenticated;
grant insert(owner_id,name),update(name) on public.bag_sizes to authenticated;
revoke delete on public.bills from authenticated;

create or replace function public.adjust_stock(p_size_id uuid,p_quantity numeric,p_kind text,p_date date,p_note text,p_request_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=auth.uid();v_product public.bag_sizes;v_delta integer;
begin
 if v_owner is null then raise exception 'Please sign in.';end if;
 perform pg_advisory_xact_lock(hashtextextended(v_owner::text,0));
 if p_request_id is null then raise exception 'Request identifier required.';end if;
 if exists(select 1 from public.stock_movements where owner_id=v_owner and request_id=p_request_id) then return;end if;
 if p_date is null or p_quantity is null or p_quantity<>trunc(p_quantity) or p_quantity not between -1000000 and 1000000 then raise exception 'Enter whole bundles, up to 1,000,000 per adjustment.';end if;
 if p_kind is null or p_kind not in ('opening','delivery','correction') then raise exception 'Invalid stock operation.';end if;
 select * into v_product from public.bag_sizes where id=p_size_id and owner_id=v_owner and not archived for update;
 if not found then raise exception 'Bag size not found.';end if;
 if p_kind='opening' then
  if v_product.stock_initialized then raise exception 'Opening stock is already set. Use a delivery or correction.';end if;
  if p_quantity<0 then raise exception 'Opening stock cannot be negative.';end if;
  v_delta:=p_quantity-v_product.stock;
 else
  if not v_product.stock_initialized then raise exception 'Set opening stock first.';end if;
  if p_kind='delivery' and p_quantity<=0 then raise exception 'Enter a positive delivery quantity.';end if;
  if p_kind='correction' and (p_quantity=0 or length(trim(coalesce(p_note,'')))=0) then raise exception 'Enter a nonzero correction and a reason.';end if;
  v_delta:=p_quantity;
 end if;
 if v_product.stock+v_delta<0 then raise exception 'Stock cannot become negative.';end if;
 update public.bag_sizes set stock=stock+v_delta,stock_initialized=true where id=p_size_id;
 -- A zero opening count is a real event and makes retries safe.
 insert into public.stock_movements(owner_id,bag_size_id,size_name,delta,kind,movement_date,note,request_id) values(v_owner,p_size_id,v_product.name,v_delta,p_kind,p_date,left(coalesce(p_note,''),500),p_request_id);
end;$$;

create or replace function public.record_payment(p_bill_id uuid,p_amount numeric,p_date date,p_note text,p_request_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=auth.uid();v_bill public.bills;
begin
 if v_owner is null then raise exception 'Please sign in.';end if;
 perform pg_advisory_xact_lock(hashtextextended(v_owner::text,0));
 if p_request_id is null then raise exception 'Request identifier required.';end if;
 if exists(select 1 from public.payments where owner_id=v_owner and request_id=p_request_id) then return;end if;
 select * into v_bill from public.bills where id=p_bill_id and owner_id=v_owner and not is_deleted for update;
 if not found then raise exception 'Bill not found.';end if;
 if p_date is null or p_amount is null or p_amount<=0 or p_amount>v_bill.balance or p_amount<>round(p_amount,2) then raise exception 'Enter an amount above zero and no more than the remaining balance, with at most two decimals.';end if;
 insert into public.payments(owner_id,bill_id,amount,payment_date,note,request_id) values(v_owner,p_bill_id,p_amount,p_date,left(coalesce(p_note,''),500),p_request_id);
 update public.bills set amount_received=amount_received+p_amount,paid=(amount_received+p_amount=total),updated_at=now() where id=p_bill_id;
end;$$;

create or replace function public.void_payment(p_payment_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=auth.uid();v_payment public.payments;
begin
 if v_owner is null then raise exception 'Please sign in.';end if;
 perform pg_advisory_xact_lock(hashtextextended(v_owner::text,0));
 select * into v_payment from public.payments where id=p_payment_id and owner_id=v_owner for update;
 if not found then raise exception 'Payment not found.';end if;
 if v_payment.voided then return;end if;
 update public.payments set voided=true,voided_at=now() where id=p_payment_id;
 update public.bills set amount_received=amount_received-v_payment.amount,paid=(amount_received-v_payment.amount=total),updated_at=now() where id=v_payment.bill_id;
end;$$;

create or replace function public.save_bill_v2(p_id uuid,p_customer_id uuid,p_date date,p_items jsonb,p_initial_payment numeric,p_request_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=auth.uid();v_name text;v_id uuid;v_total numeric:=0;v_item jsonb;v_quantity numeric;v_rate numeric;v_position integer:=0;v_old public.bills;v_product public.bag_sizes;v_product_id uuid;v_tracked boolean:=true;v_change record;v_ids uuid[]:='{}';
begin
 if v_owner is null then raise exception 'Please sign in.';end if;
 perform pg_advisory_xact_lock(hashtextextended(v_owner::text,0));
 if p_request_id is null then raise exception 'Request identifier required.';end if;
 if p_id is null then
  select id into v_id from public.bills where owner_id=v_owner and request_id=p_request_id;
  if found then return v_id;end if;
 else
  select * into v_old from public.bills where id=p_id and owner_id=v_owner and not is_deleted for update;
  if not found then raise exception 'Bill not found.';end if;
  v_tracked:=v_old.stock_tracked;
 end if;
 if p_date is null then raise exception 'Sale date required.';end if;
 select name into v_name from public.customers where id=p_customer_id and owner_id=v_owner;
 if not found then raise exception 'Customer not found.';end if;
 if p_id is not null and p_customer_id<>v_old.customer_id and v_old.amount_received>0 then raise exception 'Void payments before changing the customer.';end if;
 if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Items must be an array.';end if;
 if jsonb_array_length(p_items) not between 1 and 100 then raise exception 'Use between 1 and 100 items.';end if;
 for v_item in select value from jsonb_array_elements(p_items) loop
  v_quantity:=(v_item->>'quantity')::numeric;v_rate:=(v_item->>'rate')::numeric;
  if v_quantity is null or v_quantity<>trunc(v_quantity) or v_quantity not between 1 and 1000000 then raise exception 'Enter positive whole bundles.';end if;
  if v_rate is null or v_rate<=0 or v_rate>1000000 or v_rate<>round(v_rate,2) then raise exception 'Enter a positive price with at most two decimals.';end if;
  v_product_id:=null;
  if nullif(v_item->>'bag_size_id','') is not null then
   select id into v_product_id from public.bag_sizes where id=(v_item->>'bag_size_id')::uuid and owner_id=v_owner and (name=v_item->>'size' or exists(select 1 from public.sale_items where bill_id=p_id and bag_size_id=public.bag_sizes.id and size=v_item->>'size'));
  else
   select id into v_product_id from public.bag_sizes where owner_id=v_owner and name=v_item->>'size' and not archived;
  end if;
  if v_product_id is null and (v_tracked or not exists(select 1 from public.sale_items where bill_id=p_id and size=v_item->>'size')) then raise exception 'Select a valid bag size.';end if;
  v_ids:=array_append(v_ids,v_product_id);
  v_total:=v_total+v_quantity*v_rate;
 end loop;
 if p_initial_payment is null or p_initial_payment<0 or p_initial_payment>v_total or p_initial_payment<>round(p_initial_payment,2) then raise exception 'Initial payment must be between zero and the bill total.';end if;
 if p_id is not null and p_initial_payment<>0 then raise exception 'Use Add payment for existing bills.';end if;
 if p_id is not null and v_total<v_old.amount_received then raise exception 'Bill total cannot be less than payments received. Void incorrect payments first.';end if;
 -- Aggregate by stable catalog ID so repeated sizes and renames adjust stock correctly.
 if v_tracked then
  for v_change in
   with old_qty as (select bag_size_id as id,sum(quantity) as qty from public.sale_items where bill_id=p_id group by bag_size_id),
   new_qty as (select v_ids[t.ordinality::integer] as id,sum((t.value->>'quantity')::integer) as qty from jsonb_array_elements(p_items) with ordinality as t(value,ordinality) group by v_ids[t.ordinality::integer])
   select coalesce(n.id,o.id) as id,coalesce(n.qty,0)-coalesce(o.qty,0) as delta from new_qty n full join old_qty o on n.id=o.id order by coalesce(n.id,o.id)
  loop
   select * into v_product from public.bag_sizes where id=v_change.id and owner_id=v_owner for update;
   if not found then raise exception 'Stock item not found.';end if;
   if v_change.delta>0 and (v_product.archived or not v_product.stock_initialized) then raise exception 'Set opening stock for % before selling it, and use an active size.',v_product.name;end if;
   if v_product.stock<v_change.delta then raise exception 'Not enough stock for %. Available: % bundles.',v_product.name,v_product.stock;end if;
   update public.bag_sizes set stock=stock-v_change.delta,archived=case when v_change.delta<0 then false else archived end where id=v_change.id;
  end loop;
 end if;
 if p_id is null then
  insert into public.bills(owner_id,customer_id,customer_name,sale_date,paid,total,stock_tracked,request_id) values(v_owner,p_customer_id,v_name,p_date,false,v_total,true,p_request_id) returning id into v_id;
 else
  v_id:=p_id;
  update public.bills set customer_id=p_customer_id,customer_name=v_name,sale_date=p_date,total=v_total,paid=(amount_received=v_total),updated_at=now() where id=v_id;
 end if;
 if v_tracked then
  for v_change in
   with old_qty as (select bag_size_id as id,sum(quantity) as qty from public.sale_items where bill_id=p_id group by bag_size_id),
   new_qty as (select v_ids[t.ordinality::integer] as id,sum((t.value->>'quantity')::integer) as qty from jsonb_array_elements(p_items) with ordinality as t(value,ordinality) group by v_ids[t.ordinality::integer])
   select coalesce(n.id,o.id) as id,coalesce(o.qty,0)-coalesce(n.qty,0) as delta from new_qty n full join old_qty o on n.id=o.id
  loop
   if v_change.delta<>0 then insert into public.stock_movements(owner_id,bag_size_id,size_name,bill_id,delta,kind,movement_date) select v_owner,id,name,v_id,v_change.delta,case when p_id is null then 'sale' else 'sale_edit' end,p_date from public.bag_sizes where id=v_change.id;end if;
  end loop;
 end if;
 if p_id is not null then delete from public.sale_items where bill_id=v_id;end if;
 for v_item in select value from jsonb_array_elements(p_items) loop
  insert into public.sale_items(bill_id,position,size,quantity,rate,bag_size_id) values(v_id,v_position,v_item->>'size',(v_item->>'quantity')::integer,(v_item->>'rate')::numeric,v_ids[v_position+1]);v_position:=v_position+1;
 end loop;
 if p_id is null and p_initial_payment>0 then perform public.record_payment(v_id,p_initial_payment,p_date,'Received with sale',p_request_id);end if;
 return v_id;
end;$$;

create or replace function public.delete_bill_v2(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=auth.uid();v_bill public.bills;v_item record;
begin
 if v_owner is null then raise exception 'Please sign in.';end if;
 perform pg_advisory_xact_lock(hashtextextended(v_owner::text,0));
 select * into v_bill from public.bills where id=p_id and owner_id=v_owner for update;
 if not found then raise exception 'Bill not found.';end if;
 if v_bill.is_deleted then return;end if;
 if v_bill.amount_received>0 then raise exception 'This bill has payments. Void its payments before deleting the sale.';end if;
 if v_bill.stock_tracked then
  for v_item in select bag_size_id,sum(quantity)::integer as qty from public.sale_items where bill_id=p_id group by bag_size_id order by bag_size_id loop
   update public.bag_sizes set stock=stock+v_item.qty,archived=false where id=v_item.bag_size_id and owner_id=v_owner;
   insert into public.stock_movements(owner_id,bag_size_id,size_name,bill_id,delta,kind,movement_date) select v_owner,id,name,p_id,v_item.qty,'sale_delete',(now() at time zone 'Asia/Riyadh')::date from public.bag_sizes where id=v_item.bag_size_id;
  end loop;
 end if;
 update public.bills set is_deleted=true,updated_at=now() where id=p_id;
end;$$;
create or replace function public.archive_bag_size(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=auth.uid();v_product public.bag_sizes;
begin
 if v_owner is null then raise exception 'Please sign in.';end if;
 perform pg_advisory_xact_lock(hashtextextended(v_owner::text,0));
 select * into v_product from public.bag_sizes where id=p_id and owner_id=v_owner for update;
 if not found then raise exception 'Bag size not found.';end if;
 if v_product.stock<>0 then raise exception 'This size still has stock. Record a correction to zero before deleting it.';end if;
 update public.bag_sizes set archived=true where id=p_id;
end;$$;
create or replace function public.save_bag_size(p_id uuid,p_name text) returns setof public.bag_sizes language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=auth.uid();v_product public.bag_sizes;
begin
 if v_owner is null then raise exception 'Please sign in.';end if;
 perform pg_advisory_xact_lock(hashtextextended(v_owner::text,0));
 if p_name is null or p_name !~ '^[1-9][0-9]{0,3}x[1-9][0-9]{0,3}$' then raise exception 'Enter valid dimensions such as 17x32.';end if;
 if p_id is not null then
  update public.bag_sizes set name=p_name where id=p_id and owner_id=v_owner and not archived returning * into v_product;
  if not found then raise exception 'Bag size not found.';end if;
 else
  insert into public.bag_sizes(owner_id,name) values(v_owner,p_name) on conflict(owner_id,name) do update set archived=false where public.bag_sizes.archived returning * into v_product;
  if not found then raise exception 'This bag size already exists.';end if;
 end if;
 return next v_product;
end;$$;
revoke all on function public.save_bag_size(uuid,text) from public,anon;
grant execute on function public.save_bag_size(uuid,text) to authenticated;
-- Keep older deployed clients from bypassing inventory or payment bookkeeping.
create or replace function public.save_bill(p_id uuid,p_customer_id uuid,p_date date,p_paid boolean,p_items jsonb) returns uuid language plpgsql security definer set search_path='' as $$
begin raise exception 'Please refresh the app to use stock and payment tracking.';end;$$;
revoke all on function public.adjust_stock(uuid,numeric,text,date,text,uuid),public.record_payment(uuid,numeric,date,text,uuid),public.void_payment(uuid),public.save_bill_v2(uuid,uuid,date,jsonb,numeric,uuid),public.delete_bill_v2(uuid),public.archive_bag_size(uuid) from public,anon;
grant execute on function public.adjust_stock(uuid,numeric,text,date,text,uuid),public.record_payment(uuid,numeric,date,text,uuid),public.void_payment(uuid),public.save_bill_v2(uuid,uuid,date,jsonb,numeric,uuid),public.delete_bill_v2(uuid),public.archive_bag_size(uuid) to authenticated;
commit;

-- Simple stock controls upgrade (included for new projects).
-- Apply once AFTER migration 004. No existing sales, payments or history are removed.
begin;
create or replace function public.adjust_stock(p_size_id uuid,p_quantity numeric,p_kind text,p_date date,p_note text,p_request_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=auth.uid();v_product public.bag_sizes;v_delta integer;
begin
 if v_owner is null then raise exception 'Please sign in.';end if;
 perform pg_advisory_xact_lock(hashtextextended(v_owner::text,0));
 if p_request_id is null then raise exception 'Request identifier required.';end if;
 if exists(select 1 from public.stock_movements where owner_id=v_owner and request_id=p_request_id) then return;end if;
 if p_date is null or p_quantity is null or p_quantity<>trunc(p_quantity) or p_quantity not between -1000000 and 1000000 then raise exception 'Enter whole bundles, up to 1,000,000 per adjustment.';end if;
 if p_kind is null or p_kind not in ('opening','delivery','correction') then raise exception 'Invalid stock operation.';end if;
 select * into v_product from public.bag_sizes where id=p_size_id and owner_id=v_owner and not archived for update;
 if not found then raise exception 'Bag size not found.';end if;
 if p_kind='opening' then
  if v_product.stock_initialized then raise exception 'Opening stock is already set. Use a delivery or correction.';end if;
  if p_quantity<0 then raise exception 'Opening stock cannot be negative.';end if;
  v_delta:=p_quantity-v_product.stock;
 else
  if not v_product.stock_initialized then raise exception 'Set opening stock first.';end if;
  if p_kind='delivery' and p_quantity<=0 then raise exception 'Enter a positive delivery quantity.';end if;
  if p_kind='correction' and p_quantity=0 then raise exception 'Enter a nonzero stock correction.';end if;
  v_delta:=p_quantity;
 end if;
 if v_product.stock+v_delta<0 then raise exception 'Stock cannot become negative.';end if;
 update public.bag_sizes set stock=stock+v_delta,stock_initialized=true where id=p_size_id;
 -- A zero opening count is a real event and makes retries safe.
 insert into public.stock_movements(owner_id,bag_size_id,size_name,delta,kind,movement_date,note,request_id) values(v_owner,p_size_id,v_product.name,v_delta,p_kind,p_date,left(coalesce(p_note,''),500),p_request_id);
end;$$;

create or replace function public.archive_bag_size(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=auth.uid();v_product public.bag_sizes;
begin
 if v_owner is null then raise exception 'Please sign in.';end if;
 perform pg_advisory_xact_lock(hashtextextended(v_owner::text,0));
 select * into v_product from public.bag_sizes where id=p_id and owner_id=v_owner for update;
 if not found then raise exception 'Bag size not found.';end if;
 if v_product.stock<>0 then raise exception 'This size still has stock. Use Delete stock in the Stock page before deleting the bag size.';end if;
 update public.bag_sizes set archived=true where id=p_id;
end;$$;

create or replace function public.clear_stock(p_size_id uuid,p_request_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=auth.uid();v_product public.bag_sizes;
begin
 if v_owner is null then raise exception 'Please sign in.';end if;
 perform pg_advisory_xact_lock(hashtextextended(v_owner::text,0));
 if p_request_id is null then raise exception 'Request identifier required.';end if;
 if exists(select 1 from public.stock_movements where owner_id=v_owner and request_id=p_request_id) then return;end if;
 select * into v_product from public.bag_sizes where id=p_size_id and owner_id=v_owner and not archived for update;
 if not found then raise exception 'Bag size not found.';end if;
 if v_product.stock=0 then return;end if;
 update public.bag_sizes set stock=0,stock_initialized=true where id=p_size_id;
 insert into public.stock_movements(owner_id,bag_size_id,size_name,delta,kind,movement_date,note,request_id)
  values(v_owner,p_size_id,v_product.name,-v_product.stock,'correction',(now() at time zone 'Asia/Riyadh')::date,'Stock cleared',p_request_id);
end;$$;
revoke all on function public.clear_stock(uuid,uuid) from public,anon;
grant execute on function public.clear_stock(uuid,uuid) to authenticated;
commit;
