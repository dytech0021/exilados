using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Exilados;

/// <summary>O FFmpeg roda em processo separado: um defeito nele não derruba o programa, e ele só recebe argumentos fixos.</summary>
internal sealed class ProcessoVideo : IDisposable
{
    public Process Processo { get; }
    private string _erro = "";
    private readonly ConcurrentQueue<string> _ultimas = new();
    /// <summary>Última linha de erro que o FFmpeg escreveu.</summary>
    public string Erro => _erro;
    public string Diagnostico => string.Join(Environment.NewLine, _ultimas);

    public ProcessoVideo(IEnumerable<string> argumentos)
    {
        string caminho = ComponenteVideo.CaminhoConferido();
        var inicio = new ProcessStartInfo(caminho)
        {
            UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
            WorkingDirectory = Path.GetDirectoryName(caminho)!,
        };
        foreach (string a in argumentos) inicio.ArgumentList.Add(a);
        try { Processo = Process.Start(inicio) ?? throw new IOException("Não foi possível iniciar o vídeo."); }
        catch (System.ComponentModel.Win32Exception ex) { throw new IOException("Não foi possível iniciar o vídeo: " + ex.Message); }
        _ = Task.Run(async () =>
        {
            try
            {
                while (await Processo.StandardError.ReadLineAsync() is { } linha)
                {
                    if (linha.Trim().Length == 0) continue;
                    _erro = linha.Length > 300 ? linha[..300] : linha;
                    _ultimas.Enqueue(_erro);
                    while (_ultimas.Count > 200) _ultimas.TryDequeue(out _);
                }
            }
            catch (Exception ex) when (ex is IOException or InvalidOperationException or ObjectDisposedException) { }
        });
    }

    public void Encerrar()
    {
        try { if (!Processo.HasExited) Processo.Kill(); }
        catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception or NotSupportedException or AggregateException) { }
    }

    public void Dispose()
    {
        Encerrar();
        try { Processo.WaitForExit(1500); } catch (InvalidOperationException) { }
        Processo.Dispose();
    }
}

/// <summary>De onde vem a imagem de uma tela: a duplicação da área de trabalho do DirectX (pela placa) ou o GDI.</summary>
internal sealed record FonteTela(string Nome, Rectangle Area, int Placa = -1, int Saida = -1)
{
    public bool Dxgi => Placa >= 0;

    /// <summary>Na ordem de preferência: DXGI quando a tela é encontrada nele, e o GDI, que sempre existe.</summary>
    public static IEnumerable<FonteTela> Para(Screen tela)
    {
        var area = tela.Bounds;
        area.Width &= ~1;
        area.Height &= ~1;
        // Monitor girado: o DirectX entrega a imagem sem girar; a do GDI já vem como a tela aparece.
        if (SaidasDeVideo.Achar(tela.DeviceName) is { Girada: false } dxgi) yield return new FonteTela("DXGI", area, dxgi.Placa, dxgi.Saida);
        yield return new FonteTela("GDI", area);
    }
}

/// <summary>Em que placa e em que saída dela o DirectX enxerga cada tela, na mesma ordem que o FFmpeg usa.</summary>
internal static unsafe class SaidasDeVideo
{
    [DllImport("dxgi.dll")]
    private static extern int CreateDXGIFactory1(in Guid riid, out IntPtr factory);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct OutputDesc
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName;
        public int Left, Top, Right, Bottom;
        public int AttachedToDesktop, Rotation;
        public IntPtr Monitor;
    }

    private static readonly Guid Factory1 = new("770aae78-f26f-4dba-a829-253c83d1b387");
    private static IntPtr Metodo(IntPtr com, int posicao) => (*(IntPtr**)com)[posicao];
    private static void Liberar(IntPtr com) => ((delegate* unmanaged[Stdcall]<IntPtr, uint>)Metodo(com, 2))(com);

    public static (int Placa, int Saida, bool Girada)? Achar(string nomeDoDispositivo)
    {
        var bruto = stackalloc byte[Marshal.SizeOf<OutputDesc>()];
        try
        {
            if (CreateDXGIFactory1(Factory1, out IntPtr fabrica) < 0) return null;
            try
            {
                // IDXGIFactory::EnumAdapters, IDXGIAdapter::EnumOutputs e IDXGIOutput::GetDesc ficam na posição 7.
                for (uint a = 0; a < 16; a++)
                {
                    IntPtr placa;
                    if (((delegate* unmanaged[Stdcall]<IntPtr, uint, IntPtr*, int>)Metodo(fabrica, 7))(fabrica, a, &placa) < 0) break;
                    try
                    {
                        for (uint o = 0; o < 16; o++)
                        {
                            IntPtr saida;
                            if (((delegate* unmanaged[Stdcall]<IntPtr, uint, IntPtr*, int>)Metodo(placa, 7))(placa, o, &saida) < 0) break;
                            try
                            {
                                if (((delegate* unmanaged[Stdcall]<IntPtr, byte*, int>)Metodo(saida, 7))(saida, bruto) < 0) continue;
                                var desc = Marshal.PtrToStructure<OutputDesc>((IntPtr)bruto);
                                if (desc.AttachedToDesktop != 0 && string.Equals(desc.DeviceName, nomeDoDispositivo, StringComparison.OrdinalIgnoreCase))
                                    return ((int)a, (int)o, desc.Rotation > 1);
                            }
                            finally { Liberar(saida); }
                        }
                    }
                    finally { Liberar(placa); }
                }
                return null;
            }
            finally { Liberar(fabrica); }
        }
        catch (Exception ex) when (ex is DllNotFoundException or EntryPointNotFoundException or SEHException) { return null; }
    }
}

/// <summary>Qual placa de vídeo codifica H.264 neste computador (NVIDIA, AMD ou Intel).</summary>
internal static class Codificador
{
    private static string? _achado;
    private static readonly SemaphoreSlim Trava = new(1, 1);

    public static string Marca(string codificador) =>
        codificador.EndsWith("_nvenc") ? "NVIDIA" : codificador.EndsWith("_amf") ? "AMD" : codificador.EndsWith("_qsv") ? "Intel" : codificador;

    public static async Task<string?> AcharAsync(CancellationToken ct)
    {
        await Trava.WaitAsync(ct);
        try
        {
            if (_achado is not null) return _achado.Length == 0 ? null : _achado;
            foreach (string c in new[] { "h264_nvenc", "h264_amf", "h264_qsv" })
            {
                using var p = new ProcessoVideo(["-hide_banner", "-loglevel", "error", "-nostdin", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30",
                    "-frames:v", "3", "-vf", "format=nv12", "-c:v", c, "-bf", "0", "-f", "null", "-"]);
                using var prazo = CancellationTokenSource.CreateLinkedTokenSource(ct);
                prazo.CancelAfter(TimeSpan.FromSeconds(10));
                try
                {
                    await p.Processo.WaitForExitAsync(prazo.Token);
                    if (p.Processo.ExitCode == 0) return _achado = c;
                }
                catch (OperationCanceledException) when (!ct.IsCancellationRequested) { }
            }
            _achado = "";
            return null;
        }
        finally { Trava.Release(); }
    }
}
