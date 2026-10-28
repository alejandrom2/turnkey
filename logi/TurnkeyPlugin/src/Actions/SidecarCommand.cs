namespace Loupedeck.TurnkeyPlugin
{
    using System;
    using System.Collections.Concurrent;

    // An action the sidecar draws and runs; `kind` names it there (src/logi/sidecar.ts).
    public abstract class SidecarCommand : PluginDynamicCommand
    {
        private readonly String _kind;
        private readonly ConcurrentDictionary<String, String> _images = new ConcurrentDictionary<String, String>();
        private readonly ConcurrentDictionary<String, Boolean> _announced = new ConcurrentDictionary<String, Boolean>();

        protected SidecarCommand(String kind, String displayName, String description)
            : base(displayName: displayName, description: description, groupName: "Turnkey")
        {
            this._kind = kind;
        }

        private Sidecar Sidecar => ((TurnkeyPlugin)this.Plugin).Sidecar;

        protected override Boolean OnLoad()
        {
            this.Sidecar.Image += this.OnImage;
            this.Sidecar.Started += this.OnStarted;
            this.Sidecar.Stopped += this.OnStopped;
            return true;
        }

        protected override Boolean OnUnload()
        {
            this.Sidecar.Image -= this.OnImage;
            this.Sidecar.Started -= this.OnStarted;
            this.Sidecar.Stopped -= this.OnStopped;
            return true;
        }

        protected override void RunCommand(String actionParameter) =>
            this.Sidecar.Send(new { type = "press", action = this.ActionId(actionParameter) });

        // The SDK has no "now visible" event: the first image request is when a key appears.
        protected override BitmapImage GetCommandImage(String actionParameter, PluginImageSize imageSize)
        {
            var action = this.ActionId(actionParameter);
            if (this._announced.TryAdd(action, true))
            {
                PluginLog.Info($"{action} appeared at {imageSize}");
                this.Sidecar.Send(new { type = "appear", action, size = Pixels(imageSize) });
            }

            if (!this.Sidecar.IsRunning)
            {
                return Stopped(imageSize);
            }

            return this._images.TryGetValue(action, out var png) ? BitmapImage.FromBase64String(png) : Blank(imageSize);
        }

        private String ActionId(String actionParameter) => $"{this._kind}:{actionParameter ?? ""}";

        // Logitech's samples draw 80 px faces on the 90 sizes.
        private static Int32 Pixels(PluginImageSize imageSize) => imageSize switch
        {
            PluginImageSize.Width60 or PluginImageSize.Width60Pixels => 60,
            PluginImageSize.Width116 or PluginImageSize.Width116Pixels => 116,
            _ => 80,
        };

        private static BitmapImage Blank(PluginImageSize imageSize)
        {
            var builder = new BitmapBuilder(imageSize);
            builder.Clear(BitmapColor.FromRgb(0x111111));
            return builder.ToImage();
        }

        // Drawn here because the sidecar that draws everything else is the thing that's down.
        private static BitmapImage Stopped(PluginImageSize imageSize)
        {
            var builder = new BitmapBuilder(imageSize);
            builder.Clear(BitmapColor.FromRgb(0x111111));
            builder.DrawText("Turnkey stopped", BitmapColor.FromRgb(0xFF6764), 14, 16, 4);
            return builder.ToImage();
        }

        private void OnImage(String action, String png)
        {
            if (!action.StartsWith($"{this._kind}:"))
            {
                return;
            }

            this._images[action] = png;
            this.ActionImageChanged();
        }

        private void OnStarted()
        {
            this._announced.Clear();
            this.ActionImageChanged();
        }

        private void OnStopped()
        {
            this._images.Clear();
            this.ActionImageChanged();
        }
    }

    // A key showing one T3 Code thread; a press steps to the next thread.
    public class ThreadKeyCommand : SidecarCommand
    {
        public ThreadKeyCommand()
            : base("thread", "Turnkey Thread", "Shows a T3 Code thread. Press for the next one.")
        {
        }
    }

    // The thread that needs you most, as a color and an icon; choosing it opens the thread in T3 Code.
    public class MostUrgentCommand : SidecarCommand
    {
        public MostUrgentCommand()
            : base("urgent", "Most urgent thread", "Shows what needs you in T3 Code. Choose it to open that thread.")
        {
        }
    }

    // Stops the run that started last; dimmed while nothing runs.
    public class StopRunCommand : SidecarCommand
    {
        public StopRunCommand()
            : base("stop", "Stop run", "Stops the T3 Code run that started last.")
        {
        }
    }
}
