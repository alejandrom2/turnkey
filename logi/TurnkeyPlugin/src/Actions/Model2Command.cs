namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // The model at place 2 in T3 Code's picker, for the default ring's Models folder.
    public class Model2Command : SidecarCommand
    {
        public Model2Command()
            : base("model", "Model 2", "Switches the thread open in T3 Code to the model at this place in your T3 Code model picker: favorites first.", "Model", "2")
        {
        }
    }
}
