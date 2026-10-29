namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // Marks the open thread unread.
    public class OrganizeMarkUnreadCommand : SidecarCommand
    {
        public OrganizeMarkUnreadCommand()
            : base("organize", "Mark unread", "Marks the thread open in T3 Code unread.", "Threads", "mark_unread")
        {
        }
    }
}
