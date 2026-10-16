using System.Collections.Concurrent;
using System.Diagnostics;
using System.Globalization;
using System.IO.Pipes;

namespace Exilados;

/// <summary>Como a live vai ao ar: altura da imagem (1080 ou 720), quadros por segundo, som, e a tela ou o programa.</summary>
internal sealed record OpcoesLive(int Altura = 1080, int Quadros = 60, bool Som = true, int Tela = -1, ProgramaAberto? Programa = null)
{
    /// <summary>Taxa do vídeo em kbit/s: a recomendada para jogo em movimento nessa resolução.</summary>
    public int VideoKbps => (Altura >= 1080, Quadros >= 60) switch { (true, true) => 6000, (true, false) => 4500, (false, true) => 4500, _ => 3000 };

    public string Nome => $"{Altura}p · {Quadros} FPS";
}

/// <summary>
/// Uma live para o grupo. Codifica uma vez (H.264 pela placa de vídeo, som em Opus) e envia um único fluxo,
/// cifrado (RTSPS), ao servidor de mídia, que entrega a cada membro que abrir. O exilados-api dá o caminho e a
/// senha de envio; a cada 10 s o programa manda o sinal de vida, sem o qual a live some do site em 20 s.
/// Se o envio cair, tenta de novo com o mesmo caminho; sem voltar em 30 s, encerra.
/// </summary>
internal sealed class Transmissao : IAsyncDisposable
{
    public const int PortaMidia = 8322;
    private static readonly TimeSpan PrazoQueda = TimeSpan.FromSeconds(30);
    private readonly Api _api;
    private readonly OpcoesLive _opcoes;
    private readonly string _codificador;
    private readonly PermissaoLive _permissao;
    private readonly CancellationTokenSource _parar = new();
    private Task _envio = Task.CompletedTask, _sinal = Task.CompletedTask;
    private readonly DateTime _inicio = DateTime.Now;
    private bool _gdi;
    private int _falhasDxgi;
    private long _quadrosEnviados;

    public string Situacao { get; private set; } = "";
    public bool AoVivo { get; private set; }
    /// <summary>Quantos estão assistindo; -1 enquanto não se sabe.</summary>
    public int Assistindo { get; private set; } = -1;
    public string CodificadorUsado => _codificador;
    public OpcoesLive Opcoes => _opcoes;
    public string Caminho => _permissao.Caminho;
    /// <summary>Algo mudou (situação, ao vivo, quem assiste). Pode vir de qualquer thread.</summary>
    public event Action? Mudou;
    /// <summary>A live acabou sem a pessoa pedir (queda longa, ou o servidor encerrou), com o motivo.</summary>
    public event Action<string>? Encerrada;

    private Transmissao(Api api, OpcoesLive opcoes, string codificador, PermissaoLive permissao)
    {
        _api = api;
        _opcoes = opcoes;
        _codificador = codificador;
        _permissao = permissao;
    }

    public static async Task<Transmissao> ComecarAsync(Api api, OpcoesLive opcoes, Action<string> andamento, CancellationToken ct)
    {
        if (opcoes.Programa is { } programa)
        {
            if (!programa.TentarArea(out _)) throw new ExiladosException("Abra ou restaure a janela do programa escolhido.");
            if (opcoes.Som && !SomDePrograma.Disponivel) throw new ExiladosException("Para transmitir só o som do programa, use o Windows 11 ou desligue o som da live.");
        }
        if (!ComponenteVideo.Presente)
        {
            andamento("Preparando o componente de vídeo (só na primeira vez)...");
            await ComponenteVideo.GarantirAsync(p => andamento($"Baixando o componente de vídeo: {p}%"), ct);
        }
        andamento("Procurando a placa de vídeo...");
        string codificador = await Codificador.AcharAsync(ct)
            ?? throw new ExiladosException("Nenhuma placa de vídeo deste computador codifica H.264, e a live precisa dela.");
        andamento("Pedindo a live ao servidor...");
        var permissao = await api.ComecarAsync(ct);
        var t = new Transmissao(api, opcoes, codificador, permissao);
        t._envio = Task.Run(t.EnviarAsync);
        t._sinal = Task.Run(t.SinalAsync);
        Registro.Sessao($"live: começou ({opcoes.Nome}, {(opcoes.Som ? "com som" : "sem som")}, {(opcoes.Programa is null ? "tela" : "programa " + opcoes.Programa.Nome)}, {Codificador.Marca(codificador)}), caminho {permissao.Caminho[..7]}…");
        return t;
    }

