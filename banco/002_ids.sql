-- Exilados: ID de 9 dígitos de cada conta, para um membro adicionar a pessoa ao grupo digitando o número
-- (sem precisar de link de convite). Pode rodar de novo: cada parte confere o que já existe.

create table if not exists public.exilados_ids (
  user_id uuid primary key references auth.users (id) on delete cascade,
  codigo text not null unique check (codigo ~ '^[1-9][0-9]{8}$'),
  -- Como a pessoa quer aparecer no grupo quando for adicionada pelo ID.
  nome text check (nome is null or char_length(btrim(nome)) between 1 and 32),
  criado_em timestamptz not null default now()
);

alter table public.exilados_ids enable row level security;
revoke all on public.exilados_ids from anon, authenticated;
grant select on public.exilados_ids to authenticated;

-- Cada um vê o próprio ID; membros veem os IDs dos membros (para achar amigos pelo número).
drop policy if exists exilados_ids_ler on public.exilados_ids;
create policy exilados_ids_ler on public.exilados_ids for select to authenticated using (
  user_id = (select auth.uid())
  or (public.exilados_e_membro()
      and exists (select 1 from public.exilados_membros m where m.user_id = exilados_ids.user_id and m.ativo))
);

-- O ID da própria conta (criado na primeira vez). Com `nome`, guarda como a pessoa quer aparecer no grupo.
create or replace function public.exilados_meu_id(nome text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare
  eu uuid := auth.uid();
  resultado text;
  limpo text := nullif(btrim(regexp_replace(coalesce(nome, ''), '\s+', ' ', 'g')), '');
begin
  if eu is null then
    raise exception 'Entre na sua conta primeiro.';
  end if;
  if limpo is not null and char_length(limpo) > 32 then
    raise exception 'O nome precisa ter de 1 a 32 caracteres.';
  end if;
  select codigo into resultado from public.exilados_ids where user_id = eu;
  if not found then
    loop
      resultado := (100000000 + floor(random() * 900000000))::bigint::text;
      begin
        insert into public.exilados_ids (user_id, codigo, nome) values (eu, resultado, limpo);
        exit;
      exception when unique_violation then
        -- Outra conta já tem esse número (ou esta conta foi criada ao mesmo tempo em outra aba): tenta de novo.
        select codigo into resultado from public.exilados_ids where user_id = eu;
        if found then exit; end if;
      end;
    end loop;
  end if;
  if limpo is not null then
    update public.exilados_ids set nome = limpo where user_id = eu;
  end if;
  return resultado;
end;
$$;

-- Um membro digita o ID e a pessoa entra no grupo (ou volta, se o dono a tinha removido e é o dono quem adiciona).
-- Devolve o nome com que ela entrou.
create or replace function public.exilados_adicionar_por_id(codigo text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  numero text := regexp_replace(coalesce(codigo, ''), '\D', '', 'g');
  alvo public.exilados_ids;
  atual public.exilados_membros;
  nome_final text;
begin
  if not public.exilados_e_membro() then
    raise exception 'Só quem é do grupo pode adicionar pessoas.';
  end if;
  if numero !~ '^[1-9][0-9]{8}$' then
    raise exception 'O ID tem 9 dígitos.';
  end if;
  select * into alvo from public.exilados_ids i where i.codigo = numero;
  if not found then
    raise exception 'Nenhuma conta com esse ID. Peça para a pessoa abrir o Exilados e conferir o número.';
  end if;
  select * into atual from public.exilados_membros where user_id = alvo.user_id;
  if found then
    if atual.ativo then
      raise exception '% já faz parte do grupo.', atual.nome;
    end if;
    if not public.exilados_e_dono() then
      raise exception '% foi removido(a) pelo dono; só ele pode readmitir.', atual.nome;
    end if;
    update public.exilados_membros set ativo = true where user_id = alvo.user_id;
    return atual.nome;
  end if;
  if (select count(*) from public.exilados_membros where ativo) >= 30 then
    raise exception 'O grupo está cheio (30 membros).';
  end if;
  nome_final := coalesce(alvo.nome,
    nullif(left(btrim(split_part((select email from auth.users where id = alvo.user_id), '@', 1)), 32), ''),
    'Novo membro');
  insert into public.exilados_membros (user_id, nome) values (alvo.user_id, nome_final);
  return nome_final;
end;
$$;

revoke all on function public.exilados_meu_id(text), public.exilados_adicionar_por_id(text) from public, anon;
grant execute on function public.exilados_meu_id(text), public.exilados_adicionar_por_id(text) to authenticated;
