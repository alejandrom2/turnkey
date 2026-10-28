namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // Sends one of Turnkey's quick prompts to the selected thread; Options+ lists each as its own action.
    public class QuickPromptCommand : SidecarCommand
    {
        public QuickPromptCommand()
            : base("prompt", "Quick prompt", "Sends a prompt to the thread open in T3 Code.", "Prompts")
        {
            this.AddParameter("test", "Fix tests", "Prompts");
            this.AddParameter("fix", "Diagnose", "Prompts");
            this.AddParameter("explain", "Explain", "Prompts");
            this.AddParameter("commit", "Commit", "Prompts");
        }
    }
}
