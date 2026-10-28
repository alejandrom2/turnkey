namespace Loupedeck.TurnkeyPlugin
{
    using System;
    using System.Diagnostics;
    using System.Text.Json;
    using System.Threading.Tasks;

    // Runs Turnkey's Node core and speaks its line protocol (src/logi/protocol.ts): JSON lines on stdin and stdout.
    public sealed class Sidecar : IDisposable
    {
        private const Int32 MaxRestarts = 3;
        private const Int32 RestartDelayMs = 5000;

        private readonly Object _lock = new Object();
        private Process _process;
        private String _node;
        private String _script;
        private String _dataDir;
        private Int32 _restarts;
        private Boolean _disposed;

        // An action's new face: its id and SVG markup.
        public event Action<String, String> Image;

        // A fresh sidecar knows no keys, so actions announce themselves again.
        public event Action Started;

        public event Action Stopped;

        // A haptic event's name, as declared in events/DefaultEventSource.yaml.
        public event Action<String> Haptic;

        public Boolean IsRunning
        {
            get
            {
                lock (this._lock)
                {
                    return this._process != null && !this._process.HasExited;
                }
            }
        }

        public void Start(String node, String script, String dataDir)
        {
            this._node = node;
            this._script = script;
            this._dataDir = dataDir;
            this.Launch();
        }

        public void Send(Object message)
        {
            lock (this._lock)
            {
                if (this._process == null || this._process.HasExited)
                {
                    return;
                }

                try
                {
                    this._process.StandardInput.WriteLine(JsonSerializer.Serialize(message));
                }
                catch (Exception ex)
                {
                    PluginLog.Warning(ex, "Couldn't write to the Turnkey sidecar");
                }
            }
        }

        public void Dispose()
        {
            Process process;
            lock (this._lock)
            {
                this._disposed = true;
                process = this._process;
                this._process = null;
            }

            if (process == null)
            {
                return;
            }

            try
            {
                // Closing stdin is the sidecar's signal to stop its connections and exit.
                process.StandardInput.Close();
                if (!process.WaitForExit(2000))
                {
                    process.Kill();
                }
            }
            catch (Exception ex)
            {
                PluginLog.Warning(ex, "Couldn't stop the Turnkey sidecar");
            }
        }

        private void Launch()
        {
            var info = new ProcessStartInfo(this._node)
            {
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            info.ArgumentList.Add(this._script);
            info.ArgumentList.Add(this._dataDir);

            var process = new Process { StartInfo = info, EnableRaisingEvents = true };
            process.OutputDataReceived += (_, e) => this.OnLine(e.Data);
            process.ErrorDataReceived += (_, e) =>
            {
                if (!String.IsNullOrEmpty(e.Data))
                {
                    PluginLog.Warning($"Turnkey sidecar: {e.Data}");
                }
            };
            process.Exited += (_, _) => this.OnExited(process);

            lock (this._lock)
            {
                if (this._disposed)
                {
                    return;
                }

                try
                {
                    process.Start();
                }
                catch (Exception ex)
                {
                    PluginLog.Error(ex, $"Couldn't start the Turnkey sidecar with {this._node}");
                    this.Stopped?.Invoke();
                    return;
                }

                process.StandardInput.AutoFlush = true;
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();
                this._process = process;
            }

            this.Started?.Invoke();
        }

        private void OnExited(Process process)
        {
            lock (this._lock)
            {
                if (this._disposed || this._process != process)
                {
                    return;
                }

                this._process = null;
            }

            PluginLog.Warning($"The Turnkey sidecar exited with code {process.ExitCode}");
            this.Stopped?.Invoke();
            if (this._restarts++ < MaxRestarts)
            {
                Task.Delay(RestartDelayMs).ContinueWith(_ => this.Launch());
            }
        }

        private void OnLine(String line)
        {
            if (String.IsNullOrEmpty(line))
            {
                return;
            }

            try
            {
                using var document = JsonDocument.Parse(line);
                var root = document.RootElement;
                switch (root.GetProperty("type").GetString())
                {
                    case "image":
                        // A sidecar that draws is healthy: crashes days apart shouldn't use up the restarts.
                        this._restarts = 0;
                        this.Image?.Invoke(root.GetProperty("action").GetString(), root.GetProperty("svg").GetString());
                        break;
                    case "haptic":
                        this.Haptic?.Invoke(root.GetProperty("event").GetString());
                        break;
                    case "log":
                        var message = $"Turnkey sidecar: {root.GetProperty("message").GetString()}";
                        if (root.GetProperty("level").GetString() == "warn")
                        {
                            PluginLog.Warning(message);
                        }
                        else
                        {
                            PluginLog.Info(message);
                        }

                        break;
                }
            }
            catch (Exception ex)
            {
                PluginLog.Warning(ex, "Dropped a line from the Turnkey sidecar");
            }
        }
    }
}
