namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // Half of the default ring's Threads folder.
    public class RunningCommand : SidecarCommand
    {
        public RunningCommand()
            : base("running", "Running threads", "Counts the T3 Code threads that are running. Choose it to open the one that started last.", "Threads")
        {
        }
    }
}
