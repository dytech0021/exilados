namespace Exilados;

/// <summary>De onde vem o login das chamadas ao exilados-api: a conta guardada no programa ou o site da janela principal.</summary>
internal interface IAcesso
{
    string UsuarioId { get; }

    /// <summary>Token de acesso válido para a próxima chamada.</summary>
    Task<string> AcessoAsync(CancellationToken ct);
}

/// <summary>
/// Login emprestado pelo site aberto na janela principal: quem entrou no Exilados ali transmite sem entrar de novo.
/// O site renova o próprio login; o programa só pede o token atual a cada chamada.
/// </summary>
internal sealed class AcessoDoSite(JanelaPrincipal janela, SessaoDoSite sessao) : IAcesso
{
    public string UsuarioId { get; } = sessao.Usuario;
    public string Nome { get; } = sessao.Nome.Length > 0 ? sessao.Nome : sessao.Email;

    public async Task<string> AcessoAsync(CancellationToken ct)
    {
        var atual = await janela.SessaoAsync(ct) ?? throw new ExiladosException("O Exilados aberto no programa não está com a conta conectada. Abra-o e entre de novo.");
        if (atual.Usuario != UsuarioId) throw new ExiladosException("A conta aberta no Exilados mudou. Abra a janela Transmitir de novo.");
        return atual.Token;
    }
}
