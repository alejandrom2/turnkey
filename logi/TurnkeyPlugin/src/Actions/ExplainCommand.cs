namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // Asks the thread open in T3 Code to explain where its work stands.
    public class ExplainCommand : SidecarCommand
    {
        public ExplainCommand()
            : base("prompt", "Explain", "Sends a prompt to the thread open in T3 Code.", "Prompts", "explain")
        {
        }
    }
}
