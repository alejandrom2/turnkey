namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // A prompt the user writes in the action's editor, sent to the thread open in T3 Code; each placed copy keeps its own.
    public class SendPromptCommand : ActionEditorCommand
    {
        private const String PromptControl = "prompt";
        private readonly SidecarFaces _faces;

        public SendPromptCommand()
        {
            this.Name = "SendPrompt";
            this.DisplayName = "Send prompt";
            this.GroupName = "Prompts";
            this.Description = "Sends the prompt you write here to the thread open in T3 Code.";
            this.ActionEditor.AddControlEx(new ActionEditorTextbox(PromptControl, "Prompt to send:", "Sent as a message to the thread open in T3 Code.").SetRequired().SetMaxLength(2000));
            this.ActionEditor.ControlValueChanged += this.OnControlValueChanged;
            this._faces = new SidecarFaces("send", () => ((TurnkeyPlugin)this.Plugin).Sidecar, () => this.ActionImageChanged());
        }

        // Options+ never asks an editor action for an image and shows its name instead, so a placed copy is named with
        // Send's arrow alone; a symbol, so it needs no translation.
        private void OnControlValueChanged(Object sender, ActionEditorControlValueChangedEventArgs e)
        {
            if (e.ControlName.EqualsNoCase(PromptControl))
            {
                e.ActionEditorState.SetDisplayName("↑");
            }
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
    }
}
