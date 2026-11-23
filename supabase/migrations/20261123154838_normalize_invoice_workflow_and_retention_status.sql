SET LOCAL lock_timeout='3s';
SELECT pg_advisory_xact_lock(hashtextextended('system_admin_scope_changes',0));
LOCK TABLE public.invoice_collections,public.invoices,public.pos IN SHARE ROW EXCLUSIVE MODE;
-- Canonical invoice workflow names. Payment status remains a separate field.
CREATE FUNCTION public.canonical_invoice_status(p_status text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE lower(btrim(p_status)) WHEN '3-approved' THEN 'Approved' WHEN 'partially paid' THEN 'Approved' WHEN 'paid' THEN 'Completed' WHEN 'approved' THEN 'Approved' WHEN 'completed' THEN 'Completed' WHEN 'retention' THEN 'Retention' ELSE p_status END
$$;
REVOKE ALL ON FUNCTION public.canonical_invoice_status(text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.normalize_invoice_workflow_status() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_status text; v_vat boolean; v_net numeric; v_gross numeric; v_paid numeric; v_retention numeric; v_released numeric; v_cash_balance numeric; v_held numeric; v_total_remaining numeric; v_payment_changed boolean;
BEGIN
 v_status:=public.canonical_invoice_status(NEW.status);
 SELECT p.vat INTO v_vat FROM public.pos p WHERE p.id=NEW.pos_id;
 IF NOT FOUND THEN SELECT p.vat INTO v_vat FROM public.pos p WHERE p.po_no=NEW.po_no;END IF;
 v_net:=greatest(coalesce(NEW.invoice_amount,0)-coalesce(NEW.advance_amortisation,0),0);
 v_gross:=v_net+CASE WHEN coalesce(v_vat,false) THEN round(v_net*.15,2) ELSE 0 END;
 v_paid:=coalesce(NEW.paid_amount,0);v_retention:=coalesce(NEW.retention_amount,0)+coalesce(NEW.retention_vat,0);v_released:=coalesce(NEW.retention_released_amount,0);
 v_cash_balance:=greatest(v_gross-v_retention-v_paid,0);
 v_total_remaining:=greatest(v_gross-v_paid-v_released,0);
 v_held:=least(greatest(v_retention-v_released,0),v_total_remaining);
 IF TG_OP='INSERT' THEN v_payment_changed:=v_paid<>0 OR v_released<>0;
 ELSE v_payment_changed:=NEW.paid_amount IS DISTINCT FROM OLD.paid_amount OR NEW.retention_released_amount IS DISTINCT FROM OLD.retention_released_amount;END IF;
 IF lower(coalesce(v_status,'')) NOT IN('cancelled','canceled','void') AND (v_status IN('Approved','Completed','Retention') OR v_paid>.005 OR v_released>.005) THEN
  IF v_gross>0 AND v_cash_balance<=.005 AND v_held>.005 THEN v_status:='Retention';
  ELSIF v_status='Retention' THEN v_status:=CASE WHEN v_gross>0 AND v_total_remaining<=.005 THEN 'Completed' ELSE 'Approved' END;
  ELSIF v_payment_changed AND v_gross>0 THEN
   IF v_total_remaining<=.005 AND v_held<=.005 THEN v_status:='Completed';
   ELSIF v_status='Completed' THEN v_status:='Approved';END IF;
  END IF;
 END IF;
 NEW.status:=v_status;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.normalize_invoice_workflow_status() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER trg_zz_normalize_invoice_workflow BEFORE INSERT OR UPDATE OF status,invoice_amount,paid_amount,retention_amount,retention_vat,retention_released_amount,advance_amortisation,po_no,project_id,pos_id ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.normalize_invoice_workflow_status();

-- Change only the requested legacy labels; preserve every other invoice field.
CREATE OR REPLACE VIEW public.invoice_details_with_retention WITH(security_invoker=true) AS
 SELECT id,
    invoice_no,
    status,
    po_no,
    description,
    start_date,
    completed_date,
    invoice_amount,
    erp,
    paid_amount,
    approval_date,
    payment_terms,
    company,
    department,
    due_date,
        CASE
            WHEN upper(TRIM(BOTH FROM status)) = 'RETENTION'::text THEN 0::numeric
            ELSE open_balance
        END AS open_balance,
    project_id,
    project_name,
    vat_applicable,
    vat_amount,
    invoice_total,
    payment_status,
    retention_amount,
    retention_vat,
    retention_due_date,
    retention_released_amount,
    retention_total,
    net_payable,
        LEAST(retention_balance, GREATEST(COALESCE(invoice_total_after_advance,0)-COALESCE(paid_amount,0)-COALESCE(retention_released_amount,0),0))::numeric(18,2) AS retention_balance,
    advance_payment_percentage,
    advance_amount,
    advance_amortisation,
    net_invoice_amount,
    vat_after_advance,
    invoice_total_after_advance,
        CASE
            WHEN upper(TRIM(BOTH FROM status)) = 'RETENTION'::text THEN 0::numeric
            ELSE collection_balance_after_advance
        END::numeric(18,2) AS collection_balance_after_advance,
    net_payable_after_advance,
    payment_status_after_advance
   FROM ( SELECT d.id,
            d.invoice_no,
            d.status,
            d.po_no,
            d.description,
            d.start_date,
            d.completed_date,
            d.invoice_amount,
            d.erp,
            d.paid_amount,
            d.approval_date,
            d.payment_terms,
            d.company,
            d.department,
            d.due_date,
            d.open_balance,
            d.project_id,
            d.project_name,
            d.vat_applicable,
            d.vat_amount,
            d.invoice_total,
            d.payment_status,
            COALESCE(i.retention_amount, 0::numeric)::numeric(18,2) AS retention_amount,
            COALESCE(i.retention_vat, 0::numeric)::numeric(18,2) AS retention_vat,
            i.retention_due_date,
            COALESCE(i.retention_released_amount, 0::numeric)::numeric(18,2) AS retention_released_amount,
            (COALESCE(i.retention_amount, 0::numeric) + COALESCE(i.retention_vat, 0::numeric))::numeric(18,2) AS retention_total,
            GREATEST(COALESCE(d.invoice_total, 0::numeric) - COALESCE(i.retention_amount, 0::numeric) - COALESCE(i.retention_vat, 0::numeric), 0::numeric)::numeric(18,2) AS net_payable,
            GREATEST(COALESCE(i.retention_amount, 0::numeric) + COALESCE(i.retention_vat, 0::numeric) - COALESCE(i.retention_released_amount, 0::numeric), 0::numeric)::numeric(18,2) AS retention_balance,
            COALESCE(p.advance_payment_percentage, 0::numeric)::numeric(7,4) AS advance_payment_percentage,
            (COALESCE(p.po_value_ex_vat, 0::numeric) * COALESCE(p.advance_payment_percentage, 0::numeric) / 100::numeric)::numeric(18,2) AS advance_amount,
            COALESCE(i.advance_amortisation, 0::numeric)::numeric(18,2) AS advance_amortisation,
            GREATEST(COALESCE(d.invoice_amount, 0::numeric) - COALESCE(i.advance_amortisation, 0::numeric), 0::numeric)::numeric(18,2) AS net_invoice_amount,
                CASE
                    WHEN COALESCE(p.vat, false) THEN GREATEST(COALESCE(d.invoice_amount, 0::numeric) - COALESCE(i.advance_amortisation, 0::numeric), 0::numeric) * 0.15
                    ELSE 0::numeric
                END::numeric(18,2) AS vat_after_advance,
            (GREATEST(COALESCE(d.invoice_amount, 0::numeric) - COALESCE(i.advance_amortisation, 0::numeric), 0::numeric) +
                CASE
                    WHEN COALESCE(p.vat, false) THEN GREATEST(COALESCE(d.invoice_amount, 0::numeric) - COALESCE(i.advance_amortisation, 0::numeric), 0::numeric) * 0.15
                    ELSE 0::numeric
                END)::numeric(18,2) AS invoice_total_after_advance,
            GREATEST(GREATEST(COALESCE(d.invoice_amount, 0::numeric) - COALESCE(i.advance_amortisation, 0::numeric), 0::numeric) +
                CASE
                    WHEN COALESCE(p.vat, false) THEN GREATEST(COALESCE(d.invoice_amount, 0::numeric) - COALESCE(i.advance_amortisation, 0::numeric), 0::numeric) * 0.15
                    ELSE 0::numeric
                END - COALESCE(i.paid_amount, 0::numeric), 0::numeric)::numeric(18,2) AS collection_balance_after_advance,
            GREATEST(GREATEST(COALESCE(d.invoice_amount, 0::numeric) - COALESCE(i.advance_amortisation, 0::numeric), 0::numeric) +
                CASE
                    WHEN COALESCE(p.vat, false) THEN GREATEST(COALESCE(d.invoice_amount, 0::numeric) - COALESCE(i.advance_amortisation, 0::numeric), 0::numeric) * 0.15
                    ELSE 0::numeric
                END - COALESCE(i.retention_amount, 0::numeric) - COALESCE(i.retention_vat, 0::numeric), 0::numeric)::numeric(18,2) AS net_payable_after_advance,
                CASE
                    WHEN COALESCE(i.paid_amount, 0::numeric) >= (GREATEST(COALESCE(d.invoice_amount, 0::numeric) - COALESCE(i.advance_amortisation, 0::numeric), 0::numeric) +
                    CASE
                        WHEN COALESCE(p.vat, false) THEN GREATEST(COALESCE(d.invoice_amount, 0::numeric) - COALESCE(i.advance_amortisation, 0::numeric), 0::numeric) * 0.15
                        ELSE 0::numeric
                    END - 0.005) THEN 'Paid'::text
                    WHEN COALESCE(i.paid_amount, 0::numeric) > 0::numeric THEN 'Partially Paid'::text
                    ELSE 'Unpaid'::text
                END AS payment_status_after_advance
           FROM invoice_details d
             JOIN invoices i ON i.id = d.id
             LEFT JOIN pos p ON p.po_no = d.po_no) v;
CREATE TEMP TABLE invoice_status_before ON COMMIT DROP AS SELECT id,to_jsonb(i)-'status' value FROM public.invoices i;
UPDATE public.invoices SET status=public.canonical_invoice_status(status) WHERE lower(btrim(status)) IN('3-approved','paid','partially paid');
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.invoices i JOIN invoice_status_before b USING(id) WHERE to_jsonb(i)-'status' IS DISTINCT FROM b.value) THEN RAISE EXCEPTION 'Unexpected invoice data change during status normalization';END IF;END $$;
NOTIFY pgrst,'reload schema';

