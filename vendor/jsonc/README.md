# jsonc-parser (vendored)

Reads and edits JSON with comments and trailing commas (JSONC), the format VS Code, Zed and Gemini CLI
use for their settings. Memev uses it to add and remove its own entry without touching the rest of
the file.

From jsonc-parser 3.3.1, MIT licence (`LICENSE.md`, unchanged): the files of `lib/esm` in
https://registry.npmjs.org/jsonc-parser/-/jsonc-parser-3.3.1.tgz, whose npm integrity is
`sha512-HUgH65KyejrUFPvHFPbqOY0rsFip3Bo5wb4ngvdi1EpCYWUQDC5V+Y7mZws+DLkr4M//zQJoanu1SP+87Dv1oQ==`.
Memev does not download or depend on the package; these files are the whole of it.

Two changes, made to every file and said at its top: a first line naming the source, and relative
imports end in `.js`, which Node's ES module loader needs. Without those two changes each file has
the SHA-256 below, which `test/jsonc.test.mjs` checks:

72ff182105e158a1505ca3ecbf3f30359abb138a3980edaef1db7f4010ffb7dc  main.js
7e7bf98e740f560026df079056d3b0f5f34628124a8d34e2765fb101dde12911  impl/edit.js
e57dee56700a844b18dea11548f9ba42b17bc857bde5bcd39554af06ca95bb1f  impl/format.js
74fae1bbebf290a04e46c5457ac5d97988146a5503ea35d9f0c4c3768acd5a26  impl/parser.js
e737e1774f87ca88d85d73e3bafff688b78cac06b81c53b96c54da8b3ca86cd9  impl/scanner.js
3a0aad3f56c3e0728812c7584568c0ff200bce1ca58cf40e946f01fdb54c5752  impl/string-intern.js
