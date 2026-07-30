/**
 * `exec` liveness probe target: `node dist/healthcheck.js`.
 *
 * A shell one-liner over `stat`/`date` would work on this alpine image, but it
 * bakes the freshness threshold into the chart in a second place and silently
 * changes meaning if the base image ever loses busybox. Node is guaranteed
 * present — it is the entrypoint — so the probe reads the same
 * `HEARTBEAT_MAX_AGE_MS` the worker does, from the same module.
 *
 * Exit 0 = fresh, exit 1 = stale or missing; kubelet needs nothing else.
 */
import { isHeartbeatFresh } from './heartbeat.js';

process.exit(isHeartbeatFresh() ? 0 : 1);
