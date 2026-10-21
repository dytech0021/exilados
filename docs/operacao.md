# Exilados: operação

Como o Exilados está montado, como publicar cada parte e como conferir que está tudo de pé.

## 1. Peças e endereços

| Peça | Onde | Observação |
|---|---|---|
| Site | https://filabox3d.com.br/exilados/ (`/var/www/exilados/www/exilados/`) | Estático, publicado por `servidor/publicar.ps1`. |
| exilados-api | `127.0.0.1:7415` (pelo nginx em `/exilados/api/`) e `127.0.0.1:7416` (autorização do MediaMTX) | `/opt/exilados/api`, serviço `exilados-api`. |
| LiveKit (voz) | `127.0.0.1:7880` (pelo nginx em `/exilados/rtc`), UDP 7882 e TCP 7881 públicas | `/opt/livekit/1.13.7`, serviço `exilados-livekit`. |
| MediaMTX (lives) | RTSPS 8322 (envio), WebRTC 8189 (assistir), WHEP pelo nginx em `/exilados/ao-vivo/` | Configuração em `servidor/mediamtx/mediamtx.yml`. |
| Programa do Windows | `https://filabox3d.com.br/exilados/atualizacao/` (`Exilados.exe`, `manifest.json` e o pacote do FFmpeg) | Publicado por `windows/publicar.ps1`. |
| App Android | `https://filabox3d.com.br/exilados/atualizacao/Exilados.apk` (QR code no programa do Windows, botão de baixar no navegador do Android) | Gerado por `android/gerar-apk.ps1`, publicado por `android/publicar-apk.ps1`. |
| Banco | Supabase do FilaBox (`kobtvgqnitdeviddvymm`), tabelas `exilados_*` e pasta `exilados` | `banco/001_exilados.sql`. |

Servidor: Ubuntu 24.04 (177.153.35.193), o mesmo do FilaBox e do relay do Ponte. Acesso como root com a chave
`~/.ssh/filabox3d_deploy_ed25519` e `UserKnownHostsFile=~/.ssh/filabox3d_known_hosts`.

Segredos, só no servidor: `/etc/exilados/api.env` (chave e segredo do LiveKit, segredo das lives) e
`/etc/exilados/livekit.yaml`, os dois gerados pelo `instalar.sh` na primeira vez (0600, root).

## 2. Publicar

### 2.1 Site, exilados-api e servidor

```
.\servidor\publicar.ps1
```

Roda os testes do exilados-api, empacota `api/`, `servidor/` e `site/`, envia e roda `servidor/instalar.sh` como
root. Cada passo confere o que já existe e pode rodar de novo. nginx e MediaMTX voltam ao arquivo anterior se a
mudança não passar na conferência. O MediaMTX só é mexido sem live no ar (ou com `FORCAR_MEDIAMTX=1`).

### 2.2 Programa do Windows

1. Suba `<Version>` em `windows/Exilados.csproj`.
2. `.\windows\publicar.ps1`

Ele compila (arquivo único), assina com a chave de atualização e envia. Os programas instalados instalam a versão
nova ao abrir; abertos, procuram a cada hora e mostram a setinha verde (clicar reinicia na nova). Sem clique, a troca
acontece ao fechar ou reabrir a janela, nunca com live no ar ou na voz.

**Chave de atualização:** `OneDrive\Exilados\chave-atualizacao.exk`, cifrada com a senha do dono (PBKDF2 com
600.000 rodadas e AES-GCM). Neste PC a senha fica protegida pelo Windows em `%APPDATA%\Exilados-publicar\senha.dpapi`;
em outro PC, o `publicar.ps1` pede a senha e oferece guardar. Sem a chave, nenhuma cópia instalada aceita
atualização: guarde a senha num gerenciador de senhas.

### 2.3 App Android

1. Suba `versionCode` (de um em um) e `versionName` (a mesma versão do programa) em `android/app/build.gradle.kts`.
2. `.\android\gerar-apk.ps1` (testes, análise, compilação e assinatura; o APK fica em `pronto\Exilados.apk`).
3. `.\android\publicar-apk.ps1` (envia ao servidor).
4. Versão no GitHub com os dois arquivos: `gh release create vX.Y.Z -R dytech0021/exilados pronto\Exilados.exe pronto\Exilados.apk`
   (o `.exe` publicado fica em `%TEMP%\exilados-windows-publicar\Exilados.exe`).

O app é o site dentro de um WebView (`android/`), como o programa do Windows. O login com Google vai pelo navegador do
celular e volta para `http://127.0.0.1:53682/exilados`, o mesmo endereço do programa, já autorizado no Supabase. Na
sala de voz, um serviço com a notificação "Na sala de voz" mantém a voz com a tela apagada.

**Chave do APK:** `OneDrive\Exilados\exilados-android.jks` (criada pelo `gerar-apk.ps1` na primeira vez), com a mesma
senha da chave de atualização do programa. Sem ela, o Android não instala versões novas por cima: quem tiver o app
teria de desinstalar e instalar de novo.

### 2.4 Banco

Mudanças no banco vão em arquivos novos em `banco/` (`003_...sql`), aplicados pelo editor de SQL do Supabase, cada
um com o seu teste (`testes.sql` para o `001`, `testes_002.sql` para o `002`). Os testes usam contas simuladas e desfazem
tudo no fim (terminam com `RESULTADO: tudo certo`).

