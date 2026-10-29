namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // The model at place 6 in T3 Code's picker, for the default ring's Models folder.
    public class Model6Command : SidecarCommand
    {
        public Model6Command()
            : base("model", "Model 6", "Switches the thread open in T3 Code to the model at this place in your T3 Code model picker: favorites first.", "Model", "6")
        {
        }
    }
}
