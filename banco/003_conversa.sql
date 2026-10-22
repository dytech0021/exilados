-- Exilados 003: conversa como no Discord. Editar e apagar mensagens, responder, reações com emoji, menções (@nome e
-- @todos), o que cada um já leu (guardado no banco, igual em todos os aparelhos), arquivos além de imagem, GIFs e
-- chamadas nas conversas diretas. Pode rodar de novo: cada parte confere o que já existe.

-- ---------------------------------------------------------------- mensagens: campos novos

alter table public.exilados_mensagens
  add column if not exists editada_em timestamptz,
  -- Mensagem respondida (sem chave estrangeira: se ela for apagada, a resposta mostra "mensagem apagada").
  add column if not exists responde_a bigint,
  add column if not exists mencoes uuid[] not null default '{}',
  add column if not exists menciona_todos boolean not null default false,
  -- { caminho, nome, tipo, tamanho } na pasta "exilados-arquivos".
  add column if not exists arquivo jsonb,
  -- { url, largura, altura, titulo } de um GIF do Giphy (o site mostra pelo exilados-api).
  add column if not exists gif jsonb,
  -- Aviso de chamada numa conversa direta ("começou uma chamada").
  add column if not exists chamada boolean not null default false;

-- A regra "texto ou imagem" vira "texto, imagem, arquivo, GIF ou chamada".
do $$
declare
  r record;
begin
  for r in select conname from pg_constraint
           where conrelid = 'public.exilados_mensagens'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) like '%btrim(texto)%' and conname <> 'exilados_mensagens_conteudo' loop
    execute format('alter table public.exilados_mensagens drop constraint %I', r.conname);
  end loop;
end;
$$;
alter table public.exilados_mensagens drop constraint if exists exilados_mensagens_conteudo;
alter table public.exilados_mensagens add constraint exilados_mensagens_conteudo check (
  char_length(btrim(texto)) > 0 or imagem is not null or arquivo is not null or gif is not null or chamada
);
alter table public.exilados_mensagens drop constraint if exists exilados_mensagens_formatos;
alter table public.exilados_mensagens add constraint exilados_mensagens_formatos check (
  (arquivo is null or (jsonb_typeof(arquivo) = 'object' and arquivo ? 'caminho' and arquivo ? 'nome'
                       and char_length(arquivo->>'nome') between 1 and 200
                       and (arquivo->>'tamanho') ~ '^[0-9]{1,9}$'))
  and (gif is null or (jsonb_typeof(gif) = 'object' and (gif->>'url') ~ '^https://(media[0-9]?|i)\.giphy\.com/'))
  and cardinality(mencoes) <= 50
  -- @todos só nas salas; chamada só nas conversas diretas.
  and (not menciona_todos or sala_id is not null)
  and (not chamada or conversa_id is not null)
);
create index if not exists exilados_mensagens_resposta on public.exilados_mensagens (responde_a) where responde_a is not null;

-- Editar troca o texto (e as menções); a hora da edição é sempre a do banco.
create or replace function public.exilados_marcar_edicao() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.texto is distinct from old.texto or new.mencoes is distinct from old.mencoes
     or new.menciona_todos is distinct from old.menciona_todos then
    new.editada_em := now();
  end if;
  return new;
end;
$$;
drop trigger if exists exilados_mensagens_edicao on public.exilados_mensagens;
create trigger exilados_mensagens_edicao before update on public.exilados_mensagens
  for each row execute function public.exilados_marcar_edicao();

grant insert (sala_id, conversa_id, autor, texto, imagem, responde_a, mencoes, menciona_todos, arquivo, gif, chamada)
  on public.exilados_mensagens to authenticated;
grant update (texto, mencoes, menciona_todos) on public.exilados_mensagens to authenticated;
grant delete on public.exilados_mensagens to authenticated;

