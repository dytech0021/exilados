namespace Exilados;

/// <summary>
/// O programa fica perto do relógio. Menu: Abrir o Exilados (a janela principal, com o site), Transmitir..., Parar
/// transmissão, Abrir com o Windows, Sair da conta e Sair.
/// Atualização como a do Discord: ao abrir, procura uma versão nova e instala antes de mostrar a janela; aberto, procura
/// a cada hora e baixa sozinho, e a setinha verde aparece no site (clicar nela reinicia na versão nova). Sem clique, a
/// versão nova entra quando a janela é fechada ou aberta de novo, nunca no meio de uma live ou de uma conversa de voz.
/// </summary>
internal sealed class Bandeja : ApplicationContext
{
    private readonly SynchronizationContext _ui;
    private readonly NotifyIcon _icone;
    private readonly ToolStripMenuItem _quem, _atualizar, _transmitir, _parar, _comWindows, _sairConta;
    private readonly System.Windows.Forms.Timer _relogio = new() { Interval = 60 * 60 * 1000 };
    private readonly System.Windows.Forms.Timer _tentarAtualizar = new() { Interval = 10 * 60 * 1000 };
    private readonly bool _comJanela = JanelaPrincipal.Disponivel;
    private JanelaPrincipal? _principal;
    private JanelaTransmitir? _janela;
    private JanelaEntrar? _entrar;
    private Conta? _conta;
    private AcessoDoSite? _site;
    private Manifesto? _pendente;
    private string? _baixado;
    private bool _trocando;

    /// <summary>Versão nova já baixada e conferida, pronta para instalar (a setinha verde), ou null.</summary>
    public string? AtualizacaoPronta => _baixado is not null ? _pendente?.Version : null;

    public Config Configuracao { get; }
    public Transmissao? Live { get; private set; }
    public bool Comecando { get; private set; }
    public string Andamento { get; private set; } = "";
    public string UltimoProblema { get; private set; } = "";
    /// <summary>Nome de quem transmite: a conta guardada no programa ou a do site da janela principal.</summary>
    public string NomeConectado => _conta is not null ? Configuracao.Nome : _site?.Nome ?? "";
    private IAcesso? Acesso => (IAcesso?)_conta ?? _site;
    /// <summary>Mudou algo que as janelas mostram. Sempre na thread da interface.</summary>
    public event Action? Mudou;

