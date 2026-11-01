# Commits this fixture tree the way the red-team gate tests expect: first everything except the
# red-team record, at a fixed date, so the record can name that commit as the one the reviewer read;
# then any later change the case needs; then the record. Usage: sh build.sh [base|rest]
set -e
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t.invalid GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t.invalid
export GIT_AUTHOR_DATE='2026-01-01T00:00:00+0000' GIT_COMMITTER_DATE='2026-01-01T00:00:00+0000'
if [ "$1" != rest ]; then
  git add -A -- . ':(glob,exclude)contracts/*/redteam/**'
  git -c commit.gpgsign=false commit -q -m 'the tree the reviewer read'
fi
if [ "$1" = base ]; then exit 0; fi
git add -A
git -c commit.gpgsign=false commit -q --allow-empty -m 'red-team record'
