namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // A press-only twin of the adjustment, for the Actions Ring, which places commands.
    public class AccessCommand : SidecarCommand
    {
        public AccessCommand()
            : base("access", "Next access", "Steps the thread open in T3 Code to its next access mode.", "Model")
        {
        }
    }
}
