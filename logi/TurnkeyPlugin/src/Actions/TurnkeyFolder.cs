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
            "health:", "open:preview",
        };

        // The English names for Options+ where the sidecar names no face (a localized name needs an xliff entry per action).
        private static readonly Dictionary<String, String> Names = new Dictionary<String, String>
        {
            ["urgent:"] = "Most urgent", ["status:"] = "Status", ["continue:"] = "Continue", ["stop:"] = "Stop run", ["stopAll:"] = "Stop all runs",
            ["prompt:test"] = "Run tests", ["prompt:fix"] = "Fix tests", ["prompt:explain"] = "Explain", ["prompt:commit"] = "Commit prompt",
            ["limits:"] = "Limits", ["settings:"] = "Settings", ["activity:"] = "Activity",
            ["git:commit"] = "Git commit", ["git:push"] = "Git push", ["git:create_pr"] = "Create pull request", ["git:pull"] = "Git pull",
            ["pr:pr"] = "Pull request", ["pr:fix"] = "Fix findings", ["pr:explain"] = "Explain pull request", ["pr:ask"] = "Ask about pull request", ["pr:guide"] = "Pull request guide",
            ["health:"] = "Health", ["open:preview"] = "Open preview",
        };

        private readonly Dictionary<String, SidecarFaces> _faces = new Dictionary<String, SidecarFaces>();

        private Boolean _active;
        private Int32 _size = 80;

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

        // Folder keys exist for the sidecar only while the folder is open, so their watches stop when it closes.
        public override Boolean Activate()
        {
            this._active = true;
            foreach (var action in Actions)
            {
                this.Faces(action)?.Appear(ParameterOf(action), this._size);
            }

            return true;
        }

        public override Boolean Deactivate()
        {
            this._active = false;
            foreach (var action in Actions)
            {
                this.Faces(action)?.Disappear(ParameterOf(action));
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

        public override BitmapImage GetCommandImage(String actionParameter, PluginImageSize imageSize)
        {
            var faces = this.Faces(actionParameter);
            if (faces == null)
            {
                return null;
            }

            // A closed folder asks for images too (Options+ lists it); those must not start the keys' reads.
            this._size = SidecarFaces.Pixels(imageSize);
            return faces.Image(ParameterOf(actionParameter), this._size, this._active);
        }

        public override String GetCommandDisplayName(String actionParameter, PluginImageSize imageSize) =>
            this.Faces(actionParameter)?.Label(ParameterOf(actionParameter))
            ?? (Names.TryGetValue(actionParameter ?? "", out var name) ? name : base.GetCommandDisplayName(actionParameter, imageSize));

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

        private SidecarFaces Faces(String action) => this._faces.TryGetValue(KindOf(action ?? ""), out var faces) ? faces : null;

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
