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

        // Uma cópia por usuário do Windows: a segunda só pede para a primeira mostrar a janela.
        using var unica = new Mutex(false, @"Local\Exilados-programa");
        using var mostrar = new EventWaitHandle(false, EventResetMode.AutoReset, @"Local\Exilados-mostrar");
        bool dono;
        try { dono = unica.WaitOne(TimeSpan.FromSeconds(args.Contains("--atualizado") ? 15 : 0)); }
        catch (AbandonedMutexException) { dono = true; }
        if (!dono)
        {
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
}
