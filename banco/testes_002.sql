-- Testes do ID de cada conta (002_ids.sql). Rode no editor de SQL do Supabase depois da migração.
-- Cria usuários simulados, age como cada um e desfaz tudo no fim: o resultado aparece como mensagem de erro,
-- "RESULTADO: tudo certo (nada foi gravado)" ou a primeira FALHA.

do $$
declare
  dono uuid := gen_random_uuid();
  ana uuid := gen_random_uuid();
  bia uuid := gen_random_uuid();
  carla uuid := gen_random_uuid();
  estranho uuid := gen_random_uuid();
  id_bia text;
  id_carla text;
  id_estranho text;
  outro text;
  nome_entrou text;
  n integer;
  negou boolean;
begin
  insert into auth.users (id, email, aud, role)
  select u, 'teste-' || left(u::text, 8) || '@exilados.invalid', 'authenticated', 'authenticated'
  from unnest(array[dono, ana, bia, carla, estranho]) u;
  insert into public.exilados_membros (user_id, nome, papel) values (dono, 'Dono teste', 'dono'), (ana, 'Ana', 'membro');
  insert into public.exilados_membros (user_id, nome, papel, ativo) values (carla, 'Carla', 'membro', false);
  set local role authenticated;

  -- ---------------------------------------------------------------- quem ainda não é do grupo pega o próprio ID
  perform set_config('request.jwt.claims', json_build_object('sub', bia, 'role', 'authenticated')::text, true);
  id_bia := public.exilados_meu_id();
  if id_bia !~ '^[1-9][0-9]{8}$' then raise exception 'FALHA: ID fora do formato: %', id_bia; end if;
  if public.exilados_meu_id('  Bia   Souza ') <> id_bia then raise exception 'FALHA: o ID mudou na segunda chamada'; end if;
  select count(*) into n from public.exilados_ids where user_id = bia and nome = 'Bia Souza';
  if n <> 1 then raise exception 'FALHA: a Bia não vê o próprio ID com o nome escolhido'; end if;
  negou := false;
  begin
    perform public.exilados_meu_id(repeat('x', 33));
  exception when others then negou := true;
  end;
  if not negou then raise exception 'FALHA: aceitou nome com 33 caracteres'; end if;
  negou := false;
  begin
    perform public.exilados_adicionar_por_id(id_bia);
  exception when others then negou := true;
  end;
  if not negou then raise exception 'FALHA: quem não é do grupo adicionou alguém'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', estranho, 'role', 'authenticated')::text, true);
  id_estranho := public.exilados_meu_id();
  select count(*) into n from public.exilados_ids where user_id = bia;
  if n <> 0 then raise exception 'FALHA: conta de fora vê o ID de outra conta de fora'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', carla, 'role', 'authenticated')::text, true);
  id_carla := public.exilados_meu_id();

  -- ---------------------------------------------------------------- um membro adiciona pelo ID
  perform set_config('request.jwt.claims', json_build_object('sub', ana, 'role', 'authenticated')::text, true);
  select count(*) into n from public.exilados_ids where user_id in (bia, estranho);
  if n <> 0 then raise exception 'FALHA: membro vê o ID de quem não é do grupo'; end if;
  negou := false;
  begin
    perform public.exilados_adicionar_por_id('12345');
  exception when others then negou := true;
  end;
  if not negou then raise exception 'FALHA: aceitou ID com 5 dígitos'; end if;
  negou := false;
  begin
    -- Um número que ninguém tem (tenta alguns até achar um livre).
    loop
      outro := (100000000 + floor(random() * 900000000))::bigint::text;
      exit when not exists (select 1 from public.exilados_ids i where i.codigo = outro);
    end loop;
    perform public.exilados_adicionar_por_id(outro);
  exception when others then negou := true;
  end;
  if not negou then raise exception 'FALHA: adicionou um ID que não existe'; end if;

  nome_entrou := public.exilados_adicionar_por_id(substr(id_bia, 1, 3) || ' ' || substr(id_bia, 4, 3) || ' ' || substr(id_bia, 7, 3));
  if nome_entrou <> 'Bia Souza' then raise exception 'FALHA: entrou com o nome %', nome_entrou; end if;
  select count(*) into n from public.exilados_membros where user_id = bia and ativo and papel = 'membro' and nome = 'Bia Souza';
  if n <> 1 then raise exception 'FALHA: a Bia não virou membro'; end if;
  select count(*) into n from public.exilados_ids where user_id = bia;
  if n <> 1 then raise exception 'FALHA: membro não vê o ID de outro membro'; end if;
  negou := false;
  begin
    perform public.exilados_adicionar_por_id(id_bia);
  exception when others then negou := true;
  end;
  if not negou then raise exception 'FALHA: adicionou de novo quem já é do grupo'; end if;

  -- Quem foi removido pelo dono só volta pelas mãos do dono.
  negou := false;
  begin
    perform public.exilados_adicionar_por_id(id_carla);
  exception when others then negou := true;
  end;
  if not negou then raise exception 'FALHA: membro comum readmitiu quem o dono removeu'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', dono, 'role', 'authenticated')::text, true);
  nome_entrou := public.exilados_adicionar_por_id(id_carla);
  select count(*) into n from public.exilados_membros where user_id = carla and ativo and nome = 'Carla';
  if n <> 1 or nome_entrou <> 'Carla' then raise exception 'FALHA: o dono não readmitiu pelo ID'; end if;

  -- Sem nome escolhido, entra com o começo do e-mail.
  nome_entrou := public.exilados_adicionar_por_id(id_estranho);
  if nome_entrou <> 'teste-' || left(estranho::text, 8) then raise exception 'FALHA: nome padrão %', nome_entrou; end if;

  -- Ninguém escreve direto na tabela de IDs.
  perform set_config('request.jwt.claims', json_build_object('sub', bia, 'role', 'authenticated')::text, true);
  negou := false;
  begin
    update public.exilados_ids set codigo = '111111111' where user_id = bia;
    get diagnostics n = row_count;
    if n = 0 then negou := true; end if;
  exception when others then negou := true;
  end;
  if not negou then raise exception 'FALHA: a Bia trocou o próprio ID'; end if;

  raise exception 'RESULTADO: tudo certo (nada foi gravado)';
end $$;
