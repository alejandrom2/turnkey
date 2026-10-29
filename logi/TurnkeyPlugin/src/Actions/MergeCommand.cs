namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // Merges the open fork back; a keypad needs a hold, a Ring click is itself the confirmation.
    public class MergeCommand : SidecarCommand
    {
        public MergeCommand()
            : base("merge", "Merge back", "Merges the fork open in T3 Code back into the thread it came from, and opens that thread. On a keypad, hold it.", "Threads")
        {
        }
    }
}
