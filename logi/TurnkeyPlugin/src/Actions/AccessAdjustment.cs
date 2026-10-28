namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // The selected thread's access mode: scroll to step through, press for the next.
    public class AccessAdjustment : SidecarAdjustment
    {
        public AccessAdjustment()
            : base("access", "Access", "Scroll to change the access mode of the thread open in T3 Code; press for the next one.", "Model")
        {
        }
    }
}
