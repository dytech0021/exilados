using System.Diagnostics;
using System.Media;
using System.Text;

namespace Exilados;

/// <summary>
/// Exilados.exe --autoteste pasta. Abre uma janela de teste que se mexe e toca um tom baixo, e confere:
/// 1. o componente de vídeo e a placa que codifica H.264;
/// 2. uma gravação local de 6 s dessa janela (captura de programa) com o som, lida de volta (vídeo e som presentes);
/// 3. com uma conta guardada neste computador: a live de verdade pelo servidor (permissão, envio RTSPS, sinal de vida,
///    leitura de volta pelo servidor com a permissão de assistir e o fim da live).
/// O relatório fica em pasta\relatorio.txt; o código de saída é 0 quando tudo o que foi testado deu certo.
/// </summary>
internal static class AutoTeste
{
    public static int Rodar(string pasta)
    {
        Directory.CreateDirectory(pasta);
        var config = Config.Carregar();
        Registro.Pasta = pasta;
        var relatorio = new StringBuilder();
        bool tudoCerto = true;
        void Linha(bool ok, string texto)
        {
            tudoCerto &= ok;
            string linha = $"{(ok ? "OK   " : "FALHA")} {texto}";
            relatorio.AppendLine(linha);
            Console.WriteLine(linha);
        }

        using var janela = new JanelaDeTeste();
        try
        {
            Task.Run(() => ComponenteVideo.GarantirAsync(null, CancellationToken.None)).GetAwaiter().GetResult();
            Linha(true, $"componente de vídeo conferido ({ComponenteVideo.Executavel})");
            string? codificador = Task.Run(() => Codificador.AcharAsync(CancellationToken.None)).GetAwaiter().GetResult();
            Linha(codificador is not null, codificador is null ? "nenhuma placa codifica H.264" : $"placa de vídeo: {Codificador.Marca(codificador)} ({codificador})");
            if (codificador is null) return Fim(pasta, relatorio, false);

            var programa = janela.Abrir();
            Linha(programa is not null, programa is null ? "a janela de teste não apareceu" : $"janela de teste aberta ({programa.Titulo})");
            if (programa is null) return Fim(pasta, relatorio, false);
            using var tom = Tom.Tocar();

            bool somDoPrograma = SomDePrograma.Disponivel;
            var opcoes = new OpcoesLive(720, 30, true, -1, programa);
            string arquivo = Path.Combine(pasta, "gravacao-local.mkv");
            File.Delete(arquivo);
            var (ok, detalhe) = Task.Run(() => GravarLocalAsync(opcoes, codificador, arquivo)).GetAwaiter().GetResult();
            Linha(ok, $"gravação local de 6 s da janela com {(somDoPrograma ? "o som só dela" : "o som do computador")}: {detalhe}");

            var conta = Conta.Restaurar(config);
            if (conta is null)
            {
                relatorio.AppendLine("--    sem conta guardada neste computador: a parte do servidor não foi testada (entre no programa e rode de novo).");
                Console.WriteLine("--    sem conta: parte do servidor não testada");
            }
            else
            {
                foreach (var (passou, texto) in Task.Run(() => TestarServidorAsync(conta, opcoes)).GetAwaiter().GetResult()) Linha(passou, texto);
                conta.Guardar(config);
            }
        }
        catch (Exception ex)
        {
            Linha(false, "erro inesperado: " + ex.Message);
            Registro.Erro(ex);
        }
        return Fim(pasta, relatorio, tudoCerto);
    }

    private static int Fim(string pasta, StringBuilder relatorio, bool ok)
    {
        relatorio.AppendLine(ok ? "RESULTADO: tudo certo" : "RESULTADO: houve falhas");
        File.WriteAllText(Path.Combine(pasta, "relatorio.txt"), $"Exilados {Atualizacao.Atual} · {DateTime.Now:dd/MM/yyyy HH:mm:ss}{Environment.NewLine}{relatorio}");
        return ok ? 0 : 1;
    }

