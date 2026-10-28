namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // Opens the machines page: Logi shows the plugin's banner, and its button, only for a warning or an error.
    public class MachinesCommand : SidecarCommand
    {
        public MachinesCommand()
            : base("machines", "Machines", "Opens Turnkey's machines page, to pair, re-pair or remove T3 Code machines.", "Settings")
        {
        }
    }
}
