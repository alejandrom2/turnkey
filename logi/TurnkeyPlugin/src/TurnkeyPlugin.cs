namespace Loupedeck.TurnkeyPlugin
{
    using System;
    using System.IO;

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

            // Initialize the plugin resources.
            PluginResources.Init(this.Assembly);
        }

        // This method is called when the plugin is loaded.
        public override void Load() => this.Sidecar.Start(FindNode(), this.FindScript(), this.GetPluginDataDirectory());

        // This method is called when the plugin is unloaded.
        public override void Unload() => this.Sidecar.Dispose();

        // shortcut: needs Node installed, since Logi Plugin Service doesn't see the shell's PATH; Milestone 6 bundles it.
        private static String FindNode()
        {
            var configured = Environment.GetEnvironmentVariable("TURNKEY_NODE");
            if (!String.IsNullOrEmpty(configured))
            {
                return configured;
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

        // shortcut: runs the repo's build (logi/bin/sidecar.js) through the dev link, so resvg resolves from node_modules; Milestone 6 packages it.
        private String FindScript()
        {
            var configured = Environment.GetEnvironmentVariable("TURNKEY_SIDECAR");
            if (!String.IsNullOrEmpty(configured))
            {
                return configured;
            }

            // The assembly sits in logi/TurnkeyPlugin/bin/<Configuration>/bin/.
            var directory = Path.GetDirectoryName(this.Assembly.Location) ?? ".";
            return Path.GetFullPath(Path.Combine(directory, "..", "..", "..", "..", "bin", "sidecar.js"));
        }
    }
}