    /// <param name="inicio">Aberto com o Windows: fica só perto do relógio.</param>
    /// <param name="atualizado">Aberto pela versão anterior, que acabou de se trocar por esta.</param>
    /// <param name="abrir">Com <paramref name="atualizado"/>: a pessoa estava com a janela aberta, que volta à vista.</param>
    public Bandeja(bool inicio, bool atualizado, bool abrir, EventWaitHandle mostrar)
    {
        _ui = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();
        Configuracao = Config.Carregar();
        _conta = Conta.Restaurar(Configuracao);
        if (_conta is not null) _conta.TokenMudou += Guardar;
        Inicializacao.Aplicar(Configuracao.AbrirComWindows);

        _quem = new ToolStripMenuItem { Enabled = false };
        _atualizar = new ToolStripMenuItem("Reiniciar para atualizar", null, async (_, _) => await AtualizarAgoraAsync())
        {
            Visible = false,
            ForeColor = Visual.Verde,
            Font = new Font(SystemFonts.MenuFont ?? Control.DefaultFont, FontStyle.Bold),
        };
        _transmitir = new ToolStripMenuItem("Transmitir...", null, (_, _) => MostrarTransmitir());
        _parar = new ToolStripMenuItem("Parar transmissão", null, async (_, _) => await PararAsync());
        _comWindows = new ToolStripMenuItem("Abrir com o Windows", null, (_, _) => AlternarInicializacao()) { Checked = Configuracao.AbrirComWindows };
        _sairConta = new ToolStripMenuItem("Sair da conta", null, async (_, _) => await SairDaContaAsync());
        var menu = new ContextMenuStrip();
        menu.Items.AddRange([
            _quem,
            _atualizar,
            new ToolStripSeparator(),
            new ToolStripMenuItem("Abrir o Exilados", null, (_, _) => AbrirExilados()),
            _transmitir,
            _parar,
            new ToolStripSeparator(),
            _comWindows,
            _sairConta,
            new ToolStripMenuItem("Sair", null, async (_, _) => await SairAsync()),
        ]);
        _icone = new NotifyIcon { Icon = Visual.Icone, Text = "Exilados", ContextMenuStrip = menu, Visible = true };
        _icone.DoubleClick += (_, _) => MostrarPrincipal();
        AtualizarMenu();

        // Uma segunda cópia aberta só pede para esta mostrar a janela.
        ThreadPool.RegisterWaitForSingleObject(mostrar, (_, _) => _ui.Post(_ => MostrarPrincipal(), null), null, -1, false);

        _relogio.Tick += async (_, _) => await ProcurarAtualizacaoAsync();
        _relogio.Start();
        _tentarAtualizar.Tick += async (_, _) =>
        {
            _tentarAtualizar.Stop();
            await AplicarPendenteAsync();
        };

        if (atualizado)
        {
            if (abrir) _ui.Post(_ => MostrarPrincipal(), null);
            else _icone.ShowBalloonTip(5000, "Exilados", $"Atualizado para a versão {Atualizacao.Atual}.", ToolTipIcon.Info);
        }
        else if (inicio)
        {
            // Com o Windows: a internet pode demorar a voltar; procura daqui a 1 minuto.
            _ = Task.Delay(TimeSpan.FromSeconds(60)).ContinueWith(_ => _ui.Post(async _ => await ProcurarAtualizacaoAsync(), null), TaskScheduler.Default);
            if (_conta is null && !_comJanela) _icone.ShowBalloonTip(8000, "Exilados", "Entre na sua conta para transmitir para o grupo (duplo clique aqui).", ToolTipIcon.Info);
        }
        else _ui.Post(async _ => await AbrirComAtualizacaoAsync(), null);
    }

    private void Guardar(Conta conta) => _ui.Post(_ =>
    {
        conta.Guardar(Configuracao);
        Configuracao.Salvar();
    }, null);

    private void Avisar()
    {
        AtualizarMenu();
        Mudou?.Invoke();
    }

    private void AtualizarMenu()
    {
        string quem = _conta is not null ? (Configuracao.Nome.Length > 0 ? Configuracao.Nome : Configuracao.Email) : _site?.Nome ?? "";
        string versao = $"Exilados {Atualizacao.Atual}";
        _quem.Text = quem.Length > 0 ? $"{versao} — {quem}" : _comJanela ? versao : $"{versao} — sem conta neste computador";
        _atualizar.Visible = AtualizacaoPronta is not null;
        _atualizar.Text = $"Reiniciar para atualizar (versão {AtualizacaoPronta})";
        _transmitir.Enabled = !Comecando;
        _parar.Enabled = Live is not null;
        _sairConta.Enabled = _conta is not null && Live is null;
        string texto = Live is { AoVivo: true } l ? $"Exilados — ao vivo{(l.Assistindo >= 0 ? $" · {l.Assistindo} assistindo" : "")}"
            : Live is not null ? "Exilados — reconectando a live"
            : AtualizacaoPronta is not null ? "Exilados — atualização pronta" : "Exilados";
        _icone.Text = texto.Length > 63 ? texto[..63] : texto;
    }

    // ---------- janelas ----------

    /// <summary>A janela principal (o site); sem o WebView2 no Windows, a janela Transmitir, como antes.</summary>
    public void MostrarPrincipal()
    {
        if (_comJanela) _ = ReabrirAsync();
        else MostrarTransmitir();
    }

    public void AbrirExilados()
    {
        if (_comJanela) _ = ReabrirAsync();
        else Conta.AbrirNavegador(Conta.Site);
    }

