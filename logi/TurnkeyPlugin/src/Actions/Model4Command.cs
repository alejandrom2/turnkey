namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // The model at place 4 in T3 Code's picker, for the default ring's Models folder.
    public class Model4Command : SidecarCommand
    {
        public Model4Command()
            : base("model", "Model 4", "Switches the thread open in T3 Code to the model at this place in your T3 Code model picker: favorites first.", "Model", "4")
        {
        }
    }
}
