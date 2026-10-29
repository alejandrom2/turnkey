namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // The tightest usage limit, as a filling ring.
    public class LimitsCommand : SidecarCommand
    {
        public LimitsCommand()
            : base("limits", "Limits", "Shows your tightest T3 Code usage limit.", "Usage")
        {
        }
    }
}
