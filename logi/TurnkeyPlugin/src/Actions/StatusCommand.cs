namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // How many threads wait on you and how many run; choosing it opens the most urgent.
    public class StatusCommand : SidecarCommand
    {
        public StatusCommand()
            : base("status", "Thread status", "Shows how many T3 Code threads wait on you and how many run. Choose it to open the most urgent.", "Threads")
        {
        }
    }
}
