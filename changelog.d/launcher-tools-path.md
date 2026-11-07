### Added

- An installer that bundles its own tools, such as git, names their folders in `MEMEV_TOOLS_PATH` at install, and the launcher
  the core writes puts them first on `PATH`. The core run by an AI app or by the login service then uses the bundled git, not the
  computer's (on a new Windows PC there is none; on a Mac without the developer tools there is only Apple's stub).
