namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // The open thread's branch; opens the thread in T3 Code.
    public class BranchCommand : SidecarCommand
    {
        public BranchCommand()
            : base("branch", "Branch", "Shows the branch of the thread open in T3 Code. Choose it to open the thread.", "Threads")
        {
        }
    }
}
