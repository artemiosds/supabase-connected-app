BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';
CREATE OR REPLACE FUNCTION public.fn_guard_procurement_quote_source_metadata()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP='UPDATE' AND ROW(
      NEW.source_type,NEW.reference_identifier,NEW.accessed_at,NEW.source_tax_id,
      NEW.source_contact_name,NEW.source_contact_email,NEW.source_contact_phone,NEW.source_address,
      NEW.supplier_selection_justification,NEW.supplier_consultation_sent_at,
      NEW.evidence_storage_path,NEW.evidence_file_name,NEW.evidence_mime_type,NEW.evidence_file_size,
      NEW.supplier_consultation_response_deadline
    ) IS NOT DISTINCT FROM ROW(
      OLD.source_type,OLD.reference_identifier,OLD.accessed_at,OLD.source_tax_id,
      OLD.source_contact_name,OLD.source_contact_email,OLD.source_contact_phone,OLD.source_address,
      OLD.supplier_selection_justification,OLD.supplier_consultation_sent_at,
      OLD.evidence_storage_path,OLD.evidence_file_name,OLD.evidence_mime_type,OLD.evidence_file_size,
      OLD.supplier_consultation_response_deadline
    ) THEN
    RETURN NEW;
  END IF;

  IF NEW.source_type IN ('painel_precos','contratacoes_publicas','midia_especializada','site_especializado','banco_precos_saude')
    AND NEW.accessed_at IS NULL THEN
    RAISE EXCEPTION 'Registre a data e hora de acesso da fonte consultada.';
  END IF;

  IF NEW.source_type='fornecedor' AND length(btrim(COALESCE(NEW.supplier_selection_justification,'')))<10 THEN
    RAISE EXCEPTION 'A cotação direta exige justificativa da escolha do fornecedor (mínimo de 10 caracteres).';
  END IF;
  IF NEW.source_type='fornecedor' AND (
    NEW.supplier_consultation_sent_at IS NULL
    OR NEW.supplier_consultation_response_deadline IS NULL
    OR NEW.supplier_consultation_response_deadline<NEW.supplier_consultation_sent_at
  ) THEN
    RAISE EXCEPTION 'A cotação direta exige data de envio da solicitação e prazo de resposta compatível.';
  END IF;
  IF NEW.source_type='fornecedor' AND (
    NULLIF(btrim(NEW.source_tax_id),'') IS NULL
    OR NULLIF(btrim(NEW.source_contact_name),'') IS NULL
    OR NULLIF(btrim(NEW.source_contact_email),'') IS NULL
    OR NULLIF(btrim(NEW.source_contact_phone),'') IS NULL
    OR NULLIF(btrim(NEW.source_address),'') IS NULL
  ) THEN
    RAISE EXCEPTION 'A proposta formal exige CPF/CNPJ, responsável, e-mail, telefone e endereço do fornecedor.';
  END IF;

  IF NEW.evidence_storage_path IS NOT NULL AND (
    split_part(NEW.evidence_storage_path,'/',1) IS DISTINCT FROM NEW.tenant_id::text
    OR split_part(NEW.evidence_storage_path,'/',2) IS DISTINCT FROM 'procurement-quotes'
    OR split_part(NEW.evidence_storage_path,'/',3) IS DISTINCT FROM NEW.procurement_item_id::text
    OR split_part(NEW.evidence_storage_path,'/',4) IS DISTINCT FROM NEW.id::text
    OR NEW.evidence_storage_path !~* '[.](pdf|doc|docx|xls|xlsx|jpg|jpeg|png)$'
  ) THEN
    RAISE EXCEPTION 'O comprovante precisa estar vinculado à Secretaria, ao item e à cotação corretos.';
  END IF;

  IF NEW.source_type='nota_fiscal_eletronica'
    AND (NULLIF(btrim(NEW.reference_identifier),'') IS NULL OR NEW.accessed_at IS NULL) THEN
    RAISE EXCEPTION 'Informe a identificação da nota fiscal e a data/hora da consulta.';
  END IF;

  IF NEW.source_type='outro' AND NULLIF(btrim(NEW.reference_identifier),'') IS NULL
    AND NULLIF(btrim(NEW.reference_url),'') IS NULL AND NULLIF(btrim(NEW.notes),'') IS NULL THEN
    RAISE EXCEPTION 'Identifique a fonte ou registre observação que permita rastrear a consulta.';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.approve_procurement_item_price(p_tenant_id uuid, p_item_id uuid, p_method text, p_method_justification text, p_exceptional_justification text DEFAULT NULL::text, p_other_unit_price numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid:=(SELECT auth.uid());
  v_item public.procurement_items%ROWTYPE;
  v_count integer; v_average numeric(16,4); v_median numeric(16,4); v_lowest numeric(16,4);
  v_stddev numeric; v_cv numeric; v_price numeric(16,4); v_total numeric(16,2);
  v_values jsonb; v_sources jsonb; v_calc jsonb; v_id uuid;
BEGIN
  IF v_actor IS NULL OR NOT (app_auth.has_tenant_data_permission(p_tenant_id,'procurement:approve_price')
      OR app_auth.has_tenant_data_permission(p_tenant_id,'documents:approve'))
    OR NOT app_auth.is_tenant_in_good_standing(p_tenant_id) OR NOT app_auth.is_tenant_module_enabled(p_tenant_id,'processos') THEN
    RAISE EXCEPTION 'Sem permissão para aprovar o preço estimado nesta Secretaria.' USING ERRCODE='42501';
  END IF;
  IF p_method NOT IN ('media','mediana','menor','outro') THEN RAISE EXCEPTION 'Método estatístico inválido.'; END IF;
  IF p_method_justification IS NULL OR length(btrim(p_method_justification))<10 THEN
    RAISE EXCEPTION 'Justifique a escolha do método estatístico (mínimo de 10 caracteres).';
  END IF;
  IF p_method='outro' AND (p_other_unit_price IS NULL OR p_other_unit_price<0 OR length(btrim(p_method_justification))<20) THEN
    RAISE EXCEPTION 'O método alternativo exige preço válido e justificativa detalhada (mínimo de 20 caracteres).';
  END IF;
  SELECT * INTO v_item FROM public.procurement_items i
  WHERE i.tenant_id=p_tenant_id AND i.id=p_item_id AND i.is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item da pesquisa não encontrado ou inativo.'; END IF;

  SELECT count(*)::integer,avg(q.total_price/NULLIF(q.quantity,0))::numeric(16,4),
    percentile_cont(0.5) WITHIN GROUP (ORDER BY q.total_price/NULLIF(q.quantity,0))::numeric(16,4),
    min(q.total_price/NULLIF(q.quantity,0))::numeric(16,4),stddev_samp(q.total_price/NULLIF(q.quantity,0)),
    jsonb_agg(q.total_price/NULLIF(q.quantity,0) ORDER BY q.total_price/NULLIF(q.quantity,0))
  INTO v_count,v_average,v_median,v_lowest,v_stddev,v_values
  FROM public.procurement_price_quotes q
  WHERE q.tenant_id=p_tenant_id AND q.procurement_item_id=p_item_id AND q.is_active=true AND q.quantity>0 AND q.total_price IS NOT NULL;
  IF EXISTS (
    SELECT 1 FROM public.procurement_price_quotes q
    WHERE q.tenant_id=p_tenant_id AND q.procurement_item_id=p_item_id
      AND q.is_active=true AND q.source_type='fornecedor'
      AND (
        q.evidence_storage_path IS NULL OR q.evidence_file_name IS NULL OR q.evidence_mime_type IS NULL
        OR q.supplier_selection_justification IS NULL
        OR q.supplier_consultation_sent_at IS NULL OR q.supplier_consultation_response_deadline IS NULL
        OR q.source_tax_id IS NULL OR q.source_contact_name IS NULL OR q.source_contact_email IS NULL
        OR q.source_contact_phone IS NULL OR q.source_address IS NULL
        OR split_part(q.evidence_storage_path,'/',1) IS DISTINCT FROM q.tenant_id::text
        OR split_part(q.evidence_storage_path,'/',2) IS DISTINCT FROM 'procurement-quotes'
        OR split_part(q.evidence_storage_path,'/',3) IS DISTINCT FROM q.procurement_item_id::text
        OR split_part(q.evidence_storage_path,'/',4) IS DISTINCT FROM q.id::text
        OR q.evidence_storage_path !~* '[.](pdf|doc|docx|xls|xlsx|jpg|jpeg|png)$'
        OR NOT EXISTS (
          SELECT 1
          FROM storage.objects o
          WHERE o.bucket_id='gfs-private-documents'
            AND o.name=q.evidence_storage_path
            AND o.metadata->>'mimetype'=q.evidence_mime_type
            AND q.evidence_mime_type IN (
              'application/pdf','application/msword',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'application/vnd.ms-excel',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'image/jpeg','image/png'
            )
            AND CASE
              WHEN COALESCE(NULLIF(o.metadata->>'size',''),NULLIF(o.metadata->>'contentLength','')) ~ '^[0-9]+$'
                THEN COALESCE(NULLIF(o.metadata->>'size',''),NULLIF(o.metadata->>'contentLength',''))::bigint BETWEEN 1 AND 20971520
                  AND COALESCE(NULLIF(o.metadata->>'size',''),NULLIF(o.metadata->>'contentLength',''))::bigint=q.evidence_file_size
              ELSE false
            END
        )
      )
  ) THEN
    RAISE EXCEPTION 'Complete os dados da proposta formal e anexe o comprovante de cada cotação direta antes de aprovar o preço.';
  END IF;
  IF v_count=0 THEN RAISE EXCEPTION 'Registre ao menos uma cotação ativa antes de aprovar o preço.'; END IF;
  IF v_count<3 AND (p_exceptional_justification IS NULL OR length(btrim(p_exceptional_justification))<10) THEN
    RAISE EXCEPTION 'Com menos de três preços, informe justificativa excepcional da autoridade competente.';
  END IF;
  v_price:=CASE p_method WHEN 'media' THEN v_average WHEN 'mediana' THEN v_median WHEN 'menor' THEN v_lowest ELSE p_other_unit_price::numeric(16,4) END;
  v_total:=round(v_price*v_item.quantity,2);
  IF v_average>0 AND v_stddev IS NOT NULL THEN v_cv:=(v_stddev/v_average)*100; ELSE v_cv:=NULL; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('quote',to_jsonb(q),'supplier',
    CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object('id',s.id,'legal_name',s.legal_name,'cnpj',s.cnpj,
      'contact_name',s.contact_name,'contact_email',s.contact_email,'contact_phone',s.contact_phone,
      'street',s.street,'street_number',s.street_number,'neighborhood',s.neighborhood,'city',s.city,
      'state',s.state,'postal_code',s.postal_code) END)
    ORDER BY q.quoted_at,q.id),'[]'::jsonb)
  INTO v_sources
  FROM public.procurement_price_quotes q LEFT JOIN public.suppliers s ON s.id=q.supplier_id AND s.tenant_id=q.tenant_id
  WHERE q.tenant_id=p_tenant_id AND q.procurement_item_id=p_item_id;

  v_calc:=jsonb_build_object('method',p_method,'method_justification',btrim(p_method_justification),
    'exceptional_justification',NULLIF(btrim(p_exceptional_justification),''),'sample_count',v_count,
    'effective_unit_prices',COALESCE(v_values,'[]'::jsonb),'average',v_average,'median',v_median,'lowest',v_lowest,
    'sample_standard_deviation',v_stddev,'coefficient_of_variation',v_cv,'approved_unit_price',v_price,
    'quantity',v_item.quantity,'approved_total_price',v_total,
    'formula','Preço efetivo = total cotado com frete ÷ quantidade cotada; total aprovado = preço unitário aprovado × quantidade do item.');

  UPDATE public.procurement_price_approvals SET status='superseded',superseded_at=now()
  WHERE tenant_id=p_tenant_id AND procurement_item_id=p_item_id AND status='approved';
  INSERT INTO public.procurement_price_approvals(tenant_id,process_id,procurement_item_id,method,method_justification,
    exceptional_justification,approved_unit_price,approved_total_price,sample_count,source_snapshot,calculation_snapshot,
    status,approved_by,approved_at)
  VALUES(p_tenant_id,v_item.process_id,p_item_id,p_method,btrim(p_method_justification),
    NULLIF(btrim(p_exceptional_justification),''),v_price,v_total,v_count,v_sources,v_calc,'approved',v_actor,now())
  RETURNING id INTO v_id;

  PERFORM pg_catalog.set_config('app_auth.price_estimate_write','on',true);
  UPDATE public.procurement_items SET estimated_unit_price=v_price,estimated_price_source='approved',updated_by=v_actor
  WHERE tenant_id=p_tenant_id AND id=p_item_id;
  PERFORM pg_catalog.set_config('app_auth.price_estimate_write','',true);
  PERFORM app_auth.recalculate_procurement_process_estimate(p_tenant_id,v_item.process_id,v_actor,true);
  INSERT INTO public.audit_events(tenant_id,actor_id,action,entity,entity_id,details,created_at)
  VALUES(p_tenant_id,v_actor,'procurement.price_estimated.approved','procurement_price_approvals',v_id::text,
    jsonb_build_object('process_id',v_item.process_id,'item_id',p_item_id,'method',p_method,
      'approved_unit_price',v_price,'approved_total_price',v_total,'sample_count',v_count,
      'exceptional_justification',NULLIF(btrim(p_exceptional_justification),'')),now());
  RETURN v_id;
END;
$function$;
COMMIT;
