namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // Turns Turnkey's haptic feedback on or off; the sidecar keeps the setting.
    public class HapticsCommand : SidecarCommand
    {
        public HapticsCommand()
            : base("haptics", "Haptics on/off", "Turns Turnkey's buzzes on an MX Master 4 on or off.", "Settings")
        {
        }
    }
}
