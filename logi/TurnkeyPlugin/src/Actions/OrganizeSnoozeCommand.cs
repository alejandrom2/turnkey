namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // Snoozes the open thread for Stream Deck's default hour.
    public class OrganizeSnoozeCommand : SidecarCommand
    {
        public OrganizeSnoozeCommand()
            : base("organize", "Snooze", "Snoozes the thread open in T3 Code for an hour.", "Threads", "snooze")
        {
        }
    }
}
