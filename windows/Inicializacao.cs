using Microsoft.Win32;

namespace Exilados;

/// <summary>
/// Abrir com o Windows: uma entrada na lista de inicialização do próprio usuário (não precisa de administrador e
/// aparece no Gerenciador de Tarefas). O programa abre só perto do relógio. Só a cópia de uso (arquivo único) mexe nisso.
/// </summary>
internal static class Inicializacao
{
    private const string Chave = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string Nome = "Exilados";
    public const string Argumento = "--inicio";

    /// <summary>Desligada nas capturas de conferência, que não podem trocar o programa que abre com o Windows.</summary>
    public static bool Ativa { get; set; } = true;

    public static void Aplicar(bool ligada)
    {
        if (!Ativa || !Atualizacao.ArquivoUnico) return;
        try
        {
            using var run = Registry.CurrentUser.CreateSubKey(Chave);
            if (ligada) run.SetValue(Nome, $"\"{Environment.ProcessPath}\" {Argumento}");
            else if (run.GetValue(Nome) is not null) run.DeleteValue(Nome);
        }
        catch (Exception ex) when (ex is UnauthorizedAccessException or System.Security.SecurityException or IOException) { Registro.Erro(ex); }
    }
}
