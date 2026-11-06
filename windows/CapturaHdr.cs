using System.Runtime.InteropServices;
using System.Text;

namespace Exilados;

/// <summary>
/// HDR ligado no Windows: a imagem é composta em luz linear (scRGB, 1.0 = 80 nits) e o conteúdo comum (área de
/// trabalho, janelas, jogo sem HDR) fica no "brilho do conteúdo SDR" das configurações, em geral 200 a 300 nits.
/// A captura de 8 bits corta tudo acima de 80 nits, e a live sai estourada para quem assiste.
/// </summary>
internal static class Hdr
{
    /// <summary>O branco do conteúdo SDR em nits, se a tela (\\.\DISPLAYn) está com HDR ligado; null sem HDR.</summary>
    public static double? BrancoSdr(string nomeDoDispositivo)
    {
        try
        {
            if (GetDisplayConfigBufferSizes(SoAtivos, out uint caminhos, out uint modos) != 0 || caminhos == 0) return null;
            var lista = new Caminho[caminhos];
            var bruto = Marshal.AllocHGlobal((int)Math.Max(modos, 1) * 64);
            try { if (QueryDisplayConfig(SoAtivos, ref caminhos, lista, ref modos, bruto, IntPtr.Zero) != 0) return null; }
            finally { Marshal.FreeHGlobal(bruto); }
            foreach (var c in lista.AsSpan(0, (int)caminhos))
            {
                var nome = new NomeDaOrigem { C = Cabecalho.De(1, c.Origem.Placa, c.Origem.Id, Marshal.SizeOf<NomeDaOrigem>()) };
                if (DisplayConfigGetDeviceInfo(ref nome) != 0 || !string.Equals(nome.Gdi, nomeDoDispositivo, StringComparison.OrdinalIgnoreCase)) continue;
                // Windows 11 24H2 em diante diz o modo (SDR, cor ampla ou HDR); antes, "cor avançada" sem a cor ampla
                // forçada (gerenciamento automático de cor numa tela SDR) é o HDR.
                var cor2 = new CorAvancada2 { C = Cabecalho.De(15, c.Destino.Placa, c.Destino.Id, Marshal.SizeOf<CorAvancada2>()) };
                bool hdr;
                if (DisplayConfigGetDeviceInfo(ref cor2) == 0) hdr = cor2.Modo == 2;
                else
                {
                    var cor = new CorAvancada { C = Cabecalho.De(9, c.Destino.Placa, c.Destino.Id, Marshal.SizeOf<CorAvancada>()) };
                    hdr = DisplayConfigGetDeviceInfo(ref cor) == 0 && (cor.Bits & 0b110) == 0b010;
                }
                if (!hdr) return null;
                var branco = new BrancoSdrInfo { C = Cabecalho.De(11, c.Destino.Placa, c.Destino.Id, Marshal.SizeOf<BrancoSdrInfo>()) };
                // Nível em milésimos de 80 nits; sem resposta, o padrão do Windows (200 nits).
                return DisplayConfigGetDeviceInfo(ref branco) == 0 && branco.Nivel >= 1000 ? branco.Nivel / 1000.0 * 80 : 200;
            }
            return null;
        }
        catch (Exception ex) when (ex is DllNotFoundException or EntryPointNotFoundException) { return null; }
    }

    /// <summary>Em que tela (\\.\DISPLAYn) está a maior parte da janela.</summary>
    public static string TelaDaJanela(long janela)
    {
        var info = new InfoMonitor { Tamanho = Marshal.SizeOf<InfoMonitor>() };
        return GetMonitorInfoW(MonitorFromWindow(new IntPtr(janela), 2), ref info) ? info.Dispositivo : "";
    }

