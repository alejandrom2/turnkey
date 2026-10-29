namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // T3 Code's version, and updating it; a keypad needs a hold, a Ring click is itself the confirmation.
    public class UpdateCommand : SidecarCommand
    {
        public UpdateCommand()
            : base("update", "Update T3", "Shows T3 Code's version and updates it to the newest release. On a keypad, hold it. Needs update access, which pairing from Logitech doesn't ask for.", "Settings")
        {
        }
    }
}
