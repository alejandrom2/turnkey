namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // Stops the open thread's workflows; a keypad needs a hold, a Ring click is itself the confirmation.
    public class StopWorkflowCommand : SidecarCommand
    {
        public StopWorkflowCommand()
            : base("stopWorkflow", "Stop workflow", "Stops the workflows the thread open in T3 Code runs (Claude). On a keypad, hold it.", "Threads")
        {
        }
    }
}
