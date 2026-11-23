CREATE OR REPLACE FUNCTION public.canonical_invoice_status(p_status text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE lower(btrim(p_status)) WHEN '3-approved' THEN 'Approved' WHEN 'partially paid' THEN 'Approved' WHEN 'paid' THEN 'Completed' WHEN 'approved' THEN 'Approved' WHEN 'completed' THEN 'Completed' WHEN 'retention' THEN 'Retention' WHEN 'bad debit' THEN 'Bad Debit' ELSE p_status END
$$;

CREATE OR REPLACE FUNCTION public.normalize_invoice_workflow_status() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
 IF lower(coalesce(v_status,'')) NOT IN('cancelled','canceled','void','bad debit') AND (v_status IN('Approved','Completed','Retention') OR v_paid>.005 OR v_released>.005) THEN
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
REVOKE ALL ON FUNCTION public.canonical_invoice_status(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.normalize_invoice_workflow_status() FROM PUBLIC,anon,authenticated;