| Migração | O que traz |
|---|---|
| `001_exilados.sql` | Tabelas, regras de acesso, convites, salas, amizades, mensagens, lives, imagens e tempo real. |
| `002_ids.sql` | ID de 9 dígitos de cada conta (`exilados_meu_id`) e entrar no grupo pelo ID (`exilados_adicionar_por_id`): qualquer membro adiciona; quem o dono removeu só volta pelo dono. |

O dono e as salas iniciais foram criados por um comando avulso (fora do repositório, porque tem o e-mail):

```sql
insert into public.exilados_membros (user_id, nome, papel)
select id, 'Nome', 'dono' from auth.users where lower(email) = '<e-mail do dono>'
on conflict (user_id) do update set papel = 'dono', ativo = true;
```

## 3. Conferir

| O quê | Como |
|---|---|
| exilados-api | `curl https://filabox3d.com.br/exilados/api/saude` → `{"ok":true,...}` |
| Serviços | `systemctl status exilados-api exilados-livekit mediamtx` |
| Voz pela internet | `lk load-test --url wss://filabox3d.com.br/exilados --room teste --audio-publishers 1 --subscribers 2` (com a chave do `api.env`) |
| Programa do Windows | `Exilados.exe --autoteste pasta` (com uma conta guardada no programa, testa também a live pelo servidor) |
| Janelas do programa | `Exilados.exe --captura-ui pasta` |
| Atualização automática | `.\ferramentas\teste-atualizacao\teste.ps1`: duas versões de teste com chave descartável e o site de demonstração; confere abrir com versão nova, a setinha verde e o clique nela, e fechar e abrir de novo (não toca na cópia instalada nem no servidor) |
| Site sem contas | `node ferramentas/demo/servidor.mjs` e abrir http://localhost:5180/exilados/ (Supabase de mentira; `--livekit arquivo` liga a voz de verdade; outra aba com `?como=lucas` entra como outra pessoa, para testar a tela compartilhada) |
| Testes | `cd api && node --test` (29) e `cd site && node --test` (22) |

Registros do programa: `%APPDATA%\Exilados\sessoes.txt` (início, fim e quedas das lives) e `erros.txt`.

## 4. Roteiro de ponta a ponta (dono e um amigo)

1. Dono: entrar no site com a conta do FilaBox; botão "Convidar pessoas" (no alto da lista de membros ou o ícone ao
   lado de "Exilados") → "Criar link de convite"; mandar o link. Ou: o amigo cria a conta e abre o Exilados, vê o ID
   dele (9 dígitos), e o dono digita esse número em "Adicionar pelo ID".
2. Amigo: abrir o link, criar a conta (ou entrar), escolher o nome, entrar.
3. Os dois: mandar mensagem com imagem na `#geral`; virar amigos (Mensagens diretas → Adicionar amigo) e trocar
   uma mensagem direta.
4. Os dois: entrar na sala de voz Geral; conferir o anel verde de quem fala; trocar microfone e saída em
   Configurações → Voz e áudio sem sair da sala; ajustar o volume do outro (botão direito no nome).
   Dono (no PC): botão de tela no painel de voz → qualidade → escolher uma janela ou a tela inteira (marcar "Compartilhar
   áudio do sistema"); amigo: clicar em AO VIVO ao lado do nome (no PC e no celular), conferir imagem, som e o
   número de quem assiste; dono: "Parar".
5. Dono: baixar o programa em Configurações → Transmitir, entrar ao vivo com um jogo; amigo: clicar em AO VIVO
   (no PC e no celular) e conferir imagem e som.
6. Dono: remover o amigo em Configurações → Membros e conferir que ele cai da voz e perde o acesso; readmitir.

## 5. Problemas conhecidos

| Situação | O que fazer |
|---|---|
| iPhone: a voz para ao trocar de aplicativo ou apagar a tela | Limite do Safari; volta ao abrir o site. |
| Som da tela compartilhada pelo site | No Windows o Chrome/Edge manda o som do sistema todo (outros programas também); o site pede para deixar de fora o som da própria sala, o que os navegadores atuais respeitam. Se alguém ouvir o próprio eco, desmarque o som ao compartilhar. Para mandar só o som do jogo, use o programa do Windows. |
| Rede que bloqueia UDP | A voz usa o TCP 7881 e as lives o TCP 8189 sozinhas. Sem TURN nesta versão. |
| Voz robótica/abafada | O cancelamento de ruído (RNNoise) estragava a voz e vem desligado desde 20/10; no Android a voz sai direto do microfone (sem o tratamento do computador). Se voltar, conferir em Configurações → Voz e áudio se alguém ligou o cancelamento. |
| Conexão de voz que cai e volta a cada poucos segundos | Visto em 20/10 (motivo "RR_SIGNAL_DISCONNECTED" no LiveKit, a conexão de controle pelo nginx fechando sozinha), em rajadas, nos dois programas da ligação; causa ainda não achada. `journalctl -u exilados-livekit \| grep resuming` mostra quando acontece. |
| `MissingPartition` no canal de presença | O Supabase cria as partições de `realtime.messages` sozinho; na primeira vez pode falhar uma vez. |
