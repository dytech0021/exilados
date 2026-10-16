namespace Exilados;

/// <summary>Problema que a pessoa precisa ver, com a mensagem pronta em português.</summary>
internal sealed class ExiladosException(string message) : Exception(message);

/// <summary>A live acabou do lado do servidor (parada em outro lugar, ou a pessoa saiu do grupo).</summary>
internal sealed class LiveTerminadaException(string message) : Exception(message);

/// <summary>
/// Registros em %APPDATA%\Exilados: uma linha por início, fim e queda de cada live (sessoes.txt) e os erros
/// inesperados (erros.txt). Cada arquivo recomeça quando passa do tamanho limite.
/// </summary>
internal static class Registro
{
    private static readonly object Trava = new();

    public static string Pasta { get; set; } = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Exilados");

    public static void Sessao(string linha) => Escrever("sessoes.txt", 256 * 1024,
        $"{DateTime.Now:dd/MM/yyyy HH:mm:ss} · {Atualizacao.Atual} · {linha}{Environment.NewLine}");

    public static void Erro(Exception? erro)
    {
        if (erro is null) return;
        Escrever("erros.txt", 512 * 1024, $"--- {DateTime.Now:dd/MM/yyyy HH:mm:ss} · Exilados {Atualizacao.Atual}{Environment.NewLine}{erro}{Environment.NewLine}{Environment.NewLine}");
    }

    private static void Escrever(string nome, long limite, string texto)
    {
        try
        {
            lock (Trava)
            {
                Directory.CreateDirectory(Pasta);
                string arquivo = Path.Combine(Pasta, nome);
                if (new FileInfo(arquivo) is { Exists: true } info && info.Length > limite) File.Delete(arquivo);
                File.AppendAllText(arquivo, texto);
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
    }

    public static string Duracao(DateTime inicio)
    {
        var d = DateTime.Now - inicio;
        return d.TotalHours >= 1 ? $"{(int)d.TotalHours}h{d.Minutes:00}min"
            : d.TotalMinutes >= 1 ? $"{(int)d.TotalMinutes}min{d.Seconds:00}s" : $"{d.Seconds}s";
    }
}
