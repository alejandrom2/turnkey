namespace Loupedeck.TurnkeyPlugin
{
    using System;
    using System.Collections.Concurrent;
    using System.Collections.Generic;
    using System.Linq;
    using System.Threading;

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

        // Only these keys live in this folder alone, so only they follow it open and closed: the rest share their id with a
        // top-level key, whose own visibility must not be cut short.
        private static Boolean IsFolderOnly(String action) => action.StartsWith("git:") || action.StartsWith("pr:") || action == "health:" || action == "open:preview";

        private readonly Dictionary<String, SidecarFaces> _faces = new Dictionary<String, SidecarFaces>();

        // Open on how many devices (the service pairs each Activate with a Deactivate): the last to close ends the keys' watches.
        private Int32 _opens;

        // Every size the folder has drawn at, as the Ring and a keypad can both show it; its keys appear at each.
        private readonly ConcurrentDictionary<Int32, Boolean> _sizes = new ConcurrentDictionary<Int32, Boolean>();

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
            Interlocked.Increment(ref this._opens);
            var sizes = this._sizes.IsEmpty ? new[] { 80 } : this._sizes.Keys.ToArray();
            foreach (var action in Actions.Where(IsFolderOnly))
            {
                foreach (var size in sizes)
                {
                    this.Faces(action)?.Appear(ParameterOf(action), size);
                }
            }

            return true;
        }

        public override Boolean Deactivate()
        {
            var opens = Interlocked.Decrement(ref this._opens);
            if (opens < 0)
            {
                Interlocked.CompareExchange(ref this._opens, 0, opens);
            }

            if (opens > 0)
            {
                return true;
            }

            foreach (var action in Actions.Where(IsFolderOnly))
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

        // The Actions Ring never opens a folder as such (no Activate), so keys that only live while it's open stay off it.
        public override IEnumerable<String> GetButtonPressActionNames(DeviceType deviceType) =>
            Actions.Where(action => !IsRingOnly(deviceType) || !IsFolderOnly(action)).Select(this.CreateCommandName).Prepend(PluginDynamicFolder.NavigateUpActionName);

        // A mask that also covers the keypad keeps every key.
        private static Boolean IsRingOnly(DeviceType deviceType) => deviceType.HasFlag(DeviceType.Loupedeck72) && !deviceType.HasFlag(DeviceType.Loupedeck70);

        public override BitmapImage GetCommandImage(String actionParameter, PluginImageSize imageSize)
        {
            var faces = this.Faces(actionParameter);
            if (faces == null)
            {
                return null;
            }

            // A closed folder asks for images too (Options+ lists it); those must not start its own keys' reads.
            var pixels = SidecarFaces.Pixels(imageSize);
            this._sizes.TryAdd(pixels, true);
            return faces.Image(ParameterOf(actionParameter), pixels, Volatile.Read(ref this._opens) > 0 || !IsFolderOnly(actionParameter));
        }

        public override String GetCommandDisplayName(String actionParameter, PluginImageSize imageSize) =>
            this.Faces(actionParameter)?.Name(ParameterOf(actionParameter)) ?? base.GetCommandDisplayName(actionParameter, imageSize);

        public override void RunCommand(String actionParameter)
        {
            if (this.IsClosedFolderOnly(actionParameter))
            {
                return;
            }

            if (this._faces.TryGetValue(KindOf(actionParameter), out var faces))
            {
                faces.Run(ParameterOf(actionParameter));
            }
        }

        // Swallowed, so the SDK doesn't run it either.
        public override Boolean ProcessButtonEvent2(String actionParameter, DeviceButtonEvent2 buttonEvent) =>
            this.IsClosedFolderOnly(actionParameter) || (this.Faces(actionParameter)?.Button(ParameterOf(actionParameter), buttonEvent) ?? false);

        // A folder-only key pressed with the folder closed (the Ring never opens it) has never appeared, so its face was blank: it mustn't act blind.
        private Boolean IsClosedFolderOnly(String action) => action != null && IsFolderOnly(action) && Volatile.Read(ref this._opens) == 0;

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
