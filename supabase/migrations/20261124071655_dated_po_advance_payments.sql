-- Actual PO advance receipts are separate from invoice collections.
-- Legacy aggregate amounts have no known payment date; never invent one.
SET LOCAL lock_timeout='3s';
SELECT pg_advisory_xact_lock(hashtextextended('system_admin_scope_changes',0));
LOCK TABLE public.pos IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE public.po_advance_payments (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 po_id bigint NOT NULL REFERENCES public.pos(id) ON DELETE RESTRICT,
 payment_date date,
 amount numeric(18,2) NOT NULL CHECK (amount > 0),
 reference_no text,
 notes text,
 created_by uuid DEFAULT auth.uid(),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX po_advance_payments_po_date_idx ON public.po_advance_payments(po_id,payment_date);
CREATE INDEX po_advance_payments_date_idx ON public.po_advance_payments(payment_date);
ALTER TABLE public.po_advance_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.po_advance_payments FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.po_advance_payments TO authenticated;
GRANT USAGE,SELECT ON SEQUENCE public.po_advance_payments_id_seq TO authenticated;

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.pos WHERE advance_received_amount<0) THEN
  RAISE EXCEPTION 'Negative legacy advance amounts require review before ledger creation';
 END IF;
END $$;
INSERT INTO public.po_advance_payments(po_id,payment_date,amount,notes,created_by)
SELECT id,NULL,advance_received_amount,'Legacy advance aggregate; payment date requires confirmation',NULL
FROM public.pos WHERE advance_received_amount>0;

