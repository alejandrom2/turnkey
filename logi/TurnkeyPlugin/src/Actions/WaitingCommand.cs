namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // Half of the default ring's Threads folder.
    public class WaitingCommand : SidecarCommand
    {
        public WaitingCommand()
            : base("waiting", "Waiting on you", "Counts the T3 Code threads that wait on you. Choose it to open the most urgent.", "Threads")
        {
        }
    }
}
