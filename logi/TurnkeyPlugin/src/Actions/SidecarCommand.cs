namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // A pressable action the sidecar draws and runs.
    public abstract class SidecarCommand : PluginDynamicCommand
    {
        private readonly SidecarFaces _faces;

        // A parameter fixed by the subclass, as each quick prompt is its own action: Options+ offers no choice of parameters.
        private readonly String _parameter;

        protected SidecarCommand(String kind, String displayName, String description, String groupName, String parameter = null)
            : base(displayName: displayName, description: description, groupName: groupName)
        {
            this._parameter = parameter;
            this._faces = new SidecarFaces(kind, () => ((TurnkeyPlugin)this.Plugin).Sidecar, () => this.ActionImageChanged());
        }

        protected override Boolean OnLoad()
        {
            this._faces.Attach();
            return true;
        }

        protected override Boolean OnUnload()
        {
            this._faces.Detach();
            return true;
        }

        protected override void RunCommand(String actionParameter) => this._faces.Press(actionParameter ?? this._parameter);

        protected override BitmapImage GetCommandImage(String actionParameter, PluginImageSize imageSize) => this._faces.Image(actionParameter ?? this._parameter, imageSize);
    }
}
