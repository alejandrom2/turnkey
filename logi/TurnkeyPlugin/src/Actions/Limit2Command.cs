namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // The provider at place 2 in T3 Code's Limits, for the default ring's Limits folder.
    public class Limit2Command : SidecarCommand
    {
        public Limit2Command()
            : base("limit", "Limit 2", "Shows how much of a provider's tightest limit is used, in the order T3 Code's Limits lists providers. Choose it to refresh.", "Limits", "2")
        {
        }
    }
}
