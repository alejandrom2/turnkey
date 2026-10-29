namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // A press-only twin of the adjustment, for the Actions Ring, which places commands.
    public class EffortCommand : SidecarCommand
    {
        public EffortCommand()
            : base("effort", "Next effort", "Steps the thread open in T3 Code to its model's next effort level.", "Model")
        {
        }
    }
}
