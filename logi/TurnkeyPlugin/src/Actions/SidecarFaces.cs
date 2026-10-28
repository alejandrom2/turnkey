namespace Loupedeck.TurnkeyPlugin
{
    using System;
    using System.Collections.Concurrent;
    using System.Threading;

    // The faces of one kind of action, which the sidecar draws (src/logi/sidecar.ts names the kinds), and its presses and scrolls.
    public sealed class SidecarFaces
    {
        private readonly String _kind;
        private readonly Func<Sidecar> _sidecar;
        private readonly Action _changed;
        private readonly ConcurrentDictionary<String, String> _images = new ConcurrentDictionary<String, String>();
        private readonly ConcurrentDictionary<String, Boolean> _announced = new ConcurrentDictionary<String, Boolean>();
        private readonly ConcurrentDictionary<String, ManualResetEventSlim> _waiting = new ConcurrentDictionary<String, ManualResetEventSlim>();

        private const Int32 FirstFaceWaitMs = 250;

        public SidecarFaces(String kind, Func<Sidecar> sidecar, Action changed)
        {
            this._kind = kind;
            this._sidecar = sidecar;
            this._changed = changed;
        }

        public void Attach()
        {
            this._sidecar().Image += this.OnImage;
            this._sidecar().Started += this.OnStarted;
            this._sidecar().Stopped += this.OnStopped;
        }

        public void Detach()
        {
            this._sidecar().Image -= this.OnImage;
            this._sidecar().Started -= this.OnStarted;
            this._sidecar().Stopped -= this.OnStopped;
        }

        public void Press(String actionParameter) => this._sidecar().Send(new { type = "press", action = this.ActionId(actionParameter) });

        public void Turn(String actionParameter, Int32 ticks) => this._sidecar().Send(new { type = "turn", action = this.ActionId(actionParameter), ticks });

        public BitmapImage Image(String actionParameter, PluginImageSize imageSize) => this.Image(actionParameter, Pixels(imageSize));

        // The SDK has no "now visible" event: an image request is when a key shows, as each time the Actions Ring opens.
        public BitmapImage Image(String actionParameter, Int32 pixels)
        {
            // An action editor's image request can come without a usable width; the sidecar refuses one under 16.
            pixels = pixels >= 16 ? pixels : 80;
            var action = this.ActionId(actionParameter);

            // The kind only: a parameter can be a prompt the user wrote.
            if (this._announced.TryAdd(action, true))
            {
                PluginLog.Info($"A {this._kind} action appeared at {pixels} px");
            }

            if (!this._sidecar().IsRunning)
            {
                return StoppedImage(pixels);
            }

            // A face the sidecar hasn't drawn yet is waited for briefly: an action editor's preview asks once and keeps what it gets.
            var known = this._images.ContainsKey(action);
            var drawn = known ? null : this._waiting.GetOrAdd(action, _ => new ManualResetEventSlim(false));
            this._sidecar().Send(new { type = "appear", action, size = pixels });
            drawn?.Wait(FirstFaceWaitMs);

            return this._images.TryGetValue(action, out var svg) ? BitmapImage.FromSvg(svg) : Blank(pixels);
        }

        // Logitech's samples draw 80 px faces on the 90 sizes.
        private static Int32 Pixels(PluginImageSize imageSize) => imageSize switch
        {
            PluginImageSize.Width60 or PluginImageSize.Width60Pixels => 60,
            PluginImageSize.Width116 or PluginImageSize.Width116Pixels => 116,
            _ => 80,
        };

        private static BitmapImage Blank(Int32 pixels)
        {
            var builder = new BitmapBuilder(pixels, pixels);
            builder.Clear(BitmapColor.FromRgb(0x111111));
            return builder.ToImage();
        }

        // Drawn here because the sidecar that draws everything else is the thing that's down; no text, as it can't be translated.
        private static BitmapImage StoppedImage(Int32 pixels)
        {
            const String stroke = "stroke=\"#FF6764\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"";
            return BitmapImage.FromSvg(
                $"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{pixels}\" height=\"{pixels}\" viewBox=\"-4 -4 32 32\">"
                + $"<circle cx=\"12\" cy=\"12\" r=\"10\" {stroke}/>"
                + $"<line x1=\"12\" x2=\"12\" y1=\"8\" y2=\"12\" {stroke}/>"
                + $"<line x1=\"12\" x2=\"12.01\" y1=\"16\" y2=\"16\" {stroke}/></svg>");
        }

        private String ActionId(String actionParameter) => $"{this._kind}:{actionParameter ?? ""}";

        private void OnImage(String action, String svg)
        {
            if (!action.StartsWith($"{this._kind}:"))
            {
                return;
            }

            this._images[action] = svg;
            if (this._waiting.TryRemove(action, out var drawn))
            {
                drawn.Set();
            }

            this._changed();
        }

        private void OnStarted()
        {
            this._announced.Clear();
            this._changed();
        }

        private void OnStopped()
        {
            this._images.Clear();
            this._changed();
        }
    }
}
