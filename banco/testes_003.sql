-- Testes da conversa como no Discord (003_conversa.sql). Rode no editor de SQL do Supabase depois da migração.
-- Cria usuários simulados, age como cada um e desfaz tudo no fim: o resultado aparece como mensagem de erro,
-- "RESULTADO: tudo certo (nada foi gravado)" ou a primeira FALHA.

do $$
declare
  dono uuid := gen_random_uuid();
  ana uuid := gen_random_uuid();
  bia uuid := gen_random_uuid();
  sala uuid;
  conversa uuid;
  m_ana bigint;
  m_dono bigint;
  m_bia bigint;
  m_resposta bigint;
  n integer;
  negou boolean;
  quando timestamptz;
  r record;
begin
  insert into auth.users (id, email, aud, role)
  select u, 'teste-' || left(u::text, 8) || '@exilados.invalid', 'authenticated', 'authenticated'
  from unnest(array[dono, ana, bia]) u;
  insert into public.exilados_membros (user_id, nome, papel) values (dono, 'Dono teste', 'dono'), (ana, 'Ana', 'membro'), (bia, 'Bia', 'membro');
  insert into public.exilados_salas (nome, tipo) values ('teste-003', 'texto') returning id into sala;
  insert into public.exilados_amizades (de, para, estado) values (ana, bia, 'aceita');
  set local role authenticated;

  -- ---------------------------------------------------------------- enviar com resposta, menção, arquivo e GIF
  perform set_config('request.jwt.claims', json_build_object('sub', dono, 'role', 'authenticated')::text, true);
  insert into public.exilados_mensagens (sala_id, autor, texto) values (sala, dono, 'oi do dono') returning id into m_dono;

  perform set_config('request.jwt.claims', json_build_object('sub', ana, 'role', 'authenticated')::text, true);
  insert into public.exilados_mensagens (sala_id, autor, texto, responde_a, mencoes)
  values (sala, ana, 'respondendo @Bia', m_dono, array[bia]) returning id into m_ana;
  insert into public.exilados_mensagens (sala_id, autor, texto, arquivo)
  values (sala, ana, '', jsonb_build_object('caminho', ana::text || '/a.mp4', 'nome', 'jogada.mp4', 'tipo', 'video/mp4', 'tamanho', '1234'));
  insert into public.exilados_mensagens (sala_id, autor, texto, gif)
  values (sala, ana, '', jsonb_build_object('url', 'https://media1.giphy.com/media/abc/giphy.webp', 'largura', 200, 'altura', 150));

  negou := false;
  begin
    insert into public.exilados_mensagens (sala_id, autor, texto, arquivo)
    values (sala, ana, '', jsonb_build_object('caminho', bia::text || '/b.zip', 'nome', 'b.zip', 'tamanho', '10'));
  exception when others then negou := true;
  end;
  if not negou then raise exception 'FALHA: mandou arquivo da pasta de outra pessoa'; end if;
  negou := false;
  begin
    insert into public.exilados_mensagens (sala_id, autor, texto, gif) values (sala, ana, '', '{"url": "https://exemplo.com/x.gif"}');
  exception when others then negou := true;
  end;
  if not negou then raise exception 'FALHA: aceitou GIF de fora do Giphy'; end if;
  negou := false;
  begin
    insert into public.exilados_mensagens (sala_id, autor, texto, chamada) values (sala, ana, '', true);
  exception when others then negou := true;
  end;
  if not negou then raise exception 'FALHA: aceitou aviso de chamada numa sala'; end if;
  negou := false;
  begin
    insert into public.exilados_mensagens (sala_id, autor, texto) values (sala, ana, '   ');
  exception when others then negou := true;
  end;
  if not negou then raise exception 'FALHA: aceitou mensagem vazia'; end if;

  -- ---------------------------------------------------------------- conversa direta: @todos não, chamada sim
  conversa := public.exilados_abrir_conversa(bia);
  insert into public.exilados_mensagens (conversa_id, autor, texto, chamada) values (conversa, ana, '', true);
  negou := false;
  begin
    insert into public.exilados_mensagens (conversa_id, autor, texto, menciona_todos) values (conversa, ana, '@todos', true);
  exception when others then negou := true;
  end;
  if not negou then raise exception 'FALHA: aceitou @todos numa conversa direta'; end if;

  -- ---------------------------------------------------------------- editar
  update public.exilados_mensagens set texto = 'respondendo @Bia (editada)' where id = m_ana;
  select editada_em into quando from public.exilados_mensagens where id = m_ana;
  if quando is null then raise exception 'FALHA: editar não marcou a hora da edição'; end if;
  update public.exilados_mensagens set texto = 'mexendo na do dono' where id = m_dono;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALHA: a Ana editou a mensagem do dono'; end if;
  negou := false;
  begin
    update public.exilados_mensagens set autor = bia where id = m_ana;
  exception when others then negou := true;
  end;
  if not negou then raise exception 'FALHA: a Ana trocou o autor da mensagem'; end if;
  negou := false;
  begin
    update public.exilados_mensagens set editada_em = now() - interval '1 day' where id = m_ana;
  exception when others then negou := true;
  end;
  if not negou then raise exception 'FALHA: a Ana mexeu na hora da edição'; end if;

  -- ---------------------------------------------------------------- reações
  insert into public.exilados_reacoes (mensagem_id, user_id, emoji) values (m_dono, ana, '👍'), (m_dono, ana, '😂');
  negou := false;
  begin
    insert into public.exilados_reacoes (mensagem_id, user_id, emoji) values (m_dono, bia, '👍');
  exception when others then negou := true;
  end;
  if not negou then raise exception 'FALHA: a Ana reagiu em nome da Bia'; end if;
  delete from public.exilados_reacoes where mensagem_id = m_dono and emoji = '😂';
  select count(*) into n from public.exilados_reacoes where mensagem_id = m_dono;
  if n <> 1 then raise exception 'FALHA: tirar a reação deu % reações', n; end if;

  -- ---------------------------------------------------------------- lidas e menções
  perform set_config('request.jwt.claims', json_build_object('sub', bia, 'role', 'authenticated')::text, true);
  insert into public.exilados_mensagens (sala_id, autor, texto) values (sala, bia, 'da Bia') returning id into m_bia;
  select * into r from public.exilados_nao_lidas() where alvo = sala;
  if r.lida is not null or r.novas <> 4 or r.mencoes <> 1 then
    raise exception 'FALHA: não lidas da Bia: lida %, novas %, menções %', r.lida, r.novas, r.mencoes;
  end if;
  perform public.exilados_marcar_lida(sala, m_ana);
  perform public.exilados_marcar_lida(sala, m_dono); -- não volta para trás
  select * into r from public.exilados_nao_lidas() where alvo = sala;
  if r.lida <> m_ana or r.novas <> 2 or r.mencoes <> 0 then
    raise exception 'FALHA: depois de ler: lida %, novas %, menções %', r.lida, r.novas, r.mencoes;
  end if;
  select * into r from public.exilados_nao_lidas() where alvo = conversa;
  if r.novas <> 1 then raise exception 'FALHA: a chamada não conta como nova na conversa direta'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', ana, 'role', 'authenticated')::text, true);
  select count(*) into n from public.exilados_lidas where user_id = bia;
  if n <> 0 then raise exception 'FALHA: a Ana vê o que a Bia leu'; end if;

  -- ---------------------------------------------------------------- apagar
  delete from public.exilados_mensagens where id = m_bia;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALHA: a Ana apagou a mensagem da Bia'; end if;
  insert into public.exilados_mensagens (sala_id, autor, texto, responde_a) values (sala, ana, 'outra', m_ana) returning id into m_resposta;
  delete from public.exilados_mensagens where id = m_resposta;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FALHA: a Ana não apagou a própria mensagem'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', dono, 'role', 'authenticated')::text, true);
  delete from public.exilados_mensagens where id = m_bia;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FALHA: o dono não apagou a mensagem da Bia na sala'; end if;
  delete from public.exilados_mensagens where conversa_id = conversa;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALHA: o dono apagou mensagem de conversa direta dos outros'; end if;
  delete from public.exilados_mensagens where id = m_dono;
  select count(*) into n from public.exilados_reacoes where mensagem_id = m_dono;
  if n <> 0 then raise exception 'FALHA: as reações ficaram depois de apagar a mensagem'; end if;

  raise exception 'RESULTADO: tudo certo (nada foi gravado)';
end $$;