    /// <summary>
    /// Mostra a janela principal. Fechada, com a versão nova já baixada e a pessoa fora da voz e sem live: instala antes
    /// e abre já a versão nova (como o Discord ao abrir).
    /// </summary>
    private async Task ReabrirAsync()
    {
        if (_trocando) return;
        if (AtualizacaoPronta is not null && Live is null && !Comecando && _principal is not { Visible: true } &&
            !(_principal is { IsDisposed: false } escondida && await escondida.OcupadaAsync()))
        {
            await InstalarAsync(abrirJanela: true);
            if (_trocando) return;
        }
        Principal().Mostrar();
    }

    public JanelaPrincipal Principal()
    {
        if (_principal is { IsDisposed: false }) return _principal;
        _principal = new JanelaPrincipal(this);
        return _principal;
    }

    /// <summary>Fecharam a janela principal: o programa continua perto do relógio.</summary>
    public void JanelaEscondida()
    {
        if (!Configuracao.AvisouBandeja)
        {
            Configuracao.AvisouBandeja = true;
            Configuracao.Salvar();
            _icone.ShowBalloonTip(8000, "O Exilados continua aberto",
                "Ele fica aqui perto do relógio (a voz continua). Para fechar de vez, clique com o botão direito no ícone e escolha Sair.", ToolTipIcon.Info);
        }
        _ = AplicarPendenteAsync();
    }

    public void MostrarTransmitir() => _ = MostrarTransmitirAsync();

