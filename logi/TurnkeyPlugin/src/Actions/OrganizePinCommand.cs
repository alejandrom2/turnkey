namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // Pins or unpins the open thread: it toggles, as Stream Deck's Organize set to Pin.
    public class OrganizePinCommand : SidecarCommand
    {
        public OrganizePinCommand()
            : base("organize", "Pin", "Pins the thread open in T3 Code, or unpins it when it's pinned.", "Threads", "pin")
        {
        }
    }
}
