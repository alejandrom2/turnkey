namespace Loupedeck.TurnkeyPlugin
{
    using System;
    using System.IO;
    using System.Linq;

    // Turnkey for Logitech devices: the actions here are thin, and Turnkey's Node core in the sidecar does the work.
    public class TurnkeyPlugin : Plugin
    {
        // Gets a value indicating whether this is an API-only plugin.
        public override Boolean UsesApplicationApiOnly => true;

        // Gets a value indicating whether this is a Universal plugin or an Application plugin.
        public override Boolean HasNoApplication => true;

        public Sidecar Sidecar { get; } = new Sidecar();

        // Initializes a new instance of the plugin class.
        public TurnkeyPlugin()
        {
            // Initialize the plugin log.
            PluginLog.Init(this.Log);
        }

        // This method is called when the plugin is loaded.
        public override void Load()
        {
            this.Sidecar.Haptic += this.PluginEvents.RaiseEvent;
            this.Sidecar.Status += this.OnStatus;

            // A fresh sidecar speaks English until told otherwise, as on every restart.
            this.Sidecar.Started += this.SendLanguage;
            this.Localization.LanguageChanged += (_, _) => this.SendLanguage();
            this.Sidecar.Start(FindNode(), this.FindScript(), this.GetPluginDataDirectory());
        }

        private void SendLanguage() => this.Sidecar.Send(new { type = "language", language = this.Localization.CurrentLanguage });

        private void OnStatus(String level, String message, String url, String urlTitle)
        {
            var status = level switch
            {
                "error" => Loupedeck.PluginStatus.Error,
                "warning" => Loupedeck.PluginStatus.Warning,
                _ => Loupedeck.PluginStatus.Normal,
            };
            if (url == null)
            {
                this.OnPluginStatusChanged(status, message);
            }
            else
            {
                this.OnPluginStatusChanged(status, message, url, urlTitle);
            }
        }

        // This method is called when the plugin is unloaded.
        public override void Unload() => this.Sidecar.Dispose();

        // Logi Plugin Service installs Node for its own Node.js plugins; Turnkey runs on the newest it has, else on the system's.
        private static String FindNode()
        {
            var configured = Environment.GetEnvironmentVariable("TURNKEY_NODE");
            if (!String.IsNullOrEmpty(configured))
            {
                return configured;
            }

            var windows = OperatingSystem.IsWindows();
            var hosts = windows
                ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Logi", "LogiPluginService", "PluginHosts")
                : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Library", "Application Support", "Logi", "LogiPluginService", "PluginHosts");
            if (Directory.Exists(hosts))
            {
                // node22, node24, ...: the highest number is the newest.
                var bundled = Directory.GetDirectories(hosts, "node*")
                    .Select(directory => (Directory: directory, Version: Int32.TryParse(Path.GetFileName(directory).Substring(4), out var number) ? number : 0))
                    .OrderByDescending(host => host.Version)
                    .Select(host => windows ? Path.Combine(host.Directory, "node", "node.exe") : Path.Combine(host.Directory, "node", "bin", "node"))
                    .FirstOrDefault(File.Exists);
                if (bundled != null)
                {
                    return bundled;
                }
            }

            foreach (var candidate in new[] { "/opt/homebrew/bin/node", "/usr/local/bin/node" })
            {
                if (File.Exists(candidate))
                {
                    return candidate;
                }
            }

            return "node";
        }

        // The build copies sidecar.mjs next to the plugin's assembly; the service loads that from memory, so Assembly.Location is empty.
        private String FindScript()
        {
            var configured = Environment.GetEnvironmentVariable("TURNKEY_SIDECAR");
            return String.IsNullOrEmpty(configured) ? Path.Combine(Path.GetDirectoryName(this.AssemblyFilePath) ?? ".", "sidecar.mjs") : configured;
        }
    }
}
