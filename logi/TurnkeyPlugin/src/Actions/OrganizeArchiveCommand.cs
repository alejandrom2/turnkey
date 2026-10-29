namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // Archives the open thread; a keypad needs a hold, a Ring click is itself the confirmation.
    public class OrganizeArchiveCommand : SidecarCommand
    {
        public OrganizeArchiveCommand()
            : base("organize", "Archive", "Archives the thread open in T3 Code. On a keypad, hold it.", "Threads", "archive")
        {
        }
    }
}