CREATE FUNCTION public.po_advance_operation(p_po_id bigint,p_action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(auth.uid() IS NOT NULL AND public.access_actor_id() IS NOT NULL
 AND p_action IN('view','add','edit','delete')
 AND public.can_module('collections',p_action) AND public.po_scope(p_po_id)
 AND EXISTS(SELECT 1 FROM public.pos p WHERE p.id=p_po_id
   AND (p_action='view' OR public.department_operation(p.department,p_action))),false);
$$;
REVOKE ALL ON FUNCTION public.po_advance_operation(bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.po_advance_operation(bigint,text) TO authenticated;

CREATE POLICY po_advance_select ON public.po_advance_payments FOR SELECT TO authenticated
 USING(public.po_advance_operation(po_id,'view'));
CREATE POLICY po_advance_insert ON public.po_advance_payments FOR INSERT TO authenticated
 WITH CHECK(public.po_advance_operation(po_id,'add') AND payment_date IS NOT NULL);
CREATE POLICY po_advance_update ON public.po_advance_payments FOR UPDATE TO authenticated
 USING(public.po_advance_operation(po_id,'edit'))
 WITH CHECK(public.po_advance_operation(po_id,'edit') AND payment_date IS NOT NULL);
CREATE POLICY po_advance_delete ON public.po_advance_payments FOR DELETE TO authenticated
 USING(public.po_advance_operation(po_id,'delete'));

CREATE FUNCTION public.validate_po_advance_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target_id bigint; action_name text;
BEGIN
 target_id:=CASE WHEN TG_OP='DELETE' THEN OLD.po_id ELSE NEW.po_id END;
 action_name:=CASE TG_OP WHEN 'INSERT' THEN 'add' WHEN 'UPDATE' THEN 'edit' ELSE 'delete' END;
 IF NOT public.po_advance_operation(target_id,action_name) THEN
  RAISE EXCEPTION 'Advance payment % permission is required within the purchase order scope',action_name;
 END IF;
 -- Serialize receipts and PO aggregate changes on the parent PO.
 PERFORM 1 FROM public.pos WHERE id=target_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Purchase order not found';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;
 IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.po_id IS DISTINCT FROM OLD.po_id) THEN
  RAISE EXCEPTION 'Advance payment identifiers and purchase order cannot be changed';
 END IF;
 IF NEW.payment_date IS NULL THEN RAISE EXCEPTION 'Enter the actual advance payment date';END IF;
 IF TG_OP='INSERT' THEN NEW.created_by:=auth.uid();NEW.created_at:=now();
 ELSE NEW.created_by:=OLD.created_by;NEW.created_at:=OLD.created_at;END IF;
 NEW.reference_no:=nullif(btrim(NEW.reference_no),'');
 NEW.notes:=nullif(btrim(NEW.notes),'');
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.validate_po_advance_payment() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER trg_validate_po_advance_payment BEFORE INSERT OR UPDATE OR DELETE
 ON public.po_advance_payments FOR EACH ROW EXECUTE FUNCTION public.validate_po_advance_payment();

CREATE FUNCTION public.sync_po_advance_amount()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target_id bigint; delta numeric; action_name text;
BEGIN
 target_id:=CASE WHEN TG_OP='DELETE' THEN OLD.po_id ELSE NEW.po_id END;
 action_name:=CASE TG_OP WHEN 'INSERT' THEN 'add' WHEN 'UPDATE' THEN 'edit' ELSE 'delete' END;
 IF NOT public.po_advance_operation(target_id,action_name) THEN
  RAISE EXCEPTION 'Advance payment operation is outside your permitted scope';
 END IF;
 delta:=CASE TG_OP WHEN 'INSERT' THEN NEW.amount WHEN 'UPDATE' THEN NEW.amount-OLD.amount ELSE -OLD.amount END;
 UPDATE public.pos SET advance_received_amount=coalesce(advance_received_amount,0)+delta WHERE id=target_id;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.sync_po_advance_amount() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER trg_sync_po_advance_amount AFTER INSERT OR UPDATE OR DELETE
 ON public.po_advance_payments FOR EACH ROW EXECUTE FUNCTION public.sync_po_advance_amount();

CREATE FUNCTION public.guard_po_advance_aggregate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE expected numeric;
BEGIN
 IF TG_OP='UPDATE' AND NEW.advance_received_amount IS NOT DISTINCT FROM OLD.advance_received_amount THEN RETURN NEW;END IF;
 SELECT coalesce(sum(amount),0) INTO expected FROM public.po_advance_payments WHERE po_id=NEW.id;
 NEW.advance_received_amount:=coalesce(NEW.advance_received_amount,0);
 IF NEW.advance_received_amount IS DISTINCT FROM expected THEN
  RAISE EXCEPTION 'Record advances using dated advance payments; the PO aggregate is calculated automatically';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_po_advance_aggregate() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER trg_guard_po_advance_aggregate BEFORE INSERT OR UPDATE OF advance_received_amount
 ON public.pos FOR EACH ROW EXECUTE FUNCTION public.guard_po_advance_aggregate();

COMMENT ON TABLE public.po_advance_payments IS 'Actual PO advance receipts. Null dates represent only migrated legacy amounts and are excluded from dated-period totals.';
COMMENT ON COLUMN public.pos.advance_received_amount IS 'Aggregate of po_advance_payments; use the dated advance ledger to add, edit or delete receipts.';

-- Link edits/merges park invoices on temporary PO rows. Actual receipts remain
-- attached to the original PO; do not copy its advance aggregate to parking POs.
DO $compat$
DECLARE signature text; source text; pattern text; replacement text;
BEGIN
 FOR signature,pattern,replacement IN
  SELECT * FROM (VALUES
   ('public.update_purchase_order(bigint,jsonb)',
    'old_po.advance_payment_percentage,old_po.advance_received_amount,old_po.retention_basis) RETURNING id INTO parking_id',
    'old_po.advance_payment_percentage,0,old_po.retention_basis) RETURNING id INTO parking_id'),
   ('public.merge_business_entity(text,bigint,bigint,boolean,text)',
    'po_record.advance_payment_percentage,po_record.advance_received_amount,po_record.retention_basis) RETURNING id INTO parking_id',
    'po_record.advance_payment_percentage,0,po_record.retention_basis) RETURNING id INTO parking_id')
  ) AS changes(signature,pattern,replacement)
 LOOP
  source:=pg_get_functiondef(signature::regprocedure);
  IF position(pattern IN source)=0 THEN RAISE EXCEPTION 'Advance compatibility review required for %',signature;END IF;
  EXECUTE replace(source,pattern,replacement);
 END LOOP;
END $compat$;
