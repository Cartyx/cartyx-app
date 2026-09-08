# Data infrastructure implementation evidence

Work started 2026-09-07 (local time; test timestamps cross into 2026-09-08 UTC).

## Scope

The infrastructure PR was merged and the dev data release is deployed on z440.
Follow-up infrastructure PRs added native R2 backups, restore tooling, monitoring
and rollout fixes. Production remains staged because scans of the upstream
images found unresolved high/critical dependencies; no production data release
tag has been published. The companion app startup changes are prepared separately on the
`data-local-integration` branch based on dev.
Mongo remains authoritative for every application subsystem. Atlas access was
read-only. This is progress through phases 0–3, not completion of those phases.

Infrastructure ownership: `cartyx-infrastructure` contains the chart, Docker
services, shared database configuration, operations tools, render tests, and CI.
The app contains local startup wrappers and the read-only Mongo inventory at
`scripts/mongo-inventory.mjs`. The app wrapper defaults to the sibling checkout;
`CARTYX_INFRASTRUCTURE_DIR` supports an alternate absolute path.

Runbook: [cartyx-data](https://github.com/biozal/cartyx-infrastructure/blob/main/deploy/charts/cartyx-data/README.md).

After moving infrastructure ownership, the app's `db:up` recreated the local
containers from the infrastructure checkout using the same named volume and
existing credentials. The persisted relationship, TLS rejection checks, and CQL
role isolation all passed again. Full-app Compose and dependency-only Compose
resolve identical database services and volume names; both the default sibling
path and an explicit checkout override passed. All nine chart checks, app ESLint,
Flux source/path validation, shell syntax, and the isolated dependency audit
passed. Infrastructure CI now lives in the infrastructure repository. Earlier
kind and backup drills below predate the file move; they were not rerun for a
path-only relocation. No deployment tag was published.

## Compatibility and inventory

| Component               | Selected/tested                                                               |
| ----------------------- | ----------------------------------------------------------------------------- |
| Cassandra               | Official 4.0.21 image, OCI digest pinned in chart/Compose                     |
| JanusGraph              | Official 1.1.0 image, OCI digest pinned in chart/Compose                      |
| Container architectures | OCI indexes include linux/amd64 and linux/arm64; runtime tests here use arm64 |
| JVM / server traversal  | Bundled Java 11 / TinkerPop 3.7.3                                             |
| JavaScript client       | Gremlin 3.7.6, GraphSON 3, script and bytecode traversals                     |
| Transport               | TLS-verified Gremlin and CQL, separate generated local credentials            |
| Tool dependency audit   | No vulnerabilities after pinning uuid 11.1.1 and js-yaml 4.3.2                |
| Docker resources        | Approximately 20 GiB allocated, 8 CPUs                                        |
| Local Kubernetes        | kind v0.32.0, node image kindest/node:v1.36.1                                 |

JanusGraph's [published compatibility matrix](https://docs.janusgraph.org/changelog/)
lists Cassandra 4.0 and TinkerPop 3.7. Patch choices were verified against real
images and exercised locally. The selected images also passed live amd64 functional/recovery checks. Image
scans were subsequently completed and found unresolved advisories; production
promotion remains gated on the security work described below. These functional
tests are not a production load assessment.

Both live application namespace configurations were inventoried read-only:

| Atlas environment | Collections | Documents | Logical bytes |
| ----------------- | ----------: | --------: | ------------: |
| dev               |          39 |     1,080 |     1,099,083 |
| prod              |          25 |         2 |         1,405 |

Private collection/index reports are `.local/data/inventory/dev.json` and
`prod.json`. The earlier local-env report matches dev's totals. Legacy collection
names still require explicit mapping and field/reference validation before
import. No documents were changed or removed. This is a collection/index
inventory, not a completed document-level orphan/visibility/ownership audit.

Resource limits per environment are 3 GiB Cassandra and 2 GiB JanusGraph, with
1 GiB JVM heaps and remaining headroom. Observed idle memory was roughly
1.5–1.8 GiB Cassandra and 0.6–0.7 GiB JanusGraph. These are smoke-test measurements,
not production sizing evidence. The private kind preflight report records
capacity, disk/inodes and storage-class behavior.

## Verified locally

- Docker initial bootstrap creates independent graph/state keyspaces and scoped
  roles, then disables the default Cassandra login.
- Authenticated, trusted-TLS graph queries create/read a repeatable fixture with
  two vertices and one edge, and JavaScript bytecode traversals read it back.
- Invalid/missing Gremlin credentials and an untrusted certificate are rejected.
  CQL tests prove state credentials cannot read graph tables, graph credentials
  cannot read state tables, and the default login no longer works.
- A cold backup drains/stops Cassandra, archives its full data directory with a
  checksum, and restarts the source. The fixture survives source restart.
- An independent-volume restore verifies the checksum and reads the same
  relationship from a separate Compose project on port 18183.
- Helm installs the chart in local Kubernetes with the bootstrap job complete and
  Cassandra/JanusGraph ready. The credential isolation tests also run there.
- Nine rendering tests check local/dev/prod manifests and reject unsafe replica,
  image, identifier, shared-keyspace and empty-secret settings.

The drills found and corrected two issues: startup-time role/schema propagation
needed bounded idempotent retries; Cassandra's Pod IP could become stale in the
driver after replacement. The final chart advertises a stable CQL ClusterIP and
uses a separate headless service for StatefulSet identity. JanusGraph readiness
reads through its live CQL session so cached schema cannot hide backend failure.
Revalidation passed: after installing the corrected topology, Cassandra changed
Pod IP from `10.244.0.12` to `10.244.0.14`; the existing JanusGraph pod remained
running and the same authenticated JavaScript relationship query succeeded after
Cassandra became ready. Helm revision 2 completed and the stored fixture survived
the upgrade. This is local kind evidence, not a home-cluster deployment claim.

Final static checks: repository ESLint passed; the existing app chart retained
94 passing render tests; all nine data-chart tests passed; the changed Flux
Kustomizations and Grafana dashboard/alert parsed successfully; the isolated data
tool dependency audit reported zero vulnerabilities. Application tests were not
rerun because no domain/application persistence code changed. CI is configured
to repeat the real-container checks, and remote CI has now passed repeatedly in the infrastructure repository. The
latest monitoring fix (PR #8) passed 17 tests and the full container bootstrap,
TLS/authentication, persistence, backup and independent-volume restore job.

## Home-cluster recovery and deployment

Cluster access was restored on 2026-09-08 UTC. Key-based SSH as
`labeaaa@192.168.1.222` works, including without the old HostKeyAlias. The local
`~/.kube/cartyx.yaml` uses the new address and verifies the Kubernetes TLS
certificate normally.

The outage had two configuration problems: MicroK8s was occupying k3s kubelet
and controller ports, and k3s still advertised the old node IP/TLS SAN. The
MicroK8s API contained only its three system pods and no PVCs. Its services were
stopped and disabled (installation/data retained). The k3s service unit was
backed up on the host, its two old-IP settings were updated to `192.168.1.222`,
and k3s was restarted. The API `/readyz` returned `ok`, the node became Ready,
and all running workload containers reported Ready after recovery, including
Flux, both Cartyx environments, and observability.

Live preflight: amd64 Ubuntu 26.04, k3s v1.36.2+k3s1, 36 CPU cores, about 60.7 GiB
allocatable RAM, and about 827 GiB available disk with ample free inodes. An
initial node metric sample reported 889m CPU and 6330 MiB RAM used. Existing
regular-container requests totaled about 2.43 cores / 2.78 GiB; both proposed
data environments add 1.5 cores / 7 GiB before init-container overhead. These
are initial capacity observations, not sustained database load-test results.
The private report is in
`cartyx-infrastructure/.local/data/preflight/z440.json`.

The retained `cartyx-data-retain` StorageClass is installed. Dev uses its own
30 GiB claim and credentials; production credentials are separately provisioned,
but the production HelmRelease, source and backup schedule remain suspended.
All source credentials, preflight reports and recovery archives stay out of Git.

## Live dev evidence (2026-09-08 UTC)

- Flux deployed the data chart and bootstrap successfully. Gremlin graph reads,
  bytecode traversals, trusted TLS, invalid/missing credentials, CQL role
  isolation and disabled default Cassandra login all passed.
- Real k3s NetworkPolicy checks passed for allowed data pods, allowed Gremlin
  clients, denied unlabeled clients, and denied cross-namespace clients.
- Cassandra changed Pod IP from `10.42.0.25` to `10.42.0.31` while JanusGraph's
  existing pod remained running. The graph relationship survived and could be
  read through the stable CQL service. Subsequent chart revisions also retained
  the same source PVC.
- Native cold backup suspends the environment's Flux/Helm reconciliation,
  stops graph writers, drains/stops Cassandra, and archives data plus recovery
  credentials. It restores services before multipart R2 upload, verifies the
  full downloaded SHA256, and only then publishes a completion manifest.
- The first successful live backup took 88 seconds and uploaded 109,688 bytes.
  Restore from only that R2 archive onto a fresh namespace/PV took 79 seconds;
  graph persistence, TLS/authentication and scoped CQL permissions passed.
  The scratch namespace/volume were subsequently removed after checking that
  they were distinct from the source claim.
- A SIGTERM drill interrupted a backup while Cassandra was down. The handler
  restored both databases and Flux, cleared the Lease and preserved the previous
  verified backup timestamp. A subsequent backup completed in 86 seconds. The final backup against the monitoring/metadata fixes completed
  in 87 seconds, with a verified 122,065-byte archive.
- Dev's CronJob is enabled at 08:00 UTC. Retention keeps all backups for 14 days
  and one per UTC week through day 56. Per-environment status exposes verified
  backup age, failures, schedule state, archive size and certificate expiry.
- Both exporters are Ready and VictoriaMetrics reports both scrape targets up.
  Live series show dev scheduling enabled, prod disabled, and the dev verified
  backup timestamp preserved. Grafana serves the nine-panel data dashboard and
  all five data alert rules evaluate with health `ok` and no errors. Actual
  notification delivery was not manually triggered.

The tiny fixture demonstrates the recovery path; it does not establish an RTO
for production-sized data. A hard-kill/host-loss recovery-mode drill, retention
expiry rehearsal and orderly host reboot remain outstanding.

Two live-only problems were corrected: Lease timestamps require six fractional
second digits; Kubernetes ConfigMap symlinks require resolving the script path
before deciding whether to start the metrics server. The former failed before
pausing databases; the latter caused the exporter to exit without listening.
Regression tests now cover both cases.

## Production gate and next infrastructure slice

The Docker Scout 1.24.0 amd64 scan reported 12 critical/142 high advisory IDs for
JanusGraph 1.1.0 and 5 critical/40 high for Cassandra 4.0.21. These are dependency
findings, not a count of proven exploitable endpoints. Some are unused startup
or optional tooling, but active Java networking dependencies are also affected.
There is no newer released JanusGraph patch to simply substitute.

The exact image digests, scan reproduction, triage and required work are in the
infrastructure [security review](https://github.com/biozal/cartyx-infrastructure/blob/main/deploy/data/SECURITY.md).
Resolve reachable findings through reproducible patched/minimal image builds,
assess individual residual findings, and rerun compatibility/recovery checks.
Only then tag the verified revision, deploy production and run its own backup,
empty-volume recovery and network isolation checks before enabling scheduling.

Also finish alert delivery verification, dedicated query/GC/compaction/disk
instrumentation, realistic data-size recovery/performance measurements, the
field/query ownership matrix and document-level migration audit. Application
repositories, search deployment and runtime authorization belong to the next
foundation phase; no domain conversion or backend switch has started.

Infrastructure evidence and fixes are in PRs
[#4](https://github.com/biozal/cartyx-infrastructure/pull/4),
[#5](https://github.com/biozal/cartyx-infrastructure/pull/5),
[#6](https://github.com/biozal/cartyx-infrastructure/pull/6),
[#7](https://github.com/biozal/cartyx-infrastructure/pull/7),
[#8](https://github.com/biozal/cartyx-infrastructure/pull/8), and
[#9](https://github.com/biozal/cartyx-infrastructure/pull/9).

The companion app integration diff was copied onto an isolated branch from dev
for its own PR. The original working checkout retains its audio-derived branch
and local changes; unrelated audio hardening commits are excluded from the PR.
Existing app CI image-tag markers are untouched.