    // Os mesmos argumentos da live, gravando 6 s num arquivo em vez de enviar ao servidor.
    private static async Task<(bool, string)> GravarLocalAsync(OpcoesLive opcoes, string codificador, string arquivo)
    {
        var programa = opcoes.Programa!;
        if (!programa.TentarArea(out var area)) return (false, "a janela de teste sumiu");
        var fonte = new FonteTela("janela do programa", area);
        var (largura, altura) = Transmissao.TamanhoDeSaida(area.Width, area.Height, opcoes.Altura);
        string nomeSom = $"exilados-teste-som-{Guid.NewGuid():N}", nomeImagem = $"exilados-teste-imagem-{Guid.NewGuid():N}";
        var args = Transmissao.Argumentos(fonte, opcoes, codificador, $@"\\.\pipe\{nomeSom}", "rtsps://x/ex/teste", $@"\\.\pipe\{nomeImagem}");
        args.RemoveRange(args.Count - 7, 7);
        args.AddRange(["-t", "6", "-f", "matroska", arquivo]);
        using var canoSom = new System.IO.Pipes.NamedPipeServerStream(nomeSom, System.IO.Pipes.PipeDirection.Out, 1,
            System.IO.Pipes.PipeTransmissionMode.Byte, System.IO.Pipes.PipeOptions.Asynchronous | System.IO.Pipes.PipeOptions.CurrentUserOnly, 0, 1 << 20);
        using var canoImagem = new System.IO.Pipes.NamedPipeServerStream(nomeImagem, System.IO.Pipes.PipeDirection.Out, 1,
            System.IO.Pipes.PipeTransmissionMode.Byte, System.IO.Pipes.PipeOptions.Asynchronous | System.IO.Pipes.PipeOptions.CurrentUserOnly, 0, 1 << 20);
        await using var captura = new CapturaPrograma(programa, largura, altura, opcoes.Quadros);
        using var processo = new ProcessoVideo(args);
        using var parar = new CancellationTokenSource(TimeSpan.FromSeconds(40));
        var som = Task.Run(() => BombearSomDeTesteAsync(canoSom, SomDePrograma.Disponivel ? Environment.ProcessId : 0, parar.Token));
        var imagem = Task.Run(() => captura.BombearAsync(canoImagem, parar.Token));
        try { await processo.Processo.WaitForExitAsync(parar.Token); }
        catch (OperationCanceledException) { processo.Encerrar(); return (false, "o FFmpeg não terminou em 40 s: " + processo.Erro); }
        finally
        {
            parar.Cancel();
            try { await Task.WhenAll(som, imagem); } catch (Exception ex) when (ex is OperationCanceledException or IOException or TimeoutException or ObjectDisposedException) { }
        }
        if (processo.Processo.ExitCode != 0) return (false, "o FFmpeg falhou: " + processo.Erro);
        return await LerAsync(arquivo, 0);
    }

    // Reaproveita o bombeamento de som da live (privado nela) do jeito mais simples: captura e escreve no ritmo do relógio.
    private static async Task BombearSomDeTesteAsync(System.IO.Pipes.NamedPipeServerStream cano, int processo, CancellationToken ct)
    {
        await cano.WaitForConnectionAsync(ct);
        var fila = new System.Collections.Concurrent.ConcurrentQueue<short[]>();
        using var captura = new CapturaSom(p => { if (fila.Count < 100) fila.Enqueue(p); }, processo);
        var silencio = new byte[960 * 4];
        long inicio = Stopwatch.GetTimestamp(), escritos = 0;
        while (!ct.IsCancellationRequested)
        {
            await Task.Delay(10, ct);
            long esperado = (long)(Stopwatch.GetElapsedTime(inicio).TotalSeconds * CapturaSom.Taxa);
            while (fila.TryDequeue(out var pedaco))
            {
                if (escritos > esperado + CapturaSom.Taxa / 10) continue;
                await cano.WriteAsync(System.Runtime.InteropServices.MemoryMarshal.AsBytes(pedaco.AsSpan()).ToArray(), ct);
                escritos += pedaco.Length / 2;
            }
            while (escritos < esperado - CapturaSom.Taxa * 6 / 100)
            {
                await cano.WriteAsync(silencio, ct);
                escritos += 960;
            }
        }
    }

