### Added

- `memev connect` takes several apps in one call, for example `memev connect claude-code cursor vscode`, and connects exactly those. Every name is checked before any file changes, so an unknown name connects nothing. `memev connect` and `memev connect all` still connect every app found, and still skip the apps you disconnected. The remote setup screen can send the apps the person ticked in one command.
