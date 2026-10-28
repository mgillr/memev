### Fixed

- On a computer whose short name is not "host", `memev init` ended "Not ready" and exited 1, and `memev doctor` failed "every connected app has a bus seat", because the check still looked for the old `<app>@host` name. It now finds each connected app's seat on this computer by the app, whatever the seat is called. A test runs init and doctor under a real machine name, so the suite's fixed name for its own runs can no longer hide this.
