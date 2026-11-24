create or replace function public.dashboard_summary_trial_v1(p_filters jsonb default '{}'::jsonb, p_group_metric text default 'billed')
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $fn$
declare
  v_today date := (current_timestamp at time zone 'Asia/Riyadh')::date;
  v_from date := nullif(p_filters->>'from','')::date;
  v_to date := nullif(p_filters->>'to','')::date;
  v_due_from date := nullif(p_filters->>'dueFrom','')::date;
  v_due_to date := nullif(p_filters->>'dueTo','')::date;
  v_company text := coalesce(p_filters->>'company','');
  v_department text := coalesce(p_filters->>'department','');
  v_project text := coalesce(p_filters->>'project','');
  v_status text := lower(btrim(coalesce(p_filters->>'invoiceStatus','')));
  v_payment text := coalesce(p_filters->>'paymentStatus','');
  v_attention text := coalesce(p_filters->>'attention','');
  v_all_dates boolean;
  v_start date;
  v_end date;
  v_report_date date;
  v_invoice_criteria boolean;
  v_result jsonb;
begin
  if auth.uid() is null or public.current_user_role() is null or public.current_user_must_change_password() then
    raise insufficient_privilege using message='An active signed-in account with a completed password change is required.';
  end if;
  if v_from > v_to or v_due_from > v_due_to then raise invalid_parameter_value using message='The start date must be on or before the end date.'; end if;
  if p_group_metric not in ('billed','collections','advances','collectible','pending','retention','draft','overdue','unissued') then
    raise invalid_parameter_value using message='Unsupported grouped total.';
  end if;
  v_all_dates := v_from is null and v_to is null and (v_due_from is not null or v_due_to is not null);
  v_start := case when v_from is null and v_to is null and not v_all_dates then date_trunc('year',v_today)::date else v_from end;
  v_end := case when v_from is null and v_to is null and not v_all_dates then (date_trunc('year',v_today)+interval '1 year - 1 day')::date else v_to end;
  v_report_date := coalesce(v_to,v_today);
  v_invoice_criteria := v_status<>'' or v_payment<>'' or v_attention<>'' or v_due_from is not null or v_due_to is not null;
  with
  pr as materialized (select id,project_name,company,department from public.projects where (select public.can_read_module('projects'))),
  po as materialized (select p.*,coalesce(nullif(btrim(p.company),''),nullif(btrim(pr.company),''),'Unassigned') as customer_label,
    coalesce(nullif(btrim(p.department),''),nullif(btrim(pr.department),''),'Unassigned') as department_label,
    coalesce(nullif(btrim(pr.project_name),''),nullif(btrim(p.project_name),''),'Unassigned') as project_label
    from public.pos p left join pr on pr.id=p.project_id where (select public.can_read_module('orders'))),
  po_no as materialized (select distinct on (po_no) po_no,id from po order by po_no,id desc),
  invoice_raw as materialized (
    select i.id,i.invoice_no,i.po_no,i.status,i.project_id,i.start_date::date as invoice_date,i.approval_date::date as approval_date,
      case when i.approval_date is not null and i.payment_terms is not null then i.approval_date::date+i.payment_terms end as due_date,
      coalesce(i.retention_due_date,case when p.retention_applicable and p.retention_period_days is not null and i.approval_date is not null then i.approval_date::date+p.retention_period_days end) as retention_due,
      p.id as order_id,coalesce(p.project_id,i.project_id) as related_project_id,
      coalesce(nullif(btrim(p.company),''),nullif(btrim(pr.company),''),'Unassigned') as customer,
      coalesce(nullif(btrim(p.department),''),nullif(btrim(pr.department),''),'Unassigned') as department,
      coalesce(nullif(btrim(pr.project_name),''),nullif(btrim(p.project_name),''),nullif(btrim(i.project_name),''),'Unassigned') as project,
      case when lower(btrim(coalesce(i.status,''))) in ('canceled','cancelled','void') then 'cancelled'
        when lower(btrim(coalesce(i.status,'')))='draft' then 'draft'
        when lower(btrim(coalesce(i.status,''))) ~ '^(?:[12]-)?(?:submitted|pending|pending approval|awaiting approval|waiting approval|waiting for approval)$' then 'waiting' else 'issued' end as workflow,
      (pg_catalog.floor(((coalesce((greatest(0,coalesce(i.invoice_amount,0))),0)::double precision+2.220446049250313e-16::double precision)*100)+0.5)/100) as net,
      coalesce(p.vat,false) as taxable,
      greatest(0,coalesce(i.advance_amortisation,0)::double precision) as advance_ex_raw,
      greatest(0,coalesce(i.paid_amount,0)::double precision) as paid,
      greatest(0,coalesce(i.retention_released_amount,0)::double precision) as released,
      coalesce(i.retention_amount,0)::double precision+coalesce(i.retention_vat,0)::double precision as held_raw
    from public.invoices i left join po pi on pi.id=i.pos_id left join po_no pn on pi.id is null and pn.po_no=i.po_no
    left join po p on p.id=coalesce(pi.id,pn.id) left join pr on pr.id=coalesce(p.project_id,i.project_id)
    where (select public.can_read_module('invoices'))
  ),
  metric_a as (select r.*,(pg_catalog.floor(((coalesce((case when taxable then net*.15::double precision else 0 end),0)::double precision+2.220446049250313e-16::double precision)*100)+0.5)/100) as vat,least(net,advance_ex_raw) as advance_ex from invoice_raw r),
  metric_b as (select a.*,(pg_catalog.floor(((coalesce((net+vat),0)::double precision+2.220446049250313e-16::double precision)*100)+0.5)/100) as total,(pg_catalog.floor(((coalesce((net-advance_ex+case when taxable then (pg_catalog.floor(((coalesce(((net-advance_ex)*.15::double precision),0)::double precision+2.220446049250313e-16::double precision)*100)+0.5)/100) else 0 end),0)::double precision+2.220446049250313e-16::double precision)*100)+0.5)/100) as payable_total from metric_a a),
  metric_c as (select b.*,(pg_catalog.floor(((coalesce((least(payable_total,paid+released)),0)::double precision+2.220446049250313e-16::double precision)*100)+0.5)/100) as collected from metric_b b),
  metric_d as (select c.*,(pg_catalog.floor(((coalesce((greatest(0,payable_total-collected)),0)::double precision+2.220446049250313e-16::double precision)*100)+0.5)/100) as remaining from metric_c c),
  metric_e as (select d.*,case when upper(btrim(coalesce(status,'')))='RETENTION' then remaining else least((pg_catalog.floor(((coalesce((greatest(0,held_raw-released)),0)::double precision+2.220446049250313e-16::double precision)*100)+0.5)/100),remaining) end as retention from metric_d d),
  metric_f as (select e.*,(pg_catalog.floor(((coalesce((remaining-retention),0)::double precision+2.220446049250313e-16::double precision)*100)+0.5)/100) as balance,(pg_catalog.floor(((coalesce((total-payable_total),0)::double precision+2.220446049250313e-16::double precision)*100)+0.5)/100) as advance_applied from metric_e e),
  invoices as materialized (select f.*,
    case when workflow='cancelled' then 'Cancelled' when workflow<>'issued' then 'Not Issued' when balance<=.005 then case when retention>.005 then 'Retention Only' else 'Paid' end when collected>0 then 'Partially Paid' else 'Unpaid' end as payment,
    (workflow='issued' and due_date<v_today and balance>.005) as overdue,
    (workflow='draft' and invoice_date<=v_today) as draft_due,
    (workflow='issued' and nullif(btrim(invoice_no),'') is not null and lower(btrim(coalesce(status,''))) in ('approved','3-approved','partially paid','completed','paid','retention','bad debit')) as eligible_retention
    from metric_f f),
  scoped as materialized (select * from invoices where
    (v_company='' or customer=v_company) and (v_department='' or department=v_department) and (v_project='' or project=v_project)
    and (v_status='' or lower(btrim(coalesce(status,'')))=v_status)
    and (v_payment='' or case when v_payment='Overdue' then overdue else payment=v_payment end)
    and (v_due_from is null or due_date>=v_due_from) and (v_due_to is null or due_date<=v_due_to)
    and (v_attention='' or case v_attention when 'overdue' then overdue when 'draftDue' then draft_due when 'draft' then workflow='draft' when 'waiting' then workflow='waiting' else false end)),
  live as materialized (select * from scoped where workflow<>'cancelled'),
  billed as materialized (select * from live where workflow='issued' and approval_date is not null and (v_start is null or approval_date>=v_start) and (v_end is null or approval_date<=v_end)),
  collectible as materialized (select * from live where workflow='issued' and due_date is not null and (v_start is null or due_date>=v_start) and (v_end is null or due_date<=v_end)),
  retained as materialized (select * from live where eligible_retention),
  drafts as materialized (select * from live where draft_due),
  waiting as materialized (select * from live where workflow='waiting'),
  order_scope as materialized (select p.* from po p where (v_company='' or p.customer_label=v_company) and (v_department='' or p.department_label=v_department) and (v_project='' or p.project_label=v_project)
    and (not v_invoice_criteria or exists(select 1 from live i where i.order_id=p.id))),
  orders as materialized (select p.*,(pg_catalog.floor(((coalesce((coalesce(po_value_ex_vat,0)::double precision*case when vat then 1.15::double precision else 1::double precision end),0)::double precision+2.220446049250313e-16::double precision)*100)+0.5)/100) as gross from order_scope p where po_date is null or po_date::date<=v_report_date),
  period_orders as materialized (select * from orders where po_date is not null and (v_start is null or po_date::date>=v_start) and (v_end is null or po_date::date<=v_end)),
  order_billing as materialized (select order_id,sum(total) as billed from invoices where workflow='issued' and approval_date<=v_report_date group by order_id),
  receipts as materialized (select c.id,c.invoice_id,c.collection_date,c.amount,i.customer,i.department,i.project,i.order_id from public.invoice_collections c join live i on i.id=c.invoice_id
    where (select public.can_read_module('collections')) and (v_start is null or c.collection_date>=v_start) and (v_end is null or c.collection_date<=v_end)),
  advances as materialized (select a.id,a.po_id,a.payment_date,a.amount,p.customer_label as customer,p.department_label as department,p.project_label as project from public.po_advance_payments a join order_scope p on p.id=a.po_id
    where (select public.can_read_module('collections')) and a.payment_date is not null and (v_start is null or a.payment_date>=v_start) and (v_end is null or a.payment_date<=v_end)),
  operational as materialized (select * from invoices where workflow<>'cancelled' and (v_company='' or customer=v_company) and (v_department='' or department=v_department) and (v_project='' or project=v_project)
    and (v_status='' or lower(btrim(coalesce(status,'')))=v_status) and (v_payment='' or case when v_payment='Overdue' then overdue else payment=v_payment end)
    and (v_due_from is null or due_date>=v_due_from) and (v_due_to is null or due_date<=v_due_to)),
  progress_due as materialized (select * from live where workflow='issued' and due_date<v_today and (v_start is null or due_date>=v_start) and (v_end is null or due_date<=v_end)),
  progress_approval as materialized (select * from live where workflow in ('issued','waiting') and invoice_date<=v_today and (v_start is null or invoice_date>=v_start) and (v_end is null or invoice_date<=v_end)),
  progress_issuance as materialized (select * from live where invoice_date<=v_today and (v_start is null or invoice_date>=v_start) and (v_end is null or invoice_date<=v_end)),
  progress_json as (select jsonb_build_object(
    'collection',jsonb_build_object('positive',coalesce((select (pg_catalog.floor(((coalesce((sum(collected)),0)::double precision+2.220446049250313e-16::double precision)*100)+0.5)/100) from progress_due),0),'negative',coalesce((select (pg_catalog.floor(((coalesce((sum(balance)),0)::double precision+2.220446049250313e-16::double precision)*100)+0.5)/100) from progress_due),0),
      'positiveCount',(select count(*) from progress_due where collected>.005),'negativeCount',(select count(*) from progress_due where balance>.005),
      'missingDateCount',(select count(*) from live where workflow='issued' and due_date is null)),
    'approval',jsonb_build_object('positive',coalesce((select (pg_catalog.floor(((coalesce((sum(total)),0)::double precision+2.220446049250313e-16::double precision)*100)+0.5)/100) from progress_approval where workflow='issued'),0),'negative',coalesce((select (pg_catalog.floor(((coalesce((sum(total)),0)::double precision+2.220446049250313e-16::double precision)*100)+0.5)/100) from progress_approval where workflow='waiting'),0),
      'positiveCount',(select count(*) from progress_approval where workflow='issued' and total>.005),'negativeCount',(select count(*) from progress_approval where workflow='waiting' and total>.005),
      'missingDateCount',(select count(*) from live where workflow in ('issued','waiting') and invoice_date is null)),
    'issuance',jsonb_build_object('positive',coalesce((select (pg_catalog.floor(((coalesce((sum(total)),0)::double precision+2.220446049250313e-16::double precision)*100)+0.5)/100) from progress_issuance where workflow in ('issued','waiting')),0),'negative',coalesce((select (pg_catalog.floor(((coalesce((sum(total)),0)::double precision+2.220446049250313e-16::double precision)*100)+0.5)/100) from progress_issuance where workflow='draft'),0),
      'positiveCount',(select count(*) from progress_issuance where workflow in ('issued','waiting') and total>.005),'negativeCount',(select count(*) from progress_issuance where workflow='draft' and total>.005),
      'missingDateCount',(select count(*) from live where invoice_date is null))) as value),
  totals as (select jsonb_build_object(
    'billed',coalesce((select (pg_catalog.floor(((coalesce((sum(total)),0)::double precision+2.220446049250313e-16::double precision)*100)+0.5)/100) from billed),0),'billedNet',coalesce((select (pg_catalog.floor(((coalesce((sum(net)),0)::double precision+2.220446049250313e-16::double precision)*100)+0.5)/100) from billed),0),'billedVat',coalesce((select (pg_catalog.floor(((coalesce((sum(vat)),0)::double precision+2.220446049250313e-16::double precision)*100)+0.5)/100) from billed),0),
    'collections',coalesce((select (pg_catalog.floor(((coalesce((sum(amount)),0)::double precision+2.220446049250313e-16::double precision)*100)+0.5)/100) from receipts),0),'advances',coalesce((select (pg_catalog.floor(((coalesce((sum(amount)),0)::double precision+2.220446049250313e-16::double precision)*100)+0.5)/100) from advances),0),
    'collectible',coalesce((select (pg_catalog.floor(((coalesce((sum(balance)),0)::double precision+2.220446049250313e-16::double precision)*100)+0.5)/100) from collectible),0),'pending',coalesce((select (pg_catalog.floor(((coalesce((sum(total)),0)::double precision+2.220446049250313e-16::double precision)*100)+0.5)/100) from waiting),0),'draft',coalesce((select (pg_catalog.floor(((coalesce((sum(total)),0)::double precision+2.220446049250313e-16::double precision)*100)+0.5)/100) from drafts),0),
    'retention',coalesce((select (pg_catalog.floor(((coalesce((sum(retention)),0)::double precision+2.220446049250313e-16::double precision)*100)+0.5)/100) from retained),0),'overdueRetention',coalesce((select (pg_catalog.floor(((coalesce((sum(retention)),0)::double precision+2.220446049250313e-16::double precision)*100)+0.5)/100) from retained where retention_due<v_report_date and retention>.005),0),
    'periodPoValue',coalesce((select (pg_catalog.floor(((coalesce((sum(gross)),0)::double precision+2.220446049250313e-16::double precision)*100)+0.5)/100) from period_orders),0),'periodPoInvoiced',coalesce((select (pg_catalog.floor(((coalesce((sum(total)),0)::double precision+2.220446049250313e-16::double precision)*100)+0.5)/100) from billed),0),
    'periodPoRemaining',coalesce((select (pg_catalog.floor(((coalesce((sum(greatest(0,p.gross-coalesce(b.billed,0)))),0)::double precision+2.220446049250313e-16::double precision)*100)+0.5)/100) from period_orders p left join order_billing b on b.order_id=p.id),0)) as value),
  counts as (select jsonb_build_object('billed',(select count(*) from billed),'collections',(select count(distinct invoice_id) from receipts),'advances',(select count(*) from advances),
    'collectible',(select count(*) from collectible where balance>.005),'pending',(select count(*) from waiting),'draft',(select count(*) from drafts),'retention',(select count(*) from retained where retention>.005),
    'undatedDraft',(select count(*) from live where workflow='draft' and invoice_date is null),'undatedRetention',(select count(*) from retained where retention>.005 and retention_due is null)) as value),
  alerts as (select jsonb_agg(jsonb_build_object('key',key,'count',n,'amount',amount) order by key) as value from (
    select 'draftDue' as key,count(*) as n,coalesce((pg_catalog.floor(((coalesce((sum(total)),0)::double precision+2.220446049250313e-16::double precision)*100)+0.5)/100),0) as amount from operational where draft_due
    union all select 'waiting',count(*),coalesce((pg_catalog.floor(((coalesce((sum(total)),0)::double precision+2.220446049250313e-16::double precision)*100)+0.5)/100),0) from operational where workflow='waiting'
    union all select 'overdue',count(*),coalesce((pg_catalog.floor(((coalesce((sum(balance)),0)::double precision+2.220446049250313e-16::double precision)*100)+0.5)/100),0) from operational where overdue) a),
  group_entries as (
    select customer,department,project,total as amount from billed where p_group_metric='billed'
    union all select customer,department,project,amount from receipts where p_group_metric='collections'
    union all select customer,department,project,amount from advances where p_group_metric='advances'
    union all select customer,department,project,balance from collectible where p_group_metric='collectible'
    union all select customer,department,project,total from waiting where p_group_metric in ('pending','unissued')
    union all select customer,department,project,total from drafts where p_group_metric in ('draft','unissued')
    union all select customer,department,project,retention from retained where p_group_metric='retention'
    union all select customer,department,project,balance from live where p_group_metric='overdue' and overdue),
  grouped as (select dimension,label,(pg_catalog.floor(((coalesce((sum(amount)),0)::double precision+2.220446049250313e-16::double precision)*100)+0.5)/100) as amount,count(*) as n from group_entries cross join lateral (values ('company',customer),('department',department),('project',project)) dims(dimension,label) group by dimension,label having abs((pg_catalog.floor(((coalesce((sum(amount)),0)::double precision+2.220446049250313e-16::double precision)*100)+0.5)/100))>.005),
  group_json as (select coalesce(jsonb_agg(jsonb_build_object('dimension',dimension,'label',label,'amount',amount,'count',n) order by dimension,amount desc,label),'[]'::jsonb) as value from grouped),
  month_events as (
    select to_char(invoice_date,'YYYY-MM') as month,'invoiced' as series,total as amount from live where workflow='issued' and invoice_date is not null and (v_start is null or invoice_date>=v_start) and (v_end is null or invoice_date<=v_end)
    union all select to_char(due_date,'YYYY-MM'),'expected',total from live where workflow='issued' and due_date is not null and (v_start is null or due_date>=v_start) and (v_end is null or due_date<=v_end)
    union all select to_char(collection_date,'YYYY-MM'),'actual',amount from receipts
    union all select case when v_from is null and v_to is null and not v_all_dates and due_date<date_trunc('year',v_today)::date then 'earlier' else to_char(due_date,'YYYY-MM') end,'overdue',balance from live where overdue
      and ((v_from is null and v_to is null and not v_all_dates) or ((v_start is null or due_date>=v_start) and (v_end is null or due_date<=v_end)))),
  month_sums as (select month,series,(pg_catalog.floor(((coalesce((sum(amount)),0)::double precision+2.220446049250313e-16::double precision)*100)+0.5)/100) as amount from month_events group by month,series),
  month_json as (select coalesce(jsonb_agg(jsonb_build_object('month',month,'series',series,'amount',amount) order by month,series),'[]'::jsonb) as value from month_sums),
  choices as (select distinct customer,department,project from invoices union select customer_label,department_label,project_label from po union select coalesce(nullif(btrim(company),''),'Unassigned'),coalesce(nullif(btrim(department),''),'Unassigned'),coalesce(nullif(btrim(project_name),''),'Unassigned') from pr where not exists(select 1 from po where po.project_id=pr.id)),
  choice_json as (select coalesce(jsonb_agg(to_jsonb(c) order by customer,department,project),'[]'::jsonb) as value from choices c),
  status_json as (select coalesce(jsonb_agg(s order by s),'[]'::jsonb) as value from (select distinct btrim(status) as s from invoices where nullif(btrim(status),'') is not null) st)
  select jsonb_build_object('version',1,'asOf',v_today,'reportDate',v_report_date,'year',extract(year from v_today)::integer,'allPeriods',v_all_dates,'groupMetric',p_group_metric,
    'progress',progress_json.value,'totals',totals.value,'counts',counts.value,'alerts',alerts.value,'groups',group_json.value,'monthly',month_json.value,'choices',choice_json.value,'invoiceStatuses',status_json.value)
    into v_result from totals,counts,alerts,group_json,month_json,choice_json,status_json,progress_json;
  return v_result;
end;
$fn$;
revoke all on function public.dashboard_summary_trial_v1(jsonb,text) from public,anon;
grant execute on function public.dashboard_summary_trial_v1(jsonb,text) to authenticated;
comment on function public.dashboard_summary_trial_v1(jsonb,text) is 'Optional read-only summary dashboard trial. Security invoker; returns aggregates and filter labels only. Classic dashboard remains available.';

