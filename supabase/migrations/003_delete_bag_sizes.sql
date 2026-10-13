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