    private const uint SoAtivos = 2;
    [StructLayout(LayoutKind.Sequential)] private struct Luid { public uint Baixo; public int Alto; }
    [StructLayout(LayoutKind.Sequential)] private struct Origem { public Luid Placa; public uint Id, Modo, Flags; }
    [StructLayout(LayoutKind.Sequential)] private struct Destino { public Luid Placa; public uint Id, Modo; public int Tecnologia, Giro, Escala; public uint TaxaN, TaxaD; public int Varredura, Disponivel; public uint Flags; }
    [StructLayout(LayoutKind.Sequential)] private struct Caminho { public Origem Origem; public Destino Destino; public uint Flags; }
    [StructLayout(LayoutKind.Sequential)] private struct Cabecalho
    {
        public int Tipo, Tamanho; public Luid Placa; public uint Id;
        public static Cabecalho De(int tipo, Luid placa, uint id, int tamanho) => new() { Tipo = tipo, Tamanho = tamanho, Placa = placa, Id = id };
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct NomeDaOrigem { public Cabecalho C; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string Gdi; }
    [StructLayout(LayoutKind.Sequential)] private struct CorAvancada { public Cabecalho C; public uint Bits; public int Codificacao; public uint BitsPorCanal; }
    [StructLayout(LayoutKind.Sequential)] private struct CorAvancada2 { public Cabecalho C; public uint Bits; public int Codificacao; public uint BitsPorCanal; public int Modo; }
    [StructLayout(LayoutKind.Sequential)] private struct BrancoSdrInfo { public Cabecalho C; public uint Nivel; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct InfoMonitor
    {
        public int Tamanho; public Rectangle Monitor, Trabalho; public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string Dispositivo;
    }
    [DllImport("user32.dll")] private static extern int GetDisplayConfigBufferSizes(uint flags, out uint caminhos, out uint modos);
    [DllImport("user32.dll")] private static extern int QueryDisplayConfig(uint flags, ref uint caminhos, [Out] Caminho[] lista, ref uint modos, IntPtr listaModos, IntPtr topologia);
    [DllImport("user32.dll")] private static extern int DisplayConfigGetDeviceInfo(ref NomeDaOrigem info);
    [DllImport("user32.dll")] private static extern int DisplayConfigGetDeviceInfo(ref CorAvancada info);
    [DllImport("user32.dll")] private static extern int DisplayConfigGetDeviceInfo(ref CorAvancada2 info);
    [DllImport("user32.dll")] private static extern int DisplayConfigGetDeviceInfo(ref BrancoSdrInfo info);
    [DllImport("user32.dll")] private static extern IntPtr MonitorFromWindow(IntPtr janela, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool GetMonitorInfoW(IntPtr monitor, ref InfoMonitor info);
}

/// <summary>
/// Captura com HDR ligado (de um programa ou de uma tela inteira): pede a imagem ao Windows em 16 bits, em luz linear,
/// e converte na placa de vídeo: o branco do conteúdo SDR volta a ser o branco, o que passa dele é suavizado até o
/// máximo (em vez de cortado) e sai BGRA de 8 bits em sRGB, igual à captura comum. Usa a captura de janelas do
/// Windows (Windows Graphics Capture) direto, sem o FFmpeg, porque só ela entrega os 16 bits e o shader roda na
/// mesma placa, sem passar a imagem grande pelo processador.
/// </summary>
internal sealed unsafe class CapturaHdr : CapturaQuadros
{
    private readonly Thread _thread;
    private volatile bool _parar;
    private readonly IntPtr _alvo;
    private readonly bool _tela;
    private readonly int _largura, _altura;
    private readonly float _ganho;
    private long _processados, _tempo;
    /// <summary>Quantos quadros já foram convertidos (para o teste).</summary>
    public long Processados => Interlocked.Read(ref _processados);
    /// <summary>Tempo médio da conversão de um quadro, da cópia na placa até os bytes prontos (para o teste).</summary>
    public double MsPorQuadro => Processados == 0 ? double.NaN : Interlocked.Read(ref _tempo) * 1000.0 / System.Diagnostics.Stopwatch.Frequency / Processados;

    private CapturaHdr(IntPtr alvo, bool tela, int largura, int altura, int quadros, double brancoNits) : base(largura, altura, quadros)
    {
        _alvo = alvo;
        _tela = tela;
        _largura = largura;
        _altura = altura;
        _ganho = (float)(80 / Math.Clamp(brancoNits, 80, 10000));
        _thread = new Thread(Rodar) { IsBackground = true, Name = "exilados-captura-hdr" };
        _thread.Start();
    }

    public static CapturaHdr DoPrograma(ProgramaAberto programa, int largura, int altura, int quadros, double brancoNits) =>
        new(new IntPtr(programa.Janela), false, largura, altura, quadros, brancoNits);

    public static CapturaHdr DaTela(Screen tela, int largura, int altura, int quadros, double brancoNits)
    {
        var b = tela.Bounds;
        return new(MonitorFromPoint(new Ponto { X = b.X + b.Width / 2, Y = b.Y + b.Height / 2 }, 2), true, largura, altura, quadros, brancoNits);
    }

    public override ValueTask DisposeAsync()
    {
        _parar = true;
        return new ValueTask(Task.Run(() => _thread.Join(TimeSpan.FromSeconds(3))));
    }

    // ---------- a thread da captura: tudo do Direct3D e da captura nasce, roda e morre aqui ----------

    private void Rodar()
    {
        var soltar = new List<IntPtr>();
        IntPtr Guardar(IntPtr com) { soltar.Add(com); return com; }
        IntPtr sessao = 0, pool = 0;
        try
        {
            RoInitialize(1);
            Ok(D3D11CreateDevice(0, 1, 0, 0x20, 0, 0, 7, out IntPtr placa, out _, out IntPtr contexto), "D3D11CreateDevice");
            Guardar(placa);
            Guardar(contexto);
            IntPtr dxgi = Guardar(Pedir(placa, IidDxgiDevice));
            Ok(CreateDirect3D11DeviceFromDXGIDevice(dxgi, out IntPtr inspecionavel), "CreateDirect3D11DeviceFromDXGIDevice");
            Guardar(inspecionavel);
            IntPtr placaWinrt = Guardar(Pedir(inspecionavel, IidDirect3DDevice));

            IntPtr interop = Guardar(Fabrica("Windows.Graphics.Capture.GraphicsCaptureItem", IidItemInterop));
            IntPtr item;
            Guid iidItem = IidItem;
            Ok(((delegate* unmanaged[Stdcall]<IntPtr, IntPtr, Guid*, IntPtr*, int>)Metodo(interop, _tela ? 4 : 3))(interop, _alvo, &iidItem, &item), "CreateForWindow/Monitor");
            Guardar(item);
            Tamanho tamanho;
            Ok(((delegate* unmanaged[Stdcall]<IntPtr, Tamanho*, int>)Metodo(item, 7))(item, &tamanho), "GraphicsCaptureItem.Size");

            IntPtr estaticos = Guardar(Fabrica("Windows.Graphics.Capture.Direct3D11CaptureFramePool", IidPoolEstaticos2));
            Ok(((delegate* unmanaged[Stdcall]<IntPtr, IntPtr, int, int, Tamanho, IntPtr*, int>)Metodo(estaticos, 6))(estaticos, placaWinrt, Fp16, 2, tamanho, &pool), "CreateFreeThreaded");
            Ok(((delegate* unmanaged[Stdcall]<IntPtr, IntPtr, IntPtr*, int>)Metodo(pool, 10))(pool, item, &sessao), "CreateCaptureSession");
            // Tela inteira sem a moldura amarela da captura (no Windows 11; onde não der, ela aparece e segue).
            if (_tela && TentarPedir(sessao, IidSessao3) is var s3 and not 0)
            {
                ((delegate* unmanaged[Stdcall]<IntPtr, byte, int>)Metodo(s3, 7))(s3, 0);
                Liberar(s3);
            }

            var gpu = new Conversao(placa, contexto, _largura, _altura, _ganho);
            try
            {
                Ok(((delegate* unmanaged[Stdcall]<IntPtr, int>)Metodo(sessao, 6))(sessao), "StartCapture");
                long ultimo = 0;
                long intervalo = System.Diagnostics.Stopwatch.Frequency / Math.Max(1, _quadros);
                while (!_parar)
                {
                    // Só o mais novo interessa: os mais velhos que já chegaram são descartados.
                    IntPtr quadro = 0, proximo;
                    while (((delegate* unmanaged[Stdcall]<IntPtr, IntPtr*, int>)Metodo(pool, 7))(pool, &proximo) >= 0 && proximo != 0)
                    {
                        if (quadro != 0) Fechar(quadro);
                        quadro = proximo;
                    }
                    if (quadro == 0 || System.Diagnostics.Stopwatch.GetTimestamp() - ultimo < intervalo)
                    {
                        if (quadro != 0) Fechar(quadro);
                        Thread.Sleep(2);
                        continue;
                    }
                    ultimo = System.Diagnostics.Stopwatch.GetTimestamp();
                    try
                    {
                        Tamanho conteudo;
                        Ok(((delegate* unmanaged[Stdcall]<IntPtr, Tamanho*, int>)Metodo(quadro, 8))(quadro, &conteudo), "ContentSize");
                        IntPtr superficie;
                        Ok(((delegate* unmanaged[Stdcall]<IntPtr, IntPtr*, int>)Metodo(quadro, 6))(quadro, &superficie), "Surface");
                        try
                        {
                            IntPtr acesso = Pedir(superficie, IidDxgiAcesso), textura;
                            Guid iidTextura = IidTextura2D;
                            try { Ok(((delegate* unmanaged[Stdcall]<IntPtr, Guid*, IntPtr*, int>)Metodo(acesso, 3))(acesso, &iidTextura, &textura), "GetInterface"); }
                            finally { Liberar(acesso); }
                            try
                            {
                                long antes = System.Diagnostics.Stopwatch.GetTimestamp();
                                lock (_trava) gpu.Converter(textura, conteudo.L, conteudo.A, _ultimo);
                                Interlocked.Add(ref _tempo, System.Diagnostics.Stopwatch.GetTimestamp() - antes);
                                Interlocked.Increment(ref _processados);
                                _primeiro.TrySetResult();
                            }
                            finally { Liberar(textura); }
                        }
                        finally { Liberar(superficie); }
                        // Janela redimensionada: o próximo quadro já vem do tamanho novo.
                        if (conteudo.L > 0 && conteudo.A > 0 && (conteudo.L != tamanho.L || conteudo.A != tamanho.A))
                        {
                            tamanho = conteudo;
                            ((delegate* unmanaged[Stdcall]<IntPtr, IntPtr, int, int, Tamanho, int>)Metodo(pool, 6))(pool, placaWinrt, Fp16, 2, tamanho);
                        }
                    }
                    finally { Fechar(quadro); }
                }
            }
            finally { gpu.Dispose(); }
        }
        catch (Exception ex) when (ex is IOException or DllNotFoundException or EntryPointNotFoundException or SEHException or COMException)
        {
            _falha = new IOException("A captura com HDR parou: " + ex.Message, ex);
            _primeiro.TrySetException(_falha);
        }
        finally
        {
            if (sessao != 0) Fechar(sessao);
            if (pool != 0) Fechar(pool);
            for (int i = soltar.Count - 1; i >= 0; i--) Liberar(soltar[i]);
        }
    }

    /// <summary>O shader e as texturas: copia o quadro, converte e escala numa passada e lê de volta em BGRA.</summary>
    private sealed class Conversao : IDisposable
    {
        private readonly IntPtr _placa, _contexto, _vs, _ps, _amostra, _ajuste, _alvo, _visao, _leitura;
        private IntPtr _fonte, _fonteVista;
        private int _fonteL, _fonteA;
        private readonly int _largura, _altura;
        private readonly float _ganho;

        public Conversao(IntPtr placa, IntPtr contexto, int largura, int altura, float ganho)
        {
            _placa = placa;
            _contexto = contexto;
            _largura = largura;
            _altura = altura;
            _ganho = ganho;
            _vs = Shader(true);
            _ps = Shader(false);
            var a = new DescAmostra { Filtro = 0x15, U = 3, V = 3, W = 3, Comparacao = 1, LodMax = float.MaxValue };
            IntPtr amostra, ajuste, alvo, visao, leitura;
            Ok(((delegate* unmanaged[Stdcall]<IntPtr, DescAmostra*, IntPtr*, int>)Metodo(placa, 23))(placa, &a, &amostra), "CreateSamplerState");
            _amostra = amostra;
            var b = new DescBuffer { Bytes = 16, Ligacao = 0x4 };
            Ok(((delegate* unmanaged[Stdcall]<IntPtr, DescBuffer*, IntPtr, IntPtr*, int>)Metodo(placa, 3))(placa, &b, 0, &ajuste), "CreateBuffer");
            _ajuste = ajuste;
            _alvo = alvo = Textura(largura, altura, Bgra8, 0, 0x20, 0);
            Ok(((delegate* unmanaged[Stdcall]<IntPtr, IntPtr, IntPtr, IntPtr*, int>)Metodo(placa, 9))(placa, alvo, 0, &visao), "CreateRenderTargetView");
            _visao = visao;
            _leitura = leitura = Textura(largura, altura, Bgra8, 3, 0, 0x20000);
        }

        private IntPtr Shader(bool vertices)
        {
            byte[] fonte = Encoding.ASCII.GetBytes(Hlsl);
            IntPtr codigo, erros;
            int hr;
            fixed (byte* f = fonte)
            fixed (byte* entrada = vertices ? "vs\0"u8 : "ps\0"u8)
            fixed (byte* perfil = vertices ? "vs_5_0\0"u8 : "ps_5_0\0"u8)
                hr = D3DCompile(f, fonte.Length, 0, 0, 0, entrada, perfil, 0, 0, &codigo, &erros);
            if (hr < 0)
            {
                string detalhe = erros == 0 ? "" : Marshal.PtrToStringAnsi(Bytes(erros, out _)) ?? "";
                Liberar(erros);
                throw new IOException($"shader não compilou (0x{hr:X8}) {detalhe}");
            }
            Liberar(erros);
            try
            {
                IntPtr dados = Bytes(codigo, out nint tamanho), shader;
                Ok(((delegate* unmanaged[Stdcall]<IntPtr, IntPtr, nint, IntPtr, IntPtr*, int>)Metodo(_placa, vertices ? 12 : 15))(_placa, dados, tamanho, 0, &shader), "CreateShader");
                return shader;
            }
            finally { Liberar(codigo); }
        }

        private static IntPtr Bytes(IntPtr blob, out nint tamanho)
        {
            tamanho = ((delegate* unmanaged[Stdcall]<IntPtr, nint>)Metodo(blob, 4))(blob);
            return ((delegate* unmanaged[Stdcall]<IntPtr, IntPtr>)Metodo(blob, 3))(blob);
        }

        private IntPtr Textura(int largura, int altura, int formato, int uso, int ligacao, int cpu)
        {
            var d = new DescTextura { L = (uint)largura, A = (uint)altura, Mips = 1, Camadas = 1, Formato = formato, Amostras = 1, Uso = uso, Ligacao = ligacao, Cpu = cpu };
            IntPtr t;
            Ok(((delegate* unmanaged[Stdcall]<IntPtr, DescTextura*, IntPtr, IntPtr*, int>)Metodo(_placa, 5))(_placa, &d, 0, &t), "CreateTexture2D");
            return t;
        }

        public void Converter(IntPtr quadro, int conteudoL, int conteudoA, byte[] destino)
        {
            DescTextura d;
            ((delegate* unmanaged[Stdcall]<IntPtr, DescTextura*, void>)Metodo(quadro, 10))(quadro, &d);
            int l = Math.Clamp(conteudoL, 1, (int)d.L), a = Math.Clamp(conteudoA, 1, (int)d.A);
            if (_fonte == 0 || _fonteL != d.L || _fonteA != d.A)
            {
                Liberar(_fonteVista);
                Liberar(_fonte);
                _fonteVista = _fonte = 0;
                _fonte = Textura((int)d.L, (int)d.A, Fp16, 0, 0x8, 0);
                IntPtr vista;
                Ok(((delegate* unmanaged[Stdcall]<IntPtr, IntPtr, IntPtr, IntPtr*, int>)Metodo(_placa, 7))(_placa, _fonte, 0, &vista), "CreateShaderResourceView");
                _fonteVista = vista;
                (_fonteL, _fonteA) = ((int)d.L, (int)d.A);
            }
            var c = _contexto;
            var caixa = new Caixa { Direita = (uint)l, Baixo = (uint)a, Tras = 1 };
            ((delegate* unmanaged[Stdcall]<IntPtr, IntPtr, uint, uint, uint, uint, IntPtr, uint, Caixa*, void>)Metodo(c, 46))(c, _fonte, 0, 0, 0, 0, quadro, 0, &caixa);

            // A imagem inteira cabe na saída sem distorcer (faixas pretas no que sobrar), como a captura comum.
            float escala = Math.Min(_largura / (float)l, _altura / (float)a);
            var vp = new Janela { L = l * escala, A = a * escala, Max = 1 };
            vp.X = (_largura - vp.L) / 2;
            vp.Y = (_altura - vp.A) / 2;
            var ajuste = stackalloc float[] { l / (float)_fonteL, a / (float)_fonteA, _ganho, 0 };
            ((delegate* unmanaged[Stdcall]<IntPtr, IntPtr, uint, IntPtr, float*, uint, uint, void>)Metodo(c, 48))(c, _ajuste, 0, 0, ajuste, 0, 0);
            var preto = stackalloc float[] { 0, 0, 0, 1 };
            ((delegate* unmanaged[Stdcall]<IntPtr, IntPtr, float*, void>)Metodo(c, 50))(c, _visao, preto);
            IntPtr visao = _visao, fonteVista = _fonteVista, amostra = _amostra, ajusteBuf = _ajuste;
            ((delegate* unmanaged[Stdcall]<IntPtr, uint, IntPtr*, IntPtr, void>)Metodo(c, 33))(c, 1, &visao, 0);
            ((delegate* unmanaged[Stdcall]<IntPtr, uint, Janela*, void>)Metodo(c, 44))(c, 1, &vp);
            ((delegate* unmanaged[Stdcall]<IntPtr, int, void>)Metodo(c, 24))(c, 4);
            ((delegate* unmanaged[Stdcall]<IntPtr, IntPtr, void>)Metodo(c, 17))(c, 0);
            ((delegate* unmanaged[Stdcall]<IntPtr, IntPtr, IntPtr, uint, void>)Metodo(c, 11))(c, _vs, 0, 0);
            ((delegate* unmanaged[Stdcall]<IntPtr, IntPtr, IntPtr, uint, void>)Metodo(c, 9))(c, _ps, 0, 0);
            ((delegate* unmanaged[Stdcall]<IntPtr, uint, uint, IntPtr*, void>)Metodo(c, 8))(c, 0, 1, &fonteVista);
            ((delegate* unmanaged[Stdcall]<IntPtr, uint, uint, IntPtr*, void>)Metodo(c, 10))(c, 0, 1, &amostra);
            ((delegate* unmanaged[Stdcall]<IntPtr, uint, uint, IntPtr*, void>)Metodo(c, 16))(c, 0, 1, &ajusteBuf);
            ((delegate* unmanaged[Stdcall]<IntPtr, uint, uint, void>)Metodo(c, 13))(c, 3, 0);
            ((delegate* unmanaged[Stdcall]<IntPtr, IntPtr, IntPtr, void>)Metodo(c, 47))(c, _leitura, _alvo);

            Mapeado m;
            Ok(((delegate* unmanaged[Stdcall]<IntPtr, IntPtr, uint, int, uint, Mapeado*, int>)Metodo(c, 14))(c, _leitura, 0, 1, 0, &m), "Map");
            try
            {
                int linha = _largura * 4;
                fixed (byte* saida = destino)
                    for (int y = 0; y < _altura; y++)
                        Buffer.MemoryCopy((byte*)m.Dados + (long)y * m.Linha, saida + (long)y * linha, linha, linha);
            }
            finally { ((delegate* unmanaged[Stdcall]<IntPtr, IntPtr, uint, void>)Metodo(c, 15))(c, _leitura, 0); }
        }

        public void Dispose()
        {
            foreach (var com in new[] { _fonteVista, _fonte, _leitura, _visao, _alvo, _ajuste, _amostra, _ps, _vs }) Liberar(com);
        }
    }

    // Vértices: um triângulo que cobre a área de desenho. Pixels: ganho (o branco do SDR volta a 1.0, então o que não
    // é HDR sai idêntico), o que passa do branco é reduzido pelo canal mais forte (o tom não muda nem vira amarelo
    // estourado), corte das cores fora do sRGB e a curva sRGB.
    private const string Hlsl = """
        cbuffer Ajuste : register(b0) { float2 escala; float ganho; float reservado; };
        Texture2D<float4> fonte : register(t0);
        SamplerState amostra : register(s0);
        struct Saida { float4 pos : SV_Position; float2 uv : TEXCOORD0; };
        Saida vs(uint id : SV_VertexID)
        {
            Saida s;
            float2 t = float2((id << 1) & 2, id & 2);
            s.pos = float4(t * float2(2, -2) + float2(-1, 1), 0, 1);
            s.uv = t;
            return s;
        }
        float4 ps(Saida e) : SV_Target
        {
            float3 c = max(fonte.Sample(amostra, e.uv * escala).rgb * ganho, 0);
            float m = max(c.r, max(c.g, c.b));
            if (m > 1) c /= m;
            c = saturate(c);
            c = c <= 0.0031308 ? c * 12.92 : 1.055 * pow(c, 1 / 2.4) - 0.055;
            return float4(c, 1);
        }
        """;
    private const int Fp16 = 10, Bgra8 = 87;

    // ---------- COM e WinRT pela tabela de métodos, como em SaidasDeVideo ----------

    private static IntPtr Metodo(IntPtr com, int posicao) => (*(IntPtr**)com)[posicao];
    private static void Liberar(IntPtr com) { if (com != 0) ((delegate* unmanaged[Stdcall]<IntPtr, uint>)Metodo(com, 2))(com); }
    private static void Ok(int hr, string onde) { if (hr < 0) throw new IOException($"{onde} falhou (0x{hr:X8})"); }

    private static IntPtr TentarPedir(IntPtr com, Guid iid)
    {
        IntPtr saida;
        return ((delegate* unmanaged[Stdcall]<IntPtr, Guid*, IntPtr*, int>)Metodo(com, 0))(com, &iid, &saida) >= 0 ? saida : 0;
    }

    private static IntPtr Pedir(IntPtr com, Guid iid) => TentarPedir(com, iid) is var s and not 0 ? s : throw new IOException($"interface {iid} indisponível");

    // Quadros, sessão e pool se fecham (IClosable.Close) antes de soltar: senão o Windows segura a memória deles.
    private static void Fechar(IntPtr com)
    {
        if (TentarPedir(com, IidFechavel) is var f and not 0)
        {
            ((delegate* unmanaged[Stdcall]<IntPtr, int>)Metodo(f, 6))(f);
            Liberar(f);
        }
        Liberar(com);
    }

    private static IntPtr Fabrica(string classe, Guid iid)
    {
        Ok(WindowsCreateString(classe, (uint)classe.Length, out IntPtr nome), "WindowsCreateString");
        try
        {
            Ok(RoGetActivationFactory(nome, iid, out IntPtr fabrica), "RoGetActivationFactory " + classe);
            return fabrica;
        }
        finally { WindowsDeleteString(nome); }
    }

    private static readonly Guid IidDxgiDevice = new("54ec77fa-1377-44e6-8c32-88fd5f44c84c");
    private static readonly Guid IidDirect3DDevice = new("a37624ab-8d5f-4650-9d3e-9eae3d9bc670");
    private static readonly Guid IidItemInterop = new("3628e81b-3cac-4c60-b7f4-23ce0e0c3356");
    private static readonly Guid IidItem = new("79c3f95b-31f7-4ec2-a464-632ef5d30760");
    private static readonly Guid IidPoolEstaticos2 = new("589b103f-6bbc-5df5-a991-02e28b3b66d5");
    private static readonly Guid IidSessao3 = new("f2cdd966-22ae-5ea1-9596-3a289344c3be");
    private static readonly Guid IidFechavel = new("30d5a829-7fa4-4026-83bb-d75bae4ea99e");
    private static readonly Guid IidDxgiAcesso = new("a9b3d012-3df2-4ee3-b8d1-8695f457d3c1");
    private static readonly Guid IidTextura2D = new("6f15aaf2-d208-4e89-9ab4-489535d34f9c");

    [StructLayout(LayoutKind.Sequential)] private struct Tamanho { public int L, A; }
    [StructLayout(LayoutKind.Sequential)] private struct Ponto { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] private struct DescTextura { public uint L, A, Mips, Camadas; public int Formato; public uint Amostras, Qualidade; public int Uso, Ligacao, Cpu, Outros; }
    [StructLayout(LayoutKind.Sequential)] private struct DescBuffer { public uint Bytes; public int Uso, Ligacao, Cpu, Outros; public uint Passo; }
    [StructLayout(LayoutKind.Sequential)] private struct DescAmostra
    {
        public int Filtro, U, V, W; public float Desvio; public uint Anisotropia; public int Comparacao;
        public float B0, B1, B2, B3, LodMin, LodMax;
    }
    [StructLayout(LayoutKind.Sequential)] private struct Caixa { public uint Esquerda, Topo, Frente, Direita, Baixo, Tras; }
    [StructLayout(LayoutKind.Sequential)] private struct Janela { public float X, Y, L, A, Min, Max; }
    [StructLayout(LayoutKind.Sequential)] private struct Mapeado { public IntPtr Dados; public uint Linha, Fatia; }

    [DllImport("combase.dll")] private static extern int RoInitialize(int tipo);
    [DllImport("combase.dll", CharSet = CharSet.Unicode)] private static extern int WindowsCreateString(string texto, uint tamanho, out IntPtr hstring);
    [DllImport("combase.dll")] private static extern int WindowsDeleteString(IntPtr hstring);
    [DllImport("combase.dll")] private static extern int RoGetActivationFactory(IntPtr classe, in Guid iid, out IntPtr fabrica);
    [DllImport("d3d11.dll")] private static extern int D3D11CreateDevice(IntPtr placa, int tipo, IntPtr software, uint flags, IntPtr niveis, uint quantos, uint sdk, out IntPtr placaD3d, out int nivel, out IntPtr contexto);
    [DllImport("d3d11.dll")] private static extern int CreateDirect3D11DeviceFromDXGIDevice(IntPtr dxgi, out IntPtr inspecionavel);
    [DllImport("d3dcompiler_47.dll")] private static extern int D3DCompile(byte* fonte, nint tamanho, IntPtr nome, IntPtr definicoes, IntPtr inclusao, byte* entrada, byte* perfil, uint flags1, uint flags2, IntPtr* codigo, IntPtr* erros);
    [DllImport("user32.dll")] private static extern IntPtr MonitorFromPoint(Ponto ponto, uint flags);
}
