namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // The provider at place 5 in T3 Code's Limits, for the default ring's Limits folder.
    public class Limit5Command : SidecarCommand
    {
        public Limit5Command()
            : base("limit", "Limit 5", "Shows how much of a provider's tightest limit is used, in the order T3 Code's Limits lists providers. Choose it to refresh.", "Usage", "5")
        {
        }
    }
}