    private void MudarSituacao(string situacao, bool aoVivo)
    {
        Situacao = situacao;
        AoVivo = aoVivo;
        Mudou?.Invoke();
    }

    private void Encerrar(string motivo)
    {
        if (_parar.IsCancellationRequested) return;
        Registro.Sessao($"live: encerrada ({motivo})");
        MudarSituacao(motivo, false);
        _parar.Cancel();
        Encerrada?.Invoke(motivo);
    }

    // Envia até ser parada; se cair (internet, servidor reiniciando), tenta de novo com o mesmo caminho.
    private async Task EnviarAsync()
    {
        var ct = _parar.Token;
        int falhas = 0;
        DateTime? caiuEm = null;
        while (!ct.IsCancellationRequested)
        {
            string problema;
            try { problema = await EnviarUmaVezAsync(ct); }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { break; }
            catch (Exception ex) when (ex is IOException or ExiladosException or UnauthorizedAccessException or TimeoutException) { problema = ex.Message; }
            if (ct.IsCancellationRequested) break;
            if (Interlocked.Read(ref _quadrosEnviados) > 0) caiuEm = null;
            caiuEm ??= DateTime.Now;
            falhas++;
            Registro.Sessao($"live: o envio parou ({problema}); tentativa {falhas}");
            if (DateTime.Now - caiuEm > PrazoQueda)
            {
                Encerrar($"A live caiu e não voltou em 30 s ({problema}).");
                break;
            }
            int espera = Math.Min(10, 2 * falhas);
            MudarSituacao($"O envio parou ({problema}). Tentando de novo em {espera} s...", false);
            try { await Task.Delay(TimeSpan.FromSeconds(espera), ct); }
            catch (OperationCanceledException) { break; }
        }
    }

