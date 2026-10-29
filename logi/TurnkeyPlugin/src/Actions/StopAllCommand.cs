namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // Stops every run on every paired machine.
    public class StopAllCommand : SidecarCommand
    {
        public StopAllCommand()
            : base("stopAll", "Stop all runs", "Stops every running T3 Code thread.", "Threads")
        {
        }
    }
}
