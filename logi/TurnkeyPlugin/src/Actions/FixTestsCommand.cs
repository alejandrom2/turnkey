namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // Asks the thread open in T3 Code to run the tests and fix any failures.
    public class FixTestsCommand : SidecarCommand
    {
        public FixTestsCommand()
            : base("prompt", "Fix tests", "Sends a prompt to the thread open in T3 Code.", "Prompts", "test")
        {
        }
    }
}
