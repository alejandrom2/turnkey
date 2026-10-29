namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // Wakes the thread snoozed last.
    public class OrganizeWakeCommand : SidecarCommand
    {
        public OrganizeWakeCommand()
            : base("organize", "Wake thread", "Wakes the thread you snoozed last in T3 Code.", "Threads", "wake")
        {
        }
    }
}
