-- System Administration: Viewer monitoring, Editor department tree and audited entity merges.
-- Existing account permissions and business records are preserved during deployment.
CREATE TEMP TABLE sa_deployment_before ON COMMIT DROP AS SELECT jsonb_build_object(
'customers',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM public.customer_companies t),
'departments',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM public.departments t),
'projects',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM public.projects t),
'orders',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM public.pos t),
'invoices',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM public.invoices t),
'collections',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM public.invoice_collections t),
'profiles',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM public.users_profile t),
'permissions',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t)-'access_profile' ORDER BY user_id)::text,'[]')) FROM public.user_permissions t),
'customer_scopes',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY user_id,customer_company_id)::text,'[]')) FROM public.user_customer_access t),
'department_scopes',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM public.user_department_access t),
'project_scopes',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM public.user_project_access t)) AS fingerprint;

ALTER TABLE public.user_permissions ADD COLUMN access_profile jsonb;
CREATE TABLE public.user_department_permissions(
 user_id bigint NOT NULL REFERENCES public.users_profile(id) ON DELETE CASCADE,
 department_id bigint NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
 can_add boolean NOT NULL DEFAULT false,can_edit boolean NOT NULL DEFAULT false,can_delete boolean NOT NULL DEFAULT false,
 PRIMARY KEY(user_id,department_id)
);
CREATE TABLE public.user_customer_department_access(
 user_id bigint NOT NULL REFERENCES public.users_profile(id) ON DELETE CASCADE,
 department_id bigint NOT NULL,customer_company_id bigint NOT NULL,
 PRIMARY KEY(user_id,department_id,customer_company_id),
 FOREIGN KEY(department_id,customer_company_id) REFERENCES public.department_customer_companies(department_id,customer_company_id) ON DELETE CASCADE
);
CREATE TABLE public.user_order_access(
 user_id bigint NOT NULL REFERENCES public.users_profile(id) ON DELETE CASCADE,
 order_id bigint NOT NULL REFERENCES public.pos(id) ON DELETE CASCADE,
 PRIMARY KEY(user_id,order_id)
);
CREATE INDEX user_department_permissions_department_idx ON public.user_department_permissions(department_id);
CREATE INDEX user_customer_department_customer_idx ON public.user_customer_department_access(customer_company_id,department_id);
CREATE INDEX user_order_access_order_idx ON public.user_order_access(order_id);
ALTER TABLE public.user_department_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY scope_read ON public.user_department_permissions FOR SELECT TO authenticated USING(user_id=public.access_actor_id() OR public.is_finance_manager());
CREATE POLICY scope_admin ON public.user_department_permissions FOR ALL TO authenticated USING(public.is_finance_manager()) WITH CHECK(public.is_finance_manager());
GRANT SELECT,INSERT,UPDATE,DELETE ON public.user_department_permissions TO authenticated;
ALTER TABLE public.user_customer_department_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY scope_read ON public.user_customer_department_access FOR SELECT TO authenticated USING(user_id=public.access_actor_id() OR public.is_finance_manager());
CREATE POLICY scope_admin ON public.user_customer_department_access FOR ALL TO authenticated USING(public.is_finance_manager()) WITH CHECK(public.is_finance_manager());
GRANT SELECT,INSERT,UPDATE,DELETE ON public.user_customer_department_access TO authenticated;
ALTER TABLE public.user_order_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY scope_read ON public.user_order_access FOR SELECT TO authenticated USING(user_id=public.access_actor_id() OR public.is_finance_manager());
CREATE POLICY scope_admin ON public.user_order_access FOR ALL TO authenticated USING(public.is_finance_manager()) WITH CHECK(public.is_finance_manager());
GRANT SELECT,INSERT,UPDATE,DELETE ON public.user_order_access TO authenticated;

