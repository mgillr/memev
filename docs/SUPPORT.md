# Support

Memev needs no account, and `memev doctor` fixes most problems on its own: start with
[Troubleshooting](TROUBLESHOOTING.md).

## When you need help

Run:

```sh
memev doctor --bundle
```

It checks everything, then writes one file, `doctor-bundle-<time>.json`, in the `.memev` folder of
your vault, and prints where it is and where to send it. That file is the intake for every support
request: send it with your question, so nobody has to ask you for logs.

## What the bundle holds

- the Memev and Node versions, your operating system and processor
- the settings in `.memev/config.json`, without the vault's id
- the result of every doctor check, with its detail line
- the state of the background jobs and of the secure link, without any access token
- the names of the AI apps that are connected
- the last 200 lines of the daemon log

## What it never holds

- tokens, keys, passwords or anything that looks like one: they are replaced with `[redacted]`
- the contents of your notes
- your home folder: it is shortened to `~`
- the temporary address of a quick secure link: it is replaced with a placeholder

The file is plain JSON. Open it and read it before you send it.

## Who answers

| Plan | Support |
|---|---|
| Free | community help in the project's issue tracker, best effort, no response time |
| Personal | priority: requests that come with a bundle are answered ahead of community requests |
| Team | priority, as for Personal |

Business and Enterprise support plans, with response times, are described in
[tiers/services.md](tiers/services.md).

## Where to send it

The public support address and the place to post are not published yet. This page names them when
they are.
