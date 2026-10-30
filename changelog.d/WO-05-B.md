### Added

- The paid engine flag (merge.paid, off by default on every install): when it is on and the licence allows it, a same-note conflict goes to the external merge engine as a separate process the install points at, and the merged note lands at the path.
- Any refusal, failure or timeout of the engine falls back to the free behaviour: both versions are kept whole and a line names the reason. With the flag off, or the paid client module absent, the free behaviour runs and nothing leaves the computer.
