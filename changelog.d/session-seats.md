### Added

- Each live session of an app on one computer is its own bus seat, with no setup. The first keeps the plain seat
  (`claude-code@my-laptop`); each further live session takes `/2`, `/3` and so on, and a sub-seat comes free once its
  session has been gone longer than the roster's live window. A resume keeps the seat. Unread messages, read
  positions, holds and comms-check answers are per seat, `to: all` reaches every session, and a session posts only as
  its own seat. The hooks name the session, and the session's MCP server finds it through the app process the two
  share, so the AI's own bus calls post as the session's seat. For the apps connected with hooks (Claude Code, Codex
  CLI, Gemini CLI, Cursor); apps connected with instructions only keep one seat.
- Background agents on sub-seats: `memev runner on <app> --agents N --max-runs-per-day M` turns on runners for N
  sub-seats, each with its own pid file, cursor, limit and task list; `memev runner watch <app>` watches them all, and
  each headless turn posts as its runner's seat.
