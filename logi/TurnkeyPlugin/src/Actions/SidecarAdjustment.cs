namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // A scrollable action the sidecar draws and runs; a press goes to the sidecar too.
    public abstract class SidecarAdjustment : PluginDynamicAdjustment
    {
        private readonly SidecarFaces _faces;

        protected SidecarAdjustment(String kind, String displayName, String description, String groupName)
            : base(displayName: displayName, description: description, groupName: groupName, hasReset: false)
        {
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

        protected override void ApplyAdjustment(String actionParameter, Int32 diff) => this._faces.Turn(actionParameter, diff);

        protected override void RunCommand(String actionParameter) => this._faces.Run(actionParameter);

        protected override BitmapImage GetAdjustmentImage(String actionParameter, PluginImageSize imageSize) => this._faces.Image(actionParameter, imageSize);

        protected override BitmapImage GetCommandImage(String actionParameter, PluginImageSize imageSize) => this._faces.Image(actionParameter, imageSize);
    }
}