-- Enviar: a mesma regra de antes, mais arquivo e imagem só na pasta da própria pessoa.
drop policy if exists exilados_mensagens_enviar on public.exilados_mensagens;
create policy exilados_mensagens_enviar on public.exilados_mensagens for insert to authenticated
  with check (
    public.exilados_e_membro() and autor = (select auth.uid())
    and (imagem is null or imagem like (select auth.uid())::text || '/%')
    and (arquivo is null or (arquivo->>'caminho') like (select auth.uid())::text || '/%')
    and (
      exists (select 1 from public.exilados_salas s where s.id = sala_id and s.tipo = 'texto')
      or exists (
        select 1 from public.exilados_conversas c
        where c.id = conversa_id and (select auth.uid()) in (c.a, c.b) and public.exilados_sao_amigos(c.a, c.b)
      )
    )
  );

-- Editar: só quem escreveu (e não o aviso de chamada).
drop policy if exists exilados_mensagens_editar on public.exilados_mensagens;
create policy exilados_mensagens_editar on public.exilados_mensagens for update to authenticated
  using (public.exilados_e_membro() and autor = (select auth.uid()) and not chamada)
  with check (autor = (select auth.uid()) and char_length(texto) <= 2000);

-- Apagar: quem escreveu; nas salas, o dono também.
drop policy if exists exilados_mensagens_apagar on public.exilados_mensagens;
create policy exilados_mensagens_apagar on public.exilados_mensagens for delete to authenticated
  using (
    public.exilados_e_membro()
    and (autor = (select auth.uid()) or (sala_id is not null and public.exilados_e_dono()))
  );

-- ---------------------------------------------------------------- reações

create table if not exists public.exilados_reacoes (
  mensagem_id bigint not null references public.exilados_mensagens (id) on delete cascade,
  user_id uuid not null references public.exilados_membros (user_id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16 and emoji !~ '\s'),
  criada_em timestamptz not null default now(),
  primary key (mensagem_id, user_id, emoji)
);
alter table public.exilados_reacoes enable row level security;
revoke all on public.exilados_reacoes from anon, authenticated;
grant select, delete on public.exilados_reacoes to authenticated;
grant insert (mensagem_id, user_id, emoji) on public.exilados_reacoes to authenticated;

-- Quem vê a mensagem vê as reações dela (a consulta abaixo passa pelas regras das mensagens).
drop policy if exists exilados_reacoes_ler on public.exilados_reacoes;
create policy exilados_reacoes_ler on public.exilados_reacoes for select to authenticated
  using (exists (select 1 from public.exilados_mensagens m where m.id = mensagem_id));
-- Quantos emojis diferentes (fora `emoji`) a mensagem já tem. Roda como o dono da tabela: uma regra de acesso que
-- consultasse a própria tabela de reações cairia em recursão.
create or replace function public.exilados_outros_emojis(mensagem bigint, emoji text) returns integer
language sql stable security definer set search_path = '' as $$
  select count(distinct r.emoji)::integer from public.exilados_reacoes r
  where r.mensagem_id = mensagem and r.emoji <> exilados_outros_emojis.emoji;
$$;
revoke all on function public.exilados_outros_emojis(bigint, text) from public, anon;
grant execute on function public.exilados_outros_emojis(bigint, text) to authenticated;

-- Reagir em nome próprio, a uma mensagem que vê, com no máximo 20 emojis diferentes por mensagem.
drop policy if exists exilados_reacoes_reagir on public.exilados_reacoes;
create policy exilados_reacoes_reagir on public.exilados_reacoes for insert to authenticated
  with check (
    public.exilados_e_membro() and user_id = (select auth.uid())
    and exists (select 1 from public.exilados_mensagens m where m.id = mensagem_id)
    and public.exilados_outros_emojis(mensagem_id, emoji) < 20
  );
drop policy if exists exilados_reacoes_tirar on public.exilados_reacoes;
create policy exilados_reacoes_tirar on public.exilados_reacoes for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- o que cada um já leu

