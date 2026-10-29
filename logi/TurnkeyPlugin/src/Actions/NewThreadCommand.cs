namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // Starts a thread in the open thread's project and opens it in T3 Code.
    public class NewThreadCommand : SidecarCommand
    {
        public NewThreadCommand()
            : base("newThread", "New Thread", "Starts a new thread in the project of the thread open in T3 Code, and opens it there to type.", "Threads")
        {
        }
    }
}
