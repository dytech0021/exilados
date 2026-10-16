# Exilados: especificação

Data: 15/10/2026. Situação: aprovada (endereço trocado para filabox3d.com.br/exilados na revisão).

## 1. Objetivo

O Exilados é um lugar para um grupo de amigos (até umas 20 pessoas) conversar por texto e voz e assistir às
lives uns dos outros, com aparência e jeito de usar próximos aos do Discord. Ele nasce separando do Ponte a
parte de lives e amigos: o Ponte volta a ser só acesso remoto.

Dá certo quando:

- cada pessoa entra com a própria conta e só quem foi convidado vê o grupo;
- o grupo conversa em salas de texto (com imagens) e em salas de voz, com escolha de microfone e de saída;
- amigos conversam em particular por mensagem direta;
- alguém transmite um jogo pelo programa do Windows e qualquer membro assiste pelo navegador com menos de 1 s de
  atraso;
- tudo isso funciona no navegador do PC, do Android e do iPhone, sem instalar nada (o site pode ser instalado
  como aplicativo); só transmitir exige o programa do Windows.

## 2. Decisões tomadas

| Assunto | Decisão |
|---|---|
| Público | Um grupo de amigos, até umas 20 pessoas. Trava de segurança em 30 membros. |
| Forma | Site instalável (aplicativo web) para tudo, mais um programa pequeno para Windows só para transmitir. |
| Organização | Um único grupo, "Exilados", com salas de texto e de voz fixas que o dono administra. |
| Entrada no grupo | Link de convite gerado por qualquer membro; vale 7 dias e serve para várias pessoas. |
| Contas | As do FilaBox (Supabase dele), com e-mail e senha ou Google. |
| Lives | Todos os membros podem assistir. A live aparece como AO VIVO na sala de voz de quem transmite. |
| Amigos | Pedido e aceite entre membros; amizade libera a mensagem direta. |
| Voz | Volume de cada pessoa, além do básico. Redução de ruído do navegador sempre ligada. Sem "apertar para falar". |
| Texto | Mensagens com histórico e imagens. Sem editar, apagar, menções ou reações na primeira versão. |
| Transmitir | Só pelo programa do Windows (com som isolado do programa). Sem transmitir pelo navegador. |
| Celular | Só o site instalável. Sem aplicativo nativo por enquanto. |
| Endereço | `https://filabox3d.com.br/exilados/`, dentro do site do FilaBox, sem registro novo no DNS. Consequência: o login guardado no navegador é o mesmo do site do FilaBox (entrar ou sair num vale para o outro). |
| Repositório | `dytech0021/exilados`, público. Nenhuma chave ou senha entra nele. |
| Aparência | A do Discord (cores escuras, disposição, componentes), com o destaque roxo-azulado (#5865F2) e o ícone "EX" do grupo em laranja (#C0662B). |
| Ponte | Perde lives e amigos numa versão nova, depois que o Exilados estiver no ar. A live por link aberto (para quem não é do grupo) deixa de existir. |
| Abordagem | Supabase do FilaBox para contas, dados, tempo real e imagens; LiveKit no servidor para a voz; MediaMTX (que já existe) para as lives. |

## 3. Visão geral

```
Navegador ou app instalado (PC, Android, iPhone)
  ├─ login, grupo, salas de texto, mensagens diretas, imagens, presença ──► Supabase do FilaBox
  ├─ voz nas salas ───────────────────────────────────────────────────────► LiveKit (servidor)
  └─ assistir lives (WebRTC) ─────────────────────────────────────────────► MediaMTX (servidor)

Programa Exilados para Windows
  └─ transmite (RTSPS, H.264 pela placa, Opus) ───────────────────────────► MediaMTX (servidor)

exilados-api (servidor): confere o login e a participação no grupo e entrega as permissões
de voz, de transmitir e de assistir; responde ao MediaMTX quem pode enviar ou assistir.
```

O servidor é o mesmo de hoje (Ubuntu 24.04, 2 processadores, 1 GB de memória), que já roda o site do FilaBox,
o nginx, o MediaMTX e o relay do Ponte.

### 3.1 Peças e o que cada uma faz

| Peça | Faz | Depende de |
|---|---|---|
| `site/` | Toda a interface: login, grupo, salas, conversas, voz, assistir. HTML, CSS e JavaScript em módulos, sem etapa de compilação; bibliotecas copiadas para `site/vendor/` com versão fixa. | Supabase, exilados-api, LiveKit, MediaMTX |
| `api/` (exilados-api) | Serviço Node sem pacotes externos. Permissões de voz e de live, autorização do MediaMTX, remoção de membro da voz, sinal de vida das lives. | Supabase (com o login da própria pessoa), LiveKit |
| `banco/` | Migrações SQL das tabelas `exilados_*`, regras de acesso (RLS), funções e a pasta de imagens. | Supabase do FilaBox |
| `windows/` | Programa Exilados para Windows: login, transmitir, atualização automática. C# / .NET 10, sem pacotes externos. | exilados-api, MediaMTX |
| `servidor/` | Configuração do LiveKit, do nginx, dos serviços systemd e o roteiro de instalação. | — |

## 4. Contas, grupo e dados

### 4.1 Entrar e fazer parte

- Login pelo Supabase do FilaBox: e-mail e senha, ou Google. Ter conta não dá acesso a nada do grupo.
- **Convite:** qualquer membro ativo gera um link `https://filabox3d.com.br/exilados/#convite=<código>`. O código
  tem 128 bits aleatórios; o banco guarda só o resumo (SHA-256). Vale 7 dias e serve para várias pessoas.
- **Entrar:** quem abre o link entra (ou cria a conta), escolhe o nome que aparece no grupo (1 a 32 caracteres) e
  vira membro, pela função `exilados_entrar(codigo, nome)`. Ela recusa: código vencido, código de quem foi
  removido, grupo com 30 membros, e conta que já foi removida (só o dono readmite).
- **Dono:** a conta do dono é marcada na instalação (papel `dono`). O dono remove membros e administra as salas.
- **Remover:** o membro removido fica `ativo = false`. Na hora: perde a leitura de tudo (regras do banco), os
  convites dele param de valer, sai da voz (o exilados-api o tira do LiveKit) e não consegue mais permissão de
  voz nem de live.

### 4.2 Tabelas (Supabase do FilaBox, todas com prefixo `exilados_`)

| Tabela | Campos principais |
|---|---|
| `exilados_membros` | `user_id` (chave, conta do Supabase), `nome`, `avatar` (caminho da imagem ou vazio), `papel` (`dono` ou `membro`), `ativo`, `entrou_em` |
| `exilados_convites` | `resumo` (chave), `criado_por`, `criado_em`, `expira_em` |
| `exilados_salas` | `id`, `nome`, `tipo` (`texto` ou `voz`), `ordem` |
| `exilados_amizades` | `id`, `de`, `para`, `estado` (`pendente` ou `aceita`), `criada_em`; um par só uma vez |
| `exilados_conversas` | `id`, `a`, `b` (os dois amigos; `a < b`, par único) |
| `exilados_mensagens` | `id`, `sala_id` ou `conversa_id` (exatamente um), `autor`, `texto` (até 2.000 caracteres), `imagem` (caminho ou vazio), `criada_em` |
| `exilados_lives` | `user_id` (chave), `caminho` (`ex/<24 caracteres sorteados>`), `comecou_em`, `ultimo_sinal` |

Salas iniciais: `geral` (texto), `Geral` e `Jogando` (voz).

### 4.3 Regras de acesso (RLS)

- Só membro ativo lê membros, salas, mensagens de salas, lives e imagens do grupo.
- Cada um só escreve em nome próprio: mensagem com `autor` = a própria conta, pedido de amizade com `de` = a
  própria conta, a própria linha em `exilados_lives`, o próprio nome e foto.
- Amizade: só `para` aceita ou recusa; qualquer um dos dois desfaz.
- Conversa direta: só existe entre amigos (amizade aceita); só os dois leem e escrevem. Desfeita a amizade, a
  conversa fica fechada para os dois (nem leitura nem escrita).
- Só o dono cria, renomeia, reordena e apaga salas, e muda `ativo` de outros membros.
- Nada disso aparece para quem só tem conta no FilaBox. As tabelas e a pasta do FilaBox não mudam.

### 4.4 Imagens

- Pasta própria no armazenamento do Supabase (`exilados`), privada; cada um envia só para `<seu user_id>/...`,
  e só membros ativos leem.
- O navegador reduz a imagem antes de enviar: lado maior de até 1.600 pontos, WebP (ou JPEG onde o navegador não
  gera WebP), tamanho final de até 600 KB. Originais acima de 15 MB são recusados com aviso.
- Fotos de perfil seguem a mesma regra, reduzidas para 256 × 256.

### 4.5 Tempo real e presença

- Mensagens, amizades, salas, membros e lives chegam pela assinatura de mudanças do Supabase (respeita as regras
  de acesso de quem assina).
- Presença por um canal privado do Supabase Realtime, autorizado só para membros ativos. Cada site aberto publica:
  `online` ou `ausente` (sem mexer por 10 min) e a sala de voz em que está. Quem fecha tudo some da lista de
  online. O AO VIVO não vem da presença, e sim de `exilados_lives` (seção 7.2).
- Quem está falando numa sala de voz vai por mensagens nesse mesmo canal, no máximo 2 por segundo por pessoa,
  para todos verem o anel verde sem passar do limite de mensagens do plano gratuito.

## 5. Site

### 5.1 Telas

A tela principal segue o desenho aprovado em `docs/desenho/tela-principal.html`:

- **Trilho à esquerda:** ícone das mensagens diretas e ícone do grupo Exilados.
- **Coluna das salas:** salas de texto e de voz; dentro de cada sala de voz, quem está nela, com anel verde de quem
  fala, ícone de microfone silenciado e etiqueta AO VIVO. Embaixo, o painel "Voz conectada" (sala, sair) e o
  painel do usuário (foto, nome, status, silenciar microfone, desligar som, configurações).
- **Meio:** a conversa da sala (nome, hora, texto, imagens; caixa de escrever com botão de imagem e colar
  imagem) ou a live aberta.
- **Direita:** membros em "Online" e "Offline", com o que cada um faz ("Na sala Geral", "Ao vivo na Geral") e a
  coroa do dono.
- **Mensagens diretas:** amigos (abas Online, Todos, Pedidos, Adicionar) e a lista de conversas; a conversa
  direta tem o mesmo jeito da sala de texto.
- **Live aberta:** vídeo no meio, tela cheia, volume, "N assistindo", "A live terminou" ao fim. A pessoa continua
  na sala de voz enquanto assiste.
- **Configurações:** Minha conta (nome, foto), Voz e áudio (microfone, saída, teste com medidor, volume de
  entrada), Sair da conta. Para o dono: Salas (criar, renomear, reordenar, apagar) e Membros (remover, readmitir).
- **Entrar:** login com a conta do FilaBox; tela "Você foi convidado para Exilados" com o campo do nome.
- **Celular:** a mesma estrutura em painéis que deslizam (salas à esquerda, conversa, membros à direita), como no
  aplicativo do Discord.

### 5.2 Comportamento

- Aparência: as cores escuras do Discord (#1E1F22, #2B2D31, #313338, #383A40), texto #DBDEE1 e #949BA4,
  destaque #5865F2, verde #23A55A, vermelho #F23F43.
- Aviso rápido no canto quando um membro entra ao vivo ("Dyego entrou ao vivo"), com o botão Assistir.
- Aplicativo instalável (manifesto e service worker com escopo `/exilados/`, para não interferir no site do
  FilaBox): abre em tela cheia e guarda a casca do site para abrir
  rápido. Sem notificações com o site fechado nesta versão.
- O histórico de uma sala carrega as últimas 50 mensagens e mais 50 ao rolar para cima.

## 6. Voz

- Uma sala de voz do site é uma sala do LiveKit (`sala-<id>`). Clicar entra; o site pede ao exilados-api uma
  permissão de entrada (token do LiveKit, válido por 10 minutos para entrar), que só sai para membro ativo e para
  sala do tipo voz. A permissão só deixa publicar o microfone e receber os outros.
- Áudio: Opus, com redução de ruído, cancelamento de eco e ajuste de ganho do navegador sempre ligados.
- Silenciar microfone; desligar o som (também silencia o microfone, como no Discord).
- Anel verde de quem está falando, visível também para quem não está na sala (pelo canal de presença, seção 4.5).
- Volume de cada pessoa: botão direito no nome (ou segurar, no celular), de 0 a 200%, só para quem ajusta,
  guardado no aparelho por conta.
- Escolha de microfone e de saída em Configurações → Voz e áudio, com troca na hora, sem sair da sala. No Safari,
  que não permite escolher a saída, a opção aparece desativada com a explicação.
- Microfone negado ou ausente: entra só ouvindo, com aviso de como liberar.
- Queda de conexão: o LiveKit reconecta sozinho; o painel mostra "Reconectando...".
- Até 20 pessoas por sala (configurado no LiveKit).
- Limite conhecido: no iPhone a voz para quando a pessoa troca de aplicativo ou apaga a tela.

## 7. Lives

### 7.1 Programa Exilados para Windows

- C# / .NET 10 (WinForms), um único `Exilados.exe`, sem pacotes externos, como o Ponte. Não precisa de
  administrador.
- Aproveita, copiados do Ponte para o repositório novo: captura da tela (DXGI, com GDI de reserva) e de um
  programa (Windows Graphics Capture pelo FFmpeg), som do computador e som isolado do programa (WASAPI process
  loopback), H.264 pela placa (NVENC, AMF, Quick Sync) com quadro-chave a cada 2 s, Opus, envio RTSPS, cão de
  guarda que reinicia o envio, o FFmpeg baixado na primeira vez e conferido pelo SHA-256 fixado, login no Supabase
  e registro de erros.
- Fica perto do relógio; abre com o Windows (opção ligada por padrão, desligável). Menu: Abrir o Exilados (abre o
  site no navegador padrão), Transmitir..., Parar transmissão, Sair.
- Janela Transmitir: Uma tela (som do computador) ou Um programa (som só dele; exige Windows 11), qualidade
  1080p ou 720p a 60 ou 30 quadros por segundo, som ligado ou desligado, Entrar ao vivo, e o estado
  ("ao vivo · 3 assistindo").
- Registra início, fim e motivo de cada queda em `%APPDATA%\Exilados\sessoes.txt` e erros em `erros.txt`.
- Requisitos: Windows 10 ou 11 de 64 bits e o .NET Desktop Runtime 10. Som de um programa: Windows 11.

### 7.2 Caminho da live

1. O programa pede ao exilados-api `POST /api/live/comecar` com o login da pessoa. O exilados-api confere que ela
   é membro ativo, sorteia o caminho `ex/<24 caracteres>` e uma senha de envio de 256 bits, grava a linha em
   `exilados_lives` (com o login da própria pessoa) e devolve caminho e senha.
2. O programa envia por RTSPS (porta 8322) ao MediaMTX, usando a senha de envio.
3. A cada conexão, o MediaMTX pergunta ao exilados-api (autorização HTTP). Para caminhos `ex/...`: envio só com a
  senha daquela live; leitura só com uma permissão de assistir válida. Para os demais caminhos, o exilados-api
  repassa a pergunta ao relay do Ponte, enquanto o Ponte ainda tiver lives.
4. O programa manda sinal de vida a cada 10 s (`POST /api/live/sinal`, com o login da pessoa), que atualiza
  `ultimo_sinal`. Uma live com `ultimo_sinal` de mais de 20 s está encerrada: o site esconde a etiqueta AO VIVO e
  o exilados-api recusa novas leituras. Ao parar normalmente, o programa apaga a própria linha
  (`POST /api/live/parar`); depois de uma queda, a linha velha é substituída na próxima live.
5. No site, clicar em AO VIVO pede `POST /api/live/assistir` (membro ativo) e recebe uma permissão de leitura de
  curta duração; o vídeo vem por WebRTC (WHEP) do MediaMTX.
6. "N assistindo" vem da contagem de leitores daquela live no MediaMTX, consultada pelo exilados-api.

### 7.3 Atualização do programa

- Arquivos em `https://filabox3d.com.br/exilados/atualizacao/`: `manifest.json` (versão, tamanho, SHA-256 e
  assinatura ECDSA P-256) e `Exilados.exe`. O programa confere a assinatura com a chave pública embutida, nunca
  volta de versão e troca de executável sem live em andamento (o mesmo esquema do Ponte).
- A chave privada fica num arquivo fora do repositório, cifrado com uma senha escolhida pelo dono (PBKDF2 com
  600.000 iterações e AES-GCM), para poder ser levada entre os PCs dele. O script de publicação pede a senha.
- O FFmpeg do programa vem do mesmo endereço, o mesmo arquivo que o Ponte usa hoje, conferido pelo SHA-256.

## 8. Servidor

- **exilados-api:** Node 24 (o mesmo que roda o relay), em `127.0.0.1:7415`, serviço systemd com usuário
  descartável e teto de memória. Confere o login de cada pedido chamando o Supabase com o próprio token da pessoa
  (`/auth/v1/user`, com cache de 60 s) e consulta a participação no grupo também com esse token: não usa a chave
  mestra do Supabase. Guarda a chave do LiveKit e a lista de lives em memória (a fonte para o site é
  `exilados_lives`).
- **LiveKit:** servidor oficial (licença Apache 2.0), serviço systemd. Conexão de sinalização pelo nginx
  (`wss://filabox3d.com.br/exilados/rtc`); mídia por UDP 7882, com TCP 7881 de reserva. Sem TURN nesta versão
  (o servidor tem IP público; o TCP 7881 cobre redes que bloqueiam UDP).
- **MediaMTX:** o que já existe. A autorização HTTP passa a apontar para o exilados-api, que repassa ao relay do
  Ponte o que não é do Exilados. Entrega por WebRTC (WHEP) pelo nginx em `/exilados/ao-vivo/`.
- **nginx:** dentro do bloco que já serve `filabox3d.com.br`, os caminhos `/exilados/` (site),
  `/exilados/api/` (exilados-api), `/exilados/rtc` (LiveKit), `/exilados/ao-vivo/` (MediaMTX) e
  `/exilados/atualizacao/` (arquivos do programa). Vale o certificado que o site já usa; o site do FilaBox e os
  caminhos `/ponte/` não mudam.
- **Memória:** o servidor tem cerca de 360 MB livres; os dois serviços novos usam cerca de 150 MB. Na instalação,
  se não houver memória de reserva em disco (swap), é criada uma de 1 GB.
- **Segredos** (só no servidor, fora do repositório): chave e segredo do LiveKit, e a configuração do exilados-api.
- **Para o dono fazer:** liberar UDP 7882 e TCP 7881 no painel da hospedagem, se o firewall de lá bloquear.

## 9. Erros

| Situação | O que acontece |
|---|---|
| Sem internet ou servidor fora do ar | O site mostra "Reconectando..." e tenta de novo sozinho; o texto que estava sendo escrito não se perde. |
| Supabase não responde ao enviar | Aviso na mensagem; o texto fica na caixa para mandar de novo. |
| Imagem grande demais ou formato desconhecido | Recusada no navegador, com o motivo. |
| Permissão de voz ou de live negada | Mensagem clara: "Você não faz mais parte do grupo" ou "A sala não existe mais". |
| Live cai no programa | Reconecta sozinho com o mesmo caminho; se não conseguir em 30 s, encerra e avisa no ícone. |
| Quem assiste perde a live | "Reconectando..." e, se ela acabou, "A live terminou". |

## 10. Testes

- **exilados-api:** testes automáticos (`node --test`) com Supabase, LiveKit e MediaMTX falsos: permissões só
  para membro ativo, remoção tira da voz, autorização do MediaMTX (envio e leitura, repasse ao relay do Ponte),
  fim da live sem sinal de vida.
- **Banco:** as regras de acesso conferidas contra o Supabase de verdade com duas contas de teste num grupo de
  teste (o dono cria as duas contas ou indica quais usar; o assistente não cria contas). Os testes apagam o que
  criarem.
- **Site:** funções puras (redução de imagem, montagem das mensagens, estado da presença) com `node --test`; as
  telas conferidas pelo navegador embutido com as contas de teste.
- **Programa do Windows:** autoteste de live contra o servidor de verdade (vídeo, som, sinal de vida, fim), como o
  do Ponte.
- **De ponta a ponta:** roteiro curto para o dono e um amigo: entrar por convite, conversar com imagem, mensagem
  direta, sala de voz com troca de microfone e saída e volume de cada um, live com o programa e assistir no
  celular.

## 11. Ordem de entrega

Cada etapa tem plano, testes e entrega próprios, e ao fim já dá para usar o que ela traz.

1. **Servidor e contas:** repositório no GitHub, tabelas, regras, funções e a pasta de imagens; exilados-api;
   LiveKit; caminhos no nginx.
2. **Site:** login, convite, grupo, salas de texto com imagens, membros e presença, amigos e mensagens diretas,
   configurações do dono, aplicativo instalável.
3. **Voz:** salas de voz, escolha de microfone e saída, volume de cada pessoa, presença de quem está em cada sala.
4. **Lives:** programa do Windows com atualização assinada; assistir no site; AO VIVO e aviso.
5. **Ponte:** versão nova sem lives e amigos (Windows, Android, páginas e relay); MediaMTX volta a perguntar só
  ao exilados-api.

## 12. Fora desta versão

Editar ou apagar mensagens, menções, reações, apertar para falar, transmitir pelo navegador, live por link aberto,
aplicativo Android nativo, vários grupos, chamada privada entre amigos, notificações com o site fechado,
moderação além de o dono remover membros.
