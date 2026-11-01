# Agent identity

Part of the [Memev documentation](README.md). Up: the [README](../README.md).

A person can vouch for an agent role: that the person holding one SSH key, under one principal,
vouched for one role name and that role's public key. The vouch is a signature in the OpenSSH
standard, made with `ssh-keygen -Y sign` and checked with `ssh-keygen -Y verify`. It holds offline,
and it does not carry over to another role name, another principal or another key.

## Commands

- `memev agentid setup <role> --principal <who> --ssh-key <path>` makes the role's key pair when it
  is absent, binds it to the person, and writes the receiver-side trust line. It prints the role, the
  principal, and where the three verification files are.
- `memev agentid bind <role> --principal <who> --ssh-key <path>` binds an existing role's public key
  to the person. It prints the role, the principal, and where the signature is.
- `memev agentid verify <role> --principal <who> --allowed-signers <file>` checks a stored binding.
  It prints the role, the principal, and the status: `bound`, `invalid` or `unbound`.

Every command takes `--json`, which prints one JSON object with `ok` and the fields the text form
names.

## Tiers

Binding and setup are part of Business and Corporate (coming). On a Personal, Personal with more
computers, or no-licence install they refuse in one line and name `memev upgrade`. Verification is
free on every install, because the point of the feature is that a third party checks a binding
without a licence.

## Third-party verification

A verifier needs only three things, and nothing else:

1. the role's public key, `<role>.pub`;
2. its signature, `<role>.pub.sshsig`;
3. an `allowed_signers` file with the principal's line.

The verifier runs `ssh-keygen -Y verify` against those three, with the binding message on standard
input, and is offline: no network, no Memev, no licence. The signed message names the role, the
principal and the role's public key, so a copied binding under another name does not verify.

## Exit codes

- `0` the command succeeded, or the verification reported `bound`;
- `1` a failed verification (`invalid` or `unbound`), a tier refusal, or any other failure;
- `2` a usage error.
