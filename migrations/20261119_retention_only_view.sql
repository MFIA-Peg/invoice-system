-- Apply once. Separates RETENTION collection balances from the remaining retained balance.
BEGIN;
DO $view$
DECLARE original text; cols text;
BEGIN
SELECT pg_get_viewdef('public.invoice_details_with_retention'::regclass,true) INTO original;
SELECT string_agg(CASE WHEN attname IN ('open_balance','collection_balance_after_advance') THEN
format('(CASE WHEN upper(trim(v.status))=''RETENTION'' THEN 0 ELSE v.%I END)::%s AS %I',attname,format_type(atttypid,atttypmod),attname)
WHEN attname='retention_balance' THEN format('(CASE WHEN upper(trim(v.status))=''RETENTION'' THEN least(v.retention_balance,greatest(coalesce(v.invoice_total_after_advance,0)-coalesce(v.paid_amount,0)-coalesce(v.retention_released_amount,0),0)) ELSE v.retention_balance END)::%s AS retention_balance',format_type(atttypid,atttypmod))
ELSE format('v.%I',attname) END,', ' ORDER BY attnum) INTO cols FROM pg_attribute WHERE attrelid='public.invoice_details_with_retention'::regclass AND attnum>0 AND NOT attisdropped;
EXECUTE 'CREATE OR REPLACE VIEW public.invoice_details_with_retention AS SELECT '||cols||' FROM ('||rtrim(original,E' ;\n\r\t')||') v';
END $view$;
COMMIT;
