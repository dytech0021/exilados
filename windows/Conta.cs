using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Exilados;

/// <summary>
/// Login na conta do FilaBox (Supabase dele), com e-mail e senha ou Google, a mesma usada no site do Exilados.
/// O token de renovação fica guardado protegido pelo Windows; o de acesso é renovado sozinho antes de vencer.
/// </summary>
internal sealed class Conta : IAcesso
{
    public const string SupabaseUrl = "https://kobtvgqnitdeviddvymm.supabase.co";
    /// <summary>Chave publicável do Supabase do FilaBox (a mesma que o site entrega a qualquer navegador).</summary>
    public const string ChavePublica = "sb_publishable_S0LPicuJdLg-XsrxGiN0Ug_tIDZ4sLo";
    public const string Site = "https://filabox3d.com.br/exilados/";
    /// <summary>Porta deste computador para onde o login com Google volta (autorizada no Supabase).</summary>
    public const int PortaGoogle = 53682;
    public static readonly string RetornoGoogle = $"http://127.0.0.1:{PortaGoogle}/exilados";

    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(30) };
    private readonly SemaphoreSlim _travaRenovar = new(1, 1);
    private string _acesso = "", _renovacao;
    private DateTime _vence = DateTime.MinValue;

    public string Email { get; }
    public string UsuarioId { get; }
    /// <summary>O token de renovação mudou (o Supabase troca a cada renovação) e precisa ser gravado de novo.</summary>
    public event Action<Conta>? TokenMudou;

    private Conta(string email, string usuarioId, string renovacao)
    {
        Email = email;
        UsuarioId = usuarioId;
        _renovacao = renovacao;
    }

    // ---------- entrar ----------

    public static async Task<Conta> EntrarAsync(string email, string senha, CancellationToken ct) =>
        DaSessao(await TokenAsync("password", new { email = email.Trim(), password = senha }, ct));

    /// <summary>Abre o navegador no login do Google e espera a volta numa porta deste computador (PKCE).</summary>
    public static async Task<Conta> EntrarComGoogleAsync(CancellationToken ct)
    {
        string verificador = Base64Url(RandomNumberGenerator.GetBytes(32));
        string desafio = Base64Url(SHA256.HashData(Encoding.ASCII.GetBytes(verificador)));
        string codigo = await CodigoDoGoogleAsync($"{SupabaseUrl}/auth/v1/authorize?provider=google&redirect_to={Uri.EscapeDataString(RetornoGoogle)}" +
                                                  $"&code_challenge={desafio}&code_challenge_method=s256", ct);
        return DaSessao(await TokenAsync("pkce", new { auth_code = codigo, code_verifier = verificador }, ct));
    }

    /// <summary>
    /// Abre <paramref name="autorizar"/> (o login do Google, voltando para <see cref="RetornoGoogle"/>) no navegador e
    /// devolve o código que volta numa porta deste computador. Quem pediu o login troca o código pela sessão.
    /// </summary>
    public static async Task<string> CodigoDoGoogleAsync(string autorizar, CancellationToken ct)
    {
        var escuta = new TcpListener(IPAddress.Loopback, PortaGoogle);
        try { escuta.Start(); }
        catch (SocketException) { throw new ExiladosException($"A porta {PortaGoogle} deste computador está ocupada (talvez o Ponte esteja esperando um login). Tente de novo em seguida."); }
        try
        {
            AbrirNavegador(autorizar);
            using var prazo = CancellationTokenSource.CreateLinkedTokenSource(ct);
            prazo.CancelAfter(TimeSpan.FromMinutes(5));
            while (true)
            {
                TcpClient cliente;
                try { cliente = await escuta.AcceptTcpClientAsync(prazo.Token); }
                catch (OperationCanceledException) when (!ct.IsCancellationRequested)
                {
                    throw new ExiladosException("O login com Google não voltou a tempo. Tente de novo.");
                }
                using (cliente)
                {
                    var (codigo, erro) = await LerRetornoAsync(cliente, prazo.Token);
                    if (codigo is null && erro is null) continue;
                    if (erro is not null) throw new ExiladosException("O Google não concluiu o login: " + erro);
                    return codigo!;
                }
            }
        }
        finally { escuta.Stop(); }
    }

    public static Conta? Restaurar(Config config)
    {
        if (config.Token.Length == 0 || config.UsuarioId.Length == 0) return null;
        try
        {
            string renovacao = Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(config.Token), null, DataProtectionScope.CurrentUser));
            return new Conta(config.Email, config.UsuarioId, renovacao);
        }
        catch (Exception ex) when (ex is FormatException or CryptographicException) { return null; }
    }

    public void Guardar(Config config)
    {
        config.Email = Email;
        config.UsuarioId = UsuarioId;
        config.Token = Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(_renovacao), null, DataProtectionScope.CurrentUser));
    }

    public static void Esquecer(Config config)
    {
        config.Email = config.UsuarioId = config.Nome = config.Token = "";
    }

    public async Task SairAsync()
    {
        try
        {
            using var pedido = new HttpRequestMessage(HttpMethod.Post, SupabaseUrl + "/auth/v1/logout?scope=local");
            pedido.Headers.Add("apikey", ChavePublica);
            pedido.Headers.Authorization = new AuthenticationHeaderValue("Bearer", await AcessoAsync(CancellationToken.None));
            using var _ = await Http.SendAsync(pedido);
        }
        catch (Exception ex) when (ex is ExiladosException or HttpRequestException or TaskCanceledException) { }
    }

    /// <summary>Token de acesso válido por pelo menos mais um minuto.</summary>
    public async Task<string> AcessoAsync(CancellationToken ct)
    {
        await _travaRenovar.WaitAsync(ct);
        try
        {
            if (DateTime.UtcNow >= _vence)
            {
                var sessao = await TokenAsync("refresh_token", new { refresh_token = _renovacao }, ct);
                _acesso = sessao.Acesso;
                _renovacao = sessao.Renovacao;
                _vence = DateTime.UtcNow.AddSeconds(Math.Max(60, sessao.ExpiraEm - 60));
                TokenMudou?.Invoke(this);
            }
            return _acesso;
        }
        finally { _travaRenovar.Release(); }
    }

    /// <summary>Nome no grupo e se ainda faz parte dele (null: a conta nunca entrou no grupo).</summary>
    public async Task<(string Nome, bool Ativo)?> MembroAsync(CancellationToken ct)
    {
        using var pedido = new HttpRequestMessage(HttpMethod.Get, $"{SupabaseUrl}/rest/v1/exilados_membros?user_id=eq.{UsuarioId}&select=nome,ativo");
        pedido.Headers.Add("apikey", ChavePublica);
        pedido.Headers.Authorization = new AuthenticationHeaderValue("Bearer", await AcessoAsync(ct));
        HttpResponseMessage resposta;
        try { resposta = await Http.SendAsync(pedido, ct); }
        catch (Exception ex) when (ex is HttpRequestException || (ex is TaskCanceledException && !ct.IsCancellationRequested))
        {
            throw new ExiladosException("Sem conexão com o servidor da conta.");
        }
        using (resposta)
        {
            if (!resposta.IsSuccessStatusCode) throw new ExiladosException($"O servidor da conta recusou o pedido ({(int)resposta.StatusCode}).");
            using var json = JsonDocument.Parse(await resposta.Content.ReadAsStringAsync(ct));
            if (json.RootElement.GetArrayLength() == 0) return null;
            var linha = json.RootElement[0];
            return (linha.GetProperty("nome").GetString() ?? "", linha.GetProperty("ativo").GetBoolean());
        }
    }

    /// <summary>ID de 9 dígitos da conta (criado na primeira vez), para alguém do grupo adicionar a pessoa pelo número.</summary>
    public async Task<string> MeuIdAsync(CancellationToken ct)
    {
        using var pedido = new HttpRequestMessage(HttpMethod.Post, $"{SupabaseUrl}/rest/v1/rpc/exilados_meu_id");
        pedido.Headers.Add("apikey", ChavePublica);
        pedido.Headers.Authorization = new AuthenticationHeaderValue("Bearer", await AcessoAsync(ct));
        pedido.Content = new StringContent("{}", Encoding.UTF8, "application/json");
        HttpResponseMessage resposta;
        try { resposta = await Http.SendAsync(pedido, ct); }
        catch (Exception ex) when (ex is HttpRequestException || (ex is TaskCanceledException && !ct.IsCancellationRequested))
        {
            throw new ExiladosException("Sem conexão com o servidor da conta.");
        }
        using (resposta)
        {
            if (!resposta.IsSuccessStatusCode) throw new ExiladosException($"O servidor da conta recusou o pedido ({(int)resposta.StatusCode}).");
            string codigo = JsonSerializer.Deserialize<string>(await resposta.Content.ReadAsStringAsync(ct)) ?? "";
            return codigo.Length == 9 ? $"{codigo[..3]} {codigo[3..6]} {codigo[6..]}" : codigo;
        }
    }

    // ---------- HTTP ----------

    private sealed record Sessao(
        [property: JsonPropertyName("access_token")] string Acesso,
        [property: JsonPropertyName("refresh_token")] string Renovacao,
        [property: JsonPropertyName("expires_in")] int ExpiraEm,
        [property: JsonPropertyName("user")] Usuario? Usuario);

    private sealed record Usuario(
        [property: JsonPropertyName("id")] string Id,
        [property: JsonPropertyName("email")] string? Email);

    private static async Task<Sessao> TokenAsync(string tipo, object corpo, CancellationToken ct)
    {
        using var pedido = new HttpRequestMessage(HttpMethod.Post, $"{SupabaseUrl}/auth/v1/token?grant_type={tipo}");
        pedido.Headers.Add("apikey", ChavePublica);
        pedido.Content = new StringContent(JsonSerializer.Serialize(corpo), Encoding.UTF8, "application/json");
        HttpResponseMessage resposta;
        try { resposta = await Http.SendAsync(pedido, ct); }
        catch (Exception ex) when (ex is HttpRequestException || (ex is TaskCanceledException && !ct.IsCancellationRequested))
        {
            throw new ExiladosException("Sem conexão com o servidor da conta.");
        }
        using (resposta)
        {
            string texto = await resposta.Content.ReadAsStringAsync(ct);
            if (!resposta.IsSuccessStatusCode) throw new ExiladosException(ErroDoLogin(texto));
            return JsonSerializer.Deserialize<Sessao>(texto) is { Acesso.Length: > 0, Renovacao.Length: > 0 } sessao
                ? sessao : throw new ExiladosException("O servidor da conta respondeu de um jeito inesperado.");
        }
    }

    private static Conta DaSessao(Sessao sessao)
    {
        if (sessao.Usuario is not { Id.Length: > 0 } usuario) throw new ExiladosException("O servidor da conta não informou quem entrou.");
        return new Conta(usuario.Email ?? "", usuario.Id, sessao.Renovacao)
        {
            _acesso = sessao.Acesso,
            _vence = DateTime.UtcNow.AddSeconds(Math.Max(60, sessao.ExpiraEm - 60)),
        };
    }

    private static string ErroDoLogin(string corpo)
    {
        string codigo = "", mensagem = "";
        try
        {
            using var json = JsonDocument.Parse(corpo);
            var raiz = json.RootElement;
            codigo = raiz.TryGetProperty("error_code", out var c) ? c.GetString() ?? "" : raiz.TryGetProperty("error", out var e) ? e.GetString() ?? "" : "";
            mensagem = raiz.TryGetProperty("msg", out var m) ? m.GetString() ?? "" : raiz.TryGetProperty("error_description", out var d) ? d.GetString() ?? "" : "";
        }
        catch (JsonException) { }
        return codigo switch
        {
            "invalid_credentials" => "E-mail ou senha incorretos.",
            "invalid_grant" when mensagem.Contains("credentials", StringComparison.OrdinalIgnoreCase) => "E-mail ou senha incorretos.",
            "email_not_confirmed" => "Confirme o e-mail da conta (o link chegou na sua caixa de entrada) e tente de novo.",
            "refresh_token_not_found" or "refresh_token_already_used" or "session_not_found" => "Sua conta saiu deste computador. Entre de novo.",
            "over_request_rate_limit" => "Muitas tentativas seguidas. Espere um pouco e tente de novo.",
            _ => mensagem.Length > 0 ? "A conta recusou: " + (mensagem.Length > 200 ? mensagem[..200] : mensagem) : "A conta recusou o login.",
        };
    }

    private static string Base64Url(byte[] dados) => Convert.ToBase64String(dados).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public static void AbrirNavegador(string endereco) => Process.Start(new ProcessStartInfo(endereco) { UseShellExecute = true })?.Dispose();

    private static async Task<(string? Codigo, string? Erro)> LerRetornoAsync(TcpClient cliente, CancellationToken ct)
    {
        var fluxo = cliente.GetStream();
        var buffer = new byte[8192];
        int lidos = 0;
        using var prazo = CancellationTokenSource.CreateLinkedTokenSource(ct);
        prazo.CancelAfter(TimeSpan.FromSeconds(10));
        try
        {
            while (lidos < buffer.Length)
            {
                int n = await fluxo.ReadAsync(buffer.AsMemory(lidos), prazo.Token);
                if (n == 0) break;
                lidos += n;
                if (Encoding.ASCII.GetString(buffer, 0, lidos).Contains("\r\n\r\n")) break;
            }
        }
        catch (Exception ex) when (ex is IOException or OperationCanceledException) { return (null, null); }
        string[] partes = Encoding.ASCII.GetString(buffer, 0, lidos).Split("\r\n")[0].Split(' ');
        if (partes.Length < 2 || !partes[1].StartsWith("/exilados")) { await ResponderAsync(fluxo, 404, ""); return (null, null); }
        string consulta = partes[1].Contains('?') ? partes[1][(partes[1].IndexOf('?') + 1)..] : "";
        var valores = consulta.Split('&', StringSplitOptions.RemoveEmptyEntries).Select(p => p.Split('=', 2))
            .GroupBy(p => p[0]).ToDictionary(g => g.Key, g => g.First().Length > 1 ? Uri.UnescapeDataString(g.First()[1].Replace('+', ' ')) : "");
        string? codigo = valores.GetValueOrDefault("code");
        string? erro = valores.GetValueOrDefault("error_description") ?? valores.GetValueOrDefault("error");
        await ResponderAsync(fluxo, 200, codigo is not null
            ? "<h2>Pronto!</h2><p>Você entrou na conta. Pode fechar esta aba e voltar ao programa do Exilados.</p>"
            : "<h2>O login não foi concluído.</h2><p>Volte ao programa do Exilados e tente de novo.</p>");
        return (codigo, codigo is null ? erro ?? "sem código de retorno" : null);
    }

    private static async Task ResponderAsync(NetworkStream fluxo, int status, string html)
    {
        string pagina = "<!doctype html><html lang=\"pt-BR\"><head><meta charset=\"utf-8\"><title>Exilados</title></head>" +
                        $"<body style=\"font-family:Segoe UI,sans-serif;margin:3em;background:#313338;color:#dbdee1\">{html}</body></html>";
        byte[] corpo = Encoding.UTF8.GetBytes(pagina);
        byte[] cabecalho = Encoding.ASCII.GetBytes($"HTTP/1.1 {status} OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {corpo.Length}\r\nConnection: close\r\n\r\n");
        try
        {
            await fluxo.WriteAsync(cabecalho);
            await fluxo.WriteAsync(corpo);
        }
        catch (IOException) { }
    }
}
