namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // The provider at place 1 in T3 Code's Limits, for the default ring's Limits folder.
    public class Limit1Command : SidecarCommand
    {
        public Limit1Command()
            : base("limit", "Limit 1", "Shows how much of a provider's tightest limit is used, in the order T3 Code's Limits lists providers. Choose it to refresh.", "Usage", "1")
        {
        }
    }
}
