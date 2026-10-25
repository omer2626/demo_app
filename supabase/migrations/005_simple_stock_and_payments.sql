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
