using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Exilados;

/// <summary>
/// Janela do Windows para uma live ou tela que o site destacou (window.open com nome "exilados-video-…"): fica fora
/// da janela principal, vai para qualquer lugar ou monitor e muda de tamanho à vontade. O site move o vídeo que já está
/// tocando para dentro dela (mesma página por trás, sem reconectar); fechar a janela fecha aquela live.
/// </summary>
internal sealed class JanelaVideo : Form
{
    private readonly WebView2 _web = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.Black };
    private (FormBorderStyle Borda, FormWindowState Estado)? _antesDaTelaCheia;

    public const string Prefixo = "exilados-video-";

    public JanelaVideo(Form principal, int largura, int altura)
    {
        Text = "Exilados";
        Icon = Visual.Icone;
        BackColor = Color.Black;
        Visual.BarraEscura(this);
        float escala = DeviceDpi / 96f;
        MinimumSize = new Size((int)(240 * escala), (int)(160 * escala));
        ClientSize = new Size(largura > 0 ? largura : (int)(640 * escala), altura > 0 ? altura : (int)(360 * escala));
        // Abre perto da janela principal (na mesma tela); dali a pessoa arrasta para onde quiser.
        StartPosition = FormStartPosition.Manual;
        var tela = Screen.FromControl(principal).WorkingArea;
        Location = new Point(
            Math.Clamp(principal.Right - Width - (int)(40 * escala), tela.Left, Math.Max(tela.Left, tela.Right - Width)),
            Math.Clamp(principal.Top + (int)(80 * escala), tela.Top, Math.Max(tela.Top, tela.Bottom - Height)));
        Controls.Add(_web);
    }

    /// <summary>Prepara o WebView2 (o mesmo ambiente da janela principal) para virar a janela que o site pediu.</summary>
    public async Task<CoreWebView2> PrepararAsync(CoreWebView2Environment ambiente)
    {
        await _web.EnsureCoreWebView2Async(ambiente);
        var web = _web.CoreWebView2;
        web.Settings.AreDevToolsEnabled = !Atualizacao.ArquivoUnico;
        web.Settings.IsStatusBarEnabled = false;
        web.Settings.AreDefaultContextMenusEnabled = false;
        web.DocumentTitleChanged += (_, _) => Text = web.DocumentTitle is { Length: > 0 } titulo ? titulo : "Exilados";
        web.WindowCloseRequested += (_, _) => Close();
        web.ContainsFullScreenElementChanged += (_, _) => TelaCheia(web.ContainsFullScreenElement);
        // A janela só mostra o vídeo que o site pôs nela: nada de navegar para outro lugar ou abrir mais janelas.
        web.NavigationStarting += (_, e) => { if (!e.Uri.StartsWith("about:", StringComparison.OrdinalIgnoreCase)) e.Cancel = true; };
        web.NewWindowRequested += (_, e) => e.Handled = true;
        return web;
    }

    private void TelaCheia(bool ligar)
    {
        if (ligar && _antesDaTelaCheia is null)
        {
            _antesDaTelaCheia = (FormBorderStyle, WindowState);
            FormBorderStyle = FormBorderStyle.None;
            if (WindowState == FormWindowState.Maximized) WindowState = FormWindowState.Normal;
            WindowState = FormWindowState.Maximized;
        }
        else if (!ligar && _antesDaTelaCheia is { } antes)
        {
            _antesDaTelaCheia = null;
            WindowState = FormWindowState.Normal;
            FormBorderStyle = antes.Borda;
            WindowState = antes.Estado;
        }
    }
}
