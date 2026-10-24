# Exilados

Lugar do grupo para conversar por texto e voz, compartilhar a tela na sala de voz e assistir às lives uns dos
outros, com o jeito do Discord.

- **Site:** https://filabox3d.com.br/exilados/ (funciona no navegador do PC, do Android e do iPhone, e pode ser
  instalado como aplicativo).
- **Compartilhar a tela:** pelo site no computador, dentro da sala de voz (botão de tela no painel de voz); quem
  está na sala assiste no PC ou no celular.
- **Assistir:** cada live ou tela abre numa janela própria sobre o chat. Arraste o título para mover e as bordas
  ou cantos para mudar a largura e a altura; fechar uma janela mantém as outras abertas.
- **Programa para Windows:** para transmitir um jogo com o som só dele (isolado do resto do PC).
- **Entrar no grupo:** só com um link de convite de um membro.

## Como é feito

| Pasta | O que tem |
|---|---|
| `site/` | O site: HTML, CSS e JavaScript, sem etapa de compilação. Bibliotecas em `site/vendor/`. |
| `api/` | exilados-api: Node 24, sem pacotes externos. Permissões de voz e de live. |
| `banco/` | Tabelas, regras de acesso e funções no Supabase. |
| `servidor/` | LiveKit, MediaMTX, nginx, serviços e o roteiro de instalação. |
| `ferramentas/` | Modo de demonstração do site (sem contas) e geração dos ícones. |
| `windows/` | Programa Exilados para Windows (C# / .NET 10). |
| `docs/` | Especificação, plano, desenho e operação. |

A especificação está em [docs/superpowers/specs/2026-10-15-exilados-design.md](docs/superpowers/specs/2026-10-15-exilados-design.md);
publicar, conferir e o roteiro de ponta a ponta, em [docs/operacao.md](docs/operacao.md).

Nenhuma chave, senha ou token fica neste repositório: as do servidor ficam no servidor, e a que assina as
atualizações do programa fica com o dono.
