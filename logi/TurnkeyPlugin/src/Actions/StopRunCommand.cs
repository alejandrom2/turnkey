namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // Stops the run that started last; dimmed while nothing runs.
    public class StopRunCommand : SidecarCommand
    {
        public StopRunCommand()
            : base("stop", "Stop run", "Stops the T3 Code run that started last.", "Threads")
        {
        }
    }
}