CREATE FUNCTION public.department_operation(p_department text,p_action text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.is_finance_manager() OR EXISTS(
 SELECT 1 FROM public.user_permissions p WHERE p.user_id=public.access_actor_id() AND public.has_department_access(p_department)
 AND (p.access_profile IS NULL OR (p.access_profile->>'mode'='editor' AND EXISTS(
  SELECT 1 FROM public.user_department_permissions a JOIN public.departments d ON d.id=a.department_id WHERE a.user_id=p.user_id AND d.name=p_department
  AND CASE p_action WHEN 'add' THEN a.can_add WHEN 'edit' THEN a.can_edit WHEN 'delete' THEN a.can_delete WHEN 'view' THEN true ELSE false END
 )))
 )
$$;
CREATE FUNCTION public.customer_department_scope(p_customer text,p_department text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.is_finance_manager() OR EXISTS(
 SELECT 1 FROM public.user_permissions u WHERE u.user_id=public.access_actor_id() AND public.has_customer_access(p_customer) AND public.has_department_access(p_department)
 AND (u.access_profile IS NULL OR EXISTS(
 SELECT 1 FROM public.user_customer_department_access a JOIN public.customer_companies c ON c.id=a.customer_company_id JOIN public.departments d ON d.id=a.department_id
 WHERE a.user_id=u.user_id AND c.name=p_customer AND d.name=p_department
 ))
 )
$$;
CREATE OR REPLACE FUNCTION public.can_module(p_module text,p_action text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p_module IN('customers','departments','projects','orders','invoices','collections') AND p_action IN('view','add','edit','delete') AND
 (public.is_finance_manager() OR EXISTS(
 SELECT 1 FROM public.user_permissions p WHERE p.user_id=public.access_actor_id() AND p.module_permissions->p_module->>'view'='true' AND p.module_permissions->p_module->>p_action='true'
 AND (p_action='view' OR p.access_profile IS NULL OR (p.access_profile->>'mode'='editor' AND EXISTS(
 SELECT 1 FROM public.user_department_permissions d WHERE d.user_id=p.user_id AND CASE p_action WHEN 'add' THEN d.can_add WHEN 'edit' THEN d.can_edit WHEN 'delete' THEN d.can_delete ELSE false END
 )))
 ))
$$;
CREATE FUNCTION public.customer_operation(p_id bigint,p_action text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.can_module('customers',p_action) AND public.customer_id_scope(p_id)
 AND NOT EXISTS(SELECT 1 FROM public.department_customer_companies dc JOIN public.departments d ON d.id=dc.department_id WHERE dc.customer_company_id=p_id AND NOT public.department_operation(d.name,p_action))
$$;
CREATE FUNCTION public.invoice_department_operation(p_pos_id bigint,p_po_no text,p_project_id bigint,p_action text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.is_finance_manager() OR EXISTS(SELECT 1 FROM public.pos p WHERE
 (CASE WHEN p_pos_id IS NOT NULL THEN p.id=p_pos_id ELSE p.po_no=p_po_no AND p.project_id=p_project_id END)
 AND public.department_operation(p.department,p_action) AND public.customer_department_scope(p.company,p.department))
$$;
CREATE FUNCTION public.collection_operation(p_invoice_id bigint,p_action text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.can_module('collections',p_action) AND public.invoice_scope(p_invoice_id) AND EXISTS(SELECT 1 FROM public.invoices i WHERE i.id=p_invoice_id AND public.invoice_department_operation(i.pos_id,i.po_no,i.project_id,p_action))
$$;

CREATE OR REPLACE FUNCTION public.accessible_project_ids() RETURNS bigint[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH actor AS MATERIALIZED(
 SELECT u.id,u.role,u.all_projects,u.all_departments,per.access_profile FROM public.users_profile u LEFT JOIN public.user_permissions per ON per.user_id=u.id WHERE u.auth_user_id=(SELECT auth.uid()) AND u.active IS TRUE AND u.must_change_password IS FALSE)
 SELECT coalesce(array_agg(p.id),ARRAY[]::bigint[]) FROM public.projects p CROSS JOIN actor u
 WHERE u.role IN('finance_manager','system_admin') OR
 ((u.all_projects OR EXISTS(SELECT 1 FROM public.user_project_access a WHERE a.user_id=u.id AND a.project_id=p.id))
 AND (u.all_departments OR EXISTS(SELECT 1 FROM public.user_department_access a WHERE a.user_id=u.id AND lower(btrim(a.department))=lower(btrim(p.department))))
 AND EXISTS(SELECT 1 FROM public.user_customer_access a JOIN public.customer_companies c ON c.id=a.customer_company_id WHERE a.user_id=u.id AND c.name=p.company)
 AND (u.access_profile IS NULL OR EXISTS(SELECT 1 FROM public.user_customer_department_access a JOIN public.customer_companies c ON c.id=a.customer_company_id JOIN public.departments d ON d.id=a.department_id WHERE a.user_id=u.id AND c.name=p.company AND d.name=p.department)))
$$;
CREATE OR REPLACE FUNCTION public.accessible_po_ids() RETURNS bigint[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH actor AS MATERIALIZED(SELECT u.id,u.role,u.all_departments,per.access_profile FROM public.users_profile u LEFT JOIN public.user_permissions per ON per.user_id=u.id WHERE u.auth_user_id=(SELECT auth.uid()) AND u.active IS TRUE AND u.must_change_password IS FALSE),
 projects AS MATERIALIZED(SELECT public.accessible_project_ids() ids)
 SELECT coalesce(array_agg(p.id),ARRAY[]::bigint[]) FROM public.pos p CROSS JOIN actor u CROSS JOIN projects
 WHERE u.role IN('finance_manager','system_admin') OR
 (p.project_id=ANY(projects.ids)
 AND (u.all_departments OR EXISTS(SELECT 1 FROM public.user_department_access a WHERE a.user_id=u.id AND lower(btrim(a.department))=lower(btrim(p.department))))
 AND EXISTS(SELECT 1 FROM public.user_customer_access a JOIN public.customer_companies c ON c.id=a.customer_company_id WHERE a.user_id=u.id AND c.name=p.company)
 AND (u.access_profile IS NULL OR EXISTS(SELECT 1 FROM public.user_customer_department_access a JOIN public.customer_companies c ON c.id=a.customer_company_id JOIN public.departments d ON d.id=a.department_id WHERE a.user_id=u.id AND c.name=p.company AND d.name=p.department))
 AND (NOT coalesce(u.access_profile->>'mode'='viewer' AND u.access_profile->>'viewer_type'='orders',false) OR EXISTS(SELECT 1 FROM public.user_order_access a WHERE a.user_id=u.id AND a.order_id=p.id)))
$$;
CREATE OR REPLACE FUNCTION public.project_scope(p_id bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT public.is_finance_manager() OR p_id=ANY(public.accessible_project_ids()) $$;
CREATE OR REPLACE FUNCTION public.po_scope(p_id bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT public.is_finance_manager() OR p_id=ANY(public.accessible_po_ids()) $$;
CREATE OR REPLACE FUNCTION public.invoice_scope(p_id bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT public.is_finance_manager() OR p_id=ANY(public.accessible_invoice_ids()) $$;

-- Writes are checked against both the old module matrix and the record's department.
CREATE POLICY department_add ON public.projects AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(public.department_operation(department,'add') AND public.customer_department_scope(company,department));
CREATE POLICY department_edit ON public.projects AS RESTRICTIVE FOR UPDATE TO authenticated USING(public.department_operation(department,'edit') AND public.customer_department_scope(company,department)) WITH CHECK(public.department_operation(department,'edit') AND public.customer_department_scope(company,department));
CREATE POLICY department_delete ON public.projects AS RESTRICTIVE FOR DELETE TO authenticated USING(public.department_operation(department,'delete') AND public.customer_department_scope(company,department));
CREATE POLICY department_add ON public.pos AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(public.department_operation(department,'add') AND public.customer_department_scope(company,department));
CREATE POLICY department_edit ON public.pos AS RESTRICTIVE FOR UPDATE TO authenticated USING(public.department_operation(department,'edit') AND public.customer_department_scope(company,department)) WITH CHECK(public.department_operation(department,'edit') AND public.customer_department_scope(company,department));
CREATE POLICY department_delete ON public.pos AS RESTRICTIVE FOR DELETE TO authenticated USING(public.department_operation(department,'delete') AND public.customer_department_scope(company,department));
CREATE POLICY department_add ON public.invoices AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(public.invoice_department_operation(pos_id,po_no,project_id,'add'));
CREATE POLICY department_edit ON public.invoices AS RESTRICTIVE FOR UPDATE TO authenticated USING(public.invoice_department_operation(pos_id,po_no,project_id,'edit')) WITH CHECK(public.invoice_department_operation(pos_id,po_no,project_id,'edit'));
CREATE POLICY department_delete ON public.invoices AS RESTRICTIVE FOR DELETE TO authenticated USING(public.invoice_department_operation(pos_id,po_no,project_id,'delete'));
CREATE POLICY department_add ON public.invoice_collections AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(public.collection_operation(invoice_id,'add'));
CREATE POLICY department_edit ON public.invoice_collections AS RESTRICTIVE FOR UPDATE TO authenticated USING(public.collection_operation(invoice_id,'edit')) WITH CHECK(public.collection_operation(invoice_id,'edit'));
CREATE POLICY department_delete ON public.invoice_collections AS RESTRICTIVE FOR DELETE TO authenticated USING(public.collection_operation(invoice_id,'delete'));

CREATE OR REPLACE FUNCTION public.get_my_module_access() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object(
 'manager',public.is_finance_manager(),'user_id',public.access_actor_id(),
 'mode',CASE WHEN public.is_finance_manager() THEN 'administrator' ELSE coalesce((SELECT access_profile->>'mode' FROM public.user_permissions WHERE user_id=public.access_actor_id()),'editor') END,
 'tree',coalesce((SELECT access_profile IS NOT NULL FROM public.user_permissions WHERE user_id=public.access_actor_id()),false),
 'viewer_type',(SELECT access_profile->>'viewer_type' FROM public.user_permissions WHERE user_id=public.access_actor_id()),
 'modules',(SELECT jsonb_object_agg(m,jsonb_build_object('view',public.can_module(m,'view'),'add',public.can_module(m,'add'),'edit',public.can_module(m,'edit'),'delete',public.can_module(m,'delete'))) FROM unnest(ARRAY['customers','departments','projects','orders','invoices','collections']) m),
 'department_rules',coalesce((SELECT jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,'add',a.can_add,'edit',a.can_edit,'delete',a.can_delete)) FROM public.user_department_permissions a JOIN public.departments d ON d.id=a.department_id WHERE a.user_id=public.access_actor_id()),'[]'),
 'customer_operations',coalesce((SELECT jsonb_object_agg(c.id::text,jsonb_build_object('edit',public.customer_operation(c.id,'edit'),'delete',public.customer_operation(c.id,'delete'))) FROM public.customer_companies c WHERE c.id=ANY(public.accessible_customer_ids())),'{}')
 )
$$;

CREATE FUNCTION public.my_access_profile() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT access_profile FROM public.user_permissions WHERE user_id=public.access_actor_id() $$;
CREATE POLICY tree_pos_read ON public.pos AS RESTRICTIVE FOR SELECT TO authenticated USING(
 (SELECT public.is_finance_manager()) OR (SELECT public.my_access_profile()) IS NULL OR (
 EXISTS(SELECT 1 FROM public.user_customer_department_access a JOIN public.customer_companies c ON c.id=a.customer_company_id JOIN public.departments d ON d.id=a.department_id
 WHERE a.user_id=(SELECT public.access_actor_id()) AND c.name=pos.company AND d.name=pos.department)
 AND (NOT coalesce((SELECT public.my_access_profile())->>'mode'='viewer' AND (SELECT public.my_access_profile())->>'viewer_type'='orders',false)
 OR EXISTS(SELECT 1 FROM public.user_order_access a WHERE a.user_id=(SELECT public.access_actor_id()) AND a.order_id=pos.id))))
;

CREATE OR REPLACE FUNCTION public.create_customer_for_department(p_customer_name text, p_department_id bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_customer_id bigint;
BEGIN
 IF NOT public.department_operation((SELECT name FROM public.departments WHERE id=p_department_id),'add') THEN RAISE EXCEPTION 'You do not have Add permission for this department'; END IF;
    IF NOT public.can_create_customer() THEN
        RAISE EXCEPTION
            'Not authorized to create customers';
    END IF;

    IF NOT public.can_access_department_id(
        p_department_id
    ) THEN
        RAISE EXCEPTION
            'Not authorized for this department';
    END IF;

    IF p_customer_name IS NULL
       OR length(btrim(p_customer_name)) = 0
    THEN
        RAISE EXCEPTION
            'Customer name cannot be empty';
    END IF;

    IF EXISTS(SELECT 1 FROM public.customer_companies c WHERE c.name=p_customer_name AND NOT public.customer_id_scope(c.id)) THEN RAISE EXCEPTION 'Customer is outside your assigned scope'; END IF;
    INSERT INTO public.customer_companies (name)
    VALUES (p_customer_name)
    ON CONFLICT (name)
    DO NOTHING
    RETURNING id INTO v_customer_id;

    IF v_customer_id IS NULL THEN
        SELECT c.id
        INTO v_customer_id
        FROM public.customer_companies c
        WHERE c.name = p_customer_name;
    END IF;

    IF v_customer_id IS NULL THEN
        RAISE EXCEPTION
            'Unable to resolve customer';
    END IF;

    INSERT INTO public.department_customer_companies (
        department_id,
        customer_company_id
    )
    VALUES (
        p_department_id,
        v_customer_id
    )
    ON CONFLICT (
        department_id,
        customer_company_id
    )
    DO NOTHING;

    IF NOT public.is_finance_manager() THEN INSERT INTO public.user_customer_access(user_id,customer_company_id) VALUES(public.access_actor_id(),v_customer_id) ON CONFLICT DO NOTHING; END IF;
    IF public.my_access_profile() IS NOT NULL AND NOT public.is_finance_manager() THEN INSERT INTO public.user_customer_department_access(user_id,department_id,customer_company_id) VALUES(public.access_actor_id(),p_department_id,v_customer_id) ON CONFLICT DO NOTHING; END IF;
RETURN v_customer_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rename_customer_company(p_customer_company_id bigint, p_new_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_old text; v_new text := btrim(coalesce(p_new_name,''));
BEGIN
 IF NOT public.customer_operation(p_customer_company_id,'edit') THEN RAISE EXCEPTION 'You do not have Edit permission for all affected departments'; END IF;
 IF auth.uid() IS NULL OR NOT (public.can_module('customers','edit') AND public.customer_id_scope(p_customer_company_id)) OR coalesce(public.current_user_must_change_password(),true) THEN
   RAISE EXCEPTION 'Only an authorized Finance Manager can edit customers';
 END IF;
 IF length(v_new)<2 OR length(v_new)>250 THEN RAISE EXCEPTION 'Customer name must be between 2 and 250 characters'; END IF;
 SELECT name INTO v_old FROM public.customer_companies WHERE id=p_customer_company_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found'; END IF;
 IF v_old=v_new THEN RETURN true; END IF;
 IF public.customer_has_business_records(p_customer_company_id) THEN
   RAISE EXCEPTION 'Customer has projects or purchase orders; rename is blocked to protect historical records';
 END IF;
 IF EXISTS(SELECT 1 FROM public.customer_companies WHERE lower(btrim(name))=lower(v_new) AND id<>p_customer_company_id) THEN
   RAISE EXCEPTION 'A customer with this name already exists';
 END IF;
 UPDATE public.customer_companies SET name=v_new WHERE id=p_customer_company_id;
 RETURN true;
END $function$
;

CREATE OR REPLACE FUNCTION public.delete_customer_company_safe(p_customer_company_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_id bigint;
BEGIN
 IF NOT public.customer_operation(p_customer_company_id,'delete') THEN RAISE EXCEPTION 'You do not have Delete permission for all affected departments'; END IF;
 IF auth.uid() IS NULL OR NOT (public.can_module('customers','delete') AND public.customer_id_scope(p_customer_company_id)) OR coalesce(public.current_user_must_change_password(),true) THEN
   RAISE EXCEPTION 'Only an authorized Finance Manager can delete customers';
 END IF;
 SELECT id INTO v_id FROM public.customer_companies WHERE id=p_customer_company_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found'; END IF;
 IF public.customer_has_business_records(p_customer_company_id) THEN
   RAISE EXCEPTION 'Customer has projects or purchase orders and cannot be deleted';
 END IF;
 IF EXISTS(SELECT 1 FROM public.department_customer_companies WHERE customer_company_id=p_customer_company_id) THEN
   RAISE EXCEPTION 'Remove customer department links before deletion';
 END IF;
 DELETE FROM public.customer_companies WHERE id=p_customer_company_id;
 RETURN true;
END $function$
;

CREATE OR REPLACE FUNCTION public.rename_department(p_department_id bigint, p_new_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_old_name text;
BEGIN
 IF NOT public.department_operation((SELECT name FROM public.departments WHERE id=p_department_id),'edit') THEN RAISE EXCEPTION 'You do not have Edit permission for this department'; END IF;
 IF auth.uid() IS NULL OR NOT (public.can_module('departments','edit') AND public.can_access_department_id(p_department_id)) OR public.current_user_must_change_password() THEN
  RAISE EXCEPTION 'Finance Manager permission required';
 END IF;
 IF p_new_name IS NULL OR btrim(p_new_name) = '' THEN RAISE EXCEPTION 'Department name is required'; END IF;
 SELECT name INTO v_old_name FROM public.departments WHERE id = p_department_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Department not found'; END IF;
 IF v_old_name = p_new_name THEN RETURN true; END IF;
 -- Prevent stale legacy name-based references and unintended authorization changes.
 IF EXISTS (SELECT 1 FROM public.pos WHERE department = v_old_name OR department_id = p_department_id)
 OR EXISTS (SELECT 1 FROM public.projects WHERE department = v_old_name)
 THEN RAISE EXCEPTION 'Cannot rename: department is referenced by purchase orders, projects, or user access'; END IF;
 UPDATE public.departments SET name = p_new_name WHERE id = p_department_id;
 UPDATE public.user_department_access SET department=p_new_name WHERE lower(btrim(department))=lower(btrim(v_old_name));
 RETURN true;
END; $function$
;

CREATE OR REPLACE FUNCTION public.delete_department_safe(p_department_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_name text;
BEGIN
 IF NOT public.department_operation((SELECT name FROM public.departments WHERE id=p_department_id),'delete') THEN RAISE EXCEPTION 'You do not have Delete permission for this department'; END IF;
 IF auth.uid() IS NULL OR NOT (public.can_module('departments','delete') AND public.can_access_department_id(p_department_id)) OR public.current_user_must_change_password() THEN
  RAISE EXCEPTION 'Finance Manager permission required';
 END IF;
 SELECT name INTO v_name FROM public.departments WHERE id = p_department_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Department not found'; END IF;
 IF EXISTS (SELECT 1 FROM public.pos WHERE department = v_name OR department_id = p_department_id)
 OR EXISTS (SELECT 1 FROM public.projects WHERE department = v_name)
 OR EXISTS (SELECT 1 FROM public.department_customer_companies WHERE department_id = p_department_id)
 THEN RAISE EXCEPTION 'Cannot delete: department has purchase orders, projects, user access, or linked customers'; END IF;
 DELETE FROM public.user_department_access WHERE lower(btrim(department))=lower(btrim(v_name));
 DELETE FROM public.departments WHERE id = p_department_id;
 RETURN true;
END; $function$
;

CREATE OR REPLACE FUNCTION public.link_existing_customer_to_department(p_customer_company_id bigint, p_department_id bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_relation_id bigint;
BEGIN
 IF NOT public.department_operation((SELECT name FROM public.departments WHERE id=p_department_id),'edit') THEN RAISE EXCEPTION 'You do not have Edit permission for this department'; END IF;
    IF NOT (public.can_module('customers','edit') OR public.can_module('departments','edit'))
       OR NOT public.customer_id_scope(p_customer_company_id)
       OR auth.uid() IS NULL
       OR NOT public.can_access_department_id(
           p_department_id
       )
    THEN
        RAISE EXCEPTION
            'Not authorized for this department';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.customer_companies c
        WHERE c.id = p_customer_company_id
    ) THEN
        RAISE EXCEPTION 'Customer does not exist';
    END IF;

    INSERT INTO public.department_customer_companies (
        department_id,
        customer_company_id
    )
    VALUES (
        p_department_id,
        p_customer_company_id
    )
    ON CONFLICT (
        department_id,
        customer_company_id
    )
    DO NOTHING
    RETURNING id INTO v_relation_id;

    IF v_relation_id IS NULL THEN
        SELECT dc.id
        INTO v_relation_id
        FROM public.department_customer_companies dc
        WHERE dc.department_id = p_department_id
          AND dc.customer_company_id =
              p_customer_company_id;
    END IF;

    RETURN v_relation_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.unlink_customer_from_department(p_customer_company_id bigint, p_department_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_customer_name text;
    v_department_name text;
    v_deleted_count integer;
BEGIN
 IF NOT public.department_operation((SELECT name FROM public.departments WHERE id=p_department_id),'edit') THEN RAISE EXCEPTION 'You do not have Edit permission for this department'; END IF;
    -- Finance Manager only
    IF auth.uid() IS NULL
       OR NOT (public.can_module('customers','edit') OR public.can_module('departments','edit'))
       OR NOT public.customer_id_scope(p_customer_company_id)
       OR NOT public.can_access_department_id(p_department_id)
       OR public.current_user_must_change_password()
    THEN
        RAISE EXCEPTION
            'Only Finance Manager can unlink customers';
    END IF;

    -- Lock the relationship to prevent concurrent unlinking
    PERFORM 1
    FROM public.department_customer_companies dc
    WHERE dc.customer_company_id = p_customer_company_id
      AND dc.department_id = p_department_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN true;
    END IF;

    SELECT c.name
    INTO v_customer_name
    FROM public.customer_companies c
    WHERE c.id = p_customer_company_id;

    SELECT d.name
    INTO v_department_name
    FROM public.departments d
    WHERE d.id = p_department_id;

    IF v_customer_name IS NULL
       OR v_department_name IS NULL
    THEN
        RAISE EXCEPTION
            'Customer or department not found';
    END IF;

    -- Block unlinking when purchase orders exist
    IF EXISTS (
        SELECT 1
        FROM public.pos p
        WHERE p.company = v_customer_name
          AND p.department = v_department_name
    ) THEN
        RAISE EXCEPTION
            'Cannot unlink: related purchase orders exist';
    END IF;

    -- Block unlinking when invoices reference matching POs
    IF EXISTS (
        SELECT 1
        FROM public.invoices i
        JOIN public.pos p
          ON p.po_no = i.po_no
         AND p.project_id IS NOT DISTINCT FROM
             i.project_id
        WHERE p.company = v_customer_name
          AND p.department = v_department_name
    ) THEN
        RAISE EXCEPTION
            'Cannot unlink: related invoices exist';
    END IF;

    DELETE FROM public.department_customer_companies dc
    WHERE dc.customer_company_id = p_customer_company_id
      AND dc.department_id = p_department_id;

    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

    RETURN v_deleted_count = 1;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.create_scoped_project(p_project jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_id bigint;
BEGIN
 IF NOT public.department_operation(p_project->>'department','add') OR NOT public.customer_department_scope(p_project->>'company',p_project->>'department') THEN RAISE EXCEPTION 'Customer or department Add permission is not assigned'; END IF;
 IF NOT public.can_module('projects','add') THEN RAISE EXCEPTION 'You do not have Add permission for projects'; END IF;
 IF p_project IS NULL OR jsonb_typeof(p_project)<>'object' OR nullif(btrim(p_project->>'project_name'),'') IS NULL THEN RAISE EXCEPTION 'Project name is required'; END IF;
 IF NOT public.has_customer_access(p_project->>'company') OR NOT public.has_department_access(p_project->>'department') THEN RAISE EXCEPTION 'Customer or department is outside your assigned scope'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.customer_companies c JOIN public.department_customer_companies l ON l.customer_company_id=c.id JOIN public.departments d ON d.id=l.department_id WHERE c.name=p_project->>'company' AND d.name=p_project->>'department') THEN RAISE EXCEPTION 'Customer must be linked to the selected department'; END IF;
 INSERT INTO public.projects(project_name,company,department,project_manager,start_date,end_date,description,status)
 VALUES(btrim(p_project->>'project_name'),p_project->>'company',p_project->>'department',nullif(p_project->>'project_manager',''),nullif(p_project->>'start_date','')::date,nullif(p_project->>'end_date','')::date,nullif(p_project->>'description',''),coalesce(nullif(p_project->>'status',''),'Active')) RETURNING id INTO v_id;
 RETURN v_id;
END $function$
;

CREATE OR REPLACE FUNCTION public.create_department(p_name text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_user_id bigint;
    v_department_id bigint;
    v_is_manager boolean;
BEGIN
    IF NOT public.can_create_department() THEN
        RAISE EXCEPTION 'Not authorized to create departments';
    END IF;

    IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN
        RAISE EXCEPTION 'Department name cannot be empty';
    END IF;

    SELECT u.id
    INTO v_user_id
    FROM public.users_profile u
    WHERE u.auth_user_id = auth.uid()
      AND u.active IS TRUE
      AND u.must_change_password IS FALSE;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Active user profile not found';
    END IF;

    v_is_manager := public.is_finance_manager();

    INSERT INTO public.departments (name)
    VALUES (p_name)
    RETURNING id INTO v_department_id;

    IF NOT v_is_manager THEN
        INSERT INTO public.user_department_access (
            user_id,
            department
        )
        VALUES (
            v_user_id,
            p_name
        );
    END IF;

    IF public.my_access_profile() IS NOT NULL AND NOT public.is_finance_manager() THEN INSERT INTO public.user_department_permissions(user_id,department_id,can_add,can_edit,can_delete) VALUES(v_user_id,v_department_id,public.can_module('departments','add'),public.can_module('departments','edit'),public.can_module('departments','delete')) ON CONFLICT DO NOTHING; END IF;
RETURN v_department_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.can_access_invoice_attachment(p_invoice_id bigint, p_project_id bigint, p_permission text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT public.can_module('invoices',p_permission) AND EXISTS(SELECT 1 FROM public.invoices i WHERE i.id=p_invoice_id AND (p_project_id IS NULL OR i.project_id=p_project_id) AND public.invoice_scope(i.id) AND (p_permission='view' OR public.invoice_department_operation(i.pos_id,i.po_no,i.project_id,p_permission)))
$function$
;

CREATE FUNCTION public.apply_access_tree(p_user_id bigint,p_config jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE mode text:=p_config->>'mode'; kind text:=p_config->>'viewer_type'; rule jsonb; did bigint; cids bigint[]; pids bigint[];
 deps bigint[]:=ARRAY[]::bigint[]; custs bigint[]:=ARRAY[]::bigint[]; projs bigint[]:=ARRAY[]::bigint[]; orders bigint[]:=ARRAY[]::bigint[];
 add_flag boolean:=false; edit_flag boolean:=false; delete_flag boolean:=false; modules jsonb; pair_data jsonb:='[]';
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.users_profile WHERE id=p_user_id AND role='user') THEN RAISE EXCEPTION 'Only regular user accounts can use Viewer or Editor access'; END IF;
 IF jsonb_typeof(p_config) IS DISTINCT FROM 'object' OR mode IS NULL OR mode NOT IN('viewer','editor') THEN RAISE EXCEPTION 'Choose Viewer or Editor'; END IF;
 IF mode='editor' THEN
  IF jsonb_typeof(p_config->'departments') IS DISTINCT FROM 'array' OR jsonb_array_length(p_config->'departments')=0 THEN RAISE EXCEPTION 'Select at least one department'; END IF;
  FOR rule IN SELECT value FROM jsonb_array_elements(p_config->'departments') LOOP
   did:=(rule->>'department_id')::bigint;
   IF did=ANY(deps) OR NOT EXISTS(SELECT 1 FROM public.departments WHERE id=did) THEN RAISE EXCEPTION 'Invalid or duplicate department'; END IF;
   IF jsonb_typeof(rule->'add') IS DISTINCT FROM 'boolean' OR jsonb_typeof(rule->'edit') IS DISTINCT FROM 'boolean' OR jsonb_typeof(rule->'delete') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Department operations must be true or false'; END IF;
   IF jsonb_typeof(rule->'customer_ids') IS DISTINCT FROM 'array' OR jsonb_typeof(rule->'project_ids') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Customer and project selections are required'; END IF;
   SELECT coalesce(array_agg(DISTINCT value::bigint),ARRAY[]::bigint[]) INTO cids FROM jsonb_array_elements_text(rule->'customer_ids');
   SELECT coalesce(array_agg(DISTINCT value::bigint),ARRAY[]::bigint[]) INTO pids FROM jsonb_array_elements_text(rule->'project_ids');
   IF EXISTS(SELECT 1 FROM unnest(cids) x WHERE NOT EXISTS(SELECT 1 FROM public.department_customer_companies d WHERE d.department_id=did AND d.customer_company_id=x)) THEN RAISE EXCEPTION 'Selected customers must belong to their department'; END IF;
   IF EXISTS(SELECT 1 FROM unnest(pids) x WHERE NOT EXISTS(SELECT 1 FROM public.projects p JOIN public.departments d ON d.name=p.department JOIN public.customer_companies c ON c.name=p.company WHERE p.id=x AND d.id=did AND c.id=ANY(cids))) THEN RAISE EXCEPTION 'Select each project under its department and selected customer'; END IF;
   deps:=array_append(deps,did);custs:=custs||cids;projs:=projs||pids;
   add_flag:=add_flag OR (rule->>'add')::boolean;edit_flag:=edit_flag OR (rule->>'edit')::boolean;delete_flag:=delete_flag OR (rule->>'delete')::boolean;
   pair_data:=pair_data||coalesce((SELECT jsonb_agg(jsonb_build_object('department_id',did,'customer_id',x)) FROM unnest(cids) x),'[]');
  END LOOP;
 ELSE
  IF kind IS NULL OR kind NOT IN('customers','departments','projects','orders') OR jsonb_typeof(p_config->'selected_ids') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Choose a monitoring type and records'; END IF;
  SELECT coalesce(array_agg(DISTINCT value::bigint),ARRAY[]::bigint[]) INTO cids FROM jsonb_array_elements_text(p_config->'selected_ids');
  IF cardinality(cids)=0 THEN RAISE EXCEPTION 'Select at least one monitoring record'; END IF;
  IF kind='customers' THEN
   IF EXISTS(SELECT 1 FROM unnest(cids) x WHERE NOT EXISTS(SELECT 1 FROM public.customer_companies WHERE id=x)) THEN RAISE EXCEPTION 'Invalid customer selection'; END IF;
   custs:=cids;
   SELECT coalesce(array_agg(DISTINCT dc.department_id),ARRAY[]::bigint[]) INTO deps FROM public.department_customer_companies dc WHERE dc.customer_company_id=ANY(custs);
   SELECT coalesce(array_agg(p.id),ARRAY[]::bigint[]) INTO projs FROM public.projects p JOIN public.customer_companies c ON c.name=p.company WHERE c.id=ANY(custs);
  ELSIF kind='departments' THEN
   IF EXISTS(SELECT 1 FROM unnest(cids) x WHERE NOT EXISTS(SELECT 1 FROM public.departments WHERE id=x)) THEN RAISE EXCEPTION 'Invalid department selection'; END IF;
   deps:=cids;
   SELECT coalesce(array_agg(DISTINCT dc.customer_company_id),ARRAY[]::bigint[]) INTO custs FROM public.department_customer_companies dc WHERE dc.department_id=ANY(deps);
   SELECT coalesce(array_agg(p.id),ARRAY[]::bigint[]) INTO projs FROM public.projects p JOIN public.departments d ON d.name=p.department WHERE d.id=ANY(deps);
  ELSIF kind='projects' THEN
   IF EXISTS(SELECT 1 FROM unnest(cids) x WHERE NOT EXISTS(SELECT 1 FROM public.projects WHERE id=x)) THEN RAISE EXCEPTION 'Invalid project selection'; END IF;
   projs:=cids;
   SELECT coalesce(array_agg(DISTINCT c.id),ARRAY[]::bigint[]),coalesce(array_agg(DISTINCT d.id),ARRAY[]::bigint[]) INTO custs,deps FROM public.projects p JOIN public.customer_companies c ON c.name=p.company JOIN public.departments d ON d.name=p.department WHERE p.id=ANY(projs);
  ELSE
   IF EXISTS(SELECT 1 FROM unnest(cids) x WHERE NOT EXISTS(SELECT 1 FROM public.pos p JOIN public.projects pr ON pr.id=p.project_id WHERE p.id=x AND p.customer_company_id IS NOT NULL AND p.department_id IS NOT NULL AND p.company=pr.company AND p.department=pr.department)) THEN RAISE EXCEPTION 'Each selected purchase order must have a valid matching project, customer and department'; END IF;
   orders:=cids;
   SELECT coalesce(array_agg(DISTINCT project_id),ARRAY[]::bigint[]),coalesce(array_agg(DISTINCT customer_company_id),ARRAY[]::bigint[]),coalesce(array_agg(DISTINCT department_id),ARRAY[]::bigint[]) INTO projs,custs,deps FROM public.pos WHERE id=ANY(orders);
  END IF;
  IF kind IN('projects','orders') THEN
   SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object('department_id',d.id,'customer_id',c.id)),'[]') INTO pair_data FROM public.projects p JOIN public.departments d ON d.name=p.department JOIN public.customer_companies c ON c.name=p.company JOIN public.department_customer_companies dc ON dc.department_id=d.id AND dc.customer_company_id=c.id WHERE p.id=ANY(projs);
  ELSE
   SELECT coalesce(jsonb_agg(jsonb_build_object('department_id',dc.department_id,'customer_id',dc.customer_company_id)),'[]') INTO pair_data FROM public.department_customer_companies dc WHERE dc.department_id=ANY(deps) AND dc.customer_company_id=ANY(custs);
  END IF;
 END IF;
 DELETE FROM public.user_order_access WHERE user_id=p_user_id;
 DELETE FROM public.user_customer_department_access WHERE user_id=p_user_id;
 DELETE FROM public.user_department_permissions WHERE user_id=p_user_id;
 DELETE FROM public.user_project_access WHERE user_id=p_user_id;
 DELETE FROM public.user_customer_access WHERE user_id=p_user_id;
 DELETE FROM public.user_department_access WHERE user_id=p_user_id;
 INSERT INTO public.user_department_access(user_id,department) SELECT p_user_id,name FROM public.departments WHERE id=ANY(deps);
 INSERT INTO public.user_customer_access(user_id,customer_company_id) SELECT p_user_id,id FROM public.customer_companies WHERE id=ANY(custs);
 INSERT INTO public.user_project_access(user_id,project_id) SELECT p_user_id,id FROM public.projects WHERE id=ANY(projs);
 INSERT INTO public.user_order_access(user_id,order_id) SELECT p_user_id,id FROM public.pos WHERE id=ANY(orders);
 INSERT INTO public.user_customer_department_access(user_id,department_id,customer_company_id) SELECT DISTINCT p_user_id,(x->>'department_id')::bigint,(x->>'customer_id')::bigint FROM jsonb_array_elements(pair_data) x;
 IF mode='editor' THEN
  INSERT INTO public.user_department_permissions(user_id,department_id,can_add,can_edit,can_delete) SELECT p_user_id,(x->>'department_id')::bigint,(x->>'add')::boolean,(x->>'edit')::boolean,(x->>'delete')::boolean FROM jsonb_array_elements(p_config->'departments') x;
 ELSE
  INSERT INTO public.user_department_permissions(user_id,department_id) SELECT p_user_id,id FROM public.departments WHERE id=ANY(deps);
 END IF;
 SELECT jsonb_object_agg(m,jsonb_build_object('view',true,'add',add_flag,'edit',edit_flag,'delete',delete_flag)) INTO modules FROM unnest(ARRAY['customers','departments','projects','orders','invoices','collections']) m;
 UPDATE public.user_permissions SET module_permissions=modules,can_view=true,can_add=add_flag,can_edit=edit_flag,can_delete=delete_flag,can_create_customers=add_flag,can_edit_customers=edit_flag,can_delete_customers=delete_flag,can_create_departments=add_flag,can_edit_departments=edit_flag,can_delete_departments=delete_flag,access_profile=jsonb_build_object('model','department_tree','mode',mode,'viewer_type',CASE WHEN mode='viewer' THEN kind ELSE NULL END,'version',1),updated_at=now() WHERE user_id=p_user_id;
 UPDATE public.users_profile SET all_projects=false,all_departments=false WHERE id=p_user_id;
END $$;
REVOKE ALL ON FUNCTION public.apply_access_tree(bigint,jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.save_user_access(p_user_id bigint, p_active boolean, p_permissions jsonb, p_department_access text[], p_project_access bigint[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_role text;
  v_auth_user_id uuid;
BEGIN
  IF NOT public.is_finance_manager() THEN
    RAISE EXCEPTION 'Only Finance Manager can manage user access';
  END IF;
  IF public.current_user_must_change_password() THEN
    RAISE EXCEPTION 'Change the initial password before managing users';
  END IF;
  IF p_user_id IS NULL OR p_active IS NULL THEN
    RAISE EXCEPTION 'User ID and active status are required';
  END IF;
  IF p_permissions IS NULL OR jsonb_typeof(p_permissions) <> 'object' THEN
    RAISE EXCEPTION 'Permissions object is required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_each(p_permissions) AS e(key, value)
    WHERE e.key IN ('can_view', 'can_add', 'can_edit', 'can_delete')
      AND jsonb_typeof(e.value) <> 'boolean'
  ) THEN
    RAISE EXCEPTION 'Permission values must be boolean';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(COALESCE(p_department_access, ARRAY[]::text[])) AS d(department)
    WHERE NULLIF(BTRIM(d.department), '') IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.departments dep WHERE BTRIM(dep.name) = BTRIM(d.department))
  ) THEN
    RAISE EXCEPTION 'One or more departments are invalid';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(COALESCE(p_project_access, ARRAY[]::bigint[])) AS p(project_id)
    WHERE NOT EXISTS (SELECT 1 FROM public.projects pr WHERE pr.id = p.project_id)
  ) THEN
    RAISE EXCEPTION 'One or more projects are invalid';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('system_admin_scope_changes',0));
  IF EXISTS(SELECT 1 FROM public.user_permissions WHERE user_id=p_user_id AND access_profile IS NOT NULL) AND NOT (p_permissions ? 'access_tree') THEN RAISE EXCEPTION 'Use System Administration to edit this user access profile'; END IF;
  SELECT up.role, up.auth_user_id INTO v_role, v_auth_user_id
  FROM public.users_profile up
  WHERE up.id = p_user_id
  FOR UPDATE;

  IF v_role IS DISTINCT FROM 'user' OR v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Only linked regular user accounts can be modified here';
  END IF;

  UPDATE public.users_profile
  SET active = p_active,
      all_projects = false,
      all_departments = false
  WHERE id = p_user_id;

  INSERT INTO public.user_permissions (user_id, can_view, can_add, can_edit, can_delete)
  VALUES (
    p_user_id,
    COALESCE((p_permissions ->> 'can_view')::boolean, false),
    COALESCE((p_permissions ->> 'can_add')::boolean, false),
    COALESCE((p_permissions ->> 'can_edit')::boolean, false),
    COALESCE((p_permissions ->> 'can_delete')::boolean, false)
  )
  ON CONFLICT (user_id) DO UPDATE SET
    can_view = EXCLUDED.can_view,
    can_add = EXCLUDED.can_add,
    can_edit = EXCLUDED.can_edit,
    can_delete = EXCLUDED.can_delete,
    updated_at = now();

  DELETE FROM public.user_project_access WHERE user_id = p_user_id;
  DELETE FROM public.user_department_access WHERE user_id = p_user_id;

  INSERT INTO public.user_department_access (user_id, department)
  SELECT p_user_id, BTRIM(d.department)
  FROM unnest(COALESCE(p_department_access, ARRAY[]::text[])) AS d(department)
  WHERE NULLIF(BTRIM(d.department), '') IS NOT NULL
  GROUP BY BTRIM(d.department);

  INSERT INTO public.user_project_access (user_id, project_id)
  SELECT p_user_id, p.project_id
  FROM unnest(COALESCE(p_project_access, ARRAY[]::bigint[])) AS p(project_id)
  GROUP BY p.project_id;

 UPDATE public.user_permissions SET module_permissions=public.normalize_module_permissions(p_permissions),
 can_create_customers=(public.normalize_module_permissions(p_permissions)->'customers'->>'add')::boolean,
 can_edit_customers=(public.normalize_module_permissions(p_permissions)->'customers'->>'edit')::boolean,
 can_delete_customers=(public.normalize_module_permissions(p_permissions)->'customers'->>'delete')::boolean,
 can_create_departments=(public.normalize_module_permissions(p_permissions)->'departments'->>'add')::boolean,
 can_edit_departments=(public.normalize_module_permissions(p_permissions)->'departments'->>'edit')::boolean,
 can_delete_departments=(public.normalize_module_permissions(p_permissions)->'departments'->>'delete')::boolean WHERE user_id=p_user_id;
 DELETE FROM public.user_customer_access WHERE user_id=p_user_id;
 IF p_permissions ? 'customer_ids' THEN
  IF jsonb_typeof(p_permissions->'customer_ids')<>'array' THEN RAISE EXCEPTION 'Customer selection must be an array'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_permissions->'customer_ids') x WHERE x !~ '^[0-9]+$' OR NOT EXISTS(SELECT 1 FROM public.customer_companies c WHERE c.id=x::bigint)) THEN RAISE EXCEPTION 'Invalid customer selection'; END IF;
  INSERT INTO public.user_customer_access(user_id,customer_company_id) SELECT DISTINCT p_user_id,x::bigint FROM jsonb_array_elements_text(p_permissions->'customer_ids') x;
 ELSE
  INSERT INTO public.user_customer_access(user_id,customer_company_id)
  SELECT DISTINCT p_user_id,c.id FROM public.customer_companies c JOIN public.department_customer_companies l ON l.customer_company_id=c.id JOIN public.departments d ON d.id=l.department_id
  WHERE d.name=ANY(coalesce(p_department_access,ARRAY[]::text[])) ON CONFLICT DO NOTHING;
 END IF;

IF p_permissions ? 'access_tree' THEN PERFORM public.apply_access_tree(p_user_id,p_permissions->'access_tree'); END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.create_user_profile_with_access(p_username text, p_full_name text, p_auth_user_id uuid, p_permissions jsonb, p_department_access text[], p_project_access bigint[])
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user_id bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('system_admin_scope_changes',0));
  IF NULLIF(BTRIM(p_username), '') IS NULL THEN
    RAISE EXCEPTION 'Username is required';
  END IF;
  IF NULLIF(BTRIM(p_full_name), '') IS NULL THEN
    RAISE EXCEPTION 'Full name is required';
  END IF;
  IF p_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication user ID is required';
  END IF;
  IF p_permissions IS NULL OR jsonb_typeof(p_permissions) <> 'object' THEN
    RAISE EXCEPTION 'Permissions object is required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_each(p_permissions) AS e(key, value)
    WHERE e.key IN ('can_view', 'can_add', 'can_edit', 'can_delete')
      AND jsonb_typeof(e.value) <> 'boolean'
  ) THEN
    RAISE EXCEPTION 'Permission values must be boolean';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(COALESCE(p_department_access, ARRAY[]::text[])) AS d(department)
    WHERE NULLIF(BTRIM(d.department), '') IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM public.departments dep WHERE BTRIM(dep.name) = BTRIM(d.department)
       )
  ) THEN
    RAISE EXCEPTION 'One or more departments are invalid';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(COALESCE(p_project_access, ARRAY[]::bigint[])) AS p(project_id)
    WHERE NOT EXISTS (SELECT 1 FROM public.projects pr WHERE pr.id = p.project_id)
  ) THEN
    RAISE EXCEPTION 'One or more projects are invalid';
  END IF;

  INSERT INTO public.users_profile (
    username, full_name, role, active, auth_user_id,
    all_projects, all_departments, must_change_password
  ) VALUES (
    BTRIM(p_username), BTRIM(p_full_name), 'user', true, p_auth_user_id,
    false, false, true
  ) RETURNING id INTO v_user_id;

  INSERT INTO public.user_permissions (
    user_id, can_view, can_add, can_edit, can_delete
  ) VALUES (
    v_user_id,
    COALESCE((p_permissions ->> 'can_view')::boolean, false),
    COALESCE((p_permissions ->> 'can_add')::boolean, false),
    COALESCE((p_permissions ->> 'can_edit')::boolean, false),
    COALESCE((p_permissions ->> 'can_delete')::boolean, false)
  );

  INSERT INTO public.user_department_access (user_id, department)
  SELECT v_user_id, BTRIM(d.department)
  FROM unnest(COALESCE(p_department_access, ARRAY[]::text[])) AS d(department)
  WHERE NULLIF(BTRIM(d.department), '') IS NOT NULL
  GROUP BY BTRIM(d.department);

  INSERT INTO public.user_project_access (user_id, project_id)
  SELECT v_user_id, p.project_id
  FROM unnest(COALESCE(p_project_access, ARRAY[]::bigint[])) AS p(project_id)
  GROUP BY p.project_id;

  
 UPDATE public.user_permissions SET module_permissions=public.normalize_module_permissions(p_permissions),
 can_create_customers=(public.normalize_module_permissions(p_permissions)->'customers'->>'add')::boolean,
 can_edit_customers=(public.normalize_module_permissions(p_permissions)->'customers'->>'edit')::boolean,
 can_delete_customers=(public.normalize_module_permissions(p_permissions)->'customers'->>'delete')::boolean,
 can_create_departments=(public.normalize_module_permissions(p_permissions)->'departments'->>'add')::boolean,
 can_edit_departments=(public.normalize_module_permissions(p_permissions)->'departments'->>'edit')::boolean,
 can_delete_departments=(public.normalize_module_permissions(p_permissions)->'departments'->>'delete')::boolean WHERE user_id=v_user_id;
 DELETE FROM public.user_customer_access WHERE user_id=v_user_id;
 IF p_permissions ? 'customer_ids' THEN
  IF jsonb_typeof(p_permissions->'customer_ids')<>'array' THEN RAISE EXCEPTION 'Customer selection must be an array'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_permissions->'customer_ids') x WHERE x !~ '^[0-9]+$' OR NOT EXISTS(SELECT 1 FROM public.customer_companies c WHERE c.id=x::bigint)) THEN RAISE EXCEPTION 'Invalid customer selection'; END IF;
  INSERT INTO public.user_customer_access(user_id,customer_company_id) SELECT DISTINCT v_user_id,x::bigint FROM jsonb_array_elements_text(p_permissions->'customer_ids') x;
 ELSE
  INSERT INTO public.user_customer_access(user_id,customer_company_id)
  SELECT DISTINCT v_user_id,c.id FROM public.customer_companies c JOIN public.department_customer_companies l ON l.customer_company_id=c.id JOIN public.departments d ON d.id=l.department_id
  WHERE d.name=ANY(coalesce(p_department_access,ARRAY[]::text[])) ON CONFLICT DO NOTHING;
 END IF;

IF p_permissions ? 'access_tree' THEN PERFORM public.apply_access_tree(v_user_id,p_permissions->'access_tree'); END IF;
 RETURN v_user_id;
END;
$function$
;

REVOKE ALL ON FUNCTION public.department_operation(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.department_operation(text,text) TO authenticated,service_role;

REVOKE ALL ON FUNCTION public.customer_department_scope(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.customer_department_scope(text,text) TO authenticated,service_role;

REVOKE ALL ON FUNCTION public.customer_operation(bigint,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.customer_operation(bigint,text) TO authenticated,service_role;

REVOKE ALL ON FUNCTION public.invoice_department_operation(bigint,text,bigint,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.invoice_department_operation(bigint,text,bigint,text) TO authenticated,service_role;

REVOKE ALL ON FUNCTION public.collection_operation(bigint,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.collection_operation(bigint,text) TO authenticated,service_role;

REVOKE ALL ON FUNCTION public.my_access_profile() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.my_access_profile() TO authenticated,service_role;

CREATE FUNCTION public.invoice_number_operation(p_number text,p_action text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.invoice_number_scope(p_number) AND NOT EXISTS(SELECT 1 FROM public.invoices i WHERE i.invoice_no=p_number AND NOT public.invoice_department_operation(i.pos_id,i.po_no,i.project_id,p_action))
$$;
REVOKE ALL ON FUNCTION public.invoice_number_operation(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.invoice_number_operation(text,text) TO authenticated;
CREATE POLICY tree_add ON public.invoice_followups AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(public.invoice_number_operation(invoice_no,'add'));
CREATE POLICY tree_edit ON public.invoice_followups AS RESTRICTIVE FOR UPDATE TO authenticated USING(public.invoice_number_operation(invoice_no,'edit')) WITH CHECK(public.invoice_number_operation(invoice_no,'edit'));
CREATE POLICY tree_delete ON public.invoice_followups AS RESTRICTIVE FOR DELETE TO authenticated USING(public.invoice_number_operation(invoice_no,'delete'));
CREATE POLICY tree_add ON public.collection_tasks AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(public.invoice_number_operation(invoice_no,'add'));
CREATE POLICY tree_edit ON public.collection_tasks AS RESTRICTIVE FOR UPDATE TO authenticated USING(public.invoice_number_operation(invoice_no,'edit')) WITH CHECK(public.invoice_number_operation(invoice_no,'edit'));
CREATE POLICY tree_delete ON public.collection_tasks AS RESTRICTIVE FOR DELETE TO authenticated USING(public.invoice_number_operation(invoice_no,'delete'));


CREATE TABLE public.data_merge_audit(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 actor_id uuid,created_at timestamptz NOT NULL DEFAULT now(),
 entity_kind text NOT NULL CHECK(entity_kind IN('customers','projects','departments')),
 source_id bigint NOT NULL,target_id bigint NOT NULL,source_name text NOT NULL,target_name text NOT NULL,
 snapshot jsonb NOT NULL,result jsonb NOT NULL
);
ALTER TABLE public.data_merge_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY merge_audit_admin ON public.data_merge_audit FOR SELECT TO authenticated USING(public.is_finance_manager());
GRANT SELECT ON public.data_merge_audit TO authenticated;

CREATE FUNCTION public.merge_business_entity(p_kind text,p_source_id bigint,p_target_id bigint,p_preview boolean DEFAULT true,p_expected_token text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE src jsonb; dst jsonb; source_name text; target_name text; project_ids bigint[]; order_ids bigint[]; invoice_ids bigint[];
 before_data jsonb; financial_before jsonb; financial_after jsonb; conflicts jsonb:='[]'; warnings jsonb:='[]'; result jsonb; token text;
 po_record record; parking_id bigint; parking_no text; parking jsonb:='[]'; item jsonb; audit_id bigint; target_customer text; target_department text;
 v record; selected bigint[]; config jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_finance_manager() THEN RAISE EXCEPTION 'Only the Finance Manager / System Administrator can merge data'; END IF;
 IF p_preview IS NULL THEN RAISE EXCEPTION 'Preview flag is required'; END IF;
 IF p_kind IS NULL OR p_kind NOT IN('customers','projects','departments') OR p_source_id IS NULL OR p_target_id IS NULL OR p_source_id=p_target_id THEN RAISE EXCEPTION 'Choose different valid source and destination records'; END IF;
 IF NOT p_preview THEN
  PERFORM set_config('lock_timeout','3s',true);
  PERFORM pg_advisory_xact_lock(hashtextextended('system_admin_scope_changes',0));
  -- Collection writes precede invoice writes in their synchronization trigger.
  LOCK TABLE public.invoice_collections,public.invoices,public.pos,public.projects,public.customer_companies,public.departments,public.department_customer_companies,
   public.user_project_access,public.user_customer_access,public.user_department_access,public.user_department_permissions,public.user_customer_department_access,public.user_order_access IN SHARE ROW EXCLUSIVE MODE;
 END IF;
 IF p_kind='customers' THEN
  SELECT to_jsonb(c) INTO src FROM public.customer_companies c WHERE id=p_source_id;
  SELECT to_jsonb(c) INTO dst FROM public.customer_companies c WHERE id=p_target_id;
 ELSIF p_kind='departments' THEN
  SELECT to_jsonb(d) INTO src FROM public.departments d WHERE id=p_source_id;
  SELECT to_jsonb(d) INTO dst FROM public.departments d WHERE id=p_target_id;
 ELSE
  SELECT to_jsonb(p) INTO src FROM public.projects p WHERE id=p_source_id;
  SELECT to_jsonb(p) INTO dst FROM public.projects p WHERE id=p_target_id;
 END IF;
 IF src IS NULL OR dst IS NULL THEN RAISE EXCEPTION 'Source or destination no longer exists'; END IF;
 source_name:=coalesce(src->>'name',src->>'project_name');target_name:=coalesce(dst->>'name',dst->>'project_name');
 SELECT coalesce(array_agg(pr.id ORDER BY pr.id),ARRAY[]::bigint[]) INTO project_ids FROM public.projects pr
 WHERE CASE p_kind WHEN 'customers' THEN pr.company=source_name WHEN 'departments' THEN pr.department=source_name ELSE pr.id=p_source_id END;
 SELECT coalesce(array_agg(po.id ORDER BY po.id),ARRAY[]::bigint[]) INTO order_ids FROM public.pos po WHERE po.project_id=ANY(project_ids) OR
 CASE p_kind WHEN 'customers' THEN po.customer_company_id=p_source_id OR po.company=source_name WHEN 'departments' THEN po.department_id=p_source_id OR po.department=source_name ELSE false END;
 SELECT coalesce(array_agg(i.id ORDER BY i.id),ARRAY[]::bigint[]) INTO invoice_ids FROM public.invoices i WHERE i.pos_id=ANY(order_ids) OR i.project_id=ANY(project_ids);
 IF EXISTS(SELECT 1 FROM public.invoices i WHERE i.id=ANY(invoice_ids) AND (i.pos_id IS NULL OR NOT i.pos_id=ANY(order_ids))) THEN conflicts:=conflicts||jsonb_build_array('Some invoices have missing or inconsistent purchase-order links. Correct them before merging.'); END IF;
 IF EXISTS(SELECT 1 FROM public.invoices i JOIN public.pos po ON po.id=i.pos_id WHERE i.id=ANY(invoice_ids) AND i.project_id IS DISTINCT FROM po.project_id) THEN conflicts:=conflicts||jsonb_build_array('Some invoices and their purchase orders refer to different projects.'); END IF;
 IF EXISTS(SELECT 1 FROM public.pos po WHERE po.id=ANY(order_ids) AND NOT EXISTS(SELECT 1 FROM public.customer_companies c JOIN public.department_customer_companies dc ON dc.customer_company_id=c.id JOIN public.departments d ON d.id=dc.department_id WHERE c.name=po.company AND d.name=po.department)) THEN conflicts:=conflicts||jsonb_build_array('Some purchase orders have unregistered customer/department relationships.'); END IF;
 IF p_kind='customers' AND EXISTS(SELECT 1 FROM public.pos po JOIN public.projects pr ON pr.id=po.project_id WHERE po.id=ANY(order_ids) AND pr.company NOT IN(source_name,target_name)) THEN conflicts:=conflicts||jsonb_build_array('Some purchase orders belong to projects owned by another customer.'); END IF;
 IF p_kind='departments' AND EXISTS(SELECT 1 FROM public.pos po JOIN public.projects pr ON pr.id=po.project_id WHERE po.id=ANY(order_ids) AND pr.department NOT IN(source_name,target_name)) THEN conflicts:=conflicts||jsonb_build_array('Some purchase orders belong to projects in another department.'); END IF;
 IF p_kind='projects' THEN
  target_customer:=dst->>'company';target_department:=dst->>'department';
  IF NOT EXISTS(SELECT 1 FROM public.customer_companies c JOIN public.department_customer_companies dc ON dc.customer_company_id=c.id JOIN public.departments d ON d.id=dc.department_id WHERE c.name=target_customer AND d.name=target_department) THEN conflicts:=conflicts||jsonb_build_array('The destination project must have a registered customer and linked department.'); END IF;
  IF src->>'company' IS DISTINCT FROM target_customer OR src->>'department' IS DISTINCT FROM target_department THEN warnings:=warnings||jsonb_build_array('Purchase orders will use the destination project customer and department. Review Editor access after a cross-department move.'); END IF;
 END IF;
 before_data:=jsonb_build_object('source',src,'destination',dst,
 'projects',coalesce((SELECT jsonb_agg(to_jsonb(pr) ORDER BY pr.id) FROM public.projects pr WHERE id=ANY(project_ids)),'[]'),
 'orders',coalesce((SELECT jsonb_agg(to_jsonb(po) ORDER BY po.id) FROM public.pos po WHERE id=ANY(order_ids)),'[]'),
 'invoices',coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.invoices i WHERE id=ANY(invoice_ids)),'[]'),
 'collections',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.invoice_collections c WHERE invoice_id=ANY(invoice_ids)),'[]'),
 'customer_links',coalesce((SELECT jsonb_agg(to_jsonb(dc) ORDER BY dc.id) FROM public.department_customer_companies dc WHERE (p_kind='customers' AND dc.customer_company_id IN(p_source_id,p_target_id)) OR (p_kind='departments' AND dc.department_id IN(p_source_id,p_target_id))),'[]'),
 'customer_access',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.user_id,a.customer_company_id) FROM public.user_customer_access a),'[]'),
 'department_access',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.user_department_access a),'[]'),
 'project_access',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.user_project_access a),'[]'),
 'department_permissions',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.user_id,a.department_id) FROM public.user_department_permissions a),'[]'),
 'customer_department_access',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.user_id,a.department_id,a.customer_company_id) FROM public.user_customer_department_access a),'[]'));
 token:=md5(before_data::text);
 warnings:=warnings||jsonb_build_array('The source record will be removed after its linked records are transferred. Financial values and invoice/payment identifiers remain unchanged.');
 IF p_kind='departments' THEN warnings:=warnings||jsonb_build_array('Existing destination department permissions take precedence; transferred permissions do not raise them automatically.'); END IF;
 result:=jsonb_build_object('kind',p_kind,'source',source_name,'destination',target_name,'source_id',p_source_id,'target_id',p_target_id,
 'counts',jsonb_build_object('projects',cardinality(project_ids),'orders',cardinality(order_ids),'invoices',cardinality(invoice_ids),'collections',(SELECT count(*) FROM public.invoice_collections WHERE invoice_id=ANY(invoice_ids))),
 'warnings',warnings,'conflicts',conflicts,'can_merge',jsonb_array_length(conflicts)=0,'token',token);
 IF p_preview THEN RETURN result; END IF;
 IF p_expected_token IS NULL OR p_expected_token<>token THEN RAISE EXCEPTION 'Records changed since the preview. Preview the merge again before confirming'; END IF;
 IF jsonb_array_length(conflicts)>0 THEN RAISE EXCEPTION 'Merge blocked: %',conflicts::text; END IF;
 SELECT jsonb_build_object('invoice_count',count(*),'invoice_amount',coalesce(sum(invoice_amount),0),'paid',coalesce(sum(paid_amount),0),'retention',coalesce(sum(retention_amount),0),'retention_vat',coalesce(sum(retention_vat),0),'retention_released',coalesce(sum(retention_released_amount),0),'advance_amortisation',coalesce(sum(advance_amortisation),0)) INTO financial_before FROM public.invoices;
 financial_before:=financial_before||jsonb_build_object('order_count',(SELECT count(*) FROM public.pos),'order_value',(SELECT coalesce(sum(po_value_ex_vat),0) FROM public.pos),'collection_count',(SELECT count(*) FROM public.invoice_collections),'collection_amount',(SELECT coalesce(sum(amount),0) FROM public.invoice_collections));

 -- Stage invoice links through temporary PO rows; normal protection/synchronization triggers stay enabled.
 FOR po_record IN SELECT * FROM public.pos WHERE id=ANY(order_ids) ORDER BY id LOOP
  IF EXISTS(SELECT 1 FROM public.invoices WHERE pos_id=po_record.id) THEN
   parking_no:='__MERGE_'||gen_random_uuid()||'_'||po_record.id;
   INSERT INTO public.pos(company,project_name,po_no,vat,po_value_ex_vat,po_date,expiry_date,notes,archive,department,project_id,retention_applicable,retention_percentage,retention_period_days,status,advance_payment_percentage,advance_received_amount,retention_basis)
   VALUES(po_record.company,po_record.project_name,parking_no,po_record.vat,po_record.po_value_ex_vat,po_record.po_date,po_record.expiry_date,po_record.notes,po_record.archive,po_record.department,po_record.project_id,po_record.retention_applicable,po_record.retention_percentage,po_record.retention_period_days,po_record.status,po_record.advance_payment_percentage,po_record.advance_received_amount,po_record.retention_basis) RETURNING id INTO parking_id;
   UPDATE public.invoices SET po_no=parking_no,pos_id=parking_id WHERE pos_id=po_record.id;
   parking:=parking||jsonb_build_array(jsonb_build_object('original_id',po_record.id,'temporary_id',parking_id,'po_no',po_record.po_no));
  END IF;
 END LOOP;

 IF p_kind='customers' THEN
  INSERT INTO public.department_customer_companies(department_id,customer_company_id)
  SELECT DISTINCT d.id,p_target_id FROM public.departments d WHERE d.id IN(SELECT department_id FROM public.department_customer_companies WHERE customer_company_id=p_source_id)
   OR d.name IN(SELECT department FROM public.pos WHERE id=ANY(order_ids))
   OR d.name IN(SELECT department FROM public.projects WHERE id=ANY(project_ids))
  ON CONFLICT DO NOTHING;
  UPDATE public.projects SET company=target_name WHERE id=ANY(project_ids);
  UPDATE public.pos SET company=target_name,customer_company_id=p_target_id WHERE id=ANY(order_ids);
  INSERT INTO public.user_customer_access(user_id,customer_company_id) SELECT user_id,p_target_id FROM public.user_customer_access WHERE customer_company_id=p_source_id ON CONFLICT DO NOTHING;
  INSERT INTO public.user_customer_department_access(user_id,department_id,customer_company_id) SELECT user_id,department_id,p_target_id FROM public.user_customer_department_access WHERE customer_company_id=p_source_id ON CONFLICT DO NOTHING;
  DELETE FROM public.user_customer_department_access WHERE customer_company_id=p_source_id;
  DELETE FROM public.user_customer_access WHERE customer_company_id=p_source_id;
 ELSIF p_kind='departments' THEN
  INSERT INTO public.department_customer_companies(department_id,customer_company_id)
  SELECT p_target_id,c.id FROM public.customer_companies c WHERE c.id IN(SELECT customer_company_id FROM public.department_customer_companies WHERE department_id=p_source_id)
  OR c.name IN(SELECT company FROM public.pos WHERE id=ANY(order_ids))
  OR c.name IN(SELECT company FROM public.projects WHERE id=ANY(project_ids)) ON CONFLICT DO NOTHING;
  UPDATE public.projects SET department=target_name WHERE id=ANY(project_ids);
  UPDATE public.pos SET department=target_name,department_id=p_target_id WHERE id=ANY(order_ids);
  INSERT INTO public.user_department_access(user_id,department) SELECT user_id,target_name FROM public.user_department_access WHERE lower(btrim(department))=lower(btrim(source_name)) ON CONFLICT DO NOTHING;
  DELETE FROM public.user_department_access WHERE lower(btrim(department))=lower(btrim(source_name)) AND department<>target_name;
  INSERT INTO public.user_department_permissions(user_id,department_id,can_add,can_edit,can_delete) SELECT user_id,p_target_id,can_add,can_edit,can_delete FROM public.user_department_permissions WHERE department_id=p_source_id ON CONFLICT DO NOTHING;
  INSERT INTO public.user_customer_department_access(user_id,department_id,customer_company_id) SELECT user_id,p_target_id,customer_company_id FROM public.user_customer_department_access WHERE department_id=p_source_id ON CONFLICT DO NOTHING;
  DELETE FROM public.user_customer_department_access WHERE department_id=p_source_id;
  DELETE FROM public.user_department_permissions WHERE department_id=p_source_id;
 ELSE
  UPDATE public.pos SET project_id=p_target_id,project_name=target_name,company=target_customer,department=target_department WHERE id=ANY(order_ids);
  INSERT INTO public.user_project_access(user_id,project_id) SELECT user_id,p_target_id FROM public.user_project_access WHERE project_id=p_source_id ON CONFLICT DO NOTHING;
  DELETE FROM public.user_project_access WHERE project_id=p_source_id;
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(parking) LOOP
  UPDATE public.invoices i SET po_no=item->>'po_no',pos_id=(item->>'original_id')::bigint,
   project_id=(SELECT project_id FROM public.pos WHERE id=(item->>'original_id')::bigint),
   project_name=CASE WHEN p_kind='projects' THEN target_name ELSE i.project_name END
  WHERE i.pos_id=(item->>'temporary_id')::bigint;
  DELETE FROM public.pos WHERE id=(item->>'temporary_id')::bigint;
 END LOOP;
 IF p_kind='customers' THEN
  DELETE FROM public.department_customer_companies WHERE customer_company_id=p_source_id;
  DELETE FROM public.customer_companies WHERE id=p_source_id;
 ELSIF p_kind='departments' THEN
  DELETE FROM public.department_customer_companies WHERE department_id=p_source_id;
  DELETE FROM public.departments WHERE id=p_source_id;
 ELSE
  UPDATE public.record_attachments SET record_id=p_target_id WHERE record_type='project' AND record_id=p_source_id;
  DELETE FROM public.projects WHERE id=p_source_id;
 END IF;

 -- Viewer scopes are derived again from the surviving selected entities.
 FOR v IN SELECT user_id,access_profile FROM public.user_permissions WHERE access_profile->>'mode'='viewer' LOOP
  IF v.access_profile->>'viewer_type'='customers' THEN SELECT coalesce(array_agg(customer_company_id),ARRAY[]::bigint[]) INTO selected FROM public.user_customer_access WHERE user_id=v.user_id;
  ELSIF v.access_profile->>'viewer_type'='departments' THEN SELECT coalesce(array_agg(d.id),ARRAY[]::bigint[]) INTO selected FROM public.user_department_access a JOIN public.departments d ON d.name=a.department WHERE a.user_id=v.user_id;
  ELSIF v.access_profile->>'viewer_type'='projects' THEN SELECT coalesce(array_agg(project_id),ARRAY[]::bigint[]) INTO selected FROM public.user_project_access WHERE user_id=v.user_id;
  ELSE SELECT coalesce(array_agg(order_id),ARRAY[]::bigint[]) INTO selected FROM public.user_order_access WHERE user_id=v.user_id; END IF;
  config:=jsonb_build_object('mode','viewer','viewer_type',v.access_profile->>'viewer_type','selected_ids',to_jsonb(selected));
  PERFORM public.apply_access_tree(v.user_id,config);
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(before_data->'invoices') old JOIN public.invoices i ON i.id=(old->>'id')::bigint
 WHERE (to_jsonb(i)-ARRAY['project_id','project_name']) IS DISTINCT FROM (old-ARRAY['project_id','project_name'])) THEN RAISE EXCEPTION 'Invoice values or immutable identifiers changed; merge rolled back'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(before_data->'orders') old JOIN public.pos po ON po.id=(old->>'id')::bigint
 WHERE (to_jsonb(po)-ARRAY['company','customer_company_id','department','department_id','project_id','project_name']) IS DISTINCT FROM (old-ARRAY['company','customer_company_id','department','department_id','project_id','project_name'])) THEN RAISE EXCEPTION 'PO financial or non-link values changed; merge rolled back'; END IF;
 IF (SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]') FROM public.invoice_collections c WHERE invoice_id=ANY(invoice_ids)) IS DISTINCT FROM before_data->'collections' THEN RAISE EXCEPTION 'Collection records changed; merge rolled back'; END IF;
 SELECT jsonb_build_object('invoice_count',count(*),'invoice_amount',coalesce(sum(invoice_amount),0),'paid',coalesce(sum(paid_amount),0),'retention',coalesce(sum(retention_amount),0),'retention_vat',coalesce(sum(retention_vat),0),'retention_released',coalesce(sum(retention_released_amount),0),'advance_amortisation',coalesce(sum(advance_amortisation),0)) INTO financial_after FROM public.invoices;
 financial_after:=financial_after||jsonb_build_object('order_count',(SELECT count(*) FROM public.pos),'order_value',(SELECT coalesce(sum(po_value_ex_vat),0) FROM public.pos),'collection_count',(SELECT count(*) FROM public.invoice_collections),'collection_amount',(SELECT coalesce(sum(amount),0) FROM public.invoice_collections));
 IF financial_before IS DISTINCT FROM financial_after THEN RAISE EXCEPTION 'Financial totals changed; merge rolled back'; END IF;
 result:=result||jsonb_build_object('merged',true,'financial_values_unchanged',true);
 INSERT INTO public.data_merge_audit(actor_id,entity_kind,source_id,target_id,source_name,target_name,snapshot,result) VALUES(auth.uid(),p_kind,p_source_id,p_target_id,source_name,target_name,before_data||jsonb_build_object('financial',financial_before),result) RETURNING id INTO audit_id;
 RETURN result||jsonb_build_object('audit_id',audit_id);
