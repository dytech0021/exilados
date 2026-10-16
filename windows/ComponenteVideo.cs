using System.IO.Compression;
using System.Security.Cryptography;

namespace Exilados;

/// <summary>
/// O FFmpeg (compilação LGPL) que captura, codifica e envia a live. Não vem dentro do Exilados.exe: são 130 MB.
/// É o mesmo arquivo do Ponte: se o Ponte já o baixou neste computador, a cópia dele é aproveitada; senão vem,
/// comprimido, de https://filabox3d.com.br/exilados/atualizacao/. Nos dois casos só vale se o resumo (SHA-256)
/// bater com o fixado aqui, dentro do executável assinado. Fica em %LOCALAPPDATA%\Exilados\video.
/// </summary>
internal static class ComponenteVideo
{
    internal const string Sha256 = "ddf94f763d015cf13e76b515d92040364b4fcbc9f137f5b9238f116b26b8d245";
    internal const long Tamanho = 134_092_288;
    private const long PacoteMaximo = 96L * 1024 * 1024;
    private static readonly SemaphoreSlim Trava = new(1, 1);
    private static readonly HttpClient Http = new() { Timeout = Timeout.InfiniteTimeSpan };

    public static string Pasta => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Exilados", "video", Sha256);
    public static string Executavel => Path.Combine(Pasta, "ffmpeg.exe");
    public static string Endereco => $"https://filabox3d.com.br/exilados/atualizacao/video-{Sha256}.br";
    private static string DoPonte => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Ponte", "video", Sha256, "ffmpeg.exe");

    public static bool Presente
    {
        get
        {
            try { return new FileInfo(Executavel) is { Exists: true, Length: Tamanho }; }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { return false; }
        }
    }

    /// <summary>Garante o FFmpeg conferido; <paramref name="progresso"/> recebe a porcentagem do download.</summary>
    public static async Task GarantirAsync(Action<int>? progresso, CancellationToken ct)
    {
        await Trava.WaitAsync(ct);
        try
        {
            if (Confere(Executavel)) return;
            Directory.CreateDirectory(Pasta);
            string id = Guid.NewGuid().ToString("N");
            string pacote = Path.Combine(Pasta, id + ".br.tmp"), exe = Path.Combine(Pasta, id + ".exe.tmp");
            try
            {
                if (Confere(DoPonte))
                {
                    File.Copy(DoPonte, exe);
                }
                else
                {
                    await BaixarAsync(pacote, progresso, ct);
                    await using var entrada = File.OpenRead(pacote);
                    await using var brotli = new BrotliStream(entrada, CompressionMode.Decompress);
                    await using var saida = new FileStream(exe, FileMode.CreateNew, FileAccess.Write, FileShare.None);
                    var buffer = new byte[1024 * 1024];
                    long escritos = 0;
                    int n;
                    while ((n = await brotli.ReadAsync(buffer, ct)) > 0)
                    {
                        if ((escritos += n) > Tamanho) throw new ExiladosException("O componente de vídeo baixado não confere.");
                        await saida.WriteAsync(buffer.AsMemory(0, n), ct);
                    }
                }
                if (!Confere(exe)) throw new ExiladosException("O componente de vídeo não confere; nada foi usado.");
                File.Move(exe, Executavel, true);
            }
            catch (InvalidDataException) { throw new ExiladosException("O componente de vídeo baixado veio corrompido."); }
            finally
            {
                foreach (string temporario in new[] { pacote, exe })
                    try { File.Delete(temporario); } catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
            }
        }
        finally { Trava.Release(); }
    }

    private static async Task BaixarAsync(string destino, Action<int>? progresso, CancellationToken ct)
    {
        HttpResponseMessage resposta;
        try { resposta = await Http.GetAsync(Endereco, HttpCompletionOption.ResponseHeadersRead, ct); }
        catch (HttpRequestException) { throw new ExiladosException("Sem conexão para baixar o componente de vídeo."); }
        using (resposta)
        {
            if (!resposta.IsSuccessStatusCode) throw new ExiladosException($"O servidor não entregou o componente de vídeo ({(int)resposta.StatusCode}).");
            long total = resposta.Content.Headers.ContentLength ?? 0;
            if (total <= 0 || total > PacoteMaximo) throw new ExiladosException("O componente de vídeo no servidor tem um tamanho inesperado.");
            await using var origem = await resposta.Content.ReadAsStreamAsync(ct);
            await using var arquivo = new FileStream(destino, FileMode.CreateNew, FileAccess.Write, FileShare.None);
            var buffer = new byte[256 * 1024];
            long lidos = 0;
            int ultimo = -1, n;
            while ((n = await origem.ReadAsync(buffer, ct)) > 0)
            {
                if ((lidos += n) > PacoteMaximo) throw new ExiladosException("O componente de vídeo baixado é grande demais.");
                await arquivo.WriteAsync(buffer.AsMemory(0, n), ct);
                int porcento = (int)(lidos * 100 / total);
                if (porcento != ultimo) progresso?.Invoke(ultimo = porcento);
            }
        }
    }

    private static readonly object TravaAberto = new();
    private static FileStream? _aberto;

    /// <summary>
    /// Caminho do FFmpeg conferido. Na primeira vez confere o resumo e mantém o arquivo aberto sem permitir escrita
    /// ou troca: ninguém o substitui enquanto o programa estiver aberto. Nada além dele fica na pasta.
    /// </summary>
    public static string CaminhoConferido()
    {
        lock (TravaAberto)
        {
            if (_aberto is null)
            {
                FileStream arquivo;
                try { arquivo = new FileStream(Executavel, FileMode.Open, FileAccess.Read, FileShare.Read); }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                { throw new IOException("O componente de vídeo ainda não foi baixado neste computador."); }
                if (arquivo.Length != Tamanho || !Convert.ToHexString(SHA256.HashData(arquivo)).Equals(Sha256, StringComparison.OrdinalIgnoreCase))
                {
                    arquivo.Dispose();
                    throw new IOException("O componente de vídeo deste computador não confere.");
                }
                _aberto = arquivo;
            }
            foreach (string item in Directory.EnumerateFileSystemEntries(Pasta))
            {
                string nome = Path.GetFileName(item);
                if (nome.Equals("ffmpeg.exe", StringComparison.OrdinalIgnoreCase) || nome.EndsWith(".tmp", StringComparison.OrdinalIgnoreCase)) continue;
                try
                {
                    if (Directory.Exists(item)) Directory.Delete(item, true);
                    else File.Delete(item);
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                {
                    throw new IOException("Há um arquivo estranho na pasta do componente de vídeo: " + item);
                }
            }
            return Executavel;
        }
    }

    internal static bool Confere(string caminho)
    {
        try
        {
            if (new FileInfo(caminho) is not { Exists: true, Length: Tamanho }) return false;
            using var arquivo = File.OpenRead(caminho);
            return Convert.ToHexString(SHA256.HashData(arquivo)).Equals(Sha256, StringComparison.OrdinalIgnoreCase);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { return false; }
    }
}
