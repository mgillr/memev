# Remote setup session

Part of the [Memev documentation](README.md). Up: the [README](../README.md).

A remote setup session lets the Memev operator finish your setup over a
secure connection that you start. You run one command with a setup code the
operator gives you. The command opens an outbound connection to the operator,
verifies both sides, and then the operator can run a short list of Memev
commands on your install only.

## What it is

- You start it. Nothing runs unless you start it.
- It needs no inbound port. The connection goes out from your computer.
- It ends by itself after a time limit, or when the operator finishes, or
  when you stop it.
- The operator can only run a fixed list of commands: doctor, status,
  deployment show and set, license status and install, devices list,
  connect, ready, and reading the session log.
- The operator cannot run a shell, read or write files outside your vault,
  or read environment variables or secrets.
- Every request, result, and refusal is written to a log on your computer.
  You can read it at any time.

## How to start it

Run:

    memev setup remote --code <setup-code>

The setup code comes from the operator. It is one-time: it works once and
then it is gone. The session runs in the foreground in your terminal. You
see every line of the log as it happens.

## How to stop it

Press Ctrl-C in the terminal where the session is running, or from a second
terminal run:

    memev setup remote stop

Both close the session at once. The command that is running finishes or is
cancelled cleanly. After the session ends, the operator cannot send another
command.

## Where the log is

The log is at `.memev/setup-sessions/<session-id>.log` in your vault. Each
line is one JSON entry with a hash chain, so you can check that no one
changed it. To print the log and check the chain:

    memev setup remote log [<session-id>]

The log stays on your computer. It is never sent anywhere.

## No telemetry

This feature adds no reporting. Nothing is sent to any server except the
operator's session host, and only while the session is running. If you turn
on the milestone report separately, the session log is not part of it.

## No security approval

This feature has not been approved by a third party. It uses standard
encryption primitives from Node.js. Read the code if you want to check the
handshake and the allowlist.

## Setup without a remote session

If you do not want a remote session, you can set up Memev in a container.
See [docs/DOCKER.md](DOCKER.md) for the container install, which needs no
remote session at all.
