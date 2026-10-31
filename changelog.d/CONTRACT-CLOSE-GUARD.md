### Security

- Only `memev contract verify` writes `contracts/closed/` and `contracts/receipts/`, and no token writes those or `contracts/signed/` and `contracts/keys/` in any letter case. Before, any write token, a remote device token included, could mark a signed contract done by writing one file, and on a case-insensitive disk `contracts/Signed/` overwrote a signed contract.
- A contract signature must name a key id of the form memev makes and must be over the contract it is checked for. Before, a key id such as `../drafts/k` made the check trust a key file any contracts token can write, and a second contract's signed files copied over the first passed.
- A newer version retires the contract it supersedes only once it was signed on this computer and its own verify passed, and a contract with no task is never signed. Before, signing an empty draft that named a contract took that contract out of the session gate and the push gate.
