-- Exilados: tabelas, regras de acesso, funções, pasta de imagens e tempo real, no Supabase do FilaBox.
-- Só cria objetos com o prefixo exilados_ (e a pasta "exilados" do armazenamento); nada do FilaBox muda.
-- Pode rodar de novo: cada parte confere o que já existe.

-- ---------------------------------------------------------------- tabelas

create table if not exists public.exilados_membros (
  user_id uuid primary key references auth.users (id) on delete cascade,
  nome text not null check (char_length(btrim(nome)) between 1 and 32),
  avatar text,
  papel text not null default 'membro' check (papel in ('dono', 'membro')),
  ativo boolean not null default true,
  entrou_em timestamptz not null default now()
);

create table if not exists public.exilados_convites (
  resumo text primary key,
  criado_por uuid not null references public.exilados_membros (user_id) on delete cascade,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null
);

create table if not exists public.exilados_salas (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(btrim(nome)) between 1 and 40),
  tipo text not null check (tipo in ('texto', 'voz')),
  ordem integer not null default 0
);

create table if not exists public.exilados_amizades (
  id uuid primary key default gen_random_uuid(),
  de uuid not null references public.exilados_membros (user_id) on delete cascade,
  para uuid not null references public.exilados_membros (user_id) on delete cascade,
  estado text not null default 'pendente' check (estado in ('pendente', 'aceita')),
  criada_em timestamptz not null default now(),
  check (de <> para)
);
create unique index if not exists exilados_amizades_par on public.exilados_amizades (least(de, para), greatest(de, para));

create table if not exists public.exilados_conversas (
  id uuid primary key default gen_random_uuid(),
  a uuid not null references public.exilados_membros (user_id) on delete cascade,
  b uuid not null references public.exilados_membros (user_id) on delete cascade,
  check (a < b),
  unique (a, b)
);

create table if not exists public.exilados_mensagens (
  id bigint generated always as identity primary key,
  sala_id uuid references public.exilados_salas (id) on delete cascade,
  conversa_id uuid references public.exilados_conversas (id) on delete cascade,
  autor uuid not null references public.exilados_membros (user_id) on delete cascade,
  texto text not null default '' check (char_length(texto) <= 2000),
  imagem text,
  criada_em timestamptz not null default now(),
  check ((sala_id is null) <> (conversa_id is null)),
  check (char_length(btrim(texto)) > 0 or imagem is not null)
);
create index if not exists exilados_mensagens_sala on public.exilados_mensagens (sala_id, id desc);
create index if not exists exilados_mensagens_conversa on public.exilados_mensagens (conversa_id, id desc);

create table if not exists public.exilados_lives (
  user_id uuid primary key references public.exilados_membros (user_id) on delete cascade,
  caminho text not null check (caminho ~ '^ex/[A-Za-z0-9]{24}$'),
  comecou_em timestamptz not null default now(),
  ultimo_sinal timestamptz not null default now()
);

-- ---------------------------------------------------------------- funções de apoio às regras
-- Rodam como o dono das tabelas para não cair nas próprias regras (o que daria recursão).

create or replace function public.exilados_e_membro() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.exilados_membros where user_id = auth.uid() and ativo);
$$;

create or replace function public.exilados_e_dono() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.exilados_membros where user_id = auth.uid() and ativo and papel = 'dono');
$$;

create or replace function public.exilados_sao_amigos(x uuid, y uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.exilados_amizades
    where estado = 'aceita' and ((de = x and para = y) or (de = y and para = x))
  );
$$;

-- ---------------------------------------------------------------- funções chamadas pelo site

-- Gera um convite: 244 bits sorteados; o banco guarda só o resumo. Vale 7 dias e serve para várias pessoas.
create or replace function public.exilados_criar_convite() returns text
language plpgsql security definer set search_path = '' as $$
declare
  codigo text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if not public.exilados_e_membro() then
    raise exception 'Só membros do grupo geram convites.';
  end if;
  delete from public.exilados_convites where expira_em < now() - interval '1 day';
  insert into public.exilados_convites (resumo, criado_por, expira_em)
  values (encode(sha256(convert_to(codigo, 'UTF8')), 'hex'), auth.uid(), now() + interval '7 days');
  return codigo;
