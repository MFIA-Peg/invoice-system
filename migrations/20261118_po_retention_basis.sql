begin;
alter table public.pos add column if not exists retention_basis text not null default 'after_vat' check (retention_basis in ('before_vat','after_vat'));
comment on column public.pos.retention_basis is 'Retention calculated on the invoice amount before VAT or including VAT. Existing invoice amounts are not recalculated.';
notify pgrst, 'reload schema';
commit;
select column_name,data_type,column_default,is_nullable from information_schema.columns where table_schema='public' and table_name='pos' and column_name='retention_basis';
