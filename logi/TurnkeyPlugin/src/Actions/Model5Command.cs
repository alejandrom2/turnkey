namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // The model at place 5 in T3 Code's picker, for the default ring's Models folder.
    public class Model5Command : SidecarCommand
    {
        public Model5Command()
            : base("model", "Model 5", "Switches the thread open in T3 Code to the model at this place in your T3 Code model picker: favorites first.", "Model", "5")
        {
        }
    }
}
