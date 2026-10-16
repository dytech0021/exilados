using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace Exilados;

/// <summary>Permissão de transmitir que o exilados-api entrega a um membro ativo do grupo.</summary>
internal sealed record PermissaoLive(string Caminho, string Usuario, string Senha, string Rtsps);

/// <summary>Chamadas ao exilados-api (https://filabox3d.com.br/exilados/api), sempre com o login da pessoa.</summary>
internal sealed class Api(IAcesso conta)
{
    public static string Base { get; set; } = "https://filabox3d.com.br/exilados/api";
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(20) };

    private async Task<JsonElement> ChamarAsync(string caminho, object corpo, CancellationToken ct)
    {
        using var pedido = new HttpRequestMessage(HttpMethod.Post, Base + caminho);
        pedido.Headers.Authorization = new AuthenticationHeaderValue("Bearer", await conta.AcessoAsync(ct));
        pedido.Content = new StringContent(JsonSerializer.Serialize(corpo), Encoding.UTF8, "application/json");
        HttpResponseMessage resposta;
        try { resposta = await Http.SendAsync(pedido, ct); }
        catch (Exception ex) when (ex is HttpRequestException || (ex is TaskCanceledException && !ct.IsCancellationRequested))
        {
            throw new ExiladosException("Sem conexão com o servidor do Exilados.");
        }
        using (resposta)
        {
            string texto = await resposta.Content.ReadAsStringAsync(ct);
            JsonElement dados;
            try { dados = JsonDocument.Parse(texto.Length > 0 ? texto : "{}").RootElement.Clone(); }
            catch (JsonException) { dados = default; }
            if (resposta.IsSuccessStatusCode) return dados;
            string erro = dados.ValueKind == JsonValueKind.Object && dados.TryGetProperty("erro", out var e) ? e.GetString() ?? "" : "";
            if (resposta.StatusCode == HttpStatusCode.NotFound && caminho.StartsWith("/live/")) throw new LiveTerminadaException(erro.Length > 0 ? erro : "A live terminou.");
            throw new ExiladosException(erro.Length > 0 ? erro : $"O servidor do Exilados respondeu com erro ({(int)resposta.StatusCode}).");
        }
    }

    public async Task<PermissaoLive> ComecarAsync(CancellationToken ct)
    {
        var d = await ChamarAsync("/live/comecar", new { }, ct);
        return new PermissaoLive(d.GetProperty("caminho").GetString()!, d.GetProperty("usuario").GetString()!,
            d.GetProperty("senha").GetString()!, d.GetProperty("rtsps").GetString()!);
    }

    /// <summary>Sinal de vida; devolve quantos estão assistindo (-1 se o servidor não soube dizer).</summary>
    public async Task<int> SinalAsync(CancellationToken ct)
    {
        var d = await ChamarAsync("/live/sinal", new { }, ct);
        return d.TryGetProperty("assistindo", out var n) && n.TryGetInt32(out int valor) ? valor : -1;
    }

    public Task PararAsync(CancellationToken ct) => ChamarAsync("/live/parar", new { }, ct);

    /// <summary>Permissão de assistir (o autoteste confere a própria live por ela).</summary>
    public async Task<(string Caminho, string Token)> AssistirAsync(string usuario, CancellationToken ct)
    {
        var d = await ChamarAsync("/live/assistir", new { usuario }, ct);
        return (d.GetProperty("caminho").GetString()!, d.GetProperty("token").GetString()!);
    }
}
