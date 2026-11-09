-- Kategori agenda bertambah: jalan-jalan, kado, nonton, kuliner, lainnya.
-- Jalankan di Supabase SQL Editor.

do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.agendas'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%category%'
  loop
    execute format('alter table public.agendas drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.agendas
  add constraint agendas_category_check
  check (category in (
    'task', 'date', 'anniversary',
    'trip', 'gift', 'movie', 'food', 'other'
  ));
