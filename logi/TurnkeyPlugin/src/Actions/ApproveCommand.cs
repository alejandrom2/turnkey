namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // Allows once what the open thread asks approval for; a keypad needs a hold, a Ring click is itself the confirmation.
    public class ApproveCommand : SidecarCommand
    {
        public ApproveCommand()
            : base("approve", "Approve", "Allows once what the thread open in T3 Code asks approval for. On a keypad, hold it.", "Threads")
        {
        }
    }
}
