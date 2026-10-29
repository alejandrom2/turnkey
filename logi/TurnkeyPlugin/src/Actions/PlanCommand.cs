namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // Build or Plan for the thread open in T3 Code.
    public class PlanCommand : SidecarCommand
    {
        public PlanCommand()
            : base("plan", "Plan", "Switches the thread open in T3 Code between Build and Plan.", "Model")
        {
        }
    }
}
