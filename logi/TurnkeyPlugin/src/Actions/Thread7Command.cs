namespace Loupedeck.TurnkeyPlugin
{
    using System;

    // The thread at place 7 on T3 Code's board, in the order Stream Deck's Thread key shows with its default settings.
    public class Thread7Command : SidecarCommand
    {
        public Thread7Command()
            : base("thread", "Thread 7", "Shows the thread at this place on your T3 Code board, most urgent first. Choose it to open that thread; on a keypad, hold it to select the thread without opening it.", "Threads", "7")
        {
        }
    }
}
