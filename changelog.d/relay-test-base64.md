### Changed

- The relay test no longer fails by chance when a random nonce or signature happens to hold a short string it searches for. It still checks every other control field for that string.
