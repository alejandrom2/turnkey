namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // A prompt the user types when placing the action, sent to the thread open in T3 Code; each placed copy keeps its own.
    // A profile action, not an action editor one: Options+ asks a command for its image, so it shows Send's arrow.
    public class SendPromptCommand : SidecarCommand
    {
        public SendPromptCommand()
            : base("send", "Send prompt", "Sends the prompt you write here to the thread open in T3 Code.", "Prompts")
        {
            this.MakeProfileAction("text;Prompt to send:");
        }
    }
}
