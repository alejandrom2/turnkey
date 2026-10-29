namespace Loupedeck.TurnkeyPlugin
{
    using System;
    using System.Collections.Generic;
    using System.Linq;

    // One Turnkey slot that opens Turnkey's actions, each with the live face its own action shows.
    public class TurnkeyFolder : PluginDynamicFolder
    {
        // Action ids as the sidecar knows them (src/logi/sidecar.ts): `<kind>:<parameter>`.
        private static readonly String[] Actions =
        {
            "urgent:", "status:", "continue:", "stop:", "stopAll:",
            "prompt:test", "prompt:fix", "prompt:explain", "prompt:commit",
            "limits:", "settings:", "activity:",
            "git:commit", "git:push", "git:create_pr", "git:pull",
            "pr:pr", "pr:fix", "pr:explain", "pr:ask", "pr:guide",
        };

        private readonly Dictionary<String, SidecarFaces> _faces = new Dictionary<String, SidecarFaces>();

        public TurnkeyFolder()
        {
            this.DisplayName = "Turnkey";
            this.Description = "Opens Turnkey's actions for T3 Code.";
            this.GroupName = "Turnkey";

            // A folder lists for consoles only unless told otherwise; the Actions Ring is a device too.
            this.SupportedDevices = DeviceType.All;
        }

        public override Boolean Load()
        {
            foreach (var kind in Actions.Select(KindOf).Distinct())
            {
                var faces = new SidecarFaces(kind, () => ((TurnkeyPlugin)this.Plugin).Sidecar, this.Repaint);
                faces.Attach();
                this._faces[kind] = faces;
            }

            return true;
        }

        public override Boolean Unload()
        {
            foreach (var faces in this._faces.Values)
            {
                faces.Detach();
            }

            this._faces.Clear();
            return true;
        }

        public override IEnumerable<String> GetButtonPressActionNames(DeviceType deviceType) =>
            Actions.Select(this.CreateCommandName).Prepend(PluginDynamicFolder.NavigateUpActionName);

        public override BitmapImage GetCommandImage(String actionParameter, PluginImageSize imageSize) =>
            this._faces.TryGetValue(KindOf(actionParameter), out var faces) ? faces.Image(ParameterOf(actionParameter), imageSize) : null;

        public override void RunCommand(String actionParameter)
        {
            if (this._faces.TryGetValue(KindOf(actionParameter), out var faces))
            {
                faces.Press(ParameterOf(actionParameter));
            }
        }

        public override Boolean ProcessButtonEvent2(String actionParameter, DeviceButtonEvent2 buttonEvent) =>
            SidecarFaces.HandleButton(buttonEvent, held =>
            {
                if (this._faces.TryGetValue(KindOf(actionParameter), out var faces))
                {
                    faces.Press(ParameterOf(actionParameter), held);
                }
            });

        private static String KindOf(String action) => action.Split(':')[0];

        private static String ParameterOf(String action) => action.Substring(action.IndexOf(':') + 1);

        private void Repaint()
        {
            foreach (var action in Actions)
            {
                this.CommandImageChanged(action);
            }
        }
    }
}