    /// <summary>Lê um arquivo ou endereço por alguns segundos e diz se tinha vídeo H.264 e som Opus, e quantos quadros.</summary>
    private static async Task<(bool, string)> LerAsync(string entrada, int segundos)
    {
        var args = new List<string> { "-hide_banner", "-nostdin", "-loglevel", "info" };
        if (entrada.StartsWith("rtsps://")) args.AddRange(["-rtsp_transport", "tcp", "-tls_verify", "1"]);
        args.AddRange(["-i", entrada]);
        if (segundos > 0) args.AddRange(["-t", segundos.ToString()]);
        args.AddRange(["-f", "null", "-"]);
        using var p = new ProcessoVideo(args);
        string saida = "";
        var leitura = Task.Run(async () => saida = await p.Processo.StandardOutput.ReadToEndAsync());
        using var prazo = new CancellationTokenSource(TimeSpan.FromSeconds(segundos + 25));
        try { await p.Processo.WaitForExitAsync(prazo.Token); }
        catch (OperationCanceledException) { p.Encerrar(); }
        await leitura;
        await Task.Delay(200);
        string tudo = p.Diagnostico;
        bool video = tudo.Contains("Video: h264", StringComparison.OrdinalIgnoreCase);
        bool som = tudo.Contains("Audio: opus", StringComparison.OrdinalIgnoreCase);
        string quadros = tudo.Split('\n').LastOrDefault(l => l.Contains("frame=")) is { } linha
            ? linha[(linha.IndexOf("frame=") + 6)..].TrimStart().Split(' ')[0] : "?";
        bool ok = video && som && int.TryParse(quadros, out int n) && n > 0;
        return (ok, $"vídeo H.264 {(video ? "sim" : "não")}, som Opus {(som ? "sim" : "não")}, {quadros} quadros" + (ok ? "" : $" ({p.Erro})"));
    }

    private static async Task<List<(bool, string)>> TestarServidorAsync(Conta conta, OpcoesLive opcoes)
    {
        var resultado = new List<(bool, string)>();
        var api = new Api(conta);
        Transmissao? live = null;
        try
        {
            live = await Transmissao.ComecarAsync(api, opcoes, _ => { }, CancellationToken.None);
            resultado.Add((true, $"permissão de live recebida ({live.Caminho[..7]}…)"));
            var limite = Stopwatch.StartNew();
            while (!live.AoVivo && limite.Elapsed < TimeSpan.FromSeconds(30)) await Task.Delay(250);
            resultado.Add((live.AoVivo, live.AoVivo ? $"ao vivo em {limite.Elapsed.TotalSeconds:0.0} s" : $"não entrou ao vivo em 30 s ({live.Situacao})"));
            await Task.Delay(TimeSpan.FromSeconds(12)); // passa por um sinal de vida
            resultado.Add((live.Assistindo >= 0, $"sinal de vida aceito pelo servidor ({live.Assistindo} assistindo)"));
            var (caminho, token) = await api.AssistirAsync(conta.UsuarioId, CancellationToken.None);
            var (ok, detalhe) = await LerAsync($"rtsps://leitor:{token}@filabox3d.com.br:{Transmissao.PortaMidia}/{caminho}", 4);
            resultado.Add((ok, $"live lida de volta pelo servidor: {detalhe}"));
        }
        catch (Exception ex) when (ex is ExiladosException or LiveTerminadaException or IOException)
        {
            resultado.Add((false, "servidor: " + ex.Message));
        }
        finally
        {
            if (live is not null) await live.DisposeAsync();
        }
        if (live is not null)
        {
            try
            {
                await api.SinalAsync(CancellationToken.None);
                resultado.Add((false, "a live continuou aceitando sinal depois de parar"));
            }
            catch (LiveTerminadaException) { resultado.Add((true, "a live acabou ao parar (o servidor recusa novo sinal)")); }
            catch (ExiladosException ex) { resultado.Add((false, "fim da live: " + ex.Message)); }
        }
        return resultado;
    }

