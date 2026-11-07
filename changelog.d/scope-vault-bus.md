### Fixed

- The scope check no longer counts a vault's own `bus/` folder when the vault is the contract's workdir. Opening a vault seeds that folder, so every contract with no workdir failed its scope criterion on a checkout that is also its vault. A project repository that tracks a `bus/` folder is still judged on it.
