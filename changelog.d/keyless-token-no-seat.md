### Fixed

- A remote token with no device key no longer fills a computer seat. The server already refuses such a token from another computer, so it could only use up a seat that a real computer needed. Computers with a device key are counted and capped as before.
