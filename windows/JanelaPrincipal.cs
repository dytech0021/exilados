using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Exilados;

/// <summary>Login que o site da janela principal empresta ao programa.</summary>
internal sealed record SessaoDoSite(string Token, string Usuario, string Email, string Nome);

/// <summary>
/// Janela principal: o site do Exilados inteiro dentro do programa (WebView2), como o aplicativo do Discord. Fechar só
/// esconde a janela (a voz continua e o programa segue perto do relógio). Links de fora abrem no navegador, e o login
/// com Google também passa por ele (o Google não aceita login dentro de programas) e volta para cá. O site pede a
/// janela Transmitir, empresta o login dele às lives e diz se a pessoa está numa sala de voz; o programa conta a ele
/// quando há versão nova pronta (a setinha verde), e o clique nela volta para cá.
/// </summary>
internal sealed class JanelaPrincipal : Form
{
    private readonly Bandeja _bandeja;
    private readonly SynchronizationContext _ui;
    private readonly Uri _site;
    private readonly WebView2 _web = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Visual.Campo };
    private readonly Dictionary<int, TaskCompletionSource<JsonElement>> _pedidos = [];
    private TaskCompletionSource _pronta = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private int _ultimoPedido;
    private bool _fechar;
    private CancellationTokenSource? _google;
    private Task _loginGoogle = Task.CompletedTask;
    private (FormBorderStyle Borda, FormWindowState Estado)? _antesDaTelaCheia;

    /// <summary>Endereço do site (a versão de desenvolvimento pode abrir o modo de demonstração).</summary>
    public static string Endereco { get; set; } = Conta.Site;

    /// <summary>Pasta do WebView2 (login do site, cache e permissões), separada da do Edge.</summary>
    public static string PastaDados
    {
        get => _pastaDados ??= Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), Path.GetFileName(Registro.Pasta), "WebView2");
        set => _pastaDados = value;
    }
    private static string? _pastaDados;

    /// <summary>O WebView2 está instalado (vem com o Windows 11 e com o Edge no Windows 10).</summary>
    public static bool Disponivel
    {
        get
        {
            try { return CoreWebView2Environment.GetAvailableBrowserVersionString() is { Length: > 0 }; }
            catch (Exception ex) when (ex is WebView2RuntimeNotFoundException or DllNotFoundException or FileNotFoundException or COMException)
            {
                Registro.Sessao($"janela: WebView2 indisponível ({ex.Message})");
                return false;
            }
        }
    }

    public JanelaPrincipal(Bandeja bandeja)
    {
        _bandeja = bandeja;
        _ui = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();
        _site = new Uri(Endereco);
        Text = "Exilados";
        Icon = Visual.Icone;
        BackColor = Visual.Campo;
        Visual.BarraEscura(this);
        float escala = DeviceDpi / 96f;
        MinimumSize = new Size((int)(800 * escala), (int)(500 * escala));
        Posicionar(escala);
        Controls.Add(_web);
        Load += async (_, _) => await IniciarAsync();
        FormClosing += AoFechar;
    }

    // ---------- janela ----------

    public void Mostrar()
    {
        if (!Visible) Show();
        if (WindowState == FormWindowState.Minimized) WindowState = _bandeja.Configuracao.JanelaMaximizada ? FormWindowState.Maximized : FormWindowState.Normal;
        Activate();
    }

    /// <summary>Fecha de verdade (Sair do programa).</summary>
    public void Fechar()
    {
        _fechar = true;
        Close();
    }

    private void Posicionar(float escala)
    {
        var config = _bandeja.Configuracao;
        var partes = config.Janela.Split(',').Select(p => int.TryParse(p, out int n) ? n : (int?)null).ToArray();
        var guardada = partes is [{ } x, { } y, { } l, { } a] ? new Rectangle(x, y, l, a) : Rectangle.Empty;
        // Só volta para onde estava se o lugar ainda existe (o monitor pode ter sido desligado).
        if (guardada.Width >= MinimumSize.Width && guardada.Height >= MinimumSize.Height &&
            Screen.AllScreens.Any(t => t.WorkingArea.IntersectsWith(guardada) && Rectangle.Intersect(t.WorkingArea, guardada).Width >= 200))
        {
            StartPosition = FormStartPosition.Manual;
            Bounds = guardada;
        }
        else
        {
            var area = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1280, 800);
            Size = new Size(Math.Min((int)(1280 * escala), area.Width), Math.Min((int)(800 * escala), area.Height));
            StartPosition = FormStartPosition.CenterScreen;
        }
        if (config.JanelaMaximizada) WindowState = FormWindowState.Maximized;
    }

    private void GuardarPosicao()
    {
        if (_antesDaTelaCheia is not null || WindowState == FormWindowState.Minimized) return;
        var config = _bandeja.Configuracao;
        config.JanelaMaximizada = WindowState == FormWindowState.Maximized;
        var r = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
        config.Janela = $"{r.X},{r.Y},{r.Width},{r.Height}";
        config.Salvar();
    }

    private void AoFechar(object? _, FormClosingEventArgs e)
    {
        GuardarPosicao();
        if (_fechar || e.CloseReason is CloseReason.WindowsShutDown or CloseReason.TaskManagerClosing or CloseReason.ApplicationExitCall) return;
        e.Cancel = true;
        Hide();
        _bandeja.JanelaEscondida();
    }

    private void TelaCheia(bool ligar)
    {
        if (ligar && _antesDaTelaCheia is null)
        {
            GuardarPosicao();
            _antesDaTelaCheia = (FormBorderStyle, WindowState);
            FormBorderStyle = FormBorderStyle.None;
            if (WindowState == FormWindowState.Maximized) WindowState = FormWindowState.Normal;
            WindowState = FormWindowState.Maximized;
        }
        else if (!ligar && _antesDaTelaCheia is { } antes)
        {
            _antesDaTelaCheia = null;
            WindowState = FormWindowState.Normal;
            FormBorderStyle = antes.Borda;
            WindowState = antes.Estado;
        }
    }

    // ---------- site ----------

    private async Task IniciarAsync()
    {
        try
        {
            var ambiente = await CoreWebView2Environment.CreateAsync(null, PastaDados);
            await _web.EnsureCoreWebView2Async(ambiente);
        }
        catch (Exception ex) when (ex is WebView2RuntimeNotFoundException or COMException or InvalidOperationException or ArgumentException or UnauthorizedAccessException)
        {
            Registro.Erro(ex);
            MessageBox.Show(this, "Não deu para abrir o Exilados dentro do programa. Ele vai abrir no navegador.", "Exilados", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            Conta.AbrirNavegador(_site.AbsoluteUri);
            Fechar();
            return;
        }
        var web = _web.CoreWebView2;
        web.Settings.AreDevToolsEnabled = !Atualizacao.ArquivoUnico;
        web.Settings.IsStatusBarEnabled = false;
        web.Settings.UserAgent += $" ExiladosPrograma/{Atualizacao.Atual}";
        await web.AddScriptToExecuteOnDocumentCreatedAsync($"window.exiladosPrograma = Object.freeze({{ versao: '{Atualizacao.Atual}' }});");
        web.NavigationStarting += AoNavegar;
        web.NewWindowRequested += (_, e) =>
        {
            e.Handled = true;
            Abrir(e.Uri);
        };
        web.PermissionRequested += AoPedirPermissao;
        web.WebMessageReceived += AoReceber;
        web.DocumentTitleChanged += (_, _) => Text = web.DocumentTitle is { Length: > 0 } titulo ? titulo : "Exilados";
        web.ContainsFullScreenElementChanged += (_, _) => TelaCheia(web.ContainsFullScreenElement);
        web.ProcessFailed += (_, e) =>
        {
            Registro.Sessao($"janela: o WebView2 falhou ({e.ProcessFailedKind})");
            if (e.ProcessFailedKind is CoreWebView2ProcessFailedKind.RenderProcessExited or CoreWebView2ProcessFailedKind.RenderProcessUnresponsive) web.Reload();
        };
        web.Navigate(_site.AbsoluteUri);
    }

    private bool MesmaOrigem(Uri endereco) => Uri.Compare(endereco, _site, UriComponents.SchemeAndServer, UriFormat.Unescaped, StringComparison.OrdinalIgnoreCase) == 0;

    private bool DoSite(Uri endereco) => MesmaOrigem(endereco) &&
        endereco.AbsolutePath.StartsWith(_site.AbsolutePath.TrimEnd('/'), StringComparison.OrdinalIgnoreCase);

    private void AoNavegar(object? _, CoreWebView2NavigationStartingEventArgs e)
    {
        if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var destino) || destino.Scheme is "about" or "data" or "blob") return;
        if (DoSite(destino))
        {
            if (_pronta.Task.IsCompleted) _pronta = new(TaskCreationOptions.RunContinuationsAsynchronously);
            return;
        }
        e.Cancel = true;
        if (destino.AbsoluteUri.StartsWith(Conta.SupabaseUrl + "/auth/v1/authorize", StringComparison.OrdinalIgnoreCase)) _loginGoogle = EntrarComGoogleAsync(destino);
        else Abrir(destino.AbsoluteUri);
    }

    /// <summary>Endereços de fora do Exilados abrem no navegador (só páginas e e-mail, nada de arquivos ou programas).</summary>
    private static void Abrir(string endereco)
    {
        if (Uri.TryCreate(endereco, UriKind.Absolute, out var destino) && destino.Scheme is "https" or "http" or "mailto")
            Conta.AbrirNavegador(destino.AbsoluteUri);
    }

    /// <summary>
    /// O site pediu o login do Google: abre no navegador voltando para este computador e, com o código, volta o site
    /// para o endereço que ele pediu. O próprio site troca o código pela sessão (ele guardou a outra metade do PKCE).
    /// </summary>
    private async Task EntrarComGoogleAsync(Uri autorizar)
    {
        // Um segundo clique em "Entrar com Google" recomeça (a pessoa pode ter fechado a aba do navegador).
        _google?.Cancel();
        try { await _loginGoogle; }
        catch (Exception ex) when (ex is OperationCanceledException or ExiladosException) { }
        using var cancelar = new CancellationTokenSource();
        _google = cancelar;
        try
        {
            var partes = autorizar.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries).Select(p => p.Split('=', 2)).ToList();
            string pedido = partes.FirstOrDefault(p => p[0] == "redirect_to") is [_, var valor] ? Uri.UnescapeDataString(valor) : "";
            var volta = Uri.TryCreate(pedido, UriKind.Absolute, out var u) && DoSite(u) ? u : _site;
            string consulta = string.Join('&', partes.Where(p => p[0] != "redirect_to").Select(p => string.Join('=', p))
                .Append("redirect_to=" + Uri.EscapeDataString(Conta.RetornoGoogle)));
            string codigo = await Conta.CodigoDoGoogleAsync($"{autorizar.GetLeftPart(UriPartial.Path)}?{consulta}", cancelar.Token);
            string resto = volta.Query.TrimStart('?');
            var destino = new UriBuilder(volta) { Query = (resto.Length > 0 ? resto + "&" : "") + "code=" + Uri.EscapeDataString(codigo) };
            if (IsDisposed) return;
            _web.CoreWebView2?.Navigate(destino.Uri.AbsoluteUri);
            Mostrar();
        }
        catch (OperationCanceledException) { }
        catch (ExiladosException ex)
        {
            if (!cancelar.IsCancellationRequested && !IsDisposed) MessageBox.Show(this, ex.Message, "Exilados", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        finally
        {
            if (_google == cancelar) _google = null;
        }
    }

    private void AoPedirPermissao(object? _, CoreWebView2PermissionRequestedEventArgs e)
    {
        // O microfone (voz) e tocar som sem clique (voz e lives) já ficam liberados para o Exilados.
        if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var origem) || !MesmaOrigem(origem)) return;
        if (e.PermissionKind is CoreWebView2PermissionKind.Microphone or CoreWebView2PermissionKind.Autoplay or CoreWebView2PermissionKind.ClipboardRead)
        {
            e.State = CoreWebView2PermissionState.Allow;
            e.SavesInProfile = true;
        }
    }

    // ---------- conversa com o site (programa.js) ----------

    private void AoReceber(object? _, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!Uri.TryCreate(e.Source, UriKind.Absolute, out var origem) || !DoSite(origem)) return;
        JsonElement mensagem;
        try
        {
            using var json = JsonDocument.Parse(e.WebMessageAsJson);
            mensagem = json.RootElement.Clone();
        }
        catch (JsonException) { return; }
        if (mensagem.ValueKind != JsonValueKind.Object || !mensagem.TryGetProperty("tipo", out var tipo)) return;
        switch (tipo.GetString())
        {
            case "pronto":
                _pronta.TrySetResult();
                AvisarAtualizacao();
                break;
            case "transmitir":
                _bandeja.MostrarTransmitir();
                break;
            case "atualizar":
                _ = _bandeja.AtualizarAgoraAsync();
                break;
            case "resposta" when mensagem.TryGetProperty("id", out var id) && id.TryGetInt32(out int numero) && _pedidos.Remove(numero, out var pedido):
                pedido.TrySetResult(mensagem);
                break;
        }
    }

    /// <summary>Conta ao site se há versão nova pronta (a setinha verde). Também a cada vez que o site carrega.</summary>
    public void AvisarAtualizacao()
    {
        if (IsDisposed || !_pronta.Task.IsCompleted || _web.CoreWebView2 is not { } web) return;
        try { web.PostWebMessageAsJson(JsonSerializer.Serialize(new { tipo = "atualizacao", versao = _bandeja.AtualizacaoPronta })); }
        catch (Exception ex) when (ex is InvalidOperationException or ObjectDisposedException or COMException) { }
    }

    /// <summary>Pergunta algo ao site (de qualquer thread). null: o site não respondeu a tempo ou não está aberto.</summary>
    private Task<JsonElement?> PerguntarAsync(string tipo, CancellationToken ct)
    {
        var resultado = new TaskCompletionSource<JsonElement?>(TaskCreationOptions.RunContinuationsAsynchronously);
        _ui.Post(async _ =>
        {
            try { resultado.TrySetResult(await PerguntarNaJanelaAsync(tipo, ct)); }
            catch (Exception ex) { resultado.TrySetException(ex); }
        }, null);
        return resultado.Task;
    }

    private async Task<JsonElement?> PerguntarNaJanelaAsync(string tipo, CancellationToken ct)
    {
        if (IsDisposed) return null;
        using var prazo = CancellationTokenSource.CreateLinkedTokenSource(ct);
        prazo.CancelAfter(TimeSpan.FromSeconds(20));
        int id = ++_ultimoPedido;
        var pedido = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        try
        {
            await _pronta.Task.WaitAsync(prazo.Token);
            if (IsDisposed || _web.CoreWebView2 is not { } web) return null;
            _pedidos[id] = pedido;
            web.PostWebMessageAsJson(JsonSerializer.Serialize(new { tipo, id }));
            return await pedido.Task.WaitAsync(prazo.Token);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested) { return null; }
        catch (Exception ex) when (ex is InvalidOperationException or ObjectDisposedException or COMException) { return null; }
        finally { _pedidos.Remove(id); }
    }

    /// <summary>O login do site aberto aqui, ou null (sem login, ou o site não respondeu).</summary>
    public async Task<SessaoDoSite?> SessaoAsync(CancellationToken ct)
    {
        if (await PerguntarAsync("sessao", ct) is not { } r) return null;
        string Texto(string nome) => r.TryGetProperty(nome, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";
        return Texto("token") is { Length: > 0 } token && Texto("usuario") is { Length: > 0 } usuario
            ? new SessaoDoSite(token, usuario, Texto("email"), Texto("nome")) : null;
    }

    /// <summary>A pessoa está numa sala de voz ou assistindo a algo no site (não é hora de reiniciar o programa).</summary>
    public async Task<bool> OcupadaAsync() =>
        await PerguntarAsync("ocupado", CancellationToken.None) is { } r && r.TryGetProperty("ocupado", out var o) && o.ValueKind == JsonValueKind.True;

    // ---------- para a captura de conferência (--captura-site) ----------

    /// <summary>Roda um trecho de JavaScript no site e devolve o resultado em JSON.</summary>
    public async Task<string> ExecutarAsync(string script) =>
        _web.CoreWebView2 is { } web ? await web.ExecuteScriptAsync(script) : "null";

    /// <summary>Salva a imagem do site como está na janela.</summary>
    public async Task CapturarAsync(string arquivo)
    {
        if (_web.CoreWebView2 is not { } web) return;
        await using var saida = File.Create(arquivo);
        await web.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, saida);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _google?.Cancel();
            _web.Dispose();
        }
        base.Dispose(disposing);
    }
}
