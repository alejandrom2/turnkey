namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // Forks the open thread and opens the fork in T3 Code.
    public class ForkCommand : SidecarCommand
    {
        public ForkCommand()
            : base("fork", "Fork", "Forks the thread open in T3 Code from its last finished turn, and opens the fork.", "Threads")
        {
        }
    }
}
