using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;

namespace Exilados;

/// <summary>
/// Janelinha que aparece enquanto o programa se atualiza ao abrir, como a do Discord: o logo e "Procurando
/// atualização...", "Baixando a versão...", "Atualizando...".
/// </summary>
internal sealed class JanelaAtualizando : Form
{
    private readonly Label _texto;

    public JanelaAtualizando(string texto)
    {
        float escala = DeviceDpi / 96f;
        int Px(float valor) => (int)(valor * escala);
        Text = "Atualizando o Exilados";
        Icon = Visual.Icone;
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Visual.Painel;
        ClientSize = new Size(Px(300), Px(300));

        var logo = new Panel { Size = new Size(Px(96), Px(96)), Location = new Point(Px(102), Px(72)) };
        logo.Paint += (_, e) =>
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
            g.Clear(Visual.Painel);
            using var forma = Arredondado(new Rectangle(0, 0, logo.Width - 1, logo.Height - 1), Px(28));
            using var laranja = new SolidBrush(Visual.Laranja);
            g.FillPath(laranja, forma);
            using var fonte = Visual.Fonte(26f, FontStyle.Bold);
            TextRenderer.DrawText(g, "EX", fonte, new Rectangle(0, 0, logo.Width, logo.Height), Color.White,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
        };
        _texto = new Label
        {
            Text = texto,
            AutoSize = false,
            TextAlign = ContentAlignment.MiddleCenter,
            Font = Visual.Fonte(11f),
            ForeColor = Visual.Texto,
            Size = new Size(Px(300), Px(30)),
            Location = new Point(0, Px(196)),
        };
        Controls.Add(logo);
        Controls.Add(_texto);
        // Cantos arredondados do Windows 11 (no Windows 10 o pedido é ignorado).
        HandleCreated += (_, _) =>
        {
            int redondo = 2;
            DwmSetWindowAttribute(Handle, 33, ref redondo, sizeof(int));
        };
    }

    public void Mostrar(string texto)
    {
        _texto.Text = texto;
        _texto.Refresh();
    }

    private static GraphicsPath Arredondado(Rectangle r, int raio)
    {
        var caminho = new GraphicsPath();
        int d = raio * 2;
        caminho.AddArc(r.X, r.Y, d, d, 180, 90);
        caminho.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        caminho.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        caminho.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        caminho.CloseFigure();
        return caminho;
    }

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr janela, int atributo, ref int valor, int tamanho);
}
