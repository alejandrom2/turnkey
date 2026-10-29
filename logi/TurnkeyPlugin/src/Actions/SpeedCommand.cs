namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // Fast mode for the thread open in T3 Code, where its model offers it.
    public class SpeedCommand : SidecarCommand
    {
        public SpeedCommand()
            : base("speed", "Speed", "Turns fast mode on or off for the thread open in T3 Code, where its model offers it.", "Model")
        {
        }
    }
}
