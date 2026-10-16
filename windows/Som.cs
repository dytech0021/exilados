using System.Runtime.InteropServices;

namespace Exilados;

/// <summary>
/// Captura o que o computador está tocando na saída de som padrão (não o microfone), ou só o som de um programa
/// (Windows 11), e entrega em pedaços de 20 ms: 16 bits, dois canais, 48 kHz, sem cortar os silêncios.
/// </summary>
internal sealed class CapturaSom : IDisposable
{
    public const int Taxa = 48000, Canais = 2;
    private readonly Action<short[]> _entregar;
    private readonly int _processo;
    private readonly Thread _thread;
    private readonly short[] _pendente = new short[Taxa * Canais];
    private int _quantos;
    private volatile bool _parar;

    /// <summary>Vazio enquanto a captura funciona; senão, o motivo de não haver som.</summary>
    public string Problema { get; private set; } = "iniciando";

    public CapturaSom(Action<short[]> entregar, int processo = 0)
    {
        _entregar = entregar;
        _processo = processo;
        _thread = new Thread(Rodar) { IsBackground = true, Name = "exilados-som" };
        _thread.Start();
    }

    private void Rodar()
    {
        while (!_parar)
        {
            try { Capturar(); }
            catch (Exception ex) when (ex is COMException or InvalidCastException or NotSupportedException) { Problema = ex.Message; }
            // Sem saída de som, ou ela mudou (um fone conectado, por exemplo): tenta de novo com a que for a padrão.
            for (int i = 0; i < 20 && !_parar; i++) Thread.Sleep(50);
        }
    }

    private void Capturar()
    {
        var enumerador = (NativoSom.IMMDeviceEnumerator)new NativoSom.MMDeviceEnumerator();
        NativoSom.IMMDevice? dispositivo = null;
        NativoSom.IAudioClient? cliente = null;
        NativoSom.IAudioCaptureClient? captura = null;
        try
        {
            string idSaida = "";
            if (_processo > 0) cliente = SomDePrograma.Ativar(_processo);
            else
            {
                Marshal.ThrowExceptionForHR(enumerador.GetDefaultAudioEndpoint(0, 0, out dispositivo));
                Marshal.ThrowExceptionForHR(dispositivo.GetId(out idSaida));
                Guid idCliente = typeof(NativoSom.IAudioClient).GUID;
                Marshal.ThrowExceptionForHR(dispositivo.Activate(ref idCliente, 23, IntPtr.Zero, out object ativado));
                cliente = (NativoSom.IAudioClient)ativado;
            }

            // Primeiro pede o som já em 48 kHz e 16 bits, com o Windows convertendo; se ele recusar, a conversão é feita aqui.
            var formato = new Formato(Taxa, Canais, 16, false);
            const long duracaoBuffer = 2_000_000; // 200 ms, em unidades de 100 ns
            IntPtr pedido = Marshal.AllocHGlobal(Marshal.SizeOf<NativoSom.WAVEFORMATEX>());
            int resultado;
            try
            {
                Marshal.StructureToPtr(NativoSom.WAVEFORMATEX.Pcm16(Taxa, Canais), pedido, false);
                resultado = cliente.Initialize(0, NativoSom.AUDCLNT_STREAMFLAGS_LOOPBACK | NativoSom.AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM |
                                                  NativoSom.AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY, duracaoBuffer, 0, pedido, IntPtr.Zero);
            }
            finally { Marshal.FreeHGlobal(pedido); }
            if (resultado < 0)
            {
                if (_processo > 0) Marshal.ThrowExceptionForHR(resultado);
                Marshal.ThrowExceptionForHR(cliente.GetMixFormat(out IntPtr mistura));
                try
                {
                    formato = Formato.Ler(mistura);
                    Marshal.ThrowExceptionForHR(cliente.Initialize(0, NativoSom.AUDCLNT_STREAMFLAGS_LOOPBACK, duracaoBuffer, 0, mistura, IntPtr.Zero));
                }
                finally { NativoSom.CoTaskMemFree(mistura); }
            }

            Guid idCaptura = typeof(NativoSom.IAudioCaptureClient).GUID;
            Marshal.ThrowExceptionForHR(cliente.GetService(ref idCaptura, out object servico));
            captura = (NativoSom.IAudioCaptureClient)servico;
            Marshal.ThrowExceptionForHR(cliente.Start());
            Problema = "";
            _quantos = 0;

            int pedaco = formato.Taxa / 50 * Canais;
            long proximaConferencia = Environment.TickCount64 + 1000;
            while (!_parar)
            {
                Thread.Sleep(10);
                if (_processo == 0 && Environment.TickCount64 >= proximaConferencia)
                {
                    proximaConferencia = Environment.TickCount64 + 1000;
                    Marshal.ThrowExceptionForHR(enumerador.GetDefaultAudioEndpoint(0, 0, out var atual));
                    try
                    {
                        Marshal.ThrowExceptionForHR(atual.GetId(out string idAtual));
                        if (idAtual != idSaida) { cliente.Stop(); return; }
                    }
                    finally { Marshal.ReleaseComObject(atual); }
                }
                while (true)
                {
                    if (captura.GetNextPacketSize(out uint quadros) < 0) return;
                    if (quadros == 0) break;
                    if (captura.GetBuffer(out IntPtr dados, out quadros, out uint flags, out _, out _) < 0) return;
                    Acrescentar(formato, dados, (int)quadros, (flags & NativoSom.AUDCLNT_BUFFERFLAGS_SILENT) != 0);
                    captura.ReleaseBuffer(quadros);
                    while (_quantos >= pedaco) Entregar(pedaco, formato.Taxa);
                }
            }
            cliente.Stop();
        }
        finally
        {
            if (captura is not null) Marshal.ReleaseComObject(captura);
            if (cliente is not null) Marshal.ReleaseComObject(cliente);
            if (dispositivo is not null) Marshal.ReleaseComObject(dispositivo);
            Marshal.ReleaseComObject(enumerador);
        }
    }

