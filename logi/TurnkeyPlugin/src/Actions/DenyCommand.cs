namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // Denies what the open thread asks approval for; a keypad needs a hold, a Ring click is itself the confirmation.
    public class DenyCommand : SidecarCommand
    {
        public DenyCommand()
            : base("deny", "Deny", "Denies what the thread open in T3 Code asks approval for. On a keypad, hold it.", "Threads")
        {
        }
    }
}
