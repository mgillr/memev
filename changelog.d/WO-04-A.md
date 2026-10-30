### Added

- `scripts/metrics/report.mjs` renders the weekly funnel report: package downloads, release-host downloads, licence activations and, optionally, the opt-in milestone rows, each as the count per day, per week and the total, from count files handed to it as flags. It is a development tool that reports nothing anywhere and is not in the npm package file list.
- `scripts/metrics/gates.json` holds the month-6 gates (installs at or above 5,000 by month 6; free-to-paid at or above 1 percent once sync has shipped) and says which counted number stands for installs, which stays open until the owner chooses. The page header renders each gate with its measured value, threshold and pass or miss, and editing the file changes the header with no change to the program.