    private readonly record struct Formato(int Taxa, int Canais, int Bits, bool Real)
    {
        public static Formato Ler(IntPtr ponteiro)
        {
            var onda = Marshal.PtrToStructure<NativoSom.WAVEFORMATEX>(ponteiro);
            int tipo = onda.wFormatTag;
            if (tipo == 0xFFFE && onda.cbSize >= 22) tipo = Marshal.ReadInt32(ponteiro, 24);
            bool conhecido = (tipo == 3 && onda.wBitsPerSample == 32) || (tipo == 1 && onda.wBitsPerSample is 16 or 24 or 32);
            if (!conhecido || onda.nChannels == 0 || onda.nSamplesPerSec is < 8000 or > 192000)
                throw new NotSupportedException("A saída de som deste computador usa um formato desconhecido.");
            return new Formato((int)onda.nSamplesPerSec, onda.nChannels, onda.wBitsPerSample, tipo == 3);
        }
    }

    private unsafe void Acrescentar(Formato f, IntPtr dados, int quadros, bool silencio)
    {
        quadros = Math.Min(quadros, (_pendente.Length - _quantos) / Canais);
        if (quadros <= 0) return;
        var alvo = _pendente.AsSpan(_quantos, quadros * Canais);
        _quantos += alvo.Length;
        if (silencio || dados == IntPtr.Zero)
        {
            alvo.Clear();
            return;
        }
        int bytes = f.Bits / 8, passo = bytes * f.Canais, direita = f.Canais > 1 ? bytes : 0;
        byte* p = (byte*)dados;
        for (int i = 0; i < quadros; i++, p += passo)
        {
            alvo[i * 2] = Amostra(p, f);
            alvo[i * 2 + 1] = Amostra(p + direita, f);
        }
    }

    private static unsafe short Amostra(byte* p, Formato f) => f switch
    {
        { Real: true } => (short)Math.Clamp(*(float*)p * 32767f, short.MinValue, short.MaxValue),
        { Bits: 16 } => *(short*)p,
        { Bits: 24 } => (short)(p[1] | (sbyte)p[2] << 8),
        _ => (short)(*(int*)p >> 16),
    };

    private void Entregar(int pedaco, int taxa)
    {
        // A live quer 48 kHz; outra taxa (saída que o Windows não converte) fica de fora.
        if (taxa == Taxa) _entregar(_pendente.AsSpan(0, pedaco).ToArray());
        _pendente.AsSpan(pedaco, _quantos - pedaco).CopyTo(_pendente);
        _quantos -= pedaco;
    }

    public void Dispose()
    {
        _parar = true;
        _thread.Join(1500);
    }
}

/// <summary>
/// Captura do som de um programa (e dos processos filhos dele), independente da saída de som. Nunca cai para o
/// som do computador inteiro, que mostraria o som dos outros programas. Exige Windows 11.
/// </summary>
public static class SomDePrograma
{
    internal static bool Disponivel => OperatingSystem.IsWindowsVersionAtLeast(10, 0, 20348);

    internal static NativoSom.IAudioClient Ativar(int pid)
    {
        if (!Disponivel) throw new NotSupportedException("O som de um programa só funciona no Windows 11.");
        var conclusao = new Conclusao();
        IntPtr dados = Marshal.AllocCoTaskMem(12);
        Marshal.WriteInt32(dados, 0, 1); // AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK
        Marshal.WriteInt32(dados, 4, pid);
        Marshal.WriteInt32(dados, 8, 0); // PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE
        var variante = new PropVariant { Tipo = 65, Blob = new Blob { Tamanho = 12, Dados = dados } }; // VT_BLOB
        IOperacao? operacao = null;
        try
        {
            Guid iid = typeof(NativoSom.IAudioClient).GUID;
            Marshal.ThrowExceptionForHR(ActivateAudioInterfaceAsync("VAD\\Process_Loopback", ref iid, ref variante, conclusao, out operacao));
            try { return conclusao.Pronto.Task.WaitAsync(TimeSpan.FromSeconds(10)).GetAwaiter().GetResult(); }
            catch (TimeoutException)
            {
                _ = conclusao.Pronto.Task.ContinueWith(t => { if (t.IsCompletedSuccessfully) Marshal.ReleaseComObject(t.Result); }, TaskScheduler.Default);
                throw new NotSupportedException("O Windows não respondeu à captura de som deste programa.");
            }
        }
        finally
        {
            if (operacao is not null) Marshal.ReleaseComObject(operacao);
            Marshal.FreeCoTaskMem(dados);
            GC.KeepAlive(conclusao);
        }
    }

