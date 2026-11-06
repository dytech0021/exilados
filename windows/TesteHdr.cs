using System.Diagnostics;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;

namespace Exilados;

/// <summary>
/// Exilados.exe --teste-hdr pasta. Confere a captura com HDR na tela principal: com o branco em 80 nits (o que vale
/// numa tela sem HDR) ela tem de dar a mesma imagem que a captura comum; com o branco em 240 nits, a imagem escurece.
/// Salva as imagens e o relatorio.txt na pasta; código 0 quando tudo deu certo.
/// </summary>
internal static class TesteHdr
{
    public static int Rodar(string pasta)
    {
        Directory.CreateDirectory(pasta);
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
        try
        {
            var tela = Screen.PrimaryScreen!;
            int w = tela.Bounds.Width & ~1, h = tela.Bounds.Height & ~1;
            double? branco = Hdr.BrancoSdr(tela.DeviceName);
            Linha(true, $"{tela.DeviceName} {w}x{h}: {(branco is { } b ? $"HDR ligado, branco do SDR em {b:0} nits" : "sem HDR")}");

            Task.Run(() => ComponenteVideo.GarantirAsync(null, CancellationToken.None)).GetAwaiter().GetResult();
            var comum = CapturaComum(w, h);
            Salvar(comum, w, h, Path.Combine(pasta, "comum.png"));

            var (k1, tempo) = Capturar(() => CapturaHdr.DaTela(tela, w, h, 30, 80));
            Salvar(k1, w, h, Path.Combine(pasta, "hdr-80.png"));
            var (media, diferentes) = Comparar(comum, k1);
            Linha(branco is not null || (media < 1.5 && diferentes < 0.02),
                $"tela inteira, branco 80 nits ({tempo:0.0} ms de conversão por quadro): diferença média {media:0.00} de 255, {diferentes:P1} dos pixels com mais de 8 de diferença" +
                (branco is null ? "" : " (com HDR ligado a captura comum é a estourada; não precisa bater)"));

            var (k3, _) = Capturar(() => CapturaHdr.DaTela(tela, w, h, 30, 240));
            Salvar(k3, w, h, Path.Combine(pasta, "hdr-240.png"));
            double l1 = Brilho(k1), l3 = Brilho(k3);
            Linha(l3 < l1 * 0.8, $"branco 240 nits escurece a imagem: brilho médio {l1:0.0} -> {l3:0.0}");

            // O caminho da live: a captura com HDR entrando no codificador pelo cano, gravando 5 s num arquivo.
            string? codificador = Task.Run(() => Codificador.AcharAsync(CancellationToken.None)).GetAwaiter().GetResult();
            if (codificador is null) Linha(false, "nenhuma placa codifica H.264");
            else
            {
                string arquivo = Path.Combine(pasta, "live-hdr.mkv");
                File.Delete(arquivo);
                int quadros = Task.Run(() => GravarAsync(tela, codificador, arquivo)).GetAwaiter().GetResult();
                Linha(quadros >= 5 * 60 * 0.8, $"live de 5 s da tela pela captura com HDR ({Codificador.Marca(codificador)}, 60 quadros/s): {quadros} quadros");
            }

            // Uma janela, reduzida a 1280x720 (com faixas pretas se precisar).
            var janela = ProgramaAberto.Listar(true).FirstOrDefault(p => p.Processo != Environment.ProcessId) ?? ProgramaAberto.Listar(true).FirstOrDefault();
            if (janela is null) Linha(false, "nenhuma janela aberta para testar a captura de programa");
            else
            {
                var (jp, tj) = Capturar(() => CapturaHdr.DoPrograma(janela, 1280, 720, 30, 80));
                Salvar(jp, 1280, 720, Path.Combine(pasta, "janela.png"));
                Linha(Brilho(jp) > 1, $"janela \"{janela}\" em 1280x720 ({tj:0.0} ms de conversão por quadro)");
            }
        }
        catch (Exception ex)
        {
            Linha(false, ex.GetBaseException().Message);
        }
        File.WriteAllText(Path.Combine(pasta, "relatorio.txt"), relatorio.ToString());
        return tudoCerto ? 0 : 1;
    }

    private static (byte[] Quadro, double MsPorQuadro) Capturar(Func<CapturaHdr> criar)
    {
        return Task.Run(async () =>
        {
            await using var c = criar();
            await c.PrimeiroAsync(TimeSpan.FromSeconds(10), CancellationToken.None);
            // A tela parada não manda quadro novo: mexer o mouse um pouco força alguns.
            var inicio = Cursor.Position;
            for (int i = 0; i < 20; i++)
            {
                Cursor.Position = inicio with { X = inicio.X + (i % 2 == 0 ? 3 : -3) };
                await Task.Delay(50);
            }
            Cursor.Position = inicio;
            await Task.Delay(300);
            return (c.Copia(), c.MsPorQuadro);
        }).GetAwaiter().GetResult();
    }

