### Fixed

- The test that doctor shows no two-vaults warning with a single vault now holds the 99 ports above its vault with listeners of its own while it runs. Before, another test's daemon started in that range by a test running side by side answered doctor's probe and failed the test at random.