    [StructLayout(LayoutKind.Sequential)] private struct Blob { public uint Tamanho; public IntPtr Dados; }
    [StructLayout(LayoutKind.Sequential)] private struct PropVariant { public ushort Tipo, R1, R2, R3; public Blob Blob; }
    [ComVisible(true), Guid("41D949AB-9862-444A-80F6-C261334DA5EB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IConclusao { [PreserveSig] int ActivateCompleted(IOperacao operacao); }
    [ComImport, Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IOperacao { [PreserveSig] int GetActivateResult(out int resultado, [MarshalAs(UnmanagedType.IUnknown)] out object cliente); }
    [ComVisible(true), Guid("94EA2B94-E9CC-49E0-C0FF-EE64CA8F5B90"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IAgil { }
    [ComVisible(true), ClassInterface(ClassInterfaceType.None)]
    public sealed class Conclusao : IConclusao, IAgil
    {
        internal readonly TaskCompletionSource<NativoSom.IAudioClient> Pronto = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public int ActivateCompleted(IOperacao operacao)
        {
            object? cliente = null;
            try
            {
                Marshal.ThrowExceptionForHR(operacao.GetActivateResult(out int resultado, out cliente));
                Marshal.ThrowExceptionForHR(resultado);
                Pronto.TrySetResult((NativoSom.IAudioClient)cliente);
                cliente = null;
            }
            catch (Exception ex) { Pronto.TrySetException(ex); }
            finally { if (cliente is not null && Marshal.IsComObject(cliente)) Marshal.ReleaseComObject(cliente); }
            return 0;
        }
    }
    [DllImport("mmdevapi.dll", ExactSpelling = true, CharSet = CharSet.Unicode)]
    private static extern int ActivateAudioInterfaceAsync(string caminho, ref Guid iid, ref PropVariant ativacao, IConclusao conclusao, out IOperacao operacao);
}

/// <summary>WASAPI em modo "loopback". Só os métodos usados têm assinatura de verdade; os demais mantêm a ordem da tabela.</summary>
public static class NativoSom
{
    public const int AUDCLNT_STREAMFLAGS_LOOPBACK = 0x00020000;
    public const int AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM = unchecked((int)0x80000000);
    public const int AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY = 0x08000000;
    public const uint AUDCLNT_BUFFERFLAGS_SILENT = 2;

    [StructLayout(LayoutKind.Sequential, Pack = 2)]
    public struct WAVEFORMATEX
    {
        public ushort wFormatTag, nChannels;
        public uint nSamplesPerSec, nAvgBytesPerSec;
        public ushort nBlockAlign, wBitsPerSample, cbSize;

        public static WAVEFORMATEX Pcm16(int taxa, int canais) => new()
        {
            wFormatTag = 1, nChannels = (ushort)canais, nSamplesPerSec = (uint)taxa, wBitsPerSample = 16,
            nBlockAlign = (ushort)(canais * 2), nAvgBytesPerSec = (uint)(taxa * canais * 2),
        };
    }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    public class MMDeviceEnumerator;

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
    public interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
    }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("D666063F-1587-4E43-81F1-B948E807363F")]
    public interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, int context, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
        [PreserveSig] int OpenPropertyStore(int access, out IntPtr properties);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("1CB9AD4C-DBFA-4C32-B178-C2F568A703B2")]
    public interface IAudioClient
    {
        [PreserveSig] int Initialize(int shareMode, int streamFlags, long bufferDuration, long periodicity, IntPtr format, IntPtr sessionGuid);
        [PreserveSig] int GetBufferSize(out uint frames);
        [PreserveSig] int GetStreamLatency(out long latency);
        [PreserveSig] int GetCurrentPadding(out uint frames);
        [PreserveSig] int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closest);
        [PreserveSig] int GetMixFormat(out IntPtr format);
        [PreserveSig] int GetDevicePeriod(out long defaultPeriod, out long minimumPeriod);
        [PreserveSig] int Start();
        [PreserveSig] int Stop();
        [PreserveSig] int Reset();
        [PreserveSig] int SetEventHandle(IntPtr handle);
        [PreserveSig] int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
    }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("C8ADBD64-E71E-48A0-A4DE-185C395CD317")]
    public interface IAudioCaptureClient
    {
        [PreserveSig] int GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong devicePosition, out ulong qpcPosition);
        [PreserveSig] int ReleaseBuffer(uint frames);
        [PreserveSig] int GetNextPacketSize(out uint frames);
    }

    [DllImport("ole32.dll")]
    public static extern void CoTaskMemFree(IntPtr memory);
}
