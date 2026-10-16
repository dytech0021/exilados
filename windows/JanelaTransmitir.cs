namespace Exilados;

/// <summary>
/// Janela Transmitir: uma tela (com o som do computador) ou um programa (só o som dele, Windows 11), qualidade,
/// som, Entrar ao vivo, e a situação da live ("Ao vivo · 3 assistindo").
/// </summary>
internal sealed class JanelaTransmitir : Form
{
    private const int Largura = 420;
    private readonly Bandeja _bandeja;
    private readonly RadioButton _porTela = Opcao("Uma tela (com o som do computador)");
    private readonly RadioButton _porPrograma = Opcao("Um programa (só o som dele)");
    private readonly ComboBox _telas = Visual.Lista(Largura);
    private readonly ComboBox _programas = Visual.Lista(Largura - 92);
    private readonly Button _atualizarProgramas = Visual.Botao("Atualizar", Visual.Cinza, 84);
    private readonly ComboBox _qualidade = Visual.Lista(Largura);
    private readonly CheckBox _som = new() { Text = "Transmitir o som", AutoSize = true, ForeColor = Visual.Texto, Margin = new Padding(0, 4, 0, 4) };
    private readonly Label _situacao = Visual.Rotulo("", Largura, 10.5f, FontStyle.Bold);
    private readonly Button _principal = Visual.Botao("Entrar ao vivo", Visual.Vermelho, Largura);
    private readonly Label _aviso = Visual.Rotulo("", Largura, 9f, cor: Visual.Fraco);
    private static readonly (string Nome, int Altura, int Quadros)[] Qualidades =
        [("1080p · 60 FPS", 1080, 60), ("1080p · 30 FPS", 1080, 30), ("720p · 60 FPS", 720, 60), ("720p · 30 FPS", 720, 30)];

    public JanelaTransmitir(Bandeja bandeja)
    {
        _bandeja = bandeja;
        Visual.Preparar(this, "Transmitir para o Exilados", Largura + 48);
        var linhaProgramas = new FlowLayoutPanel { AutoSize = true, WrapContents = false, Margin = Padding.Empty };
        _atualizarProgramas.Height = _programas.PreferredHeight + 2;
        _atualizarProgramas.Margin = new Padding(8, 0, 0, 8);
        linhaProgramas.Controls.AddRange([_programas, _atualizarProgramas]);
        var coluna = Visual.Coluna(Largura);
        coluna.Controls.AddRange([
            Visual.Rotulo("Transmitir para o grupo", Largura, 15f, FontStyle.Bold, Visual.Forte),
            Visual.Rotulo("Os membros assistem pelo site do Exilados, com menos de 1 segundo de atraso. A live aparece como AO VIVO.", Largura, 9.5f, cor: Visual.Fraco),
            Visual.Secao("O que transmitir", Largura),
            _porTela, _telas, _porPrograma, linhaProgramas,
            Visual.Secao("Qualidade", Largura), _qualidade,
            _som,
            _situacao,
            _principal,
            _aviso,
            Visual.Link("Abrir o Exilados no navegador", () => Conta.AbrirNavegador(Conta.Site)),
        ]);
        Controls.Add(coluna);
        coluna.Location = new Point(Padding.Left, Padding.Top);

        foreach (var q in Qualidades) _qualidade.Items.Add(q.Nome);
        var config = bandeja.Configuracao;
        int escolhida = Array.FindIndex(Qualidades, q => q.Altura == config.Altura && q.Quadros == config.Quadros);
        _qualidade.SelectedIndex = Math.Max(0, escolhida);
        _som.Checked = config.Som;
        PreencherTelas(config.Tela);
        PreencherProgramas();
        if (!SomDePrograma.Disponivel) _porPrograma.Text = "Um programa (só o som dele exige Windows 11)";
        (config.Fonte == "programa" ? _porPrograma : _porTela).Checked = true;

        _porTela.CheckedChanged += (_, _) => Habilitar();
        _porPrograma.CheckedChanged += (_, _) => Habilitar();
        _atualizarProgramas.Click += (_, _) => PreencherProgramas();
        _principal.Click += async (_, _) => await PrincipalAsync();
        bandeja.Mudou += Atualizar;
        FormClosed += (_, _) => bandeja.Mudou -= Atualizar;
        Atualizar();
    }

