namespace Loupedeck.TurnkeyPlugin
{
    using System;
    using System.IO;
    using System.Linq;

    // T3 Code, so Logi knows when it's in front and can switch to its Turnkey profile.
    public class TurnkeyApplication : ClientApplication
    {
        public TurnkeyApplication()
        {
        }

        // Windows: T3 Code's process, stable and Nightly.
        protected override String[] GetProcessNames() => new[] { "T3 Code", "T3 Code (Nightly)" };

        // macOS: the bundle id both channels share.
        protected override String GetBundleName() => "com.t3tools.t3code";

        // Options+ names the application after the plugin otherwise.
        public override String GetDisplayName() => "T3 Code";

        // Where T3 Code is on macOS, so Options+ can show the real app and its icon; Windows paths aren't known yet.
        private static readonly String[] MacApps = { "/Applications/T3 Code.app", "/Applications/T3 Code (Nightly).app" };

        protected override String GetExecutablePath() => MacApps.FirstOrDefault(Directory.Exists) ?? "";

        public override ClientApplicationStatus GetApplicationStatus() =>
            OperatingSystem.IsMacOS()
                ? (MacApps.Any(Directory.Exists) ? ClientApplicationStatus.Installed : ClientApplicationStatus.NotInstalled)
                : ClientApplicationStatus.Unknown;
    }
}