    private async Task MostrarTransmitirAsync()
    {
        if (MostrarSeAberta()) return;
        // Sem conta guardada no programa: usa o login do site da janela principal (sem entrar duas vezes).
        if (_conta is null && Live is null && !Comecando)
        {
            if (!_comJanela)
            {
                MostrarEntrar();
                return;
            }
            var principal = Principal();
            if (!principal.Visible && !principal.IsHandleCreated) principal.Mostrar();
            var sessao = await principal.SessaoAsync(CancellationToken.None);
            _site = sessao is null ? null : new AcessoDoSite(principal, sessao);
            Avisar();
            if (_site is null)
            {
                principal.Mostrar();
                MessageBox.Show(principal, "Entre na sua conta aqui no Exilados para transmitir.", "Exilados", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
        }
        if (MostrarSeAberta()) return;
        _janela = new JanelaTransmitir(this);
        _janela.Show();
        _janela.Activate();
    }

    private bool MostrarSeAberta()
    {
        if (_janela is not { IsDisposed: false }) return false;
        if (_janela.WindowState == FormWindowState.Minimized) _janela.WindowState = FormWindowState.Normal;
        _janela.Activate();
        return true;
    }

    private void MostrarEntrar()
    {
        if (_entrar is { IsDisposed: false })
        {
            _entrar.Activate();
            return;
        }
        _entrar = new JanelaEntrar(Configuracao.Email);
        _entrar.FormClosed += (_, _) =>
        {
            var janela = _entrar;
            _entrar = null;
            if (janela?.DialogResult != DialogResult.OK || janela.Conta is null) return;
            _conta = janela.Conta;
            _conta.TokenMudou += Guardar;
            _conta.Guardar(Configuracao);
            Configuracao.Nome = janela.NomeNoGrupo;
            Configuracao.Salvar();
            Avisar();
            MostrarTransmitir();
        };
        _entrar.Show();
        _entrar.Activate();
    }

    // ---------- live ----------

    public async Task ComecarAsync(OpcoesLive opcoes)
    {
        if (Acesso is not { } acesso || Live is not null || Comecando) return;
        Comecando = true;
        UltimoProblema = "";
        Andamento = "Começando...";
        Avisar();
        try
        {
            var live = await Transmissao.ComecarAsync(new Api(acesso), opcoes, texto => _ui.Post(_ =>
            {
                Andamento = texto;
                Avisar();
            }, null), CancellationToken.None);
            live.Mudou += () => _ui.Post(_ => Avisar(), null);
            live.Encerrada += motivo => _ui.Post(async _ => await AoEncerrarAsync(live, motivo), null);
            Live = live;
        }
        catch (Exception ex) when (ex is ExiladosException or LiveTerminadaException or IOException)
        {
            UltimoProblema = ex.Message;
            Registro.Sessao($"live: não começou ({ex.Message})");
        }
        catch (Exception ex)
        {
            UltimoProblema = "Algo deu errado ao começar a live. Tente de novo.";
            Registro.Erro(ex);
        }
        finally
        {
            Comecando = false;
            Avisar();
        }
    }

    private async Task AoEncerrarAsync(Transmissao live, string motivo)
    {
        if (Live != live) return;
        Live = null;
        UltimoProblema = motivo;
        Avisar();
        _icone.ShowBalloonTip(10000, "A live terminou", motivo, ToolTipIcon.Warning);
        await live.DisposeAsync();
        await AplicarPendenteAsync();
    }

    public async Task PararAsync(bool aplicarDepois = true)
    {
        var live = Live;
        if (live is null) return;
        Live = null;
        Avisar();
        await live.DisposeAsync();
        Avisar();
        if (aplicarDepois) await AplicarPendenteAsync();
    }

    // ---------- conta, inicialização, sair ----------

    private void AlternarInicializacao()
    {
        Configuracao.AbrirComWindows = !Configuracao.AbrirComWindows;
        _comWindows.Checked = Configuracao.AbrirComWindows;
        Configuracao.Salvar();
        Inicializacao.Aplicar(Configuracao.AbrirComWindows);
    }

    private async Task SairDaContaAsync()
    {
        if (_conta is null || Live is not null) return;
        var conta = _conta;
        _conta = null;
        Conta.Esquecer(Configuracao);
        Configuracao.Salvar();
        _janela?.Close();
        Avisar();
        await conta.SairAsync();
    }

    private async Task SairAsync()
    {
        await PararAsync(aplicarDepois: false);
        Encerrar();
    }

    private void Encerrar()
    {
        _principal?.Fechar();
        _icone.Visible = false;
        _icone.Dispose();
        ExitThread();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _relogio.Dispose();
            _tentarAtualizar.Dispose();
            _principal?.Dispose();
            _icone.Visible = false;
            _icone.Dispose();
        }
        base.Dispose(disposing);
    }

    // ---------- atualização ----------

    /// <summary>Ao abrir o programa: procura uma versão nova (no máximo 5 s) e, se houver, instala antes de mostrar a janela.</summary>
    private async Task AbrirComAtualizacaoAsync()
    {
        if (Atualizacao.PodeSeAtualizar)
        {
            var aviso = new JanelaAtualizando("Procurando atualização...");
            aviso.Show();
            try
            {
                Manifesto? manifesto;
                using (var prazo = new CancellationTokenSource(TimeSpan.FromSeconds(5)))
                    manifesto = await Atualizacao.ProcurarAsync(prazo.Token);
                if (manifesto is not null)
                {
                    Registro.Sessao($"atualização: versão {manifesto.Version} disponível ao abrir");
                    aviso.Mostrar($"Baixando a versão {manifesto.Version}...");
                    using var prazo = new CancellationTokenSource(TimeSpan.FromMinutes(2));
                    _baixado = await Atualizacao.BaixarAsync(manifesto, prazo.Token);
                    _pendente = manifesto;
                    aviso.Mostrar("Atualizando...");
                    await InstalarAsync(abrirJanela: true, aviso);
                }
            }
            catch (Exception ex) when (ex is ExiladosException or OperationCanceledException or IOException or HttpRequestException or UnauthorizedAccessException)
            {
                _pendente = null;
                _baixado = null;
                Registro.Sessao($"atualização ao abrir: {ex.Message}");
            }
            finally
            {
                // Trocando, o aviso fica até esta versão fechar (a nova abre a janela em seguida).
                if (!_trocando) aviso.Close();
            }
            if (_trocando) return;
        }
        if (_comJanela) Principal().Mostrar();
        else MostrarTransmitir();
    }

    /// <summary>Com o programa aberto (a cada hora): baixa a versão nova e mostra a setinha; com a janela fechada, já instala.</summary>
    private async Task ProcurarAtualizacaoAsync()
    {
        if (!Atualizacao.PodeSeAtualizar || _pendente is not null || _trocando) return;
        try
        {
            using var prazo = new CancellationTokenSource(TimeSpan.FromMinutes(5));
            var manifesto = await Atualizacao.ProcurarAsync(prazo.Token);
            if (manifesto is null) return;
            _pendente = manifesto;
            Registro.Sessao($"atualização: versão {manifesto.Version} disponível");
            _baixado = await Atualizacao.BaixarAsync(manifesto, prazo.Token);
            MudouAtualizacao();
            await AplicarPendenteAsync();
        }
        catch (Exception ex) when (ex is ExiladosException or OperationCanceledException or IOException or HttpRequestException or UnauthorizedAccessException)
        {
            _pendente = null;
            _baixado = null;
            Registro.Sessao($"atualização: {ex.Message}");
        }
    }

    private void MudouAtualizacao()
    {
        Avisar();
        _principal?.AvisarAtualizacao();
    }

    /// <summary>Clicaram na setinha verde (ou em Reiniciar para atualizar): reinicia já na versão nova, com a janela aberta.</summary>
    public async Task AtualizarAgoraAsync()
    {
        if (AtualizacaoPronta is not { } versao || _trocando || Comecando) return;
        if (Live is not null)
        {
            string texto = $"A sua live vai parar para o Exilados reiniciar na versão {versao}. Continuar?";
            var resposta = _principal is { Visible: true } janela
                ? MessageBox.Show(janela, texto, "Exilados", MessageBoxButtons.YesNo, MessageBoxIcon.Question)
                : MessageBox.Show(texto, "Exilados", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
            if (resposta != DialogResult.Yes) return;
            await PararAsync(aplicarDepois: false);
        }
        await InstalarAsync(abrirJanela: true);
    }

    // Sem clique na setinha, a troca acontece com a janela fechada, sem live no ar e fora da voz (ninguém perde a live
    // ou a conversa por causa de uma atualização); com a janela em uso, tenta de novo daqui a 10 minutos.
    private async Task AplicarPendenteAsync()
    {
        if (AtualizacaoPronta is null || Live is not null || Comecando || _trocando) return;
        if (await JanelaEmUsoAsync()) return;
        if (AtualizacaoPronta is null || Live is not null || Comecando) return;
        await InstalarAsync(abrirJanela: false);
    }

    /// <summary>
    /// Troca pela versão já baixada e encerra; a nova abre sozinha (com a janela à vista, se <paramref name="abrirJanela"/>,
    /// e com o aviso "Atualizando..." enquanto isso). Se a troca falhar, continua nesta versão.
    /// </summary>
    private async Task InstalarAsync(bool abrirJanela, JanelaAtualizando? aviso = null)
    {
        if (_pendente is not { } manifesto || _baixado is not { } novo || _trocando) return;
        _trocando = true;
        _tentarAtualizar.Stop();
        bool avisoMeu = aviso is null && abrirJanela;
        if (avisoMeu)
        {
            aviso = new JanelaAtualizando("Atualizando...");
            aviso.Show();
        }
        try
        {
            Registro.Sessao($"atualização: instalando a versão {manifesto.Version}");
            await Task.Run(() => Atualizacao.Aplicar(novo, manifesto, abrirJanela));
            Encerrar();
        }
        catch (Exception ex) when (ex is ExiladosException or IOException or UnauthorizedAccessException)
        {
            _trocando = false;
            _pendente = null;
            _baixado = null;
            Registro.Sessao($"atualização: {ex.Message}");
            if (avisoMeu) aviso?.Close();
            MudouAtualizacao();
        }
    }

    /// <summary>A janela principal está à vista, ou escondida com a pessoa numa sala de voz: a troca fica para depois.</summary>
    private async Task<bool> JanelaEmUsoAsync()
    {
        if (_principal is not { IsDisposed: false } principal || (!principal.Visible && !await principal.OcupadaAsync())) return false;
        _tentarAtualizar.Stop();
        _tentarAtualizar.Start();
        return true;
    }
}
