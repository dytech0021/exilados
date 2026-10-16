using System.Diagnostics;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Exilados;

internal sealed record Manifesto(string Version, long Size, string Sha256, string Signature);

/// <summary>
/// Atualização automática por https://filabox3d.com.br/exilados/atualizacao/. A versão nova só é aceita se a
/// assinatura (ECDSA P-256) conferir com a chave pública embutida aqui; nunca volta de versão, e a troca do
/// executável só acontece sem live no ar. A chave privada fica fora do repositório, num arquivo cifrado com uma
/// senha do dono (PBKDF2 com 600.000 rodadas e AES-GCM), para poder ir de um PC para outro.
/// </summary>
internal static class Atualizacao
{
    public const string Endereco = "https://filabox3d.com.br/exilados/atualizacao/";
    private const long TamanhoMaximo = 64L * 1024 * 1024;
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromMinutes(5) };

    public static Version Atual { get; } = Normalizar(Assembly.GetExecutingAssembly().GetName().Version ?? new Version(0, 0, 0));

    private static string Executavel => Environment.ProcessPath ?? throw new ExiladosException("Caminho do programa indisponível.");

    /// <summary>O executável de uso é um arquivo só; a versão de desenvolvimento tem uma DLL ao lado.</summary>
    public static bool ArquivoUnico => !File.Exists(Path.ChangeExtension(Executavel, ".dll"));

    public static bool PodeSeAtualizar => ChaveAtualizacao.Publica.Length > 0 && ArquivoUnico;

    private static Version Normalizar(Version v) => new(v.Major, v.Minor, Math.Max(0, v.Build));

    private static byte[] Mensagem(string versao, long tamanho, string sha256) =>
        Encoding.UTF8.GetBytes($"exilados-atualizacao\n{versao}\n{tamanho}\n{sha256.ToLowerInvariant()}\n");

    public static bool Conferir(Manifesto m)
    {
        if (ChaveAtualizacao.Publica.Length == 0) return false;
        if (m is not { Version: not null, Sha256: not null, Signature: not null } || !Version.TryParse(m.Version, out _) ||
            m.Size is <= 0 or > TamanhoMaximo || m.Sha256.Length != 64 || !m.Sha256.All(Uri.IsHexDigit)) return false;
        try
        {
            using var chave = ECDsa.Create();
            chave.ImportSubjectPublicKeyInfo(Convert.FromBase64String(ChaveAtualizacao.Publica), out _);
            return chave.VerifyData(Mensagem(m.Version, m.Size, m.Sha256), Convert.FromBase64String(m.Signature), HashAlgorithmName.SHA256);
        }
        catch (Exception ex) when (ex is FormatException or CryptographicException) { return false; }
    }

    /// <summary>A atualização disponível, ou null se esta já é a mais nova.</summary>
    public static async Task<Manifesto?> ProcurarAsync(CancellationToken ct)
    {
        if (!PodeSeAtualizar) return null;
        string texto;
        try { texto = await Http.GetStringAsync(Endereco + "manifest.json", ct); }
        catch (HttpRequestException) { return null; }
        Manifesto? m;
        try { m = JsonSerializer.Deserialize<Manifesto>(texto); }
        catch (JsonException) { m = null; }
        if (m is null || !Conferir(m)) throw new ExiladosException("A atualização oferecida pelo servidor não tem assinatura válida e foi ignorada.");
        return Normalizar(Version.Parse(m.Version)) > Atual ? m : null;
    }

    /// <summary>Baixa e confere o executável novo; devolve o caminho dele, ao lado do atual.</summary>
    public static async Task<string> BaixarAsync(Manifesto m, CancellationToken ct)
    {
        byte[] dados;
        try { dados = await Http.GetByteArrayAsync(Endereco + "Exilados.exe", ct); }
        catch (HttpRequestException) { throw new ExiladosException("O servidor não entregou o arquivo de atualização."); }
        if (!Bate(dados, m)) throw new ExiladosException("O arquivo de atualização não confere com a assinatura e foi descartado.");
        string caminho = Path.Combine(Path.GetDirectoryName(Executavel)!, "Exilados-novo.exe");
        await File.WriteAllBytesAsync(caminho, dados, ct);
        return caminho;
    }

    private static bool Bate(byte[] dados, Manifesto m) =>
        dados.Length == m.Size && Convert.ToHexString(SHA256.HashData(dados)).Equals(m.Sha256, StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Confere de novo, faz o teste de partida (uma versão que nem abre não substitui a que funciona), troca o
    /// executável (o atual vira ".antigo") e abre a versão nova. Quem chama deve encerrar em seguida.
    /// </summary>
    public static void Aplicar(string novo, Manifesto m)
    {
        if (!PodeSeAtualizar) throw new ExiladosException("Esta cópia do Exilados não se atualiza sozinha.");
        if (!Bate(File.ReadAllBytes(novo), m)) throw new ExiladosException("O arquivo de atualização foi alterado depois de baixado e foi descartado.");
        using (var teste = Process.Start(new ProcessStartInfo(novo) { UseShellExecute = false, CreateNoWindow = true, ArgumentList = { "--verificar" } }))
        {
            if (teste is null || !teste.WaitForExit(90_000))
            {
                try { teste?.Kill(); } catch (InvalidOperationException) { }
                throw new ExiladosException("A versão nova não respondeu ao teste de partida e não foi instalada.");
            }
            if (teste.ExitCode != 0) throw new ExiladosException("A versão nova falhou no teste de partida e não foi instalada.");
        }
        string exe = Executavel, antigo = exe + ".antigo";
        try
        {
            if (File.Exists(antigo)) File.Delete(antigo);
            File.Move(exe, antigo);
            try { File.Move(novo, exe); }
            catch
            {
                File.Move(antigo, exe);
                throw;
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            throw new ExiladosException("Não foi possível trocar o arquivo do programa. Ele está numa pasta protegida ou em uso.");
        }
        Process.Start(new ProcessStartInfo(exe) { UseShellExecute = false, ArgumentList = { "--atualizado" } })?.Dispose();
    }

    /// <summary>Remove o que sobrou da última troca. Chamado na partida.</summary>
    public static void Limpar()
    {
        try
        {
            string exe = Executavel;
            foreach (string sobra in new[] { exe + ".antigo", Path.Combine(Path.GetDirectoryName(exe)!, "Exilados-novo.exe") })
                if (File.Exists(sobra)) File.Delete(sobra);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ExiladosException) { }
    }

    // ---------- ferramentas de quem publica (não usadas pelo programa em si) ----------

    private static readonly byte[] Marca = "EXCHAVE1"u8.ToArray();
    private const int Rodadas = 600_000;

    private static byte[] Cifrar(byte[] privada, string senha)
    {
        byte[] sal = RandomNumberGenerator.GetBytes(16), nonce = RandomNumberGenerator.GetBytes(12), tag = new byte[16];
        byte[] chave = Rfc2898DeriveBytes.Pbkdf2(senha, sal, Rodadas, HashAlgorithmName.SHA256, 32);
        var cifrado = new byte[privada.Length];
        using (var aes = new AesGcm(chave, 16)) aes.Encrypt(nonce, privada, cifrado, tag, Marca);
        return [.. Marca, .. sal, .. nonce, .. tag, .. cifrado];
    }

    private static byte[] Decifrar(byte[] arquivo, string senha)
    {
        if (arquivo.Length < Marca.Length + 44 || !arquivo.AsSpan(0, Marca.Length).SequenceEqual(Marca))
            throw new ExiladosException("O arquivo da chave não é do Exilados.");
        var sal = arquivo.AsSpan(8, 16);
        var nonce = arquivo.AsSpan(24, 12);
        var tag = arquivo.AsSpan(36, 16);
        var cifrado = arquivo.AsSpan(52);
        byte[] chave = Rfc2898DeriveBytes.Pbkdf2(senha, sal, Rodadas, HashAlgorithmName.SHA256, 32);
        var privada = new byte[cifrado.Length];
        try
        {
            using var aes = new AesGcm(chave, 16);
            aes.Decrypt(nonce, cifrado, tag, privada, Marca);
        }
        catch (CryptographicException) { throw new ExiladosException("Senha da chave de atualização incorreta."); }
        return privada;
    }

    private static string SenhaDoAmbiente() => Environment.GetEnvironmentVariable("EXILADOS_SENHA_CHAVE") is { Length: >= 12 } senha
        ? senha : throw new ExiladosException("Defina EXILADOS_SENHA_CHAVE (pelo menos 12 caracteres).");

    /// <summary>Cria o par de chaves: a privada, cifrada pela senha, em <paramref name="arquivoChave"/>; a pública em ChaveAtualizacao.cs.</summary>
    public static int GerarChave(string arquivoChave, string arquivoFonte)
    {
        if (File.Exists(arquivoChave)) return 3; // nunca sobrescreve: perder a chave deixaria as cópias instaladas sem atualização
        using var chave = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(arquivoChave))!);
        File.WriteAllBytes(arquivoChave, Cifrar(chave.ExportPkcs8PrivateKey(), SenhaDoAmbiente()));
        File.WriteAllText(arquivoFonte,
            "namespace Exilados;\n\n" +
            "/// <summary>Chave pública que confere a assinatura das atualizações. Vazia = atualização automática desligada.</summary>\n" +
            "internal static class ChaveAtualizacao\n{\n" +
            $"    public const string Publica = \"{Convert.ToBase64String(chave.ExportSubjectPublicKeyInfo())}\";\n" +
            "}\n", new UTF8Encoding(false));
        return 0;
    }

    /// <summary>Assina um executável publicado e grava o manifesto que vai com ele.</summary>
    public static int Assinar(string exe, string arquivoChave, string arquivoManifesto)
    {
        byte[] dados = File.ReadAllBytes(exe);
        var info = FileVersionInfo.GetVersionInfo(exe);
        string versao = $"{info.FileMajorPart}.{info.FileMinorPart}.{info.FileBuildPart}";
        string sha256 = Convert.ToHexString(SHA256.HashData(dados)).ToLowerInvariant();
        using var chave = ECDsa.Create();
        chave.ImportPkcs8PrivateKey(Decifrar(File.ReadAllBytes(arquivoChave), SenhaDoAmbiente()), out _);
        string assinatura = Convert.ToBase64String(chave.SignData(Mensagem(versao, dados.Length, sha256), HashAlgorithmName.SHA256));
        var m = new Manifesto(versao, dados.Length, sha256, assinatura);
        File.WriteAllText(arquivoManifesto, JsonSerializer.Serialize(m), new UTF8Encoding(false));
        return Conferir(m) ? 0 : 4; // 4: a chave privada não corresponde à pública embutida neste executável
    }
}
