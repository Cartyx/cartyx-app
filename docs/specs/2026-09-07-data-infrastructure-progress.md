# Data infrastructure implementation evidence

Updated 2026-09-08. Infrastructure work began 2026-09-07; UTC test timestamps
cross into September 8.

## Current scope

JanusGraph/Cassandra run in local Docker and dev Kubernetes. Production has been
activated from immutable infrastructure tag `data-v0.1.1` after its own off-host
recovery, isolation and reboot checks passed. Both daily backup schedules are enabled. MongoDB is
still authoritative for every application subsystem. No application documents
have been migrated or deleted.

The infrastructure repository owns the chart, Docker services, database image
builds, shared configuration, operations tools, tests and infrastructure CI.
The app owns local startup wrappers and the read-only Mongo inventory script.
The app wrapper defaults to the sibling `cartyx-infrastructure` checkout;
`CARTYX_INFRASTRUCTURE_DIR` supports another absolute path. Private credentials,
preflight reports and recovery artifacts stay under the infrastructure repo's
ignored `.local` directory.

Current runbooks and evidence:

- [Database deployment](https://github.com/biozal/cartyx-infrastructure/blob/main/deploy/charts/cartyx-data/README.md)
- [Backup, restore and monitoring](https://github.com/biozal/cartyx-infrastructure/blob/main/deploy/data/README.md)
- [Maintained image builds and exception review](https://github.com/biozal/cartyx-infrastructure/blob/main/deploy/images/README.md)
- [Security scan and promotion record](https://github.com/biozal/cartyx-infrastructure/blob/main/deploy/data/SECURITY.md)

## Tested compatibility

| Component              | Tested selection                                                                  |
| ---------------------- | --------------------------------------------------------------------------------- |
| Cassandra              | Maintained 4.0.21 distribution; upstream server/storage version retained          |
| JanusGraph             | Maintained 1.1.0 core/CQL distribution                                            |
| JVM / traversal server | Temurin 11.0.32 / TinkerPop 3.7.6                                                 |
| JavaScript client      | Gremlin 3.7.6, GraphSON 3, script and bytecode traversals                         |
| Architectures          | Native linux/amd64 and linux/arm64 build, scan, security and recovery CI          |
| Transport              | Verified TLS and authentication for Gremlin/CQL; distinct environment credentials |
| Image references       | Identical published GHCR OCI index digests in chart and Compose                   |

The original upstream images had 12 critical/142 high advisory IDs for JanusGraph
and 5 critical/40 high for Cassandra in the amd64 baseline scan. Maintained builds
replace their vulnerable Java/OS/Python dependencies and omit unused backends and
startup tools. TinkerPop's embedded Jackson is rebuilt from checksum-verified
source; changing the ordinary Jackson dependency alone would leave that embedded
copy unchanged. Inputs and final JARs are locked, and CI records scans/SBOMs.

Both native architecture scans report zero high/critical findings for JanusGraph.
Cassandra has zero critical findings and one reviewed high finding:
`CVE-2022-1471` in SnakeYAML 1.33. Its scoped exception expires **2026-10-08**.
Cassandra's actual YAML constructor is unsafe for untrusted input; the exception
rests on operator-controlled configuration, not on a safe-constructor claim.
The linked image guide records the source evidence, boundary and required follow-up.
Production promotion does not close this advisory review.

These are infrastructure fixture/compatibility tests, not production load tests
or application authorization tests. JanusGraph's [published compatibility matrix](https://docs.janusgraph.org/changelog/)
lists Cassandra 4.0 and TinkerPop 3.7; Cartyx's dependency changes have their own
explicit test and maintenance obligations.

## Atlas inventory

Both live namespace configurations were inventoried read-only:

| Environment | Collections | Documents | Logical bytes |
| ----------- | ----------: | --------: | ------------: |
| dev         |          39 |     1,080 |     1,099,083 |
| prod        |          25 |         2 |         1,405 |

Private collection/index reports remain in the application checkout under
`.local/data/inventory/dev.json` and `prod.json`. Counts include raw-driver
collections. This is not yet a document-level audit of orphan references,
ownership, visibility, legacy names or field mappings. Those checks are required
before any import or subsystem cutover.

## Local development

- `npm run dev` starts/waits for Docker database dependencies before host web and
  realtime processes. Ctrl+C stops the host processes; database teardown is
  explicit and preserves named volumes. `dev:web` starts only the web server.
- Dependency-only and full-app Compose resolve the same database services and
  volume names. The audio worker is an explicit full-stack profile so ordinary
  database startup cannot accidentally consume a configured remote queue.
- Docker bootstrap creates graph/state keyspaces and scoped CQL roles, then
  disables the default Cassandra login. The fixture has two vertices and an edge.
  Idempotent creation, persisted reads, bytecode, invalid/missing credentials,
  untrusted TLS and CQL role isolation passed.
- Existing-volume upgrades to the maintained images and then their published
  digests preserved the fixture. Both images run as UID/GID 999.
- Cold backups drain/stop Cassandra and restart the source. An independent-volume
  restore reads the same persisted relationship. Local archive format 2 records
  both image references and running IDs, rejecting changed candidate tags.
- Local kind testing also verified Helm bootstrap, persistence and CQL roles.
  Cassandra Pod IP replacement was tested while JanusGraph remained running;
  stable CQL service discovery allowed reconnect and the fixture survived.

The companion app PR includes compatible dependency patches that clear its npm
audit. ESLint, TypeScript, 218 unit-test files/2,477 tests, service tests and the
application build passed. The complete remote CI suite, including Playwright and
Storybook/browser tests, passed after the startup integration fix. Playwright starts `dev:web` against CI's ephemeral
MongoDB; infrastructure's native CI separately tests the database containers.
The original working checkout retains its audio-derived branch and local changes;
that unrelated ancestry is excluded from the app integration PR.

## Cluster and storage

Key-based SSH works as `labeaaa@192.168.1.222`. The dedicated kubeconfig is
`~/.kube/cartyx.yaml`; the default Docker Desktop context was not repurposed.
The initial outage involved conflicting MicroK8s services and stale k3s node-IP/TLS
SAN settings. MicroK8s was stopped/disabled with its installation/data retained;
the k3s unit was backed up and corrected for the new address.

Live preflight recorded amd64 Ubuntu 26.04, k3s v1.36.2+k3s1, 36 CPUs and about
60.7 GiB allocatable RAM. The database storage filesystem has approximately
827 GiB free and ample inodes. Resource limits are 3 GiB Cassandra and 2 GiB
JanusGraph per environment, with 1 GiB JVM heaps and native-memory headroom.
These are initial budgets, not sustained-load sizing evidence.

The dedicated `cartyx-data-retain` StorageClass uses retained local storage.
Dev has a 30 GiB claim and production is configured for 60 GiB. These requests
are not filesystem quotas. Each environment has its own credentials, certificate
and keyspaces. This is **one host with RF=1**, without high availability.

Dev follows infrastructure main. Production's entire data overlay, including
backup configuration, follows an exact immutable `data-v*` tag. Application
release sources remain separate. Production tags must never be moved.

## Live dev verification

- Flux installed/upgraded the chart and bootstrap. Graph persistence, bytecode,
  trusted TLS, credential rejection, scoped CQL roles and disabled default login
  passed against the published maintained images.
- k3s NetworkPolicy allowed intended database and Gremlin clients and denied
  unlabeled/cross-namespace clients. Dev/prod credentials and certificates are
  distinct. There are no public database services or runtime app credentials.
- Pod replacement, chart revisions and the hardened image upgrade retained the
  original source PVC/PV. Cassandra runs under enforced non-root UID 999.
- Native backups acquire an environment Lease, suspend its Flux/Helm, stop graph
  writers, drain/stop Cassandra and archive data/configuration/recovery credentials.
  Services resume before multipart private R2 upload. Full download/checksum
  verification precedes the completion manifest.
- The hardened dev backup completed in 73 seconds. Its R2-only fresh-volume
  restore passed graph, TLS/auth and CQL checks in 57 seconds. Scratch resources
  were removed after proving they were independent of the source volume.
- Graceful SIGTERM recovery passed. A separate host-runtime SIGKILL drill produced
  exit 137 while Cassandra was scaled down; the Lease and previous success
  timestamp remained. A recovery Job restored both databases/Flux and cleared
  the Lease, and the next off-host backup passed.
- An orderly host reboot recovered the node/databases in 233 seconds with the
  same source PVC/PV. k3s started automatically, MicroK8s remained stopped, all
  active workload pods recovered, and graph/security/network checks passed again.

Tiny-fixture durations demonstrate the recovery path; they do not establish a
production-size RTO or simulate a complete lost-host rebuild.

## Live production verification

Production installed from `data-v0.1.0` with its own 60 GiB retained claim and
credentials. Graph/bytecode queries, verified TLS, credential rejection, CQL role
permissions and enforced namespace network restrictions passed. Production also
rejected dev's Gremlin credentials over its own trusted TLS connection.

The first production backup completed in 71 seconds with a verified 79,683-byte
R2 archive. Its R2-only independent-volume restore passed graph/TLS/auth/CQL
checks in 58 seconds. The scratch namespace and volume were removed after
confirming they were independent of both source environments.

A second orderly host reboot with both environments present returned all four
freshly restarted database containers to Ready within 225 seconds, retaining
both original PVC/PV identities. This timing uses fresh container start times
and Pod Ready transitions, avoiding stale controller replica counts during boot.
Real graph, TLS/authentication, CQL and network checks passed afterward in both
environments, including production rejection of dev credentials.

`data-v0.1.1` then enabled production backups while keeping the same image set and
source storage. The entire production overlay follows that immutable tag.

## Monitoring and remaining work

Dev backups run at 08:00 UTC and production at 09:00 UTC. Both schedules are
enabled after the respective recovery rehearsals. Retention keeps every
completed backup for 14 days and one per UTC week through day 56. Both metrics
exporters, VictoriaMetrics targets, the nine-panel Grafana dashboard and five
alert rules have been verified. Alerts cover stale/failed/stuck backups, database
availability, certificate expiry and missing metrics. Abrupt exits that cannot
write failure status are detected by a stale in-progress attempt.

Still required before application cutover: alert notification delivery, retention
expiry rehearsal, detailed query/GC/compaction/disk instrumentation, realistic
recovery/load measurements, the field/query ownership matrix, document-level
migration audit, and graph schema/client/runtime authorization work. Search and
all domain conversions belong to the next foundation/subsystem phases.

Infrastructure implementation and fixes are recorded in PRs
[#3–#9](https://github.com/biozal/cartyx-infrastructure/pulls?q=is%3Apr+is%3Amerged),
[#10](https://github.com/biozal/cartyx-infrastructure/pull/10),
[#11](https://github.com/biozal/cartyx-infrastructure/pull/11), and
[#12](https://github.com/biozal/cartyx-infrastructure/pull/12), and
[#13](https://github.com/biozal/cartyx-infrastructure/pull/13).
