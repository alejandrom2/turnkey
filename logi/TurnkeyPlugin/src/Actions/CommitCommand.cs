namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // Asks the thread open in T3 Code to commit its changes.
    public class CommitCommand : SidecarCommand
    {
        public CommitCommand()
            : base("prompt", "Commit", "Sends a prompt to the thread open in T3 Code.", "Prompts", "commit")
        {
        }
    }
}