    // Sinal de vida a cada 10 s; traz quantos estão assistindo.
    private async Task SinalAsync()
    {
        var ct = _parar.Token;
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(10), ct);
                int n = await _api.SinalAsync(ct);
                if (n != Assistindo)
                {
                    Assistindo = n;
                    Mudou?.Invoke();
                }
            }
            catch (OperationCanceledException) { break; }
            catch (LiveTerminadaException ex) { Encerrar(ex.Message); break; }
            catch (ExiladosException ex) when (ex.Message.Contains("não faz mais parte", StringComparison.OrdinalIgnoreCase)) { Encerrar(ex.Message); break; }
            catch (ExiladosException) { /* sem conexão agora: o próximo sinal tenta de novo */ }
        }
    }

    private async Task<string> EnviarUmaVezAsync(CancellationToken ct)
    {
        var telas = Screen.AllScreens;
        int indice = _opcoes.Tela >= 0 && _opcoes.Tela < telas.Length ? _opcoes.Tela : Math.Max(0, Array.FindIndex(telas, s => s.Primary));
        FonteTela fonte;
        if (_opcoes.Programa is { } programa)
        {
            if (!programa.TentarArea(out var area)) throw new ExiladosException("o programa foi fechado ou minimizado; restaure a janela para voltar ao ar");
            fonte = new FonteTela("janela do programa", area);
        }
        else fonte = FonteTela.Para(telas[indice]).First(s => !_gdi || !s.Dxgi);
        string? nomeSom = _opcoes.Som ? $"exilados-som-{Guid.NewGuid():N}" : null;
        using var canoSom = nomeSom is null ? null : new NamedPipeServerStream(nomeSom, PipeDirection.Out, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly, 0, 1 << 20);
        string endereco = $"rtsps://{_permissao.Usuario}:{_permissao.Senha}@{new Uri(_permissao.Rtsps.Replace("rtsps://", "https://")).Host}:{PortaMidia}/{_permissao.Caminho}";
        var (largura, altura) = TamanhoDeSaida(fonte.Area.Width, fonte.Area.Height, _opcoes.Altura);
        string nomeImagem = $"exilados-imagem-{Guid.NewGuid():N}";
        using var canoImagem = _opcoes.Programa is null ? null : new NamedPipeServerStream(nomeImagem, PipeDirection.Out, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly, 0, 1 << 20);
        await using var capturaPrograma = _opcoes.Programa is { } escolhido ? new CapturaPrograma(escolhido, largura, altura, _opcoes.Quadros) : null;
        Registro.Sessao($"live: capturando pelo {fonte.Nome} ({fonte.Area.Width}x{fonte.Area.Height}), enviando {largura}x{altura}");
        MudarSituacao("Conectando ao servidor...", false);
        using var processo = new ProcessoVideo(Argumentos(fonte, _opcoes, _codificador, nomeSom is null ? null : $@"\\.\pipe\{nomeSom}", endereco,
            canoImagem is null ? null : $@"\\.\pipe\{nomeImagem}"));
        using var parando = CancellationTokenSource.CreateLinkedTokenSource(ct);
        using var matar = parando.Token.Register(processo.Encerrar);
        var som = canoSom is null ? Task.CompletedTask : Task.Run(() => BombearSomAsync(canoSom, _opcoes.Programa?.Processo ?? 0, parando.Token));
        var imagem = capturaPrograma is null ? Task.CompletedTask : Task.Run(() => capturaPrograma.BombearAsync(canoImagem!, parando.Token));
        _ = imagem.ContinueWith(_ => processo.Encerrar(), CancellationToken.None, TaskContinuationOptions.OnlyOnFaulted | TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
        _ = som.ContinueWith(_ => processo.Encerrar(), CancellationToken.None, TaskContinuationOptions.OnlyOnFaulted | TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
        Interlocked.Exchange(ref _quadrosEnviados, 0);
        var andamento = Task.Run(() => AcompanharAsync(processo.Processo.StandardOutput, parando.Token));
        // Cão de guarda: o som pode continuar com a imagem parada (a captura travou), e quem assiste fica esperando.
        // Sem quadro novo por 6 s (ou nenhum em 20 s), reinicia o envio.
        bool parada = false;
        var guarda = Task.Run(async () =>
        {
            long visto = 0, desde = Stopwatch.GetTimestamp(), comeco = desde;
            while (!parando.IsCancellationRequested)
            {
                await Task.Delay(250, parando.Token);
                if (_opcoes.Programa is { } p && (!p.TentarArea(out var atual) || atual != fonte.Area))
                {
                    processo.Encerrar();
                    return;
                }
                long agora = Interlocked.Read(ref _quadrosEnviados);
                if (agora != visto)
                {
                    visto = agora;
                    desde = Stopwatch.GetTimestamp();
                }
                else if (agora > 0 ? Stopwatch.GetElapsedTime(desde) > TimeSpan.FromSeconds(6) : Stopwatch.GetElapsedTime(comeco) > TimeSpan.FromSeconds(20))
                {
                    parada = true;
                    processo.Encerrar();
                    return;
                }
            }
        });
        try
        {
            await processo.Processo.WaitForExitAsync(ct);
        }
        finally
        {
            parando.Cancel();
            try { await Task.WhenAll(som, andamento, guarda, imagem); }
            catch (Exception ex) when (ex is OperationCanceledException or IOException or ObjectDisposedException or TimeoutException) { }
        }
        ct.ThrowIfCancellationRequested();
        if (imagem.IsFaulted) return imagem.Exception!.GetBaseException().Message;
        if (som.IsFaulted) return som.Exception!.GetBaseException().Message;
        if (parada)
        {
            if (fonte.Dxgi) _gdi = true;
            return $"a imagem parou de sair (captura pelo {fonte.Nome})";
        }
        string erro = processo.Erro;
        if (fonte.Dxgi && (erro.Contains("ddagrab", StringComparison.OrdinalIgnoreCase) || erro.Contains("d3d11", StringComparison.OrdinalIgnoreCase)) &&
            (!AoVivo || ++_falhasDxgi >= 2))
            _gdi = true;
        return erro.Contains("401") || erro.Contains("Unauthorized") ? "o servidor recusou a permissão de envio"
            : erro.Length > 0 ? erro : $"o FFmpeg terminou com o código {processo.Processo.ExitCode}";
    }

    // O FFmpeg informa o andamento ("frame=..."): quadro saindo é live no ar.
    private async Task AcompanharAsync(StreamReader saida, CancellationToken ct)
    {
        long quadros = 0;
        while (await saida.ReadLineAsync(ct) is { } linha)
        {
            if (!linha.StartsWith("frame=", StringComparison.Ordinal) || !long.TryParse(linha.AsSpan(6), out long agora)) continue;
            if (agora > quadros && !AoVivo) MudarSituacao("Ao vivo", true);
            quadros = agora;
            Interlocked.Exchange(ref _quadrosEnviados, agora);
        }
    }

    /// <summary>
    /// Mantém o som chegando ao FFmpeg no ritmo do relógio: quando nada toca, o Windows não entrega nada, e o
    /// FFmpeg (e o vídeo junto) ficaria esperando. O que falta vira silêncio; o que sobra demais é descartado.
    /// </summary>
    private static async Task BombearSomAsync(NamedPipeServerStream cano, int processo, CancellationToken ct)
    {
        await cano.WaitForConnectionAsync(ct);
        var fila = new ConcurrentQueue<short[]>();
        using var captura = new CapturaSom(pedaco => { if (fila.Count < 100) fila.Enqueue(pedaco); }, processo);
        const int taxa = CapturaSom.Taxa, quadro = 960; // 20 ms
        var silencio = new byte[quadro * 4];
        long inicio = Stopwatch.GetTimestamp(), escritos = 0;
        while (!ct.IsCancellationRequested)
        {
            await Task.Delay(10, ct);
            if (processo > 0 && Stopwatch.GetElapsedTime(inicio).TotalSeconds > 4 && captura.Problema.Length > 0)
                throw new IOException("Não foi possível capturar só o som do programa: " + captura.Problema);
            long esperado = (long)(Stopwatch.GetElapsedTime(inicio).TotalSeconds * taxa);
            while (fila.TryDequeue(out var pedaco))
            {
                if (escritos > esperado + taxa / 10) continue; // mais de 100 ms adiantado: descarta
                await cano.WriteAsync(System.Runtime.InteropServices.MemoryMarshal.AsBytes(pedaco.AsSpan()).ToArray(), ct);
                escritos += pedaco.Length / 2;
            }
            while (escritos < esperado - taxa * 6 / 100) // mais de 60 ms atrás (nada tocando): silêncio
            {
                await cano.WriteAsync(silencio, ct);
                escritos += quadro;
            }
        }
    }

    /// <summary>Tamanho da imagem enviada: reduzida até a altura pedida (nunca ampliada), com medidas pares.</summary>
    internal static (int Largura, int Altura) TamanhoDeSaida(int largura, int altura, int alturaAlvo)
    {
        if (altura <= alturaAlvo) return (largura & ~1, altura & ~1);
        int escalada = (int)Math.Round(largura * (double)alturaAlvo / altura / 2) * 2;
        return (escalada, alturaAlvo & ~1);
    }

    private static string N(long v) => v.ToString(CultureInfo.InvariantCulture);

    internal static List<string> Argumentos(FonteTela fonte, OpcoesLive o, string codificador, string? canoSom, string endereco, string? canoImagem = null)
    {
        var a = fonte.Area;
        var (w, h) = TamanhoDeSaida(a.Width, a.Height, o.Altura);
        string escala = $"scale={w}:{h}:flags=bicubic:out_color_matrix=bt709:out_range=tv,format=nv12";
        var args = new List<string> { "-hide_banner", "-loglevel", "error", "-nostdin", "-nostats", "-progress", "pipe:1" };
        bool programa = o.Programa is not null;
        bool filtroNaFonte = fonte.Dxgi && !programa;
        if (programa)
        {
            if (canoImagem is null) throw new InvalidDataException("A captura do programa precisa do seu fluxo de imagem.");
            args.AddRange(["-f", "rawvideo", "-pixel_format", "bgra", "-video_size", $"{w}x{h}", "-framerate", N(o.Quadros), "-i", canoImagem]);
        }
        else if (fonte.Dxgi)
        {
            args.AddRange(["-init_hw_device", $"d3d11va=tela:{fonte.Placa}", "-filter_hw_device", "tela", "-filter_complex",
                $"ddagrab=output_idx={fonte.Saida}:framerate={o.Quadros}:draw_mouse=1:video_size={a.Width}x{a.Height},hwdownload,format=bgra,{escala}[v]"]);
        }
        else
        {
            args.AddRange(["-f", "gdigrab", "-draw_mouse", "1", "-framerate", N(o.Quadros), "-offset_x", N(a.X), "-offset_y", N(a.Y),
                "-video_size", $"{a.Width}x{a.Height}", "-i", "desktop"]);
        }
        if (canoSom is not null) args.AddRange(["-thread_queue_size", "1024", "-f", "s16le", "-ar", "48000", "-ac", "2", "-i", canoSom]);
        if (filtroNaFonte) args.AddRange(["-map", "[v]"]);
        else args.AddRange(["-map", "0:v", "-vf", escala]);
        if (canoSom is not null) args.AddRange(["-map", $"{(filtroNaFonte ? 0 : 1)}:a"]);

        long taxa = o.VideoKbps * 1000L;
        // Sem quadros B (o WebRTC não os aceita) e quadro-chave a cada 2 s: quem entra no meio vê a imagem logo.
        args.AddRange(["-c:v", codificador, "-pix_fmt", "nv12", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
            "-color_range", "tv", "-profile:v", "high", "-bf", "0", "-g", N(o.Quadros * 2),
            "-b:v", N(taxa), "-maxrate", N(taxa), "-bufsize", N(taxa)]);
        // Quadro completo (IDR) a cada 2 s imposto quadro a quadro: alguns drivers ignoram o -g e, em baixa latência,
        // trocam os quadros completos por atualização em faixas; quem entrasse depois ficaria com a tela preta.
        args.AddRange(["-force_key_frames", "expr:gte(t,n_forced*2)"]);
        if (codificador.EndsWith("_nvenc")) args.AddRange(["-preset", "p4", "-tune", "ll", "-rc", "cbr", "-forced-idr", "1"]);
        else if (codificador.EndsWith("_amf"))
            args.AddRange(["-usage", "lowlatency", "-quality", "balanced", "-rc", "cbr", "-forced_idr", "1", "-intra_refresh_mb", "0",
                "-header_spacing", N(o.Quadros * 2)]);
        else if (codificador.EndsWith("_qsv")) args.AddRange(["-preset", "veryfast", "-forced_idr", "1"]);
        if (canoSom is not null) args.AddRange(["-c:a", "libopus", "-b:a", "128k", "-ar", "48000", "-ac", "2"]);
        // O certificado do servidor é conferido pelo Windows: a senha de envio só vai para o servidor de verdade.
        args.AddRange(["-f", "rtsp", "-rtsp_transport", "tcp", "-tls_verify", "1", endereco]);
        return args;
    }

    public async ValueTask DisposeAsync()
    {
        bool jaParada = _parar.IsCancellationRequested;
        _parar.Cancel();
        try { await Task.WhenAll(_envio, _sinal); }
        catch (Exception ex) when (ex is OperationCanceledException or IOException or ExiladosException) { }
        try
        {
            using var prazo = new CancellationTokenSource(TimeSpan.FromSeconds(8));
            await _api.PararAsync(prazo.Token);
        }
        catch (Exception ex) when (ex is ExiladosException or LiveTerminadaException or OperationCanceledException) { }
        if (!jaParada) Registro.Sessao($"live: parada depois de {Registro.Duracao(_inicio)}");
        AoVivo = false;
        Situacao = "Live encerrada.";
    }
}
