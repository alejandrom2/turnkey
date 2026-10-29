namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // Settles the open thread, as Stream Deck's Organize set to Settle.
    public class OrganizeSettleCommand : SidecarCommand
    {
        public OrganizeSettleCommand()
            : base("organize", "Settle", "Settles the thread open in T3 Code, taking it off the board.", "Threads", "settle")
        {
        }
    }
}
