-- Testes das regras de acesso do Exilados. Rode no editor de SQL do Supabase depois de 001_exilados.sql.
-- Cria usuários simulados, age como cada um e confere o que pode e o que não pode. No fim, tudo é desfeito:
-- o resultado aparece como mensagem de erro, "RESULTADO: tudo certo (nada foi gravado)" ou a primeira FALHA.

do $$
declare
  dono uuid := gen_random_uuid();
  ana uuid := gen_random_uuid();
  bia uuid := gen_random_uuid();
  estranho uuid := gen_random_uuid();
  texto_id uuid;
  voz_id uuid;
  convite text;
  convite_da_ana text;
  conversa uuid;
  n integer;
  negou boolean;
  papel_atual text;
begin
  insert into auth.users (id, email, aud, role)
  select u, 'teste-' || u || '@exilados.invalid', 'authenticated', 'authenticated' from unnest(array[dono, ana, bia, estranho]) u;
  insert into public.exilados_membros (user_id, nome, papel) values (dono, 'Dono teste', 'dono');
  insert into public.exilados_salas (nome, tipo, ordem) values ('teste-texto', 'texto', 900) returning id into texto_id;
  insert into public.exilados_salas (nome, tipo, ordem) values ('teste-voz', 'voz', 901) returning id into voz_id;

  -- ---------------------------------------------------------------- quem não é membro
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', estranho, 'role', 'authenticated')::text, true);
  select count(*) into n from public.exilados_salas;
  if n <> 0 then raise exception 'FALHA: conta de fora do grupo vê % salas', n; end if;
  select count(*) into n from public.exilados_membros;
  if n <> 0 then raise exception 'FALHA: conta de fora do grupo vê % membros', n; end if;
  negou := false;
  begin
    insert into public.exilados_mensagens (sala_id, autor, texto) values (texto_id, estranho, 'oi');
  exception when others then negou := true;
  end;
  if not negou then raise exception 'FALHA: conta de fora do grupo mandou mensagem'; end if;
  negou := false;
  begin
    perform public.exilados_criar_convite();
  exception when others then negou := true;
  end;
  if not negou then raise exception 'FALHA: conta de fora do grupo gerou convite'; end if;

  -- ---------------------------------------------------------------- convite
  perform set_config('request.jwt.claims', json_build_object('sub', dono, 'role', 'authenticated')::text, true);
  convite := public.exilados_criar_convite();
  if char_length(convite) <> 64 then raise exception 'FALHA: convite com % caracteres', char_length(convite); end if;
  select count(*) into n from public.exilados_info_convite(convite) where valido and convidado_por = 'Dono teste';
  if n <> 1 then raise exception 'FALHA: informação do convite não confere'; end if;
  select count(*) into n from public.exilados_info_convite('codigo-errado') where valido;
  if n <> 0 then raise exception 'FALHA: código errado aparece como válido'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', ana, 'role', 'authenticated')::text, true);
  negou := false;
  begin
    perform public.exilados_entrar('codigo-errado', 'Ana');
  exception when others then negou := true;
  end;
  if not negou then raise exception 'FALHA: entrou com código errado'; end if;
  negou := false;
  begin
    perform public.exilados_entrar(convite, '   ');
  exception when others then negou := true;
  end;
  if not negou then raise exception 'FALHA: entrou com nome vazio'; end if;
  perform public.exilados_entrar(convite, '  Ana  ');
  perform public.exilados_entrar(convite, 'Ana de novo');
  select count(*) into n from public.exilados_membros where user_id = ana and nome = 'Ana' and papel = 'membro' and ativo;
  if n <> 1 then raise exception 'FALHA: Ana não entrou certo (ou o segundo uso mudou o nome)'; end if;
  select count(*) into n from public.exilados_salas where id in (texto_id, voz_id);
  if n <> 2 then raise exception 'FALHA: membro não vê as salas'; end if;
  convite_da_ana := public.exilados_criar_convite();

  perform set_config('request.jwt.claims', json_build_object('sub', bia, 'role', 'authenticated')::text, true);
  perform public.exilados_entrar(convite, 'Bia');

  -- o dono usando o próprio convite continua dono
  perform set_config('request.jwt.claims', json_build_object('sub', dono, 'role', 'authenticated')::text, true);
  perform public.exilados_entrar(convite, 'Outro nome');
  select papel into papel_atual from public.exilados_membros where user_id = dono;
  if papel_atual <> 'dono' then raise exception 'FALHA: o convite rebaixou o dono'; end if;

  -- ---------------------------------------------------------------- mensagens nas salas
  perform set_config('request.jwt.claims', json_build_object('sub', ana, 'role', 'authenticated')::text, true);
  insert into public.exilados_mensagens (sala_id, autor, texto) values (texto_id, ana, 'oi, gente');
  insert into public.exilados_mensagens (sala_id, autor, imagem) values (texto_id, ana, ana || '/foto.webp');
  negou := false;
  begin
    insert into public.exilados_mensagens (sala_id, autor, texto) values (texto_id, ana, '   ');
  exception when others then negou := true;
  end;
  if not negou then raise exception 'FALHA: aceitou mensagem vazia'; end if;
  negou := false;
  begin
    insert into public.exilados_mensagens (sala_id, autor, texto) values (texto_id, dono, 'falsa');
  exception when others then negou := true;
  end;
  if not negou then raise exception 'FALHA: mandou mensagem em nome de outro'; end if;
  negou := false;
  begin
    insert into public.exilados_mensagens (sala_id, autor, texto) values (voz_id, ana, 'na sala de voz');
  exception when others then negou := true;
  end;
  if not negou then raise exception 'FALHA: aceitou mensagem numa sala de voz'; end if;
  negou := false;
  begin
    insert into public.exilados_mensagens (sala_id, autor, imagem) values (texto_id, ana, bia || '/alheia.webp');
  exception when others then negou := true;
  end;
  if not negou then raise exception 'FALHA: aceitou imagem da pasta de outra pessoa'; end if;
  select count(*) into n from public.exilados_mensagens where sala_id = texto_id;
  if n <> 2 then raise exception 'FALHA: Ana vê % mensagens da sala (esperava 2)', n; end if;

  -- ---------------------------------------------------------------- só o dono mexe em salas e membros
  negou := false;
  begin
    insert into public.exilados_salas (nome, tipo) values ('da ana', 'texto');
  exception when others then negou := true;
  end;
  if not negou then raise exception 'FALHA: membro criou sala'; end if;
  negou := false;
  begin
    update public.exilados_membros set papel = 'dono' where user_id = ana;
  exception when others then negou := true;
  end;
  if not negou then raise exception 'FALHA: membro mudou o próprio papel'; end if;
  update public.exilados_membros set nome = 'Ana Clara' where user_id = ana;
  update public.exilados_membros set nome = 'Hackeado' where user_id = bia;
  select count(*) into n from public.exilados_membros where nome = 'Hackeado';
  if n <> 0 then raise exception 'FALHA: membro mudou o nome de outro'; end if;
  negou := false;
  begin
    perform public.exilados_definir_ativo(bia, false);
  exception when others then negou := true;
  end;
  if not negou then raise exception 'FALHA: membro removeu outro membro'; end if;

  -- ---------------------------------------------------------------- amizade e mensagem direta
  insert into public.exilados_amizades (de, para) values (ana, bia);
  negou := false;
  begin
    insert into public.exilados_amizades (de, para, estado) values (ana, dono, 'aceita');
  exception when others then negou := true;
  end;
  if not negou then raise exception 'FALHA: amizade criada já aceita'; end if;
  update public.exilados_amizades set estado = 'aceita' where de = ana and para = bia;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALHA: quem pediu aceitou o próprio pedido'; end if;
  negou := false;
  begin
    perform public.exilados_abrir_conversa(bia);
  exception when others then negou := true;
  end;
  if not negou then raise exception 'FALHA: conversa direta antes de a amizade ser aceita'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', bia, 'role', 'authenticated')::text, true);
  update public.exilados_amizades set estado = 'aceita' where de = ana and para = bia;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FALHA: Bia não conseguiu aceitar'; end if;
  conversa := public.exilados_abrir_conversa(ana);
  insert into public.exilados_mensagens (conversa_id, autor, texto) values (conversa, bia, 'segredo');

  perform set_config('request.jwt.claims', json_build_object('sub', dono, 'role', 'authenticated')::text, true);
  select count(*) into n from public.exilados_mensagens where conversa_id = conversa;
  if n <> 0 then raise exception 'FALHA: o dono lê a conversa direta de outros'; end if;
  negou := false;
  begin
    insert into public.exilados_mensagens (conversa_id, autor, texto) values (conversa, dono, 'intruso');
  exception when others then negou := true;
  end;
  if not negou then raise exception 'FALHA: o dono escreveu na conversa direta de outros'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', ana, 'role', 'authenticated')::text, true);
  if public.exilados_abrir_conversa(bia) <> conversa then raise exception 'FALHA: abriu uma segunda conversa'; end if;
  select count(*) into n from public.exilados_mensagens where conversa_id = conversa;
  if n <> 1 then raise exception 'FALHA: Ana não lê a conversa com a amiga'; end if;

  -- desfeita a amizade, a conversa fecha para os dois
  delete from public.exilados_amizades where (de = ana and para = bia);
  select count(*) into n from public.exilados_mensagens where conversa_id = conversa;
  if n <> 0 then raise exception 'FALHA: conversa continua aberta depois de desfazer a amizade'; end if;
  negou := false;
  begin
    insert into public.exilados_mensagens (conversa_id, autor, texto) values (conversa, ana, 'ainda?');
  exception when others then negou := true;
  end;
  if not negou then raise exception 'FALHA: escreveu depois de desfazer a amizade'; end if;

  -- ---------------------------------------------------------------- lives
  insert into public.exilados_lives (user_id, caminho) values (ana, 'ex/abcdefghijklmnopqrstuvwx');
  negou := false;
  begin
    insert into public.exilados_lives (user_id, caminho) values (bia, 'ex/ABCDEFGHIJKLMNOPQRSTUVWX');
  exception when others then negou := true;
  end;
  if not negou then raise exception 'FALHA: gravou a live de outra pessoa'; end if;
  negou := false;
  begin
    update public.exilados_lives set caminho = 'ao/abcdefghijklmnopqrstuvwx' where user_id = ana;
  exception when others then negou := true;
  end;
  if not negou then raise exception 'FALHA: aceitou caminho de live fora do padrão'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', estranho, 'role', 'authenticated')::text, true);
  select count(*) into n from public.exilados_lives;
  if n <> 0 then raise exception 'FALHA: conta de fora do grupo vê lives'; end if;

  -- ---------------------------------------------------------------- remoção pelo dono
  perform set_config('request.jwt.claims', json_build_object('sub', dono, 'role', 'authenticated')::text, true);
  negou := false;
  begin
    perform public.exilados_definir_ativo(dono, false);
  exception when others then negou := true;
  end;
  if not negou then raise exception 'FALHA: o dono removeu a si mesmo'; end if;
  perform public.exilados_definir_ativo(ana, false);

  perform set_config('request.jwt.claims', json_build_object('sub', ana, 'role', 'authenticated')::text, true);
  select count(*) into n from public.exilados_salas;
  if n <> 0 then raise exception 'FALHA: membro removido ainda vê salas'; end if;
  select count(*) into n from public.exilados_membros where user_id = ana and not ativo;
  if n <> 1 then raise exception 'FALHA: membro removido não vê a própria situação'; end if;
  negou := false;
  begin
    insert into public.exilados_mensagens (sala_id, autor, texto) values (texto_id, ana, 'voltei');
  exception when others then negou := true;
  end;
  if not negou then raise exception 'FALHA: membro removido mandou mensagem'; end if;
  negou := false;
  begin
    perform public.exilados_entrar(convite, 'Ana');
  exception when others then negou := true;
  end;
  if not negou then raise exception 'FALHA: membro removido voltou por convite'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', estranho, 'role', 'authenticated')::text, true);
  negou := false;
  begin
    perform public.exilados_entrar(convite_da_ana, 'Estranho');
  exception when others then negou := true;
  end;
  if not negou then raise exception 'FALHA: convite de membro removido ainda vale'; end if;

  -- ---------------------------------------------------------------- limite de 30 membros
  reset role;
  insert into auth.users (id, email, aud, role)
  select g, 'teste-' || g || '@exilados.invalid', 'authenticated', 'authenticated'
  from (select gen_random_uuid() g from generate_series(1, 40)) x;
  select count(*) into n from public.exilados_membros where ativo;
  insert into public.exilados_membros (user_id, nome)
  select id, 'Extra' from auth.users where email like 'teste-%@exilados.invalid'
    and id not in (select user_id from public.exilados_membros) and id <> estranho
  limit greatest(0, 30 - n);
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', estranho, 'role', 'authenticated')::text, true);
  negou := false;
  begin
    perform public.exilados_entrar(convite, 'Estranho');
  exception when others then negou := true;
  end;
  if not negou then raise exception 'FALHA: entrou com o grupo cheio'; end if;

  reset role;
  raise exception 'RESULTADO: tudo certo (nada foi gravado)';
end;
$$;
