namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // The provider at place 3 in T3 Code's Limits, for the default ring's Limits folder.
    public class Limit3Command : SidecarCommand
    {
        public Limit3Command()
            : base("limit", "Limit 3", "Shows how much of a provider's tightest limit is used, in the order T3 Code's Limits lists providers. Choose it to refresh.", "Usage", "3")
        {
        }
    }
}
