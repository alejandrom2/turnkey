namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // Unpins or pins the open thread: it toggles, as Stream Deck's Organize set to Unpin.
    public class OrganizeUnpinCommand : SidecarCommand
    {
        public OrganizeUnpinCommand()
            : base("organize", "Unpin", "Unpins the thread open in T3 Code, or pins it when it isn't pinned.", "Threads", "unpin")
        {
        }
    }
}
