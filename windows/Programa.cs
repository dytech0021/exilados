namespace Exilados;

internal static class Programa
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Contains("--verificar")) return 0;
        string? Arg(string nome)
        {
            int i = Array.IndexOf(args, nome);
            return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
        }

        try
        {
            if (Arg("--gerar-chave") is { } chave) return Atualizacao.GerarChave(chave, Arg(chave) ?? "ChaveAtualizacao.cs");
            if (Arg("--assinar") is { } exe)
            {
                int i = Array.IndexOf(args, "--assinar");
                if (i + 3 >= args.Length) return 2;
                return Atualizacao.Assinar(exe, args[i + 2], args[i + 3]);
            }
        }
        catch (ExiladosException ex)
        {
            Console.Error.WriteLine(ex.Message);
            return 5;
        }

        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += (_, e) => Registro.Erro(e.Exception);
        AppDomain.CurrentDomain.UnhandledException += (_, e) => Registro.Erro(e.ExceptionObject as Exception);
        TaskScheduler.UnobservedTaskException += (_, e) =>
        {
            Registro.Erro(e.Exception);
            e.SetObserved();
        };

        if (Arg("--autoteste") is { } pasta) return AutoTeste.Rodar(pasta);
        if (Arg("--captura-ui") is { } pastaImagens) return CapturarJanelas(pastaImagens);
        if (Arg("--captura-site") is { } pastaSite) return CapturarSite(pastaSite, Arg("--site"));

        // A versão de desenvolvimento (com a DLL ao lado) roda separada da instalada: outra pasta de dados e outra
        // trava, para não disputar o login guardado. Ela pode abrir outro site (--site, o modo de demonstração).
        string sufixo = Atualizacao.ArquivoUnico ? "" : "-dev";
        Registro.Pasta += sufixo;
        if (sufixo.Length > 0 && Arg("--site") is { } site) JanelaPrincipal.Endereco = site;

        // Uma cópia por usuário do Windows: a segunda só pede para a primeira mostrar a janela.
        using var unica = new Mutex(false, @"Local\Exilados-programa" + sufixo);
        using var mostrar = new EventWaitHandle(false, EventResetMode.AutoReset, @"Local\Exilados-mostrar" + sufixo);
        bool dono;
        try { dono = unica.WaitOne(TimeSpan.FromSeconds(args.Contains("--atualizado") ? 15 : 0)); }
        catch (AbandonedMutexException) { dono = true; }
        if (!dono)
        {
            AllowSetForegroundWindow(QualquerProcesso); // a primeira cópia pode trazer a janela para a frente
            mostrar.Set();
            return 0;
        }
        try
        {
            Atualizacao.Limpar();
            SynchronizationContext.SetSynchronizationContext(new WindowsFormsSynchronizationContext());
            Application.Run(new Bandeja(args.Contains(Inicializacao.Argumento), args.Contains("--atualizado"), mostrar));
            return 0;
        }
        finally { unica.ReleaseMutex(); }
    }

    /// <summary>Salva imagens das janelas (para conferir o visual sem usar a tela). Não mexe na conta nem no registro.</summary>
    private static int CapturarJanelas(string pasta)
    {
        Directory.CreateDirectory(pasta);
        Registro.Pasta = pasta;
        Inicializacao.Ativa = false;
        SynchronizationContext.SetSynchronizationContext(new WindowsFormsSynchronizationContext());
        void Salvar(Form janela, string nome)
        {
            janela.StartPosition = FormStartPosition.Manual;
            janela.Location = new Point(-4000, -4000);
            janela.Show();
            Application.DoEvents();
            using var imagem = new Bitmap(janela.Width, janela.Height);
            janela.DrawToBitmap(imagem, new Rectangle(Point.Empty, janela.Size));
            imagem.Save(Path.Combine(pasta, nome), System.Drawing.Imaging.ImageFormat.Png);
            janela.Close();
        }
        using var mostrar = new EventWaitHandle(false, EventResetMode.AutoReset);
        Salvar(new JanelaEntrar("pessoa@exemplo.com"), "entrar.png");
        var bandeja = new Bandeja(true, false, mostrar);
        bandeja.Configuracao.Nome = "Dyego";
        Salvar(new JanelaTransmitir(bandeja), "transmitir.png");
        bandeja.Dispose();
        return 0;
    }

    /// <summary>
    /// Abre a janela principal com o site (ou <paramref name="site"/>, como o modo de demonstração), espera ele
    /// carregar e salva site.png e site.txt: o login que o site empresta, se está ocupado e o que ele mostra. Depois
    /// clica em Transmitir no menu do grupo e salva a janela que abriu (transmitir.png). Usa uma pasta de dados só
    /// dela. Devolve 0 com login, 2 sem login e 1 se o site não respondeu.
    /// </summary>
    private static int CapturarSite(string pasta, string? site)
    {
        Directory.CreateDirectory(pasta);
        Registro.Pasta = pasta;
        Inicializacao.Ativa = false;
        JanelaPrincipal.PastaDados = Path.Combine(pasta, "WebView2");
        if (site is not null) JanelaPrincipal.Endereco = site;
        SynchronizationContext.SetSynchronizationContext(new WindowsFormsSynchronizationContext());
        using var mostrar = new EventWaitHandle(false, EventResetMode.AutoReset);
        using var bandeja = new Bandeja(true, false, mostrar);
        var janela = bandeja.Principal();
        int resultado = 1;
        janela.Shown += async (_, _) =>
        {
            var relatorio = new System.Text.StringBuilder();
            try
            {
                var sessao = await janela.SessaoAsync(CancellationToken.None);
                relatorio.AppendLine(sessao is null ? "login do site: nenhum" : $"login do site: {sessao.Email} ({sessao.Usuario}), token com {sessao.Token.Length} caracteres");
                for (int i = 0; i < 30 && await janela.ExecutarAsync("document.getElementById('carregando')?.hidden === true") != "true"; i++) await Task.Delay(500);
                await Task.Delay(1500);
                relatorio.AppendLine($"nome no grupo: {(await janela.SessaoAsync(CancellationToken.None))?.Nome}");
                relatorio.AppendLine($"ocupada: {await janela.OcupadaAsync()}");
                relatorio.AppendLine("site: " + await janela.ExecutarAsync(
                    "JSON.stringify({ programa: window.exiladosPrograma?.versao, botaoBaixar: !document.getElementById('trilho-baixar')?.hidden, titulo: document.title, agente: navigator.userAgent })"));
                await janela.CapturarAsync(Path.Combine(pasta, "site.png"));
                resultado = sessao is null ? 2 : 0;

                await janela.ExecutarAsync("document.querySelector('.lateral-topo-titulo')?.click()");
                await Task.Delay(500);
                await janela.ExecutarAsync("[...document.querySelectorAll('.menu [role=menuitem]')].find((b) => b.textContent.trim() === 'Transmitir')?.click()");
                JanelaTransmitir? transmitir = null;
                for (int i = 0; i < 20 && (transmitir = Application.OpenForms.OfType<JanelaTransmitir>().FirstOrDefault()) is null; i++) await Task.Delay(500);
                relatorio.AppendLine(transmitir is null ? "transmitir: a janela não abriu" : $"transmitir: abriu ({transmitir.Text})");
                if (transmitir is not null)
                {
                    await Task.Delay(500);
                    using var imagem = new Bitmap(transmitir.Width, transmitir.Height);
                    transmitir.DrawToBitmap(imagem, new Rectangle(Point.Empty, transmitir.Size));
                    imagem.Save(Path.Combine(pasta, "transmitir.png"), System.Drawing.Imaging.ImageFormat.Png);
                    transmitir.Close();
                }
                else resultado = 1;
            }
            catch (Exception ex) when (ex is IOException or InvalidOperationException or System.Runtime.InteropServices.COMException)
            {
                relatorio.AppendLine("erro: " + ex.Message);
            }
            File.WriteAllText(Path.Combine(pasta, "site.txt"), relatorio.ToString());
            janela.Fechar();
        };
        janela.FormClosed += (_, _) => Application.ExitThread();
        janela.Show();
        Application.Run();
        return resultado;
    }

    private const uint QualquerProcesso = 0xFFFFFFFF; // ASFW_ANY

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool AllowSetForegroundWindow(uint processo);
}
