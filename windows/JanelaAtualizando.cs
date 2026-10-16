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
            g.Clear(Visual.Painel);
            using var forma = Arredondado(new Rectangle(0, 0, logo.Width - 1, logo.Height - 1), Px(28));
            using var lavanda = new SolidBrush(Visual.Lavanda);
            g.FillPath(lavanda, forma);
            using var roxo = new Pen(Visual.RoxoMarca, logo.Width * 0.16f)
            {
                StartCap = LineCap.Round,
                EndCap = LineCap.Round,
                LineJoin = LineJoin.Round,
            };
            PointF P(float x, float y) => new(logo.Width * x, logo.Height * y);
            g.DrawBezier(roxo, P(.25f, .23f), P(.40f, .34f), P(.60f, .66f), P(.75f, .77f));
            g.DrawBezier(roxo, P(.75f, .23f), P(.60f, .34f), P(.40f, .66f), P(.25f, .77f));
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