END $$;
REVOKE ALL ON FUNCTION public.merge_business_entity(text,bigint,bigint,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.merge_business_entity(text,bigint,bigint,boolean,text) TO authenticated;

DO $verify$ DECLARE after_data jsonb; BEGIN
 SELECT jsonb_build_object(
'customers',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM public.customer_companies t),
'departments',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM public.departments t),
'projects',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM public.projects t),
'orders',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM public.pos t),
'invoices',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM public.invoices t),
'collections',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM public.invoice_collections t),
'profiles',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM public.users_profile t),
'permissions',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t)-'access_profile' ORDER BY user_id)::text,'[]')) FROM public.user_permissions t),
'customer_scopes',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY user_id,customer_company_id)::text,'[]')) FROM public.user_customer_access t),
'department_scopes',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM public.user_department_access t),
'project_scopes',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM public.user_project_access t)) INTO after_data;
 IF after_data IS DISTINCT FROM (SELECT fingerprint FROM sa_deployment_before) THEN RAISE EXCEPTION 'Existing records changed during deployment; migration rolled back'; END IF;
 IF EXISTS(SELECT 1 FROM public.data_merge_audit) THEN RAISE EXCEPTION 'No real data merge should run during deployment'; END IF;
END $verify$;
NOTIFY pgrst,'reload schema';
