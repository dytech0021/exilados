namespace Exilados;

/// <summary>Entrar com a mesma conta do site (a do FilaBox): e-mail e senha, ou Google. Só membros do grupo transmitem.</summary>
internal sealed class JanelaEntrar : Form
{
    private const int Largura = 360;
    private readonly TextBox _email = Visual.Caixa(Largura);
    private readonly TextBox _senha = Visual.Caixa(Largura, senha: true);
    private readonly Label _erro = Visual.Rotulo("", Largura, 9.5f, cor: Color.FromArgb(0xFA, 0x77, 0x7C));
    private readonly Button _entrar = Visual.Botao("Entrar", Visual.Destaque, Largura);
    private readonly Button _google = Visual.Botao("Entrar com Google", Color.White, Largura, Color.FromArgb(0x1F, 0x1F, 0x1F));
    private readonly CancellationTokenSource _fechar = new();

    public Conta? Conta { get; private set; }
    public string NomeNoGrupo { get; private set; } = "";

    public JanelaEntrar(string emailAnterior)
    {
        Visual.Preparar(this, "Entrar no Exilados", Largura + 48);
        var coluna = Visual.Coluna(Largura);
        coluna.Controls.AddRange([
            Visual.Rotulo("Boas-vindas de volta!", Largura, 16f, FontStyle.Bold, Visual.Forte),
            Visual.Rotulo("Entre com a mesma conta do site do Exilados para transmitir para o grupo.", Largura, 10f, cor: Visual.Fraco),
            Visual.Secao("E-mail", Largura), _email,
            Visual.Secao("Senha", Largura), _senha,
            _entrar,
            Centralizar(Visual.Rotulo("ou", Largura, 9f, cor: Visual.Fraco)),
            _google,
            _erro,
            Visual.Link("Ainda não tem conta ou não está no grupo? Abra o convite no site.", () => Conta.AbrirNavegador(Exilados.Conta.Site)),
        ]);
        Controls.Add(coluna);
        coluna.Location = new Point(Padding.Left, Padding.Top);
        _email.Text = emailAnterior;
        AcceptButton = _entrar;
        _entrar.Click += async (_, _) => await EntrarAsync(ct => Exilados.Conta.EntrarAsync(_email.Text, _senha.Text, ct));
        _google.Click += async (_, _) => await EntrarAsync(Exilados.Conta.EntrarComGoogleAsync);
        FormClosed += (_, _) => _fechar.Cancel();
        Shown += (_, _) => (_email.Text.Length > 0 ? _senha : _email).Focus();
    }

    private static Label Centralizar(Label rotulo)
    {
        rotulo.Margin = new Padding(Largura / 2 - 8, 8, 0, 0);
        return rotulo;
    }

    private async Task EntrarAsync(Func<CancellationToken, Task<Conta>> entrar)
    {
        _erro.Text = "";
        _entrar.Enabled = _google.Enabled = false;
        try
        {
            var conta = await entrar(_fechar.Token);
            var membro = await conta.MembroAsync(_fechar.Token);
            if (membro is null)
            {
                string id;
                try { id = await conta.MeuIdAsync(_fechar.Token); }
                catch (ExiladosException) { id = ""; }
                _erro.Text = id.Length > 0
                    ? $"Esta conta ainda não faz parte do Exilados. Seu ID é {id}: mande para alguém do grupo te adicionar e clique em Entrar de novo."
                    : "Esta conta ainda não faz parte do Exilados. Abra o link de convite no site e depois entre aqui.";
                return;
            }
            if (!membro.Value.Ativo)
            {
                _erro.Text = "Sua entrada no grupo foi desfeita pelo dono. Só ele pode te readmitir.";
                return;
            }
            Conta = conta;
            NomeNoGrupo = membro.Value.Nome;
            DialogResult = DialogResult.OK;
            Close();
        }
        catch (ExiladosException ex) { _erro.Text = ex.Message; }
        catch (OperationCanceledException) { }
        finally
        {
            if (!IsDisposed) _entrar.Enabled = _google.Enabled = true;
        }
    }
}
