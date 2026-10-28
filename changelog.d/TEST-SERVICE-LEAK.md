### Fixed

- With MEMEV_NO_SERVICE set, as every test sandbox sets it, Memev never calls launchctl, systemctl or schtasks: `memev service install`, `memev service remove`, `memev uninstall` and `memev doctor --fix` leave the login service alone, and doctor reports it as off. Before, running the tests on a Mac replaced the person's own login service with one pointing at a temporary folder.