    private static async Task<int> GravarAsync(Screen tela, string codificador, string arquivo)
    {
        var opcoes = new OpcoesLive(1080, 60, false);
        var fonte = FonteTela.Para(tela).First();
        var (w, h) = Transmissao.TamanhoDeSaida(fonte.Area.Width, fonte.Area.Height, opcoes.Altura);
        string nome = $"exilados-teste-hdr-{Guid.NewGuid():N}";
        var args = Transmissao.Argumentos(fonte, opcoes, codificador, null, "rtsps://x/ex/teste", $@"\\.\pipe\{nome}");
        args.RemoveRange(args.Count - 7, 7);
        args.AddRange(["-t", "5", "-f", "matroska", arquivo]);
        using var cano = new System.IO.Pipes.NamedPipeServerStream(nome, System.IO.Pipes.PipeDirection.Out, 1,
            System.IO.Pipes.PipeTransmissionMode.Byte, System.IO.Pipes.PipeOptions.Asynchronous | System.IO.Pipes.PipeOptions.CurrentUserOnly, 0, 1 << 20);
        await using var captura = CapturaHdr.DaTela(tela, w, h, opcoes.Quadros, 80);
        using var processo = new ProcessoVideo(args);
        using var parar = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var imagem = Task.Run(() => captura.BombearAsync(cano, parar.Token));
        try { await processo.Processo.WaitForExitAsync(parar.Token); }
        finally
        {
            parar.Cancel();
            try { await imagem; } catch (Exception ex) when (ex is OperationCanceledException or IOException or TimeoutException) { }
        }
        if (processo.Processo.ExitCode != 0) throw new IOException("o FFmpeg falhou: " + processo.Erro);
        using var leitura = new ProcessoVideo(["-hide_banner", "-nostdin", "-loglevel", "error", "-nostats", "-progress", "pipe:1", "-i", arquivo, "-map", "0:v", "-f", "null", "-"]);
        int contados = 0;
        while (await leitura.Processo.StandardOutput.ReadLineAsync() is { } linha)
            if (linha.StartsWith("frame=", StringComparison.Ordinal)) int.TryParse(linha.AsSpan(6), out contados);
        return contados;
    }

    private static byte[] CapturaComum(int w, int h)
    {
        using var p = new ProcessoVideo(["-hide_banner", "-loglevel", "error", "-nostdin", "-filter_complex",
            $"ddagrab=output_idx=0:framerate=10:draw_mouse=1,hwdownload,format=bgra[v]", "-map", "[v]", "-frames:v", "5",
            "-c:v", "rawvideo", "-pix_fmt", "bgra", "-f", "rawvideo", "pipe:1"]);
        var tudo = new MemoryStream();
        p.Processo.StandardOutput.BaseStream.CopyTo(tudo);
        p.Processo.WaitForExit(10000);
        var bytes = tudo.ToArray();
        int quadro = w * h * 4;
        if (bytes.Length < quadro) throw new IOException("a captura comum não deu imagem: " + p.Erro);
        return bytes[^quadro..];
    }

    private static (double Media, double Diferentes) Comparar(byte[] a, byte[] b)
    {
        long soma = 0, diferentes = 0, pixels = a.Length / 4;
        for (int i = 0; i < a.Length; i += 4)
        {
            int maior = 0;
            for (int c = 0; c < 3; c++)
            {
                int d = Math.Abs(a[i + c] - b[i + c]);
                soma += d;
                maior = Math.Max(maior, d);
            }
            if (maior > 8) diferentes++;
        }
        return (soma / (pixels * 3.0), diferentes / (double)pixels);
    }

    private static double Brilho(byte[] q)
    {
        long soma = 0;
        for (int i = 0; i < q.Length; i += 4) soma += q[i] + q[i + 1] + q[i + 2];
        return soma / (q.Length / 4 * 3.0);
    }

    private static void Salvar(byte[] bgra, int w, int h, string arquivo)
    {
        using var imagem = new Bitmap(w, h, PixelFormat.Format32bppRgb);
        var dados = imagem.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format32bppRgb);
        for (int y = 0; y < h; y++) Marshal.Copy(bgra, y * w * 4, dados.Scan0 + y * dados.Stride, w * 4);
        imagem.UnlockBits(dados);
        imagem.Save(arquivo, ImageFormat.Png);
    }
}
