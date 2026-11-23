-- Evaluate statement-wide authorization once without changing row scope or write permissions.
CREATE OR REPLACE FUNCTION public.get_my_module_access()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT jsonb_build_object(
 'manager',public.is_finance_manager(),'user_id',public.access_actor_id(),
 'mode',CASE WHEN public.is_finance_manager() THEN 'administrator' ELSE coalesce((SELECT access_profile->>'mode' FROM public.user_permissions WHERE user_id=public.access_actor_id()),'editor') END,
 'tree',coalesce((SELECT access_profile IS NOT NULL FROM public.user_permissions WHERE user_id=public.access_actor_id()),false),
 'viewer_type',(SELECT access_profile->>'viewer_type' FROM public.user_permissions WHERE user_id=public.access_actor_id()),
 'modules',(SELECT jsonb_object_agg(m,jsonb_build_object('view',public.can_module(m,'view'),'add',public.can_module(m,'add'),'edit',public.can_module(m,'edit'),'delete',public.can_module(m,'delete'))) FROM unnest(ARRAY['customers','departments','projects','orders','invoices','collections']) m),
 'department_rules',coalesce((SELECT jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,'add',a.can_add,'edit',a.can_edit,'delete',a.can_delete)) FROM public.user_department_permissions a JOIN public.departments d ON d.id=a.department_id WHERE a.user_id=public.access_actor_id()),'[]'),
 'customer_operations',CASE WHEN public.is_finance_manager() OR public.my_access_profile()->>'mode'='viewer' THEN '{}'::jsonb ELSE coalesce((SELECT jsonb_object_agg(c.id::text,jsonb_build_object('edit',public.customer_operation(c.id,'edit'),'delete',public.customer_operation(c.id,'delete'))) FROM public.customer_companies c WHERE c.id=ANY(public.accessible_customer_ids())),'{}') END
 )
