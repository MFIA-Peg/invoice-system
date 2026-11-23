
-- Per-module operations and explicit customer/department/project scopes.
ALTER TABLE public.user_permissions ADD COLUMN module_permissions jsonb;
CREATE TABLE public.user_customer_access (
 user_id bigint NOT NULL REFERENCES public.users_profile(id) ON DELETE CASCADE,
 customer_company_id bigint NOT NULL REFERENCES public.customer_companies(id) ON DELETE CASCADE,
 PRIMARY KEY(user_id,customer_company_id)
);
CREATE INDEX user_customer_access_customer_idx ON public.user_customer_access(customer_company_id);
ALTER TABLE public.user_customer_access ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.access_actor_id() RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT id FROM public.users_profile WHERE auth_user_id=(SELECT auth.uid()) AND active IS TRUE AND must_change_password IS FALSE LIMIT 1
$$;
CREATE OR REPLACE FUNCTION public.is_finance_manager() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.users_profile WHERE id=public.access_actor_id() AND lower(btrim(role)) IN('finance_manager','system_admin'))
$$;
CREATE FUNCTION public.normalize_module_permissions(p jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE result jsonb:='{}'; m text; a text; item jsonb; value boolean;
BEGIN
 IF p IS NULL OR jsonb_typeof(p)<>'object' THEN RAISE EXCEPTION 'Permissions must be an object'; END IF;
 IF p ? 'modules' AND jsonb_typeof(p->'modules')<>'object' THEN RAISE EXCEPTION 'Module permissions must be an object'; END IF;
 FOREACH m IN ARRAY ARRAY['customers','departments','projects','orders','invoices','collections'] LOOP
  item:='{}';
  FOREACH a IN ARRAY ARRAY['view','add','edit','delete'] LOOP
   IF p ? 'modules' THEN
    IF jsonb_typeof(p->'modules'->m->a) IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Each module must define view, add, edit and delete'; END IF;
    value:=(p->'modules'->m->>a)::boolean;
   ELSE
    value:=coalesce((p->>('can_'||a))::boolean,false);
    IF m IN('customers','departments') AND a<>'view' THEN value:=coalesce((p->>(CASE a WHEN 'add' THEN 'can_create_' ELSE 'can_'||a||'_' END||m))::boolean,false); END IF;
   END IF;
   item:=item||jsonb_build_object(a,value);
  END LOOP;
  IF NOT (item->>'view')::boolean AND ((item->>'add')::boolean OR (item->>'edit')::boolean OR (item->>'delete')::boolean) THEN RAISE EXCEPTION 'Enable View before allowing changes in %',m; END IF;
  result:=result||jsonb_build_object(m,item);
 END LOOP;
 RETURN result;
END $$;

UPDATE public.user_permissions p SET module_permissions=public.normalize_module_permissions(to_jsonb(p));
ALTER TABLE public.user_permissions ALTER COLUMN module_permissions SET DEFAULT '{}', ALTER COLUMN module_permissions SET NOT NULL;

INSERT INTO public.user_customer_access(user_id,customer_company_id)
SELECT DISTINCT u.id,c.id FROM public.users_profile u CROSS JOIN public.customer_companies c
WHERE EXISTS(
 SELECT 1 FROM public.department_customer_companies dc JOIN public.departments d ON d.id=dc.department_id
 WHERE dc.customer_company_id=c.id AND (u.all_departments OR EXISTS(SELECT 1 FROM public.user_department_access a WHERE a.user_id=u.id AND lower(btrim(a.department))=lower(btrim(d.name))))
)
OR EXISTS(
 SELECT 1 FROM public.projects p WHERE p.company=c.name AND (u.all_projects OR EXISTS(SELECT 1 FROM public.user_project_access a WHERE a.user_id=u.id AND a.project_id=p.id))
) ON CONFLICT DO NOTHING;

CREATE FUNCTION public.can_module(p_module text,p_action text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p_module IN('customers','departments','projects','orders','invoices','collections') AND p_action IN('view','add','edit','delete') AND
 (public.is_finance_manager() OR EXISTS(SELECT 1 FROM public.user_permissions WHERE user_id=public.access_actor_id()
 AND module_permissions->p_module->>'view'='true' AND module_permissions->p_module->>p_action='true'))
$$;
-- Parent rows required by authorized financial screens remain available as scoped lookups.
CREATE FUNCTION public.can_read_module(m text) RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT public.can_module(m,'view') OR
 (m IN('customers','departments','projects','orders','invoices') AND public.can_module('collections','view')) OR
 (m IN('customers','departments','projects','orders') AND public.can_module('invoices','view')) OR
 (m IN('customers','departments','projects') AND public.can_module('orders','view')) OR
 (m IN('customers','departments') AND public.can_module('projects','view')) OR
 (m='customers' AND public.can_module('departments','view')) OR (m='departments' AND public.can_module('customers','view'))
$$;
CREATE OR REPLACE FUNCTION public.has_department_access(p_department text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.users_profile u WHERE u.id=public.access_actor_id() AND
 (public.is_finance_manager() OR u.all_departments OR EXISTS(SELECT 1 FROM public.user_department_access a WHERE a.user_id=u.id AND lower(btrim(a.department))=lower(btrim(p_department)))))
$$;
CREATE OR REPLACE FUNCTION public.has_project_access(p_project_id bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.users_profile u WHERE u.id=public.access_actor_id() AND
 (public.is_finance_manager() OR u.all_projects OR EXISTS(SELECT 1 FROM public.user_project_access a WHERE a.user_id=u.id AND a.project_id=p_project_id)))
$$;
CREATE FUNCTION public.has_customer_access(p_name text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.is_finance_manager() OR EXISTS(SELECT 1 FROM public.user_customer_access a JOIN public.customer_companies c ON c.id=a.customer_company_id WHERE a.user_id=public.access_actor_id() AND c.name=p_name)
$$;
CREATE FUNCTION public.customer_scope(p_id bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.is_finance_manager() OR EXISTS(SELECT 1 FROM public.customer_companies c WHERE c.id=p_id AND public.has_customer_access(c.name)
 AND EXISTS(SELECT 1 FROM public.department_customer_companies l JOIN public.departments d ON d.id=l.department_id WHERE l.customer_company_id=c.id AND public.has_department_access(d.name)))
$$;
CREATE OR REPLACE FUNCTION public.can_access_department_id(p_department_id bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.departments WHERE id=p_department_id AND public.has_department_access(name))
$$;
CREATE FUNCTION public.project_scope(p_id bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.is_finance_manager() OR EXISTS(SELECT 1 FROM public.projects p WHERE p.id=p_id AND public.has_project_access(p.id) AND public.has_department_access(p.department) AND public.has_customer_access(p.company))
$$;
CREATE OR REPLACE FUNCTION public.has_project_department_access(p_project_id bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.project_scope(p_project_id)
$$;
CREATE FUNCTION public.po_scope(p_id bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.is_finance_manager() OR EXISTS(SELECT 1 FROM public.pos p WHERE p.id=p_id AND public.project_scope(p.project_id) AND public.has_department_access(p.department) AND public.has_customer_access(p.company))
$$;
CREATE OR REPLACE FUNCTION public.has_invoice_po_access(p_po_no text,p_project_id bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.is_finance_manager() OR EXISTS(SELECT 1 FROM public.pos p WHERE p.po_no=p_po_no AND p.project_id=p_project_id AND public.po_scope(p.id))
$$;
CREATE FUNCTION public.invoice_scope(p_id bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.is_finance_manager() OR EXISTS(SELECT 1 FROM public.invoices i WHERE i.id=p_id AND public.project_scope(i.project_id) AND
 CASE WHEN i.pos_id IS NOT NULL THEN EXISTS(SELECT 1 FROM public.pos p WHERE p.id=i.pos_id AND p.project_id=i.project_id AND public.po_scope(p.id))
 ELSE public.has_invoice_po_access(i.po_no,i.project_id) END)
$$;
CREATE OR REPLACE FUNCTION public.can_access_collection_invoice(p_invoice_id bigint) RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT public.invoice_scope(p_invoice_id)
$$;
CREATE FUNCTION public.invoice_number_scope(p_number text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.invoices WHERE invoice_no=p_number AND public.invoice_scope(id))
 AND NOT EXISTS(SELECT 1 FROM public.invoices WHERE invoice_no=p_number AND NOT public.invoice_scope(id))
$$;

CREATE FUNCTION public.get_my_module_access() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('manager',public.is_finance_manager(),'user_id',public.access_actor_id(),'modules',
 CASE WHEN public.is_finance_manager() THEN (SELECT jsonb_object_agg(m,jsonb_build_object('view',true,'add',true,'edit',true,'delete',true)) FROM unnest(ARRAY['customers','departments','projects','orders','invoices','collections']) m)
 ELSE coalesce((SELECT module_permissions FROM public.user_permissions WHERE user_id=public.access_actor_id()),'{}') END)
$$;


CREATE FUNCTION public.accessible_department_ids() RETURNS bigint[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH actor AS MATERIALIZED(SELECT id,role,all_departments FROM public.users_profile WHERE auth_user_id=(SELECT auth.uid()) AND active IS TRUE AND must_change_password IS FALSE)
 SELECT coalesce(array_agg(d.id),ARRAY[]::bigint[]) FROM public.departments d CROSS JOIN actor u
 WHERE u.role IN('finance_manager','system_admin') OR u.all_departments OR EXISTS(SELECT 1 FROM public.user_department_access a WHERE a.user_id=u.id AND lower(btrim(a.department))=lower(btrim(d.name)))
$$;
CREATE FUNCTION public.accessible_customer_ids() RETURNS bigint[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH actor AS MATERIALIZED(SELECT id,role FROM public.users_profile WHERE auth_user_id=(SELECT auth.uid()) AND active IS TRUE AND must_change_password IS FALSE),
 deps AS MATERIALIZED(SELECT public.accessible_department_ids() ids)
 SELECT coalesce(array_agg(c.id),ARRAY[]::bigint[]) FROM public.customer_companies c CROSS JOIN actor u CROSS JOIN deps
 WHERE u.role IN('finance_manager','system_admin') OR (
 EXISTS(SELECT 1 FROM public.user_customer_access a WHERE a.user_id=u.id AND a.customer_company_id=c.id)
 AND EXISTS(SELECT 1 FROM public.department_customer_companies l WHERE l.customer_company_id=c.id AND l.department_id=ANY(deps.ids)))
$$;
CREATE FUNCTION public.accessible_project_ids() RETURNS bigint[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH actor AS MATERIALIZED(SELECT id,role,all_projects,all_departments FROM public.users_profile WHERE auth_user_id=(SELECT auth.uid()) AND active IS TRUE AND must_change_password IS FALSE)
 SELECT coalesce(array_agg(p.id),ARRAY[]::bigint[]) FROM public.projects p CROSS JOIN actor u
 WHERE u.role IN('finance_manager','system_admin') OR
 ((u.all_projects OR EXISTS(SELECT 1 FROM public.user_project_access a WHERE a.user_id=u.id AND a.project_id=p.id))
 AND (u.all_departments OR EXISTS(SELECT 1 FROM public.user_department_access a WHERE a.user_id=u.id AND lower(btrim(a.department))=lower(btrim(p.department))))
 AND EXISTS(SELECT 1 FROM public.user_customer_access a JOIN public.customer_companies c ON c.id=a.customer_company_id WHERE a.user_id=u.id AND c.name=p.company))
$$;
CREATE FUNCTION public.accessible_po_ids() RETURNS bigint[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH actor AS MATERIALIZED(SELECT id,role,all_departments FROM public.users_profile WHERE auth_user_id=(SELECT auth.uid()) AND active IS TRUE AND must_change_password IS FALSE),
 projects AS MATERIALIZED(SELECT public.accessible_project_ids() ids)
 SELECT coalesce(array_agg(p.id),ARRAY[]::bigint[]) FROM public.pos p CROSS JOIN actor u CROSS JOIN projects
 WHERE u.role IN('finance_manager','system_admin') OR
 (p.project_id=ANY(projects.ids)
 AND (u.all_departments OR EXISTS(SELECT 1 FROM public.user_department_access a WHERE a.user_id=u.id AND lower(btrim(a.department))=lower(btrim(p.department))))
 AND EXISTS(SELECT 1 FROM public.user_customer_access a JOIN public.customer_companies c ON c.id=a.customer_company_id WHERE a.user_id=u.id AND c.name=p.company))
$$;
CREATE FUNCTION public.accessible_invoice_ids() RETURNS bigint[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH actor AS MATERIALIZED(SELECT id,role FROM public.users_profile WHERE auth_user_id=(SELECT auth.uid()) AND active IS TRUE AND must_change_password IS FALSE),
 projects AS MATERIALIZED(SELECT public.accessible_project_ids() ids),
 orders AS MATERIALIZED(SELECT id,po_no,project_id FROM public.pos WHERE id=ANY((SELECT public.accessible_po_ids())::bigint[]))
 SELECT coalesce(array_agg(i.id),ARRAY[]::bigint[]) FROM public.invoices i CROSS JOIN actor u CROSS JOIN projects
 WHERE u.role IN('finance_manager','system_admin') OR
 (i.project_id=ANY(projects.ids) AND EXISTS(SELECT 1 FROM orders p WHERE p.project_id=i.project_id AND
 CASE WHEN i.pos_id IS NOT NULL THEN p.id=i.pos_id ELSE p.po_no=i.po_no END))
$$;
CREATE FUNCTION public.accessible_invoice_numbers() RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH ids AS MATERIALIZED(SELECT public.accessible_invoice_ids() allowed)
 SELECT coalesce(array_agg(invoice_no),ARRAY[]::text[]) FROM
 (SELECT i.invoice_no FROM public.invoices i CROSS JOIN ids WHERE i.invoice_no IS NOT NULL GROUP BY i.invoice_no HAVING bool_and(i.id=ANY(ids.allowed))) s
$$;

CREATE POLICY customer_access_self ON public.user_customer_access FOR SELECT TO authenticated USING(user_id=public.access_actor_id() OR public.is_finance_manager());
CREATE POLICY customer_access_manager ON public.user_customer_access FOR ALL TO authenticated USING(public.is_finance_manager()) WITH CHECK(public.is_finance_manager());

CREATE FUNCTION public.grant_created_project_access() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF public.can_module('projects','add') AND NOT public.is_finance_manager() THEN
  INSERT INTO public.user_project_access(user_id,project_id) VALUES(public.access_actor_id(),NEW.id) ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER project_creator_access AFTER INSERT ON public.projects FOR EACH ROW EXECUTE FUNCTION public.grant_created_project_access();

CREATE OR REPLACE FUNCTION public.can_create_customer() RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$ SELECT public.can_module('customers','add') $$;
CREATE OR REPLACE FUNCTION public.can_create_department() RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$ SELECT public.can_module('departments','add') $$;

CREATE OR REPLACE FUNCTION public.can_view_data() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT public.is_finance_manager() OR EXISTS(SELECT 1 FROM public.user_permissions p WHERE p.user_id=public.access_actor_id() AND EXISTS(SELECT 1 FROM jsonb_each(p.module_permissions) m WHERE m.value->>'view'='true' AND m.value->>'view'='true')) $$;

CREATE OR REPLACE FUNCTION public.can_add_data() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT public.is_finance_manager() OR EXISTS(SELECT 1 FROM public.user_permissions p WHERE p.user_id=public.access_actor_id() AND EXISTS(SELECT 1 FROM jsonb_each(p.module_permissions) m WHERE m.value->>'view'='true' AND m.value->>'add'='true')) $$;

CREATE OR REPLACE FUNCTION public.can_edit_data() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT public.is_finance_manager() OR EXISTS(SELECT 1 FROM public.user_permissions p WHERE p.user_id=public.access_actor_id() AND EXISTS(SELECT 1 FROM jsonb_each(p.module_permissions) m WHERE m.value->>'view'='true' AND m.value->>'edit'='true')) $$;

CREATE OR REPLACE FUNCTION public.can_delete_data() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT public.is_finance_manager() OR EXISTS(SELECT 1 FROM public.user_permissions p WHERE p.user_id=public.access_actor_id() AND EXISTS(SELECT 1 FROM jsonb_each(p.module_permissions) m WHERE m.value->>'view'='true' AND m.value->>'delete'='true')) $$;
DROP POLICY "initial_password_gate_invoices_delete" ON public."invoices";
CREATE POLICY "initial_password_gate_invoices_delete" ON public."invoices" AS RESTRICTIVE FOR DELETE TO authenticated USING ((NOT current_user_must_change_password()));
DROP POLICY "initial_password_gate_invoices_insert" ON public."invoices";
CREATE POLICY "initial_password_gate_invoices_insert" ON public."invoices" AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((NOT current_user_must_change_password()));
DROP POLICY "initial_password_gate_invoices_select" ON public."invoices";
CREATE POLICY "initial_password_gate_invoices_select" ON public."invoices" AS RESTRICTIVE FOR SELECT TO authenticated USING ((NOT current_user_must_change_password()));
DROP POLICY "initial_password_gate_invoices_update" ON public."invoices";
CREATE POLICY "initial_password_gate_invoices_update" ON public."invoices" AS RESTRICTIVE FOR UPDATE TO authenticated USING ((NOT current_user_must_change_password())) WITH CHECK ((NOT current_user_must_change_password()));
DROP POLICY "initial_password_gate_pos_delete" ON public."pos";
CREATE POLICY "initial_password_gate_pos_delete" ON public."pos" AS RESTRICTIVE FOR DELETE TO authenticated USING ((NOT current_user_must_change_password()));
DROP POLICY "initial_password_gate_pos_insert" ON public."pos";
CREATE POLICY "initial_password_gate_pos_insert" ON public."pos" AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((NOT current_user_must_change_password()));
DROP POLICY "initial_password_gate_pos_select" ON public."pos";
CREATE POLICY "initial_password_gate_pos_select" ON public."pos" AS RESTRICTIVE FOR SELECT TO authenticated USING ((NOT current_user_must_change_password()));
DROP POLICY "initial_password_gate_pos_update" ON public."pos";
CREATE POLICY "initial_password_gate_pos_update" ON public."pos" AS RESTRICTIVE FOR UPDATE TO authenticated USING ((NOT current_user_must_change_password())) WITH CHECK ((NOT current_user_must_change_password()));
DROP POLICY "initial_password_gate_projects_delete" ON public."projects";
CREATE POLICY "initial_password_gate_projects_delete" ON public."projects" AS RESTRICTIVE FOR DELETE TO authenticated USING ((NOT current_user_must_change_password()));
DROP POLICY "initial_password_gate_projects_insert" ON public."projects";
CREATE POLICY "initial_password_gate_projects_insert" ON public."projects" AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((NOT current_user_must_change_password()));
DROP POLICY "initial_password_gate_projects_select" ON public."projects";
CREATE POLICY "initial_password_gate_projects_select" ON public."projects" AS RESTRICTIVE FOR SELECT TO authenticated USING ((NOT current_user_must_change_password()));
DROP POLICY "initial_password_gate_projects_update" ON public."projects";
CREATE POLICY "initial_password_gate_projects_update" ON public."projects" AS RESTRICTIVE FOR UPDATE TO authenticated USING ((NOT current_user_must_change_password())) WITH CHECK ((NOT current_user_must_change_password()));
DROP POLICY "initial_password_gate_record_attachments_delete" ON public."record_attachments";
CREATE POLICY "initial_password_gate_record_attachments_delete" ON public."record_attachments" AS RESTRICTIVE FOR DELETE TO authenticated USING ((NOT current_user_must_change_password()));
DROP POLICY "initial_password_gate_record_attachments_insert" ON public."record_attachments";
CREATE POLICY "initial_password_gate_record_attachments_insert" ON public."record_attachments" AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((NOT current_user_must_change_password()));
DROP POLICY "initial_password_gate_record_attachments_select" ON public."record_attachments";
CREATE POLICY "initial_password_gate_record_attachments_select" ON public."record_attachments" AS RESTRICTIVE FOR SELECT TO authenticated USING ((NOT current_user_must_change_password()));
DROP POLICY "initial_password_gate_record_attachments_update" ON public."record_attachments";
CREATE POLICY "initial_password_gate_record_attachments_update" ON public."record_attachments" AS RESTRICTIVE FOR UPDATE TO authenticated USING ((NOT current_user_must_change_password())) WITH CHECK ((NOT current_user_must_change_password()));
DROP POLICY "initial_password_gate_user_department_access_delete" ON public."user_department_access";
CREATE POLICY "initial_password_gate_user_department_access_delete" ON public."user_department_access" AS RESTRICTIVE FOR DELETE TO authenticated USING ((NOT current_user_must_change_password()));
DROP POLICY "initial_password_gate_user_department_access_insert" ON public."user_department_access";
CREATE POLICY "initial_password_gate_user_department_access_insert" ON public."user_department_access" AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((NOT current_user_must_change_password()));
DROP POLICY "initial_password_gate_user_department_access_select" ON public."user_department_access";
CREATE POLICY "initial_password_gate_user_department_access_select" ON public."user_department_access" AS RESTRICTIVE FOR SELECT TO authenticated USING ((NOT current_user_must_change_password()));
DROP POLICY "initial_password_gate_user_department_access_update" ON public."user_department_access";
CREATE POLICY "initial_password_gate_user_department_access_update" ON public."user_department_access" AS RESTRICTIVE FOR UPDATE TO authenticated USING ((NOT current_user_must_change_password())) WITH CHECK ((NOT current_user_must_change_password()));
DROP POLICY "initial_password_gate_user_permissions_delete" ON public."user_permissions";
CREATE POLICY "initial_password_gate_user_permissions_delete" ON public."user_permissions" AS RESTRICTIVE FOR DELETE TO authenticated USING ((NOT current_user_must_change_password()));
DROP POLICY "initial_password_gate_user_permissions_insert" ON public."user_permissions";
CREATE POLICY "initial_password_gate_user_permissions_insert" ON public."user_permissions" AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((NOT current_user_must_change_password()));
DROP POLICY "initial_password_gate_user_permissions_select" ON public."user_permissions";
CREATE POLICY "initial_password_gate_user_permissions_select" ON public."user_permissions" AS RESTRICTIVE FOR SELECT TO authenticated USING ((NOT current_user_must_change_password()));
DROP POLICY "initial_password_gate_user_permissions_update" ON public."user_permissions";
CREATE POLICY "initial_password_gate_user_permissions_update" ON public."user_permissions" AS RESTRICTIVE FOR UPDATE TO authenticated USING ((NOT current_user_must_change_password())) WITH CHECK ((NOT current_user_must_change_password()));
DROP POLICY "initial_password_gate_user_project_access_delete" ON public."user_project_access";
CREATE POLICY "initial_password_gate_user_project_access_delete" ON public."user_project_access" AS RESTRICTIVE FOR DELETE TO authenticated USING ((NOT current_user_must_change_password()));
DROP POLICY "initial_password_gate_user_project_access_insert" ON public."user_project_access";
CREATE POLICY "initial_password_gate_user_project_access_insert" ON public."user_project_access" AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((NOT current_user_must_change_password()));
DROP POLICY "initial_password_gate_user_project_access_select" ON public."user_project_access";
CREATE POLICY "initial_password_gate_user_project_access_select" ON public."user_project_access" AS RESTRICTIVE FOR SELECT TO authenticated USING ((NOT current_user_must_change_password()));
DROP POLICY "initial_password_gate_user_project_access_update" ON public."user_project_access";
CREATE POLICY "initial_password_gate_user_project_access_update" ON public."user_project_access" AS RESTRICTIVE FOR UPDATE TO authenticated USING ((NOT current_user_must_change_password())) WITH CHECK ((NOT current_user_must_change_password()));
DROP POLICY "customer_companies_select_policy" ON public."customer_companies";
DROP POLICY "department_customer_select_policy" ON public."department_customer_companies";
DROP POLICY "departments_select_policy" ON public."departments";
DROP POLICY "collections_delete_policy" ON public."invoice_collections";
DROP POLICY "collections_insert_policy" ON public."invoice_collections";
DROP POLICY "collections_select_policy" ON public."invoice_collections";
DROP POLICY "collections_update_policy" ON public."invoice_collections";
DROP POLICY "invoices_delete_policy" ON public."invoices";
DROP POLICY "invoices_insert_policy" ON public."invoices";
DROP POLICY "invoices_select_policy" ON public."invoices";
DROP POLICY "invoices_update_policy" ON public."invoices";
DROP POLICY "pos_delete_policy" ON public."pos";
DROP POLICY "pos_insert_policy" ON public."pos";
DROP POLICY "pos_select_policy" ON public."pos";
DROP POLICY "pos_update_policy" ON public."pos";
DROP POLICY "projects_delete_policy" ON public."projects";
DROP POLICY "projects_insert_policy" ON public."projects";
DROP POLICY "projects_select_policy" ON public."projects";
DROP POLICY "projects_update_policy" ON public."projects";
CREATE POLICY module_select ON public.customer_companies FOR SELECT TO authenticated USING((SELECT public.can_read_module('customers')) AND (id=ANY((SELECT public.accessible_customer_ids())::bigint[])));
CREATE POLICY module_select ON public.departments FOR SELECT TO authenticated USING((SELECT public.can_read_module('departments')) AND (id=ANY((SELECT public.accessible_department_ids())::bigint[])));
CREATE POLICY module_select ON public.department_customer_companies FOR SELECT TO authenticated USING((SELECT public.can_read_module('customers')) AND (department_id=ANY((SELECT public.accessible_department_ids())::bigint[]) AND customer_company_id=ANY((SELECT public.accessible_customer_ids())::bigint[])));
CREATE POLICY module_select ON public.projects FOR SELECT TO authenticated USING((SELECT public.can_read_module('projects')) AND (id=ANY((SELECT public.accessible_project_ids())::bigint[])));
CREATE POLICY module_add ON public.projects FOR INSERT TO authenticated WITH CHECK(public.can_module('projects','add') AND (public.has_customer_access(company) AND public.has_department_access(department)));
CREATE POLICY module_edit ON public.projects FOR UPDATE TO authenticated USING((SELECT public.can_module('projects','edit')) AND id=ANY((SELECT public.accessible_project_ids())::bigint[])) WITH CHECK(public.can_module('projects','edit') AND (public.has_customer_access(company) AND public.has_department_access(department)));
CREATE POLICY module_delete ON public.projects FOR DELETE TO authenticated USING((SELECT public.can_module('projects','delete')) AND id=ANY((SELECT public.accessible_project_ids())::bigint[]));
CREATE POLICY module_select ON public.pos FOR SELECT TO authenticated USING((SELECT public.can_read_module('orders')) AND ((SELECT public.is_finance_manager()) OR (project_id=ANY((SELECT public.accessible_project_ids())::bigint[]) AND company IN(SELECT name FROM public.customer_companies) AND department IN(SELECT name FROM public.departments))));
CREATE POLICY module_add ON public.pos FOR INSERT TO authenticated WITH CHECK(public.can_module('orders','add') AND (public.project_scope(project_id) AND public.has_customer_access(company) AND public.has_department_access(department)));
CREATE POLICY module_edit ON public.pos FOR UPDATE TO authenticated USING((SELECT public.can_module('orders','edit')) AND id=ANY((SELECT public.accessible_po_ids())::bigint[])) WITH CHECK(public.can_module('orders','edit') AND (public.project_scope(project_id) AND public.has_customer_access(company) AND public.has_department_access(department)));
CREATE POLICY module_delete ON public.pos FOR DELETE TO authenticated USING((SELECT public.can_module('orders','delete')) AND id=ANY((SELECT public.accessible_po_ids())::bigint[]));
CREATE POLICY module_select ON public.invoices FOR SELECT TO authenticated USING((SELECT public.can_read_module('invoices')) AND ((SELECT public.is_finance_manager()) OR (project_id=ANY((SELECT public.accessible_project_ids())::bigint[]) AND (pos_id=ANY((SELECT public.accessible_po_ids())::bigint[]) OR (pos_id IS NULL AND public.has_invoice_po_access(po_no,project_id))))));
CREATE POLICY module_add ON public.invoices FOR INSERT TO authenticated WITH CHECK(public.can_module('invoices','add') AND (public.project_scope(project_id) AND public.has_invoice_po_access(po_no,project_id)));
CREATE POLICY module_edit ON public.invoices FOR UPDATE TO authenticated USING((SELECT public.can_module('invoices','edit')) AND id=ANY((SELECT public.accessible_invoice_ids())::bigint[])) WITH CHECK(public.can_module('invoices','edit') AND (public.project_scope(project_id) AND public.has_invoice_po_access(po_no,project_id)));
CREATE POLICY module_delete ON public.invoices FOR DELETE TO authenticated USING((SELECT public.can_module('invoices','delete')) AND id=ANY((SELECT public.accessible_invoice_ids())::bigint[]));
CREATE POLICY module_select ON public.invoice_collections FOR SELECT TO authenticated USING((SELECT public.can_read_module('collections')) AND (invoice_id=ANY((SELECT public.accessible_invoice_ids())::bigint[])));
CREATE POLICY module_add ON public.invoice_collections FOR INSERT TO authenticated WITH CHECK(public.can_module('collections','add') AND (public.invoice_scope(invoice_id)));
CREATE POLICY module_edit ON public.invoice_collections FOR UPDATE TO authenticated USING((SELECT public.can_module('collections','edit')) AND invoice_id=ANY((SELECT public.accessible_invoice_ids())::bigint[])) WITH CHECK(public.can_module('collections','edit') AND (public.invoice_scope(invoice_id)));
CREATE POLICY module_delete ON public.invoice_collections FOR DELETE TO authenticated USING((SELECT public.can_module('collections','delete')) AND invoice_id=ANY((SELECT public.accessible_invoice_ids())::bigint[]));
ALTER TABLE public.invoice_followups ENABLE ROW LEVEL SECURITY;
CREATE POLICY module_view ON public.invoice_followups FOR SELECT TO authenticated USING((SELECT public.can_module('invoices','view')) AND invoice_no=ANY((SELECT public.accessible_invoice_numbers())::text[]));
CREATE POLICY module_add ON public.invoice_followups FOR INSERT TO authenticated WITH CHECK(public.can_module('invoices','add') AND public.invoice_number_scope(invoice_no));
CREATE POLICY module_edit ON public.invoice_followups FOR UPDATE TO authenticated USING(public.can_module('invoices','edit') AND public.invoice_number_scope(invoice_no)) WITH CHECK(public.can_module('invoices','edit') AND public.invoice_number_scope(invoice_no));
CREATE POLICY module_delete ON public.invoice_followups FOR DELETE TO authenticated USING(public.can_module('invoices','delete') AND public.invoice_number_scope(invoice_no));
ALTER TABLE public.collection_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY module_view ON public.collection_tasks FOR SELECT TO authenticated USING((SELECT public.can_module('collections','view')) AND invoice_no=ANY((SELECT public.accessible_invoice_numbers())::text[]));
CREATE POLICY module_add ON public.collection_tasks FOR INSERT TO authenticated WITH CHECK(public.can_module('collections','add') AND public.invoice_number_scope(invoice_no));
CREATE POLICY module_edit ON public.collection_tasks FOR UPDATE TO authenticated USING(public.can_module('collections','edit') AND public.invoice_number_scope(invoice_no)) WITH CHECK(public.can_module('collections','edit') AND public.invoice_number_scope(invoice_no));
CREATE POLICY module_delete ON public.collection_tasks FOR DELETE TO authenticated USING(public.can_module('collections','delete') AND public.invoice_number_scope(invoice_no));
ALTER TABLE public.po_import_staging ENABLE ROW LEVEL SECURITY;
CREATE POLICY staging_manager ON public.po_import_staging FOR ALL TO authenticated USING(public.is_finance_manager()) WITH CHECK(public.is_finance_manager());
DO $$ DECLARE v record; BEGIN FOR v IN SELECT c.relname FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='v' LOOP EXECUTE format('ALTER VIEW public.%I SET (security_invoker=true)',v.relname); END LOOP; END $$;

CREATE FUNCTION public.customer_id_scope(p_id bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT public.is_finance_manager() OR EXISTS(SELECT 1 FROM public.customer_companies WHERE id=p_id AND public.has_customer_access(name)) $$;

CREATE OR REPLACE FUNCTION public.rename_customer_company(p_customer_company_id bigint, p_new_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_old text; v_new text := btrim(coalesce(p_new_name,''));
BEGIN
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

CREATE OR REPLACE FUNCTION public.create_customer_for_department(p_customer_name text, p_department_id bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_customer_id bigint;
BEGIN
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
    RETURN v_customer_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.can_access_invoice_attachment(p_invoice_id bigint,p_project_id bigint,p_permission text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.can_module('invoices',p_permission) AND EXISTS(SELECT 1 FROM public.invoices i WHERE i.id=p_invoice_id AND (p_project_id IS NULL OR i.project_id=p_project_id) AND public.invoice_scope(i.id))
$$;

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

RETURN v_user_id;
END;
$function$
;
REVOKE ALL ON FUNCTION public.access_actor_id() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.access_actor_id() TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.normalize_module_permissions(jsonb) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.can_module(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_module(text,text) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.can_read_module(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_read_module(text) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.has_customer_access(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.has_customer_access(text) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.customer_scope(bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.customer_scope(bigint) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.customer_id_scope(bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.customer_id_scope(bigint) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.project_scope(bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.project_scope(bigint) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.po_scope(bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.po_scope(bigint) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.invoice_scope(bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.invoice_scope(bigint) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.invoice_number_scope(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.invoice_number_scope(text) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.get_my_module_access() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_module_access() TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.grant_created_project_access() FROM PUBLIC,anon;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.user_customer_access TO authenticated;
REVOKE EXECUTE ON FUNCTION public.can_access_collection_invoice(p_invoice_id bigint) FROM PUBLIC,anon;
REVOKE EXECUTE ON FUNCTION public.can_access_department_id(p_department_id bigint) FROM PUBLIC,anon;
REVOKE EXECUTE ON FUNCTION public.can_access_existing_attachment(p_storage_path text, p_permission text) FROM PUBLIC,anon;
REVOKE EXECUTE ON FUNCTION public.can_access_invoice_attachment(p_invoice_id bigint, p_project_id bigint, p_permission text) FROM PUBLIC,anon;
REVOKE EXECUTE ON FUNCTION public.can_add_data() FROM PUBLIC,anon;
REVOKE EXECUTE ON FUNCTION public.can_create_customer() FROM PUBLIC,anon;
REVOKE EXECUTE ON FUNCTION public.can_create_department() FROM PUBLIC,anon;
REVOKE EXECUTE ON FUNCTION public.can_delete_data() FROM PUBLIC,anon;
REVOKE EXECUTE ON FUNCTION public.can_edit_data() FROM PUBLIC,anon;
REVOKE EXECUTE ON FUNCTION public.can_view_data() FROM PUBLIC,anon;
REVOKE EXECUTE ON FUNCTION public.can_write_data() FROM PUBLIC,anon;
REVOKE EXECUTE ON FUNCTION public.create_customer_for_department(p_customer_name text, p_department_id bigint) FROM PUBLIC,anon;
REVOKE EXECUTE ON FUNCTION public.create_department(p_name text) FROM PUBLIC,anon;
REVOKE EXECUTE ON FUNCTION public.current_user_must_change_password() FROM PUBLIC,anon;
REVOKE EXECUTE ON FUNCTION public.current_user_role() FROM PUBLIC,anon;
REVOKE EXECUTE ON FUNCTION public.customer_has_business_records(p_id bigint) FROM PUBLIC,anon;
REVOKE EXECUTE ON FUNCTION public.delete_customer_company_safe(p_customer_company_id bigint) FROM PUBLIC,anon;
REVOKE EXECUTE ON FUNCTION public.delete_department_safe(p_department_id bigint) FROM PUBLIC,anon;
REVOKE EXECUTE ON FUNCTION public.has_department_access(p_department text) FROM PUBLIC,anon;
REVOKE EXECUTE ON FUNCTION public.has_invoice_po_access(p_po_no text, p_project_id bigint) FROM PUBLIC,anon;
REVOKE EXECUTE ON FUNCTION public.has_project_access(p_project_id bigint) FROM PUBLIC,anon;
REVOKE EXECUTE ON FUNCTION public.has_project_department_access(p_project_id bigint) FROM PUBLIC,anon;
REVOKE EXECUTE ON FUNCTION public.is_finance_manager() FROM PUBLIC,anon;
REVOKE EXECUTE ON FUNCTION public.is_system_admin() FROM PUBLIC,anon;
REVOKE EXECUTE ON FUNCTION public.link_existing_customer_to_department(p_customer_company_id bigint, p_department_id bigint) FROM PUBLIC,anon;
REVOKE EXECUTE ON FUNCTION public.prevent_closed_invoice_delete() FROM PUBLIC,anon;
REVOKE EXECUTE ON FUNCTION public.protect_invoiced_po_links() FROM PUBLIC,anon;
REVOKE EXECUTE ON FUNCTION public.rename_customer_company(p_customer_company_id bigint, p_new_name text) FROM PUBLIC,anon;
REVOKE EXECUTE ON FUNCTION public.rename_department(p_department_id bigint, p_new_name text) FROM PUBLIC,anon;
REVOKE EXECUTE ON FUNCTION public.save_user_access(p_user_id bigint, p_active boolean, p_permissions jsonb, p_department_access text[], p_project_access bigint[]) FROM PUBLIC,anon;
REVOKE EXECUTE ON FUNCTION public.sync_invoice_pos_id() FROM PUBLIC,anon;
REVOKE EXECUTE ON FUNCTION public.sync_po_customer_department_ids() FROM PUBLIC,anon;
REVOKE EXECUTE ON FUNCTION public.unlink_customer_from_department(p_customer_company_id bigint, p_department_id bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_access_collection_invoice(p_invoice_id bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_department_id(p_department_id bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_existing_attachment(p_storage_path text, p_permission text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_invoice_attachment(p_invoice_id bigint, p_project_id bigint, p_permission text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_add_data() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_create_customer() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_create_department() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_delete_data() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_edit_data() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_data() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_write_data() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_customer_for_department(p_customer_name text, p_department_id bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_department(p_name text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_must_change_password() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.customer_has_business_records(p_id bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_customer_company_safe(p_customer_company_id bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_department_safe(p_department_id bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_department_access(p_department text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_invoice_po_access(p_po_no text, p_project_id bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_project_access(p_project_id bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_project_department_access(p_project_id bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_finance_manager() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_system_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.link_existing_customer_to_department(p_customer_company_id bigint, p_department_id bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rename_customer_company(p_customer_company_id bigint, p_new_name text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rename_department(p_department_id bigint, p_new_name text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_user_access(p_user_id bigint, p_active boolean, p_permissions jsonb, p_department_access text[], p_project_access bigint[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unlink_customer_from_department(p_customer_company_id bigint, p_department_id bigint) TO authenticated;

REVOKE ALL ON FUNCTION public.accessible_department_ids() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.accessible_department_ids() TO authenticated,service_role;

REVOKE ALL ON FUNCTION public.accessible_customer_ids() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.accessible_customer_ids() TO authenticated,service_role;

REVOKE ALL ON FUNCTION public.accessible_project_ids() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.accessible_project_ids() TO authenticated,service_role;

REVOKE ALL ON FUNCTION public.accessible_po_ids() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.accessible_po_ids() TO authenticated,service_role;

REVOKE ALL ON FUNCTION public.accessible_invoice_ids() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.accessible_invoice_ids() TO authenticated,service_role;

REVOKE ALL ON FUNCTION public.accessible_invoice_numbers() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.accessible_invoice_numbers() TO authenticated,service_role;

CREATE FUNCTION public.create_scoped_project(p_project jsonb) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id bigint;
BEGIN
 IF NOT public.can_module('projects','add') THEN RAISE EXCEPTION 'You do not have Add permission for projects'; END IF;
 IF p_project IS NULL OR jsonb_typeof(p_project)<>'object' OR nullif(btrim(p_project->>'project_name'),'') IS NULL THEN RAISE EXCEPTION 'Project name is required'; END IF;
 IF NOT public.has_customer_access(p_project->>'company') OR NOT public.has_department_access(p_project->>'department') THEN RAISE EXCEPTION 'Customer or department is outside your assigned scope'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.customer_companies c JOIN public.department_customer_companies l ON l.customer_company_id=c.id JOIN public.departments d ON d.id=l.department_id WHERE c.name=p_project->>'company' AND d.name=p_project->>'department') THEN RAISE EXCEPTION 'Customer must be linked to the selected department'; END IF;
 INSERT INTO public.projects(project_name,company,department,project_manager,start_date,end_date,description,status)
 VALUES(btrim(p_project->>'project_name'),p_project->>'company',p_project->>'department',nullif(p_project->>'project_manager',''),nullif(p_project->>'start_date','')::date,nullif(p_project->>'end_date','')::date,nullif(p_project->>'description',''),coalesce(nullif(p_project->>'status',''),'Active')) RETURNING id INTO v_id;
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.create_scoped_project(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_scoped_project(jsonb) TO authenticated;
