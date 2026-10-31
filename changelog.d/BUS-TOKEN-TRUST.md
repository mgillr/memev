### Security

- On this computer an app's token now names the app, whatever client header a request sends. Before, any local token that sent the header of the terminal could set the bus lead, even a read-only token limited to one folder with no bus access, and while no lead was set any local token could pick the first one through the seat-registration call. Only the CLI picks a lead now.
- An app posts on the bus only as its own seat. Before, any app on this computer could post as another app's seat, the lead's included, and its message carried the lead's authority to a runner turned on for another seat. A remote computer's device token still serves every app on that computer.
