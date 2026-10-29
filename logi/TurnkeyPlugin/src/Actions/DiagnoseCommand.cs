namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // Asks the thread open in T3 Code to diagnose the problem and fix it.
    public class DiagnoseCommand : SidecarCommand
    {
        public DiagnoseCommand()
            : base("prompt", "Diagnose", "Sends a prompt to the thread open in T3 Code.", "Prompts", "fix")
        {
        }
    }
}