    /// <summary>Janela que se mexe sozinha (a captura de programa precisa de quadros novos), numa thread própria.</summary>
    private sealed class JanelaDeTeste : IDisposable
    {
        private Form? _form;
        private Thread? _thread;

        public ProgramaAberto? Abrir()
        {
            var pronto = new ManualResetEventSlim();
            _thread = new Thread(() =>
            {
                _form = new Form { Text = "Exilados · autoteste", ClientSize = new Size(640, 360), StartPosition = FormStartPosition.CenterScreen, ShowInTaskbar = true };
                int passo = 0;
                var relogio = new System.Windows.Forms.Timer { Interval = 33 };
                _form.Paint += (_, e) =>
                {
                    var g = e.Graphics;
                    g.Clear(Color.FromArgb(0x31, 0x33, 0x38));
                    int x = passo * 7 % (_form.ClientSize.Width - 120);
                    using var pincel = new SolidBrush(Color.FromArgb(0xC0, 0x66, 0x2B));
                    g.FillRectangle(pincel, x, 120, 120, 120);
                    using var fonte = new Font("Segoe UI", 20, FontStyle.Bold);
                    g.DrawString($"Exilados · autoteste · {passo}", fonte, Brushes.White, 20, 20);
                };
                relogio.Tick += (_, _) => { passo++; _form.Invalidate(); };
                _form.Shown += (_, _) => { relogio.Start(); pronto.Set(); };
                Application.Run(_form);
            }) { IsBackground = true };
            _thread.SetApartmentState(ApartmentState.STA);
            _thread.Start();
            if (!pronto.Wait(TimeSpan.FromSeconds(10))) return null;
            Thread.Sleep(500);
            return ProgramaAberto.ListarIncluindoEste().FirstOrDefault(p => p.Titulo == "Exilados · autoteste");
        }

        public void Dispose()
        {
            try { _form?.Invoke(() => _form.Close()); } catch (Exception ex) when (ex is InvalidOperationException or ObjectDisposedException) { }
        }
    }

    /// <summary>Tom de 440 Hz bem baixo, repetido, tocado por este processo (para conferir a captura do som).</summary>
    private sealed class Tom : IDisposable
    {
        private readonly SoundPlayer _player;
        private readonly MemoryStream _wav;

        private Tom(MemoryStream wav)
        {
            _wav = wav;
            _player = new SoundPlayer(wav);
            _player.PlayLooping();
        }

        public static Tom Tocar()
        {
            const int taxa = 48000, segundos = 2;
            int amostras = taxa * segundos;
            var wav = new MemoryStream();
            using (var w = new BinaryWriter(wav, Encoding.ASCII, leaveOpen: true))
            {
                w.Write("RIFF"u8); w.Write(36 + amostras * 4); w.Write("WAVE"u8);
                w.Write("fmt "u8); w.Write(16); w.Write((short)1); w.Write((short)2); w.Write(taxa); w.Write(taxa * 4); w.Write((short)4); w.Write((short)16);
                w.Write("data"u8); w.Write(amostras * 4);
                for (int i = 0; i < amostras; i++)
                {
                    short v = (short)(Math.Sin(2 * Math.PI * 440 * i / taxa) * 1200);
                    w.Write(v); w.Write(v);
                }
            }
            wav.Position = 0;
            return new Tom(wav);
        }

        public void Dispose()
        {
            _player.Stop();
            _player.Dispose();
            _wav.Dispose();
        }
    }
}
