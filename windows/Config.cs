using System.Text.Json;

namespace Exilados;

/// <summary>Escolhas guardadas em %APPDATA%\Exilados\config.json. O login fica protegido pelo Windows (DPAPI).</summary>
internal sealed class Config
{
    public string Email { get; set; } = "";
    public string UsuarioId { get; set; } = "";
    public string Nome { get; set; } = "";
    /// <summary>Token de renovação do login, cifrado para esta conta do Windows.</summary>
    public string Token { get; set; } = "";
    public int Altura { get; set; } = 1080;
    public int Quadros { get; set; } = 60;
    public bool Som { get; set; } = true;
    public bool AbrirComWindows { get; set; } = true;
    /// <summary>"tela" ou "programa".</summary>
    public string Fonte { get; set; } = "tela";
    public string Tela { get; set; } = "";

    private static readonly JsonSerializerOptions Opcoes = new() { WriteIndented = true };

    public static string Arquivo => Path.Combine(Registro.Pasta, "config.json");

    public static Config Carregar()
    {
        try
        {
            if (File.Exists(Arquivo)) return JsonSerializer.Deserialize<Config>(File.ReadAllText(Arquivo)) ?? new Config();
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException) { }
        return new Config();
    }

    public void Salvar()
    {
        try
        {
            Directory.CreateDirectory(Registro.Pasta);
            string temporario = Arquivo + ".tmp";
            File.WriteAllText(temporario, JsonSerializer.Serialize(this, Opcoes));
            File.Move(temporario, Arquivo, true);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { Registro.Erro(ex); }
    }
}
