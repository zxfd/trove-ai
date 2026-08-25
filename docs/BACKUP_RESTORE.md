# Trove AI backup and restore

The deployment backup is created by `scripts/backup.sh`. By default it writes a
timestamped directory under `/Users/gin/nas/backups/trove-ai`. Set
`TROVE_BACKUP_ROOT` to place it on another mounted backup disk.

Each completed backup contains:

- `postgresql.dump`: logical PostgreSQL backup created by `pg_dump --format=custom`.
- `.env`: deployment secrets and service-token mapping.
- `config_store.json`: persisted LLM and embedding settings.
- `trove-ai.bundle`: the current committed Git branch and its history.
- `MANIFEST` and `SHA256SUMS`: source revision and integrity checks.

The script refuses to run when tracked changes are uncommitted. It does not copy
Docker `pgdata`, because a logical dump is the portable recovery source.

## Create and verify a backup

```sh
cd /Users/gin/nas/docker/trove-ai
scripts/backup.sh

cd /Users/gin/nas/backups/trove-ai/<timestamp>
shasum -a 256 -c SHA256SUMS
```

## Restore the code and configuration

Restore into a separate directory first so the live checkout is not overwritten:

```sh
git clone -b local/acceptance-fixes \
  /Users/gin/nas/backups/trove-ai/<timestamp>/trove-ai.bundle \
  /Users/gin/nas/docker/trove-ai-restored

install -m 600 /Users/gin/nas/backups/trove-ai/<timestamp>/.env \
  /Users/gin/nas/docker/trove-ai-restored/.env

install -m 600 \
  /Users/gin/nas/backups/trove-ai/<timestamp>/config_store.json \
  /Users/gin/nas/docker/trove-ai-restored/backend/app/config_store.json
```

Review the restored checkout and Compose configuration before replacing the live
deployment.

## Restore PostgreSQL

Database restore replaces current Trove data. Stop the services that write to the
database, keep PostgreSQL running, and verify the selected backup before running it:

```sh
cd /Users/gin/nas/docker/trove-ai
docker compose stop backend frontend wechat-bot

docker compose exec -T postgres pg_restore \
  --list \
  < /Users/gin/nas/backups/trove-ai/<timestamp>/postgresql.dump

docker compose exec -T postgres pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  --exit-on-error \
  -U trove \
  -d trove \
  < /Users/gin/nas/backups/trove-ai/<timestamp>/postgresql.dump

docker compose up -d
```

After restore, verify login, AI configuration, article counts, embedding dimensions,
the Obsidian sync token, and the WeChat worker before treating recovery as complete.
