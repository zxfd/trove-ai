#!/bin/sh
set -eu

umask 077

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
backup_root=${TROVE_BACKUP_ROOT:-/Users/gin/nas/backups/trove-ai}
stamp=$(date '+%Y%m%d-%H%M%S')
backup_dir="$backup_root/$stamp"

cd "$repo_root"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Refusing to back up an uncommitted tracked worktree." >&2
  echo "Commit or intentionally discard tracked changes first." >&2
  exit 1
fi

branch=$(git symbolic-ref --quiet --short HEAD) || {
  echo "Refusing to back up a detached HEAD." >&2
  exit 1
}
commit=$(git rev-parse HEAD)

mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
touch "$backup_dir/INCOMPLETE"

docker compose exec -T postgres pg_dump \
  -U trove \
  -d trove \
  --format=custom \
  --compress=6 \
  --no-owner \
  --no-acl \
  > "$backup_dir/postgresql.dump"

docker compose exec -T postgres pg_restore --list \
  < "$backup_dir/postgresql.dump" \
  > /dev/null

install -m 600 .env "$backup_dir/.env"
install -m 600 backend/app/config_store.json "$backup_dir/config_store.json"

git bundle create "$backup_dir/trove-ai.bundle" "$branch"
git bundle verify "$backup_dir/trove-ai.bundle" > /dev/null

printf '%s\n' \
  "created_at=$(date '+%Y-%m-%dT%H:%M:%S%z')" \
  "branch=$branch" \
  "commit=$commit" \
  "database=postgresql.dump" \
  "code=trove-ai.bundle" \
  > "$backup_dir/MANIFEST"

(
  cd "$backup_dir"
  shasum -a 256 \
    postgresql.dump \
    .env \
    config_store.json \
    trove-ai.bundle \
    MANIFEST \
    > SHA256SUMS
)

rm "$backup_dir/INCOMPLETE"
echo "Backup complete: $backup_dir"
