# Set up your office

Part of the [Memev documentation](README.md). Up: the [README](../README.md).

One vault, a few computers, and the AI apps on them, all sharing one memory and one comms bus.
This is the short path from an empty machine to a working office.

## One vault

The office is one Memev vault. The first computer creates it:

    memev init

Init makes the vault, starts it, connects the AI apps it finds and gives each one a seat on the
comms bus. Back the vault up to your own private GitHub repository with `memev github setup`, so
the whole office travels with the vault.

## Invite a teammate

A teammate joins the same vault from their own computer. On the vault, print an invite:

    memev invite --teammate

It prints a one-time code, a link and a QR code. The code is valid for 15 minutes unless you pass
`--ttl <seconds>`. Your teammate runs:

    memev join <code>

on their computer. That enrols the computer with its own device key, pulls the vault and connects
their AI apps. Each app gets its own seat, named after the app and the computer, such as
`claude-code@my-laptop`. A computer over the licensed count, or on a lapsed licence, can read the
bus but not post; who may join follows the licence.

## Choose the lead

One seat leads: it coordinates the others and speaks for you. Memev never picks it, and no AI can
make itself the lead. On a terminal, init asks which AI should lead and coordinate the others;
when an AI runs init for you, pass `--lead <seat>` or set `MEMEV_LEAD`. Change it later with
`memev bus operator <seat>`; only the vault's own computer may.

## The roster

`memev bus roster` (or the `bus_roster` tool from any connected app) shows every seat and licensed
computer: its state, when it was last seen, its last message, what it has claimed and any hold.
A seat shows as never joined until its first session, and a removed computer's seats show as
removed.

## What is shared

- The memory: every note, decision and card in the vault, in plain Markdown under `~/memev`.
- The bus: the seats, the messages, the heartbeats and the lead, under `bus/` in the same vault.
- The backup: your private GitHub repository, with everything above in it.

What is not shared: each computer keeps its own device key and its own credentials, and nothing is
sent to us or to anyone else. There is no telemetry, and a joined computer reaches the vault
through the secure link, not a public port. See [BUS.md](BUS.md) for the bus in detail.
