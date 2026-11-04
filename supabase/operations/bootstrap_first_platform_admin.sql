-- BOOTSTRAP INICIAL DO SUPERADMINISTRADOR GLOBAL
-- Executar uma única vez no SQL Editor do Supabase SMS2, somente depois que
-- a pessoa autorizada criar e confirmar sua própria conta pela tela /cadastro.
-- Substitua apenas o e-mail abaixo. Nunca inclua senha, JWT ou service_role.
-- O script falha se o e-mail não existir, o perfil não existir ou já houver
-- qualquer registro em platform_admins. A operação gera evento de auditoria.

DO $bootstrap$
DECLARE
  v_email text := pg_catalog.lower(pg_catalog.btrim('SUBSTITUA_PELO_EMAIL_DA_CONTA_CRIADA'));
  v_user_id uuid;
  v_matches integer;
BEGIN
  IF v_email = ''
     OR v_email = 'substitua_pelo_email_da_conta_criada' THEN
    RAISE EXCEPTION 'Informe o e-mail exato da conta Auth criada antes de executar.';
  END IF;

  SELECT pg_catalog.count(*)
    INTO v_matches
  FROM auth.users u
  WHERE pg_catalog.lower(u.email) = v_email
    AND u.deleted_at IS NULL;

  IF v_matches <> 1 THEN
    RAISE EXCEPTION 'Esperada exatamente uma conta Auth ativa para o e-mail informado; encontradas: %.', v_matches;
  END IF;

  SELECT u.id
    INTO v_user_id
  FROM auth.users u
  WHERE pg_catalog.lower(u.email) = v_email
    AND u.deleted_at IS NULL;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = v_user_id
  ) THEN
    RAISE EXCEPTION 'O perfil ainda não existe. Verifique o trigger trg_auth_user_profile antes do bootstrap.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.platform_admins) THEN
    RAISE EXCEPTION 'Bootstrap interrompido: já existe um registro em platform_admins. Não crie outro superadministrador automaticamente.';
  END IF;

  INSERT INTO public.platform_admins (user_id, is_active, granted_by)
  VALUES (v_user_id, true, v_user_id);

  RAISE NOTICE 'Superadministrador global inicial cadastrado para % (UUID: %).', v_email, v_user_id;
END
$bootstrap$;
