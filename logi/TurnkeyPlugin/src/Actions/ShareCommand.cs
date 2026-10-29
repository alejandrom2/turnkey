namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // Makes and copies a guest link for the open thread; a keypad hold stops sharing.
    public class ShareCommand : SidecarCommand
    {
        public ShareCommand()
            : base("share", "Share thread", "Makes a guest link for the thread open in T3 Code and copies it. On a keypad, hold it to stop sharing. Needs sharing access, which pairing from Logitech doesn't ask for.", "Threads")
        {
        }
    }
}
