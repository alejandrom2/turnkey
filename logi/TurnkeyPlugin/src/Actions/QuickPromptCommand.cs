namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // One of Turnkey's quick prompts, picked in the action's editor and sent to the thread open in T3 Code; each placed
    // copy keeps its own pick. Options+ offers no choice of a command's parameters, so the pick lives in the editor.
    public class QuickPromptCommand : ActionEditorCommand
    {
        private const String PromptControl = "prompt";

        // The sidecar's prompt names (src/logi/ring.ts PROMPT_GLYPHS) and how the editor lists them.
        private static readonly (String Name, String Label)[] Prompts =
        {
            ("test", "Fix tests"),
            ("fix", "Diagnose"),
            ("explain", "Explain"),
            ("commit", "Commit"),
        };

        private readonly SidecarFaces _faces;

        public QuickPromptCommand()
        {
            this.Name = "QuickPrompt";
            this.DisplayName = "Quick prompt";
            this.GroupName = "Prompts";
            this.Description = "Sends a prompt to the thread open in T3 Code.";
            this.ActionEditor.AddControlEx(new ActionEditorListbox(PromptControl, "Prompt:", "Sent as a message to the thread open in T3 Code.").SetRequired());
            this.ActionEditor.ListboxItemsRequested += this.OnListboxItemsRequested;
            this.ActionEditor.ControlValueChanged += this.OnControlValueChanged;
            this._faces = new SidecarFaces("prompt", () => ((TurnkeyPlugin)this.Plugin).Sidecar, () => this.ActionImageChanged());
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

        protected override Boolean RunCommand(ActionEditorActionParameters actionParameters)
        {
            if (!actionParameters.TryGetString(PromptControl, out var prompt))
            {
                return false;
            }

            this._faces.Press(prompt);
            return true;
        }

        protected override BitmapImage GetCommandImage(ActionEditorActionParameters actionParameters, Int32 imageWidth, Int32 imageHeight) =>
            this._faces.Image(actionParameters.TryGetString(PromptControl, out var prompt) ? prompt : "", imageWidth);

        private void OnListboxItemsRequested(Object sender, ActionEditorListboxItemsRequestedEventArgs e)
        {
            if (!e.ControlName.EqualsNoCase(PromptControl))
            {
                return;
            }

            foreach (var (name, label) in Prompts)
            {
                e.AddItem(name, label, null);
            }
        }

        // Each placed copy is named after its prompt, so the ring and the list say which one it sends.
        private void OnControlValueChanged(Object sender, ActionEditorControlValueChangedEventArgs e)
        {
            if (!e.ControlName.EqualsNoCase(PromptControl))
            {
                return;
            }

            var picked = e.ActionEditorState.GetControlValue(PromptControl);
            foreach (var (name, label) in Prompts)
            {
                if (name == picked)
                {
                    e.ActionEditorState.SetDisplayName(label);
                }
            }
        }
    }
}
