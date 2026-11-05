### Fixed

- The leak scan's exemption for this repository's own URL no longer applies when the URL sits inside another URL, for
  example after `?u=` in a query string. Only the start of a line, a space, a quote, a backtick or an opening bracket may
  come before it.
