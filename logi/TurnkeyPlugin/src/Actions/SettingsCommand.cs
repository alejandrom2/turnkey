namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // Opens Turnkey Settings: Logi shows the plugin's banner, and its button, only for a warning or an error.
    public class SettingsCommand : SidecarCommand
    {
        public SettingsCommand()
            : base("settings", "Turnkey Settings", "Opens Turnkey Settings: machines, pairing and haptics.", "Settings")
        {
        }
    }
}
