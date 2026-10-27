#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Runs every Memev CLI command once in a throwaway home folder and saves the output, for the lab test
# plan (docs/testing/LAB-TEST-PLAN.md, section 5). Nothing outside the temporary folder is touched:
# no login service, no tunnel, no download, no background jobs. Fake app folders stand in for
# installed AI apps so registration can be checked.
#   sh scripts/lab/cli-walk.sh [OUTDIR]
set -u
REPO=$(cd "$(dirname "$0")/../.." && pwd)
OUT=${1:-$(mktemp -d "${TMPDIR:-/tmp}/memev-cli-walk-XXXXXX")}
mkdir -p "$OUT"
LAB=$(mktemp -d "${TMPDIR:-/tmp}/memev-lab-home-XXXXXX")
export HOME="$LAB" XDG_CONFIG_HOME="$LAB/.config" MEMEV_CONFIG_DIR="$LAB/.config/memev" MEMEV_ROOT="$LAB/memev"
export MEMEV_NO_SERVICE=1 MEMEV_NO_TUNNEL=1 MEMEV_NO_BACKGROUND=1 MEMEV_NO_DOWNLOAD=1 GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=lab GIT_AUTHOR_EMAIL=lab@example.invalid GIT_COMMITTER_NAME=lab GIT_COMMITTER_EMAIL=lab@example.invalid
mkdir -p "$HOME/.claude" "$HOME/.codex" "$HOME/.gemini" "$HOME/.cursor"
M="node $REPO/bin/memev.mjs"
n=0; failed=0
run() { # run ID EXPECTED_EXIT command...
  id=$1; want=$2; shift 2; n=$((n + 1))
  "$@" > "$OUT/$id.txt" 2>&1; got=$?
  if [ "$got" = "$want" ]; then r=PASS; else r=FAIL; failed=$((failed + 1)); fi
  printf '%s\t%s\texit %s (want %s)\t%s\n' "$r" "$id" "$got" "$want" "$*" | tee -a "$OUT/summary.tsv"
}
run C01-version 0 $M --version
run C02-help 0 $M help
run C03-init 0 $M init --local-only --port "${MEMEV_LAB_PORT:-7797}"
run C04-clients 0 $M clients
run C05-status 0 $M status
run C06-doctor 0 $M doctor
run C07-remember 0 $M remember "We deploy the billing API with blue-green releases" --kind decision --project billing --why "downtime breaks invoicing"
run C08-remember-junk 0 $M remember "ok thanks"
run C09-remember-dated 0 $M remember "For now the upload test is skipped in the release branch" --kind note --project billing
run C10-recall 0 $M recall "how do we deploy billing" --project billing
run C11-recall-other-project 0 $M recall "how do we deploy billing" --project search
run C12-recall-all-projects 0 $M recall "how do we deploy billing" --project search --all-projects
run C13-why 0 $M why "how do we deploy billing" --project billing
run C14-review 0 $M review
run C15-audit 0 $M audit
run C16-checkpoint 0 $M checkpoint --project billing --task "release 2.1" --done "tests green" --doing "changelog" --next "tag,announce"
run C17-card 0 $M card --project billing
run C18-claims 0 $M claims
run C19-token-issue 0 $M token issue lab-app --scopes read
run C20-token-list 0 $M token list
run C21-devices 0 $M devices
run C22-devices-keygen 0 $M devices keygen
# exit 1 on purpose: with no licence the vault is licensed for 1 computer, so a second is refused
run C23-devices-enroll-refused 1 $M devices enroll --kind remote-computer --label lab-laptop --pubkey-file "$MEMEV_CONFIG_DIR/keys/device-ed25519.pem.pub"
run C24-license-status 0 $M license status
run C25-license-status-json 0 $M license status --json
run C26-cloud-status 0 $M cloud status
run C27-contract-list 0 $M contract list
run C28-verify 0 $M verify
run C29-gate 0 $M gate --workdir "$LAB"
run C30-doctor-bundle 0 $M doctor --bundle
run C31-upgrade-not-a-command 2 $M upgrade
run C32-disconnect-cursor 0 $M disconnect cursor
run C33-connect-cursor 0 $M connect cursor
run C34-stop 0 $M stop
run C35-uninstall 0 $M uninstall --purge
echo "$n commands, $failed unexpected exit codes. Output: $OUT"
rm -rf "$LAB"
[ "$failed" = 0 ]
