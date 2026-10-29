namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // The thread that needs you most, as a color and an icon; choosing it opens the thread in T3 Code.
    public class MostUrgentCommand : SidecarCommand
    {
        public MostUrgentCommand()
            : base("urgent", "Most urgent thread", "Shows what needs you in T3 Code. Choose it to open that thread.", "Threads")
        {
        }
    }
}
