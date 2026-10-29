namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // The last 30 days' usage cost, read again on a press.
    public class UsageCommand : SidecarCommand
    {
        public UsageCommand()
            : base("usage", "Usage", "Shows what your T3 Code usage cost over the last 30 days. Choose it to read it again; on a keypad, hold it to reload model prices first.", "Usage")
        {
        }
    }
}