    private static RadioButton Opcao(string texto) => new()
    {
        Text = texto, AutoSize = true, ForeColor = Visual.Texto, Margin = new Padding(0, 2, 0, 4),
    };

    private void PreencherTelas(string anterior)
    {
        _telas.Items.Clear();
        var telas = Screen.AllScreens;
        for (int i = 0; i < telas.Length; i++)
            _telas.Items.Add($"Tela {i + 1}{(telas[i].Primary ? " (principal)" : "")} — {telas[i].Bounds.Width}×{telas[i].Bounds.Height}");
        int indice = Array.FindIndex(telas, t => t.DeviceName == anterior);
        _telas.SelectedIndex = indice >= 0 ? indice : Math.Max(0, Array.FindIndex(telas, t => t.Primary));
    }

    private void PreencherProgramas()
    {
        var anterior = _programas.SelectedItem as ProgramaAberto;
        _programas.Items.Clear();
        foreach (var p in ProgramaAberto.Listar()) _programas.Items.Add(p);
        int indice = anterior is null ? -1 : _programas.Items.Cast<ProgramaAberto>().ToList().FindIndex(p => p.Janela == anterior.Janela);
        if (_programas.Items.Count > 0) _programas.SelectedIndex = Math.Max(0, indice);
    }

    private void Habilitar()
    {
        bool livre = _bandeja.Live is null && !_bandeja.Comecando;
        _porTela.Enabled = _porPrograma.Enabled = _qualidade.Enabled = _som.Enabled = livre;
        _telas.Enabled = livre && _porTela.Checked;
        _programas.Enabled = _atualizarProgramas.Enabled = livre && _porPrograma.Checked;
    }

    private void Atualizar()
    {
        if (IsDisposed) return;
        var live = _bandeja.Live;
        if (_bandeja.Comecando)
        {
            _situacao.Text = _bandeja.Andamento;
            _situacao.ForeColor = Visual.Fraco;
            _principal.Text = "Começando...";
            _principal.Enabled = false;
        }
        else if (live is not null)
        {
            _situacao.Text = live.AoVivo
                ? $"● Ao vivo{(live.Assistindo >= 0 ? $" · {live.Assistindo} assistindo" : "")}"
                : live.Situacao;
            _situacao.ForeColor = live.AoVivo ? Color.FromArgb(0xF2, 0x3F, 0x43) : Visual.Fraco;
            _principal.Text = "Parar transmissão";
            _principal.BackColor = Visual.Cinza;
            _principal.Enabled = true;
            _aviso.Text = $"{live.Opcoes.Nome} · placa {Codificador.Marca(live.CodificadorUsado)}";
        }
        else
        {
            _situacao.Text = _bandeja.UltimoProblema.Length > 0 ? _bandeja.UltimoProblema : "Pronto para entrar ao vivo.";
            _situacao.ForeColor = _bandeja.UltimoProblema.Length > 0 ? Color.FromArgb(0xFA, 0x77, 0x7C) : Visual.Texto;
            _principal.Text = "Entrar ao vivo";
            _principal.BackColor = Visual.Vermelho;
            _principal.Enabled = true;
            _aviso.Text = _bandeja.Configuracao.Nome.Length > 0 ? $"Conectado como {_bandeja.Configuracao.Nome}." : "";
        }
        Habilitar();
    }

    private async Task PrincipalAsync()
    {
        if (_bandeja.Live is not null)
        {
            await _bandeja.PararAsync();
            return;
        }
        var q = Qualidades[Math.Max(0, _qualidade.SelectedIndex)];
        var config = _bandeja.Configuracao;
        config.Altura = q.Altura;
        config.Quadros = q.Quadros;
        config.Som = _som.Checked;
        config.Fonte = _porPrograma.Checked ? "programa" : "tela";
        var telas = Screen.AllScreens;
        int tela = Math.Clamp(_telas.SelectedIndex, 0, telas.Length - 1);
        config.Tela = telas[tela].DeviceName;
        config.Salvar();
        ProgramaAberto? programa = null;
        if (_porPrograma.Checked)
        {
            programa = _programas.SelectedItem as ProgramaAberto;
            if (programa is null)
            {
                MessageBox.Show(this, "Escolha o programa na lista (abra-o antes e clique em Atualizar).", "Exilados", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
        }
        await _bandeja.ComecarAsync(new OpcoesLive(q.Altura, q.Quadros, _som.Checked, tela, programa));
    }
}
