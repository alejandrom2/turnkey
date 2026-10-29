namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // The selected thread's effort: scroll to step through its model's levels, press for the next.
    public class EffortAdjustment : SidecarAdjustment
    {
        public EffortAdjustment()
            : base("effort", "Effort", "Scroll to change the effort of the thread open in T3 Code; press for the next level.", "Model")
        {
        }
    }
}