end;
$$;

-- Para a tela "Você foi convidado": diz se o convite vale e quem convidou, sem revelar mais nada.
create or replace function public.exilados_info_convite(codigo text)
returns table (valido boolean, convidado_por text)
language sql stable security definer set search_path = '' as $$
  select coalesce(bool_or(true), false), max(m.nome)
  from public.exilados_convites c
  join public.exilados_membros m on m.user_id = c.criado_por and m.ativo
  where c.resumo = encode(sha256(convert_to(codigo, 'UTF8')), 'hex') and c.expira_em > now();
$$;

create or replace function public.exilados_entrar(codigo text, nome text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  eu uuid := auth.uid();
  limpo text := btrim(coalesce(nome, ''));
  atual public.exilados_membros;
begin
  if eu is null then
    raise exception 'Entre na sua conta antes de usar o convite.';
  end if;
  if char_length(limpo) not between 1 and 32 then
    raise exception 'O nome precisa ter de 1 a 32 caracteres.';
  end if;
  perform 1 from public.exilados_convites c
    join public.exilados_membros m on m.user_id = c.criado_por and m.ativo
    where c.resumo = encode(sha256(convert_to(coalesce(codigo, ''), 'UTF8')), 'hex') and c.expira_em > now();
  if not found then
    raise exception 'Este convite não vale mais. Peça um novo a quem te convidou.';
  end if;
  select * into atual from public.exilados_membros where user_id = eu;
  if found then
    if atual.ativo then
      return;
    end if;
    raise exception 'Sua entrada no grupo foi desfeita pelo dono. Só ele pode te readmitir.';
  end if;
  if (select count(*) from public.exilados_membros where ativo) >= 30 then
    raise exception 'O grupo está cheio (30 membros).';
  end if;
  insert into public.exilados_membros (user_id, nome) values (eu, limpo);
end;
$$;

-- Remover (valor falso) ou readmitir (verdadeiro) um membro. Só o dono, e nunca a si mesmo.
create or replace function public.exilados_definir_ativo(alvo uuid, valor boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.exilados_e_dono() then
    raise exception 'Só o dono do grupo pode fazer isso.';
  end if;
  if alvo = auth.uid() then
    raise exception 'O dono não pode remover a si mesmo.';
  end if;
  update public.exilados_membros set ativo = valor where user_id = alvo;
  if not found then
    raise exception 'Esse membro não existe.';
  end if;
end;
$$;

-- Abre (ou devolve) a conversa direta com um amigo.
create or replace function public.exilados_abrir_conversa(outro uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  eu uuid := auth.uid();
  resultado uuid;
begin
  if not public.exilados_e_membro() or outro is null or not public.exilados_sao_amigos(eu, outro) then
    raise exception 'Mensagem direta só entre amigos.';
  end if;
  insert into public.exilados_conversas (a, b) values (least(eu, outro), greatest(eu, outro))
  on conflict (a, b) do nothing;
  select id into resultado from public.exilados_conversas where a = least(eu, outro) and b = greatest(eu, outro);
  return resultado;
end;
$$;

revoke all on function public.exilados_e_membro(), public.exilados_e_dono(), public.exilados_sao_amigos(uuid, uuid),
  public.exilados_criar_convite(), public.exilados_info_convite(text), public.exilados_entrar(text, text),
  public.exilados_definir_ativo(uuid, boolean), public.exilados_abrir_conversa(uuid) from public, anon;
grant execute on function public.exilados_e_membro(), public.exilados_e_dono(), public.exilados_sao_amigos(uuid, uuid),
  public.exilados_criar_convite(), public.exilados_info_convite(text), public.exilados_entrar(text, text),
  public.exilados_definir_ativo(uuid, boolean), public.exilados_abrir_conversa(uuid) to authenticated;
grant execute on function public.exilados_info_convite(text) to anon;

-- ---------------------------------------------------------------- permissões e regras de acesso

alter table public.exilados_membros enable row level security;
alter table public.exilados_convites enable row level security;
alter table public.exilados_salas enable row level security;
alter table public.exilados_amizades enable row level security;
alter table public.exilados_conversas enable row level security;
alter table public.exilados_mensagens enable row level security;
alter table public.exilados_lives enable row level security;

revoke all on public.exilados_membros, public.exilados_convites, public.exilados_salas, public.exilados_amizades,
  public.exilados_conversas, public.exilados_mensagens, public.exilados_lives from anon, authenticated;

grant select on public.exilados_membros, public.exilados_salas, public.exilados_amizades, public.exilados_conversas,
  public.exilados_mensagens, public.exilados_lives to authenticated;
grant update (nome, avatar) on public.exilados_membros to authenticated;
grant insert, update, delete on public.exilados_salas to authenticated;
grant insert, delete on public.exilados_amizades to authenticated;
grant update (estado) on public.exilados_amizades to authenticated;
grant insert (sala_id, conversa_id, autor, texto, imagem) on public.exilados_mensagens to authenticated;
grant insert, update, delete on public.exilados_lives to authenticated;

-- membros: todos do grupo se veem; quem foi removido ainda vê a própria linha (para o site explicar o porquê)
drop policy if exists exilados_membros_ler on public.exilados_membros;
create policy exilados_membros_ler on public.exilados_membros for select to authenticated
  using (public.exilados_e_membro() or user_id = (select auth.uid()));
drop policy if exists exilados_membros_mudar on public.exilados_membros;
create policy exilados_membros_mudar on public.exilados_membros for update to authenticated
  using (user_id = (select auth.uid()) and ativo)
  with check (user_id = (select auth.uid()) and (avatar is null or avatar like (select auth.uid())::text || '/%'));

-- salas: todos leem; só o dono mexe
drop policy if exists exilados_salas_ler on public.exilados_salas;
create policy exilados_salas_ler on public.exilados_salas for select to authenticated using (public.exilados_e_membro());
drop policy if exists exilados_salas_criar on public.exilados_salas;
create policy exilados_salas_criar on public.exilados_salas for insert to authenticated with check (public.exilados_e_dono());
drop policy if exists exilados_salas_mudar on public.exilados_salas;
create policy exilados_salas_mudar on public.exilados_salas for update to authenticated
  using (public.exilados_e_dono()) with check (public.exilados_e_dono());
drop policy if exists exilados_salas_apagar on public.exilados_salas;
create policy exilados_salas_apagar on public.exilados_salas for delete to authenticated using (public.exilados_e_dono());

-- amizades: cada um vê as próprias; pede em nome próprio; só quem recebeu aceita; qualquer um dos dois desfaz
drop policy if exists exilados_amizades_ler on public.exilados_amizades;
create policy exilados_amizades_ler on public.exilados_amizades for select to authenticated
  using (public.exilados_e_membro() and (select auth.uid()) in (de, para));
drop policy if exists exilados_amizades_pedir on public.exilados_amizades;
create policy exilados_amizades_pedir on public.exilados_amizades for insert to authenticated
  with check (
    public.exilados_e_membro() and de = (select auth.uid()) and estado = 'pendente'
    and exists (select 1 from public.exilados_membros m where m.user_id = para and m.ativo)
  );
drop policy if exists exilados_amizades_aceitar on public.exilados_amizades;
create policy exilados_amizades_aceitar on public.exilados_amizades for update to authenticated
  using (public.exilados_e_membro() and para = (select auth.uid()))
  with check (estado = 'aceita');
drop policy if exists exilados_amizades_desfazer on public.exilados_amizades;
create policy exilados_amizades_desfazer on public.exilados_amizades for delete to authenticated
  using ((select auth.uid()) in (de, para));

-- conversas diretas: só os dois, e só enquanto forem amigos (criadas por exilados_abrir_conversa)
drop policy if exists exilados_conversas_ler on public.exilados_conversas;
create policy exilados_conversas_ler on public.exilados_conversas for select to authenticated
  using (public.exilados_e_membro() and (select auth.uid()) in (a, b) and public.exilados_sao_amigos(a, b));

-- mensagens
drop policy if exists exilados_mensagens_ler on public.exilados_mensagens;
create policy exilados_mensagens_ler on public.exilados_mensagens for select to authenticated
  using (
    public.exilados_e_membro() and (
      sala_id is not null
      or exists (
        select 1 from public.exilados_conversas c
        where c.id = conversa_id and (select auth.uid()) in (c.a, c.b) and public.exilados_sao_amigos(c.a, c.b)
      )
    )
  );
drop policy if exists exilados_mensagens_enviar on public.exilados_mensagens;
create policy exilados_mensagens_enviar on public.exilados_mensagens for insert to authenticated
  with check (
    public.exilados_e_membro() and autor = (select auth.uid())
    and (imagem is null or imagem like (select auth.uid())::text || '/%')
    and (
      exists (select 1 from public.exilados_salas s where s.id = sala_id and s.tipo = 'texto')
      or exists (
        select 1 from public.exilados_conversas c
        where c.id = conversa_id and (select auth.uid()) in (c.a, c.b) and public.exilados_sao_amigos(c.a, c.b)
      )
    )
  );

-- lives: todos do grupo veem; cada um mexe só na própria
drop policy if exists exilados_lives_ler on public.exilados_lives;
create policy exilados_lives_ler on public.exilados_lives for select to authenticated using (public.exilados_e_membro());
drop policy if exists exilados_lives_criar on public.exilados_lives;
create policy exilados_lives_criar on public.exilados_lives for insert to authenticated
  with check (public.exilados_e_membro() and user_id = (select auth.uid()));
drop policy if exists exilados_lives_mudar on public.exilados_lives;
create policy exilados_lives_mudar on public.exilados_lives for update to authenticated
  using (user_id = (select auth.uid())) with check (public.exilados_e_membro() and user_id = (select auth.uid()));
drop policy if exists exilados_lives_apagar on public.exilados_lives;
create policy exilados_lives_apagar on public.exilados_lives for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- imagens

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exilados', 'exilados', false, 1048576, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists exilados_imagens_ler on storage.objects;
create policy exilados_imagens_ler on storage.objects for select to authenticated
  using (bucket_id = 'exilados' and public.exilados_e_membro());
drop policy if exists exilados_imagens_enviar on storage.objects;
create policy exilados_imagens_enviar on storage.objects for insert to authenticated
  with check (
    bucket_id = 'exilados' and public.exilados_e_membro()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ---------------------------------------------------------------- tempo real

do $$
declare
  tabela text;
begin
  foreach tabela in array array['exilados_membros', 'exilados_salas', 'exilados_amizades', 'exilados_conversas',
                                'exilados_mensagens', 'exilados_lives'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = tabela
    ) then
      execute format('alter publication supabase_realtime add table public.%I', tabela);
    end if;
  end loop;
end;
$$;

-- Canal privado "exilados" (presença e quem está falando): só membros ativos entram e mandam.
do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute 'drop policy if exists exilados_canal_ler on realtime.messages';
    execute $p$create policy exilados_canal_ler on realtime.messages for select to authenticated
      using ((select realtime.topic()) = 'exilados' and public.exilados_e_membro())$p$;
    execute 'drop policy if exists exilados_canal_enviar on realtime.messages';
    execute $p$create policy exilados_canal_enviar on realtime.messages for insert to authenticated
      with check ((select realtime.topic()) = 'exilados' and public.exilados_e_membro())$p$;
  end if;
end;
$$;
