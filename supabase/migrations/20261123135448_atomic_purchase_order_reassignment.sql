-- Explicit, authorized and atomic PO reassignment, keeping all normal triggers enabled.
CREATE TABLE public.po_link_change_audit(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now(),actor_id uuid NOT NULL,
 po_id bigint NOT NULL,before_record jsonb NOT NULL,after_record jsonb NOT NULL,invoice_count integer NOT NULL
);
ALTER TABLE public.po_link_change_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY manager_read ON public.po_link_change_audit FOR SELECT TO authenticated USING((SELECT public.is_finance_manager()));
GRANT SELECT ON public.po_link_change_audit TO authenticated;

CREATE FUNCTION public.update_purchase_order(p_po_id bigint,p_patch jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old_po public.pos%ROWTYPE; new_po public.pos%ROWTYPE; pr public.projects%ROWTYPE;
 links_changed boolean; parking_id bigint; parking_no text; invoice_ids bigint[]; before_invoices jsonb; before_collections jsonb; n integer;
BEGIN
 IF auth.uid() IS NULL OR public.access_actor_id() IS NULL OR NOT public.can_module('orders','edit') THEN RAISE EXCEPTION 'Purchase order Edit permission is required';END IF;
 IF p_patch IS NULL OR jsonb_typeof(p_patch)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_patch) k WHERE k NOT IN('company','department','project_id','project_name','po_no','vat','po_value_ex_vat','po_date','expiry_date','notes','archive','retention_applicable','retention_percentage','retention_period_days','status','advance_payment_percentage','advance_received_amount','retention_basis')) THEN RAISE EXCEPTION 'Invalid purchase order fields';END IF;
 PERFORM set_config('lock_timeout','3s',true);
 PERFORM pg_advisory_xact_lock(hashtextextended('system_admin_scope_changes',0));
 -- Serialize link reassignment with invoice/collection writes and the merge service.
 LOCK TABLE public.invoice_collections,public.invoices,public.pos IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO old_po FROM public.pos WHERE id=p_po_id FOR UPDATE;
 IF old_po.id IS NULL OR NOT public.po_scope(old_po.id) OR NOT public.department_operation(old_po.department,'edit') THEN RAISE EXCEPTION 'Purchase order is outside your editable scope';END IF;
 new_po:=jsonb_populate_record(old_po,p_patch);
 new_po.po_no:=btrim(new_po.po_no);
 IF nullif(new_po.po_no,'') IS NULL OR nullif(new_po.company,'') IS NULL OR nullif(new_po.department,'') IS NULL OR new_po.project_id IS NULL THEN RAISE EXCEPTION 'Select a registered customer, department and project, and enter the PO number';END IF;
 SELECT * INTO pr FROM public.projects WHERE id=new_po.project_id;
 IF pr.id IS NULL OR NOT public.project_scope(pr.id) OR NOT public.customer_department_scope(new_po.company,new_po.department) OR NOT public.department_operation(new_po.department,'edit') THEN RAISE EXCEPTION 'Destination customer, department or project is outside your editable scope';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.department_customer_companies dc JOIN public.customer_companies c ON c.id=dc.customer_company_id JOIN public.departments d ON d.id=dc.department_id WHERE c.name=new_po.company AND d.name=new_po.department) THEN RAISE EXCEPTION 'Customer must be linked to the selected department';END IF;
 links_changed:=old_po.po_no IS DISTINCT FROM new_po.po_no OR old_po.project_id IS DISTINCT FROM new_po.project_id OR old_po.company IS DISTINCT FROM new_po.company OR old_po.department IS DISTINCT FROM new_po.department;
 IF links_changed AND (pr.company IS DISTINCT FROM new_po.company OR pr.department IS DISTINCT FROM new_po.department) THEN RAISE EXCEPTION 'Choose a project belonging to the selected customer and department';END IF;
 new_po.project_name:=pr.project_name;
 IF coalesce(new_po.po_value_ex_vat,0)<0 OR coalesce(new_po.advance_received_amount,0)<0 OR coalesce(new_po.retention_percentage,0) NOT BETWEEN 0 AND 100 OR coalesce(new_po.advance_payment_percentage,0) NOT BETWEEN 0 AND 100 OR coalesce(new_po.retention_period_days,0)<0 OR new_po.retention_basis NOT IN('before_vat','after_vat') THEN RAISE EXCEPTION 'Invalid financial values or retention settings';END IF;
 IF EXISTS(SELECT 1 FROM public.pos WHERE po_no=new_po.po_no AND id<>p_po_id) THEN RAISE EXCEPTION 'This purchase order number already exists';END IF;
 SELECT coalesce(array_agg(id ORDER BY id),ARRAY[]::bigint[]) INTO invoice_ids FROM public.invoices WHERE pos_id=p_po_id OR (po_no=old_po.po_no AND project_id=old_po.project_id);
 n:=cardinality(invoice_ids);
 IF links_changed AND n>0 THEN
  IF NOT public.can_module('invoices','edit') THEN RAISE EXCEPTION 'Invoice Edit permission is required to move linked invoices';END IF;
  IF EXISTS(SELECT 1 FROM public.invoices i WHERE id=ANY(invoice_ids) AND (NOT public.invoice_scope(i.id) OR i.project_id IS DISTINCT FROM old_po.project_id OR i.po_no IS DISTINCT FROM old_po.po_no OR i.pos_id IS DISTINCT FROM p_po_id)) THEN RAISE EXCEPTION 'Linked invoices require review before reassignment';END IF;
  SELECT jsonb_agg(to_jsonb(i) ORDER BY id) INTO before_invoices FROM public.invoices i WHERE id=ANY(invoice_ids);
  SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY id),'[]') INTO before_collections FROM public.invoice_collections c WHERE invoice_id=ANY(invoice_ids);
  parking_no:='__PO_EDIT_'||gen_random_uuid();
  INSERT INTO public.pos(company,project_name,po_no,vat,po_value_ex_vat,po_date,expiry_date,notes,archive,department,project_id,retention_applicable,retention_percentage,retention_period_days,status,advance_payment_percentage,advance_received_amount,retention_basis)
  VALUES(old_po.company,old_po.project_name,parking_no,old_po.vat,old_po.po_value_ex_vat,old_po.po_date,old_po.expiry_date,old_po.notes,old_po.archive,old_po.department,old_po.project_id,old_po.retention_applicable,old_po.retention_percentage,old_po.retention_period_days,old_po.status,old_po.advance_payment_percentage,old_po.advance_received_amount,old_po.retention_basis) RETURNING id INTO parking_id;
  UPDATE public.invoices SET po_no=parking_no,pos_id=parking_id WHERE id=ANY(invoice_ids);
 END IF;
 UPDATE public.pos SET company=new_po.company,department=new_po.department,project_id=new_po.project_id,project_name=new_po.project_name,po_no=new_po.po_no,vat=new_po.vat,po_value_ex_vat=new_po.po_value_ex_vat,po_date=new_po.po_date,expiry_date=new_po.expiry_date,notes=new_po.notes,archive=new_po.archive,retention_applicable=new_po.retention_applicable,retention_percentage=new_po.retention_percentage,retention_period_days=new_po.retention_period_days,status=new_po.status,advance_payment_percentage=new_po.advance_payment_percentage,advance_received_amount=new_po.advance_received_amount,retention_basis=new_po.retention_basis WHERE id=p_po_id;
 IF parking_id IS NOT NULL THEN
  UPDATE public.invoices SET po_no=new_po.po_no,pos_id=p_po_id,project_id=new_po.project_id,project_name=new_po.project_name WHERE id=ANY(invoice_ids);
  DELETE FROM public.pos WHERE id=parking_id;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(before_invoices) b JOIN public.invoices i ON i.id=(b->>'id')::bigint WHERE (to_jsonb(i)-ARRAY['po_no','pos_id','project_id','project_name']) IS DISTINCT FROM (b-ARRAY['po_no','pos_id','project_id','project_name'])) THEN RAISE EXCEPTION 'Invoice values changed unexpectedly; update cancelled';END IF;
  IF (SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY id),'[]') FROM public.invoice_collections c WHERE invoice_id=ANY(invoice_ids)) IS DISTINCT FROM before_collections THEN RAISE EXCEPTION 'Collection records changed unexpectedly; update cancelled';END IF;
 END IF;
 IF links_changed THEN INSERT INTO public.po_link_change_audit(actor_id,po_id,before_record,after_record,invoice_count) SELECT auth.uid(),p_po_id,to_jsonb(old_po),to_jsonb(p),n FROM public.pos p WHERE id=p_po_id;END IF;
 RETURN jsonb_build_object('id',p_po_id,'updated',true,'linked_invoices',n);
END $$;
REVOKE ALL ON FUNCTION public.update_purchase_order(bigint,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_purchase_order(bigint,jsonb) TO authenticated;


NOTIFY pgrst,'reload schema';