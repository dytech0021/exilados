using System.Diagnostics;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text;

namespace Exilados;

/// <summary>Uma janela de programa que pode ser transmitida (identificada também pelo processo, para não confundir).</summary>
internal sealed record ProgramaAberto(long Janela, int Processo, long Iniciado, string Titulo, string Nome)
{
    public override string ToString() => $"{Nome} — {Titulo}";

    internal static ProgramaAberto[] ListarIncluindoEste() => Listar(true);

    internal static ProgramaAberto[] Listar(bool incluirEste = false)
    {
        var lista = new List<ProgramaAberto>();
        EnumWindows((hwnd, estado) =>
        {
            if (!IsWindowVisible(hwnd) || GetWindow(hwnd, 4) != IntPtr.Zero) return true;
            var titulo = new StringBuilder(512);
            GetWindowTextW(hwnd, titulo, titulo.Capacity);
            if (titulo.Length == 0) return true;
            GetWindowThreadProcessId(hwnd, out uint pid);
            if (pid == Environment.ProcessId && !incluirEste) return true;
            try
            {
                using var processo = Process.GetProcessById((int)pid);
                var p = new ProgramaAberto(hwnd.ToInt64(), (int)pid, processo.StartTime.ToUniversalTime().Ticks, titulo.ToString(), processo.ProcessName);
                if (p.TentarArea(out _)) lista.Add(p);
            }
            catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or System.ComponentModel.Win32Exception) { }
            return true;
        }, IntPtr.Zero);
        return lista.OrderBy(p => p.Nome).ThenBy(p => p.Titulo).ToArray();
    }

    // Confere processo e janela a cada tentativa: um número de janela reaproveitado nunca pode mostrar outra janela.
    public bool TentarArea(out Rectangle area)
    {
        area = default;
        var hwnd = new IntPtr(Janela);
        if (!IsWindow(hwnd) || !IsWindowVisible(hwnd) || IsIconic(hwnd)) return false;
        GetWindowThreadProcessId(hwnd, out uint pid);
        if (pid != Processo) return false;
        try
        {
            using var processo = Process.GetProcessById(Processo);
            if (processo.StartTime.ToUniversalTime().Ticks != Iniciado) return false;
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or System.ComponentModel.Win32Exception) { return false; }
        if (!GetClientRect(hwnd, out var r) || r.Right < 2 || r.Bottom < 2) return false;
        area = new Rectangle(0, 0, r.Right, r.Bottom);
        return true;
    }

    private delegate bool Retorno(IntPtr hwnd, IntPtr estado);
    [DllImport("user32.dll")] private static extern bool EnumWindows(Retorno retorno, IntPtr estado);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr hwnd, uint comando);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowTextW(IntPtr hwnd, StringBuilder texto, int tamanho);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] private static extern bool GetClientRect(IntPtr hwnd, out Retangulo r);
    [StructLayout(LayoutKind.Sequential)] private struct Retangulo { public int Left, Top, Right, Bottom; }
}

/// <summary>
/// Imagem de um programa pela captura de janelas do Windows (Windows Graphics Capture, pelo FFmpeg). Ela só manda
/// quadro quando a janela muda: o último fica guardado e é repetido no ritmo da live, para um programa parado
/// ainda começar a live e o som não ficar esperando.
/// </summary>
internal sealed class CapturaPrograma : IAsyncDisposable
{
    private readonly ProcessoVideo _captura;
    private readonly CancellationTokenSource _parar = new();
    private readonly object _trava = new();
    private readonly byte[] _ultimo;
    private readonly Task _leitura;
    private readonly TaskCompletionSource _primeiro = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private volatile Exception? _falha;
    private readonly int _quadros;

    public CapturaPrograma(ProgramaAberto programa, int largura, int altura, int quadros)
    {
        if (largura < 2 || altura < 2 || (long)largura * altura > 16777216) throw new ExiladosException("A janela é grande demais para transmitir.");
        _quadros = quadros;
        _ultimo = new byte[checked(largura * altura * 4)];
        _captura = new ProcessoVideo(Argumentos(programa, largura, altura, quadros));
        _leitura = Task.Run(async () =>
        {
            try
            {
                byte[] quadro = new byte[_ultimo.Length];
                while (!_parar.IsCancellationRequested)
                {
                    await _captura.Processo.StandardOutput.BaseStream.ReadExactlyAsync(quadro, _parar.Token);
                    lock (_trava) quadro.CopyTo(_ultimo, 0);
                    _primeiro.TrySetResult();
                }
            }
            catch (Exception ex) when (ex is IOException or OperationCanceledException or ObjectDisposedException or EndOfStreamException)
            {
                if (!_parar.IsCancellationRequested)
                {
                    _falha = new IOException("A captura do programa parou. " + _captura.Erro, ex);
                    _primeiro.TrySetException(_falha);
                }
            }
        });
    }

    internal static List<string> Argumentos(ProgramaAberto p, int largura, int altura, int quadros) =>
        ["-hide_banner", "-loglevel", "error", "-nostdin", "-filter_complex",
        $"gfxcapture=hwnd={p.Janela}:max_framerate={quadros}:capture_cursor=1:capture_border=0:display_border=1:width={largura}:height={altura}:resize_mode=scale_aspect,hwdownload,format=bgra[v]",
        "-map", "[v]", "-c:v", "rawvideo", "-pix_fmt", "bgra", "-threads", "1", "-fps_mode", "passthrough", "-f", "rawvideo", "-flush_packets", "1", "pipe:1"];

    public async Task BombearAsync(NamedPipeServerStream cano, CancellationToken ct)
    {
        await cano.WaitForConnectionAsync(ct);
        await _primeiro.Task.WaitAsync(TimeSpan.FromSeconds(12), ct);
        byte[] quadro = new byte[_ultimo.Length];
        long inicio = Stopwatch.GetTimestamp(), escritos = 0;
        while (!ct.IsCancellationRequested)
        {
            if (_falha is { } falha) throw falha;
            lock (_trava) _ultimo.CopyTo(quadro, 0);
            await cano.WriteAsync(quadro, ct);
            escritos++;
            double espera = escritos * 1000.0 / _quadros - Stopwatch.GetElapsedTime(inicio).TotalMilliseconds;
            if (espera > 0) await Task.Delay(TimeSpan.FromMilliseconds(espera), ct);
            else if (espera < -200) { inicio = Stopwatch.GetTimestamp(); escritos = 0; }
        }
    }

    public async ValueTask DisposeAsync()
    {
        _parar.Cancel();
        _captura.Encerrar();
        try { await _leitura.WaitAsync(TimeSpan.FromSeconds(3)); }
        catch (Exception ex) when (ex is OperationCanceledException or TimeoutException) { }
        _captura.Dispose();
    }
}
