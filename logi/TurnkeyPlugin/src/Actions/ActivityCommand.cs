namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // The most urgent thread on the board; listed in the Turnkey folder.
    public class ActivityCommand : SidecarCommand
    {
        public ActivityCommand()
            : base("activity", "Activity", "Shows the most urgent thread on your T3 Code board. Choose it to open that thread.", "Threads")
        {
        }
    }
}
