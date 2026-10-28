namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // Opens a thread that waits on you, else nudges the selected one to continue.
    public class ContinueCommand : SidecarCommand
    {
        public ContinueCommand()
            : base("continue", "Continue", "Nudges the thread open in T3 Code to continue; opens it when it waits on you.", "Threads")
        {
        }
    }
}
