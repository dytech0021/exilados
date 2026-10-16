using System.Runtime.InteropServices;

namespace Exilados;

/// <summary>Cores e peças das janelas, no tema escuro do Discord (as mesmas do site).</summary>
internal static class Visual
{
    public static readonly Color Fundo = Color.FromArgb(0x31, 0x33, 0x38);
    public static readonly Color Painel = Color.FromArgb(0x2B, 0x2D, 0x31);
    public static readonly Color Campo = Color.FromArgb(0x1E, 0x1F, 0x22);
    public static readonly Color Texto = Color.FromArgb(0xDB, 0xDE, 0xE1);
    public static readonly Color Fraco = Color.FromArgb(0x94, 0x9B, 0xA4);
    public static readonly Color Forte = Color.FromArgb(0xF2, 0xF3, 0xF5);
    public static readonly Color Destaque = Color.FromArgb(0x58, 0x65, 0xF2);
    public static readonly Color Vermelho = Color.FromArgb(0xDA, 0x37, 0x3C);
    public static readonly Color Verde = Color.FromArgb(0x23, 0xA5, 0x5A);
    public static readonly Color Cinza = Color.FromArgb(0x4E, 0x50, 0x58);
    public static readonly Color Laranja = Color.FromArgb(0xC0, 0x66, 0x2B);

    public static Font Fonte(float tamanho = 10f, FontStyle estilo = FontStyle.Regular) => new("Segoe UI", tamanho, estilo);

    public static Icon Icone { get; } = CarregarIcone();

    private static Icon CarregarIcone()
    {
        try { return Icon.ExtractAssociatedIcon(Environment.ProcessPath!) ?? SystemIcons.Application; }
        catch (Exception ex) when (ex is ArgumentException or IOException) { return SystemIcons.Application; }
    }

    public static void Preparar(Form janela, string titulo, int largura)
    {
        janela.Text = titulo;
        janela.Icon = Icone;
        janela.BackColor = Fundo;
        janela.ForeColor = Texto;
        janela.Font = Fonte();
        janela.FormBorderStyle = FormBorderStyle.FixedSingle;
        janela.MaximizeBox = false;
        janela.StartPosition = FormStartPosition.CenterScreen;
        janela.AutoScaleMode = AutoScaleMode.Dpi;
        janela.AutoSize = true;
        janela.AutoSizeMode = AutoSizeMode.GrowAndShrink;
        janela.Padding = new Padding(24, 20, 24, 20);
        janela.MinimumSize = new Size(largura, 0);
        janela.HandleCreated += (_, _) =>
        {
            int sim = 1;
            DwmSetWindowAttribute(janela.Handle, 20, ref sim, sizeof(int)); // barra de título escura
        };
    }

    public static FlowLayoutPanel Coluna(int largura) => new()
    {
        FlowDirection = FlowDirection.TopDown,
        WrapContents = false,
        AutoSize = true,
        AutoSizeMode = AutoSizeMode.GrowAndShrink,
        Width = largura,
        Margin = Padding.Empty,
    };

    public static Label Rotulo(string texto, int largura, float tamanho = 10f, FontStyle estilo = FontStyle.Regular, Color? cor = null) => new()
    {
        Text = texto,
        AutoSize = true,
        MaximumSize = new Size(largura, 0),
        Font = Fonte(tamanho, estilo),
        ForeColor = cor ?? Texto,
        Margin = new Padding(0, 0, 0, 6),
    };

    public static Label Secao(string texto, int largura) => new()
    {
        Text = texto.ToUpperInvariant(),
        AutoSize = true,
        MaximumSize = new Size(largura, 0),
        Font = Fonte(8.5f, FontStyle.Bold),
        ForeColor = Fraco,
        Margin = new Padding(0, 14, 0, 6),
    };

    public static Button Botao(string texto, Color fundo, int largura, Color? letra = null)
    {
        var b = new Button
        {
            Text = texto,
            FlatStyle = FlatStyle.Flat,
            BackColor = fundo,
            ForeColor = letra ?? Color.White,
            Font = Fonte(10f, FontStyle.Bold),
            Width = largura,
            Height = 40,
            Cursor = Cursors.Hand,
            Margin = new Padding(0, 6, 0, 0),
            UseVisualStyleBackColor = false,
        };
        b.FlatAppearance.BorderSize = 0;
        b.FlatAppearance.MouseOverBackColor = ControlPaint.Dark(fundo, 0.1f);
        return b;
    }

    public static TextBox Caixa(int largura, bool senha = false) => new()
    {
        Width = largura,
        BackColor = Campo,
        ForeColor = Forte,
        BorderStyle = BorderStyle.FixedSingle,
        Font = Fonte(11f),
        UseSystemPasswordChar = senha,
        Margin = new Padding(0, 0, 0, 10),
    };

    public static ComboBox Lista(int largura) => new()
    {
        Width = largura,
        DropDownStyle = ComboBoxStyle.DropDownList,
        FlatStyle = FlatStyle.Flat,
        BackColor = Campo,
        ForeColor = Forte,
        Font = Fonte(10f),
        Margin = new Padding(0, 0, 0, 8),
    };

    public static LinkLabel Link(string texto, Action aoClicar)
    {
        var link = new LinkLabel
        {
            Text = texto,
            AutoSize = true,
            LinkColor = Color.FromArgb(0x00, 0xA8, 0xFC),
            ActiveLinkColor = Color.FromArgb(0x00, 0xA8, 0xFC),
            Margin = new Padding(0, 10, 0, 0),
        };
        link.LinkClicked += (_, _) => aoClicar();
        return link;
    }

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr janela, int atributo, ref int valor, int tamanho);
}