$function$
;
ALTER POLICY "initial_password_gate_record_attachments_delete" ON public."record_attachments" USING ((NOT (SELECT public.current_user_must_change_password())));
ALTER POLICY "initial_password_gate_record_attachments_insert" ON public."record_attachments" WITH CHECK ((NOT (SELECT public.current_user_must_change_password())));
ALTER POLICY "initial_password_gate_record_attachments_select" ON public."record_attachments" USING ((NOT (SELECT public.current_user_must_change_password())));
ALTER POLICY "initial_password_gate_record_attachments_update" ON public."record_attachments" USING ((NOT (SELECT public.current_user_must_change_password()))) WITH CHECK ((NOT (SELECT public.current_user_must_change_password())));
ALTER POLICY "initial_password_gate_user_project_access_delete" ON public."user_project_access" USING ((NOT (SELECT public.current_user_must_change_password())));
ALTER POLICY "initial_password_gate_user_project_access_insert" ON public."user_project_access" WITH CHECK ((NOT (SELECT public.current_user_must_change_password())));
ALTER POLICY "initial_password_gate_user_project_access_select" ON public."user_project_access" USING ((NOT (SELECT public.current_user_must_change_password())));
ALTER POLICY "initial_password_gate_user_project_access_update" ON public."user_project_access" USING ((NOT (SELECT public.current_user_must_change_password()))) WITH CHECK ((NOT (SELECT public.current_user_must_change_password())));
ALTER POLICY "initial_password_gate_invoices_delete" ON public."invoices" USING ((NOT (SELECT public.current_user_must_change_password())));
ALTER POLICY "initial_password_gate_invoices_insert" ON public."invoices" WITH CHECK ((NOT (SELECT public.current_user_must_change_password())));
ALTER POLICY "initial_password_gate_invoices_select" ON public."invoices" USING ((NOT (SELECT public.current_user_must_change_password())));
ALTER POLICY "initial_password_gate_invoices_update" ON public."invoices" USING ((NOT (SELECT public.current_user_must_change_password()))) WITH CHECK ((NOT (SELECT public.current_user_must_change_password())));
ALTER POLICY "initial_password_gate_projects_delete" ON public."projects" USING ((NOT (SELECT public.current_user_must_change_password())));
ALTER POLICY "initial_password_gate_projects_insert" ON public."projects" WITH CHECK ((NOT (SELECT public.current_user_must_change_password())));
ALTER POLICY "initial_password_gate_projects_select" ON public."projects" USING ((NOT (SELECT public.current_user_must_change_password())));
ALTER POLICY "initial_password_gate_projects_update" ON public."projects" USING ((NOT (SELECT public.current_user_must_change_password()))) WITH CHECK ((NOT (SELECT public.current_user_must_change_password())));
ALTER POLICY "initial_password_gate_user_department_access_delete" ON public."user_department_access" USING ((NOT (SELECT public.current_user_must_change_password())));
ALTER POLICY "initial_password_gate_user_department_access_insert" ON public."user_department_access" WITH CHECK ((NOT (SELECT public.current_user_must_change_password())));
ALTER POLICY "initial_password_gate_user_department_access_select" ON public."user_department_access" USING ((NOT (SELECT public.current_user_must_change_password())));
ALTER POLICY "initial_password_gate_user_department_access_update" ON public."user_department_access" USING ((NOT (SELECT public.current_user_must_change_password()))) WITH CHECK ((NOT (SELECT public.current_user_must_change_password())));
ALTER POLICY "initial_password_gate_pos_delete" ON public."pos" USING ((NOT (SELECT public.current_user_must_change_password())));
ALTER POLICY "initial_password_gate_pos_insert" ON public."pos" WITH CHECK ((NOT (SELECT public.current_user_must_change_password())));
ALTER POLICY "initial_password_gate_pos_select" ON public."pos" USING ((NOT (SELECT public.current_user_must_change_password())));
ALTER POLICY "initial_password_gate_pos_update" ON public."pos" USING ((NOT (SELECT public.current_user_must_change_password()))) WITH CHECK ((NOT (SELECT public.current_user_must_change_password())));
ALTER POLICY "initial_password_gate_user_permissions_delete" ON public."user_permissions" USING ((NOT (SELECT public.current_user_must_change_password())));
ALTER POLICY "initial_password_gate_user_permissions_insert" ON public."user_permissions" WITH CHECK ((NOT (SELECT public.current_user_must_change_password())));
ALTER POLICY "initial_password_gate_user_permissions_select" ON public."user_permissions" USING ((NOT (SELECT public.current_user_must_change_password())));
ALTER POLICY "initial_password_gate_user_permissions_update" ON public."user_permissions" USING ((NOT (SELECT public.current_user_must_change_password()))) WITH CHECK ((NOT (SELECT public.current_user_must_change_password())));
ALTER POLICY "scope_admin" ON public."user_department_permissions" USING ((SELECT public.is_finance_manager())) WITH CHECK ((SELECT public.is_finance_manager()));
ALTER POLICY "scope_read" ON public."user_department_permissions" USING (((user_id = (SELECT public.access_actor_id())) OR (SELECT public.is_finance_manager())));
ALTER POLICY "scope_admin" ON public."user_customer_department_access" USING ((SELECT public.is_finance_manager())) WITH CHECK ((SELECT public.is_finance_manager()));
ALTER POLICY "scope_read" ON public."user_customer_department_access" USING (((user_id = (SELECT public.access_actor_id())) OR (SELECT public.is_finance_manager())));
ALTER POLICY "scope_admin" ON public."user_order_access" USING ((SELECT public.is_finance_manager())) WITH CHECK ((SELECT public.is_finance_manager()));
ALTER POLICY "scope_read" ON public."user_order_access" USING (((user_id = (SELECT public.access_actor_id())) OR (SELECT public.is_finance_manager())));

NOTIFY pgrst,'reload schema';