create table if not exists public.exilados_lidas (
  user_id uuid not null references public.exilados_membros (user_id) on delete cascade,
  -- Uma sala de texto ou uma conversa direta.
  alvo uuid not null,
  ultima bigint not null default 0,
  atualizada_em timestamptz not null default now(),
  primary key (user_id, alvo)
);
alter table public.exilados_lidas enable row level security;
revoke all on public.exilados_lidas from anon, authenticated;
grant select on public.exilados_lidas to authenticated;
drop policy if exists exilados_lidas_ler on public.exilados_lidas;
create policy exilados_lidas_ler on public.exilados_lidas for select to authenticated
  using (user_id = (select auth.uid()));

-- Marca como lido até a mensagem `ate` (nunca volta para trás).
create or replace function public.exilados_marcar_lida(alvo uuid, ate bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.exilados_e_membro() or alvo is null or ate is null or ate < 0 then
    return;
  end if;
  insert into public.exilados_lidas (user_id, alvo, ultima) values (auth.uid(), alvo, ate)
  on conflict (user_id, alvo) do update set ultima = greatest(public.exilados_lidas.ultima, excluded.ultima),
    atualizada_em = now();
end;
$$;

-- Para cada sala de texto e conversa direta que a pessoa vê: a última mensagem, até onde ela leu (null se nunca
-- abriu), quantas novas de outras pessoas (até 99) e quantas a mencionam. Passa pelas regras de acesso dela.
create or replace function public.exilados_nao_lidas()
returns table (alvo uuid, ultima bigint, lida bigint, novas integer, mencoes integer)
language sql stable security invoker set search_path = '' as $$
  with alvos as (
    select s.id as alvo, true as sala from public.exilados_salas s where s.tipo = 'texto'
    union all
    select c.id, false from public.exilados_conversas c
  )
  select a.alvo,
    (select max(m.id) from public.exilados_mensagens m where m.sala_id = a.alvo or m.conversa_id = a.alvo),
    l.ultima,
    (select count(*)::integer from (
       select 1 from public.exilados_mensagens m
       where (m.sala_id = a.alvo or m.conversa_id = a.alvo) and m.id > coalesce(l.ultima, 0)
         and m.autor <> (select auth.uid()) limit 99) x),
    (select count(*)::integer from public.exilados_mensagens m
       where (m.sala_id = a.alvo or m.conversa_id = a.alvo) and m.id > coalesce(l.ultima, 0)
         and m.autor <> (select auth.uid())
         and ((select auth.uid()) = any (m.mencoes) or (a.sala and m.menciona_todos)))
  from alvos a
  left join public.exilados_lidas l on l.alvo = a.alvo and l.user_id = (select auth.uid());
$$;

revoke all on function public.exilados_marcar_lida(uuid, bigint), public.exilados_nao_lidas() from public, anon;
grant execute on function public.exilados_marcar_lida(uuid, bigint), public.exilados_nao_lidas() to authenticated;

-- ---------------------------------------------------------------- arquivos (até 25 MB) e limpeza

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exilados-arquivos', 'exilados-arquivos', false, 26214400, null)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists exilados_arquivos_ler on storage.objects;
create policy exilados_arquivos_ler on storage.objects for select to authenticated
  using (bucket_id = 'exilados-arquivos' and public.exilados_e_membro());
drop policy if exists exilados_arquivos_enviar on storage.objects;
create policy exilados_arquivos_enviar on storage.objects for insert to authenticated
  with check (
    bucket_id = 'exilados-arquivos' and public.exilados_e_membro()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
-- Quem apaga a própria mensagem apaga também a imagem ou o arquivo dela.
drop policy if exists exilados_proprios_apagar on storage.objects;
create policy exilados_proprios_apagar on storage.objects for delete to authenticated
  using (
    bucket_id in ('exilados', 'exilados-arquivos')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ---------------------------------------------------------------- tempo real

do $$
declare
  tabela text;
begin
  foreach tabela in array array['exilados_reacoes', 'exilados_lidas'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = tabela
    ) then
      execute format('alter publication supabase_realtime add table public.%I', tabela);
    end if;
  end loop;
end;
$$;
