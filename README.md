# Relay Rewards Controller

A backend service for the [ANYONE Protocol](https://anyone.io) that drives
**relay reward distribution rounds**. On a fixed interval it scores every
verified relay in the network, submits those scores to the on-chain
(AO / Arweave) Relay Rewards process, finalizes the round, and permanently
archives a summary of the distribution to Arweave.

It is a [NestJS](https://nestjs.com) application backed by Redis (job queues),
MongoDB (uptime tracking and round state), and Consul (leader election for
running multiple replicas safely).

> **Scope:** this service handles **relay** rewards only. Staking rewards are
> handled by a separate sibling service, the `staking-rewards-controller`. The
> HODLER contract exposes both locks and stakes; this controller reads locks
> (for relay reward eligibility) and ignores the staking data.

---

## What it does

Relays in the ANYONE network earn rewards based on the bandwidth and quality of
service they provide. This controller is the off-chain orchestrator that
calculates how much each relay should earn each round and feeds that into the
on-chain reward logic. It does **not** decide reward amounts itself — it
gathers and shapes the inputs (the "scores"), and the on-chain Relay Rewards
process computes the actual token distribution from them.

### Round lifecycle

Each round runs on a timer (`ROUND_PERIOD_SECONDS`, 1 hour in production) and
proceeds through a chained set of BullMQ jobs:

1. **Start distribution** — gather the inputs for the round
   ([`DistributionService.getCurrentScores`](src/distribution/distribution.service.ts)):
   - Fetch running relays and their consensus weight from an Onionoo-style
     network details endpoint (`ONIONOO_DETAILS_URI`).
   - Fetch verified fingerprints and registered hardware from the
     **Operator Registry** AO process (`OPERATOR_REGISTRY_PROCESS_ID`).
   - Fetch token **locks and stakes** from the **HODLER** Ethereum contract
     (`HODLER_CONTRACT_ADDRESS`) to determine reward eligibility.
   - Look up each relay's geo-location as an [H3](https://h3geo.org) hex cell
     via the Anyone API (`ANYONE_API_URL`) to compute location diversity.
   - Track per-relay uptime in MongoDB and compute multi-day uptime streaks.
   - Produce a `ScoreData` record per eligible relay.
2. **Add scores** — the scores are split into batches (420 per job) and each
   batch is sent to the Relay Rewards AO process via an `Add-Scores` message.
3. **Complete round** — once all score batches succeed, a `Complete-Round`
   message finalizes the round on-chain.
4. **Persist last round** — the final round snapshot is fetched back from the
   process and uploaded to Arweave as a tagged `distribution/summary` document
   via the ArDrive Turbo bundler.

The whole chain is modeled as a BullMQ [flow](https://docs.bullmq.io/guide/flows)
so later steps only run after their children succeed
(see [`TasksService.DISTRIBUTION_FLOW`](src/tasks/tasks.service.ts)).

### What goes into a score

Each [`ScoreData`](src/distribution/schemas/score-data.ts) record carries the
signals the on-chain reward formula consumes:

| Field          | Meaning                                                         |
| -------------- | --------------------------------------------------------------- |
| `Fingerprint`  | Relay identity                                                  |
| `Address`      | Verified operator EVM address                                   |
| `Network`      | Consensus weight (bandwidth contribution)                       |
| `IsHardware`   | Whether the relay runs on registered ANYONE hardware            |
| `ExitBonus`    | Whether the relay carries the `Exit` flag                       |
| `UptimeStreak` | Consecutive days meeting the uptime threshold                   |
| `FamilySize`   | Size of the relay's effective family (minus self)               |
| `LocationSize` | Number of other relays sharing the same H3 geo cell (minus self)|

A relay is only scored if it is running with non-zero consensus weight, has a
verified operator address, and is reward-eligible under HODLER (registered
hardware, or an operator lock matching the verified address).

---

## Architecture

```
                          ┌──────────────────────────────┐
                          │  Onionoo details endpoint    │  relays + consensus weight
                          │  Operator Registry (AO)      │  verified fingerprints / hardware
   inputs ──────────────▶│  HODLER contract (Ethereum)  │  locks + stakes (eligibility)
                          │  Anyone API (fingerprint-map)│  geo / H3 cells
                          └──────────────┬───────────────┘
                                         │
                          ┌──────────────▼───────────────┐
                          │  Relay Rewards Controller    │
                          │  (NestJS)                    │
                          │  • Redis / BullMQ job flow   │
                          │  • MongoDB uptime + state    │
                          │  • Consul leader election    │
                          └──────────────┬───────────────┘
                                         │
                          ┌──────────────▼──────────────┐
   outputs ─────────────▶│  Relay Rewards process (AO) │  Add-Scores / Complete-Round
                          │  Arweave (Turbo bundler)    │  distribution/summary snapshot
                          └─────────────────────────────┘
```

### Key modules (`src/`)

| Module               | Responsibility                                                             |
| -------------------- | -------------------------------------------------------------------------- |
| `tasks/`             | Schedules rounds, defines the BullMQ queues/flow, and the queue processors |
| `distribution/`      | Round orchestration: scoring, uptime streaks, geo cells, snapshot persist  |
| `relay-rewards/`     | Talks to the Relay Rewards AO process and the HODLER Ethereum contract     |
| `operator-registry/` | Reads verified fingerprints / hardware from the Operator Registry process  |
| `bundling/`          | Uploads round summaries to Arweave via the ArDrive Turbo SDK               |
| `geo-ip/`            | Caches the Anyone API fingerprint-to-location map for H3 lookups           |
| `cluster/`           | Node `cluster` worker forking + Consul-based leader election               |
| `util/`              | AO messaging, Ethereum data-item signing, arbundles helpers                |

### Clustering & leader election

The service is designed to run as multiple replicas without doing duplicate
work. There are two layers:

- **Process threads** — `AppThreadsService` forks `CPU_COUNT` Node `cluster`
  workers; only the first fork is the **local leader**
  (`IS_LOCAL_LEADER=true`).
- **Instance leader** — across replicas, `ClusterService` acquires a lock in
  Consul (`clusters/<service>/leader`) using a renewing session. Only the local
  leader of the instance that holds the Consul lock (`isTheOne()`) actually
  bootstraps and drives distribution rounds.

When not live (`IS_LIVE !== 'true'`) or when Consul isn't configured, the
service falls back to single-node mode and treats itself as the leader.

---

## Configuration

All configuration is via environment variables (loaded by `@nestjs/config`).
In production these are injected by Nomad + Vault + Consul KV (see
[`operations/`](operations/)).

### Core

| Variable               | Description                                                           |
| ---------------------- | --------------------------------------------------------------------- |
| `IS_LIVE`              | `true` enables on-chain writes, Arweave persistence, and Consul. Anything else runs in dry-run / single-node mode. |
| `VERSION`              | Build/version label for logging                                       |
| `PORT`                 | HTTP port for the `/health` endpoint (default `3000`)                 |
| `CPU_COUNT`            | Number of Node `cluster` workers to fork (default `1`)                |
| `ROUND_PERIOD_SECONDS` | Minimum seconds between distribution rounds (production: `3600`)      |
| `DO_CLEAN`            | `true` obliterates the queues and round state on leader bootstrap      |

### Data sources

| Variable                      | Description                                                 |
| ----------------------------- | ----------------------------------------------------------- |
| `ONIONOO_DETAILS_URI`         | Network details endpoint (relays + consensus weight)        |
| `DETAILS_URI_AUTH`            | Optional `Authorization` header value for the details call  |
| `ANYONE_API_URL`              | Base URL of the Anyone API serving `/fingerprint-map`       |
| `ANYONE_API_CACHE_TTL`        | Geo map cache TTL in ms (default `3600000`)                 |

### On-chain / AO

| Variable                       | Description                                             |
| ------------------------------ | ------------------------------------------------------- |
| `USE_HODLER`                   | Must be `true`. Enables the HODLER eligibility + contract path. |
| `RELAY_REWARDS_PROCESS_ID`     | AO process id for relay rewards                          |
| `RELAY_REWARDS_CONTROLLER_KEY` | EVM private key used to sign AO messages                 |
| `OPERATOR_REGISTRY_PROCESS_ID` | AO process id for the operator registry                  |
| `HODLER_CONTRACT_ADDRESS`      | HODLER Ethereum contract address                         |
| `JSON_RPC`                     | Ethereum JSON-RPC URL for reading the HODLER contract    |
| `CU_URL`                       | AO Compute Unit URL used by `aoconnect`                  |

> **A note on `USE_HODLER`:** this flag is a leftover from the migration to the
> HODLER staking model. HODLER is now the only supported path going forward, so
> it should always be set to `true`. The non-HODLER code paths are legacy.

### Arweave bundling

| Variable                | Description                                                   |
| ----------------------- | ------------------------------------------------------------- |
| `BUNDLER_CONTROLLER_KEY`| EVM private key used to sign Arweave data items (Turbo)       |
| `BUNDLER_NODE`          | Turbo upload service URL (e.g. `https://upload.ardrive.io`)   |
| `BUNDLER_GATEWAY`       | Arweave gateway URL (e.g. `https://ar.anyone.tech`)           |
| `BUNDLER_NETWORK`       | Bundler network identifier                                    |

### MongoDB

| Variable    | Description                      |
| ----------- | -------------------------------- |
| `MONGO_URI` | MongoDB connection string        |

### Redis / BullMQ

| Variable                  | Description                                             |
| ------------------------- | ------------------------------------------------------- |
| `REDIS_MODE`              | `standalone` (default) or `sentinel`                    |
| `REDIS_HOSTNAME`          | Host (standalone mode)                                  |
| `REDIS_PORT`              | Port (standalone mode)                                  |
| `REDIS_MASTER_NAME`       | Sentinel master name (sentinel mode)                    |
| `REDIS_SENTINEL_{1,2,3}_HOST` / `_PORT` | Sentinel node addresses (sentinel mode)   |

### Consul (clustering)

| Variable                          | Description                                       |
| --------------------------------- | ------------------------------------------------- |
| `CONSUL_HOST` / `CONSUL_PORT`     | Consul agent address                              |
| `CONSUL_SERVICE_NAME`             | Service name used for the leader-election key     |
| `CONSUL_TOKEN_CONTROLLER_CLUSTER` | Consul ACL token                                  |
| `IS_LOCAL_LEADER`                 | Set automatically by the cluster forker           |

---

## Development

Prerequisites: Node.js (LTS), npm, Docker.

1. **TLS CA cert** (if using an internal endpoint requiring it):
   ```bash
   export NODE_EXTRA_CA_CERTS=$(pwd)/admin-ui-ca.crt
   ```

2. **Redis** (BullMQ queues):
   ```bash
   docker run --name validator_dev_redis -p 6379:6379 redis:7.2
   ```

3. **MongoDB** (uptime + round state):
   ```bash
   docker run --name validator_dev_mongo -p 27017:27017 mongo:5.0
   ```

   Alternatively, `docker compose up mongo redis` brings up both
   (see [`docker-compose.yml`](docker-compose.yml)).

4. **Install dependencies:**
   ```bash
   npm install
   ```

5. **Run in watch mode:**
   ```bash
   npm run start:dev
   ```

   Provide the required environment variables (see [Configuration](#configuration)).
   Leaving `IS_LIVE` unset runs in single-node, dry-run mode: rounds are
   computed and logged but no AO messages or Arweave uploads are sent.

The service exposes a health check at `GET /health` (and `GET /`).

### Testing

```bash
npm test            # run unit tests (*.spec.ts)
npm run test:watch  # watch mode
npm run test:cov    # with coverage
```

### Build

```bash
npm run build       # nest build -> dist/
npm run start:prod  # node dist/main
```

---

## Deployment

Production runs on **Nomad** in the `live-protocol` / `stage-protocol`
namespaces. The Docker image is published to
`ghcr.io/anyone-protocol/relay-rewards-controller` by the GitHub Actions release
workflow ([`.github/workflows/release-action.yml`](.github/workflows/release-action.yml)),
and deployed via the job specs in [`operations/`](operations/):

| File                                                  | Purpose                          |
| ----------------------------------------------------- | -------------------------------- |
| `relay-rewards-controller-live.hcl`                   | Live controller job              |
| `relay-rewards-controller-stage.hcl`                  | Staging controller job           |
| `relay-rewards-controller-redis-sentinel-live.hcl`    | Live Redis Sentinel cluster      |
| `relay-rewards-controller-redis-sentinel-stage.hcl`   | Staging Redis Sentinel cluster   |

In production the controller runs with `count = 2` replicas behind a Consul
leader lock, Redis in `sentinel` mode, secrets sourced from Vault, and process
ids / addresses sourced from Consul KV. Only the elected leader drives rounds;
the others stand by to take over.

---

## License

[AGPL-3.0-only](LICENSE)
</content>
</invoke>
