namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // Opens the open thread's folder in T3 Code's default editor, as Stream Deck's Open does with no Editor setting.
    public class OpenEditorCommand : SidecarCommand
    {
        public OpenEditorCommand()
            : base("open", "Open in editor", "Opens the folder of the thread open in T3 Code in your editor: its worktree, else its project's folder.", "Threads", "editor")
        {
        }
    }
}
