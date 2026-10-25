-- Run once AFTER migration 005. Records are retained; no payments are voided.
begin;
alter table public.customers add column if not exists is_archived boolean not null default false;
revoke update on public.customers from authenticated;
grant update(name,phone) on public.customers to authenticated;
create or replace function public.archive_customer(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=auth.uid();
begin
 if v_owner is null then raise exception 'Please sign in.';end if;
 perform pg_advisory_xact_lock(hashtextextended(v_owner::text,0));
 update public.customers set is_archived=true where id=p_id and owner_id=v_owner;
 if not found then raise exception 'Customer not found.';end if;
end;$$;
create or replace function public.delete_bill_v2(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=auth.uid();v_bill public.bills;v_item record;
begin
 if v_owner is null then raise exception 'Please sign in.';end if;
 perform pg_advisory_xact_lock(hashtextextended(v_owner::text,0));
 select * into v_bill from public.bills where id=p_id and owner_id=v_owner for update;
 if not found then raise exception 'Bill not found.';end if;
 if v_bill.is_deleted then return;end if;
 if v_bill.stock_tracked then
  for v_item in select bag_size_id,sum(quantity)::integer as qty from public.sale_items where bill_id=p_id group by bag_size_id order by bag_size_id loop
   update public.bag_sizes set stock=stock+v_item.qty,archived=false where id=v_item.bag_size_id and owner_id=v_owner;
   insert into public.stock_movements(owner_id,bag_size_id,size_name,bill_id,delta,kind,movement_date) select v_owner,id,name,p_id,v_item.qty,'sale_delete',(now() at time zone 'Asia/Riyadh')::date from public.bag_sizes where id=v_item.bag_size_id;
  end loop;
 end if;
 update public.bills set is_deleted=true,updated_at=now() where id=p_id;
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
 select name into v_name from public.customers where id=p_customer_id and owner_id=v_owner and (not is_archived or (p_id is not null and v_old.customer_id=p_customer_id));
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


revoke all on function public.archive_customer(uuid),public.delete_bill_v2(uuid),public.save_bill_v2(uuid,uuid,date,jsonb,numeric,uuid) from public,anon;
grant execute on function public.archive_customer(uuid),public.delete_bill_v2(uuid),public.save_bill_v2(uuid,uuid,date,jsonb,numeric,uuid) to authenticated;
commit;
