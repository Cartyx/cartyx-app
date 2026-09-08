# Audio adversarial review fixes

These changes address the eight findings from the review of `audio-hardening`
at `4ec55474`.

- Rejected, never-confirmed main uploads are swept again by the worker after
  their signed PUT URLs expire. The cutoff is at least fifteen minutes from
  creation, even if `UPLOAD_TIMEOUT_MS` is configured lower. Failed R2 deletes
  retain the source reference for retry; successful deletes remove it so an
  obsolete reference cannot hide an orphan. This also covers existing rejected
  rows. Confirmed sources eligible for transcode retry are preserved. Cleanup
  runs between worker jobs, so the cutoff is eligibility, not a deletion deadline.
- Package pruning uses the package's `updatedAt` as a write precondition and
  retries with fresh items and moods on conflict. Both editor and pruning writes
  advance the timestamp monotonically, including within one millisecond.
- A pad with both random interval bounds is armed for scheduler-driven one-shots;
  it does not also start an ordinary track. A transient sound ending does not
  disarm the scheduler.
- Stop All stops ordinary tracks, transient sounds and fading tails, cancels
  pending one-shot fires, and stops scheduler timers immediately. Unrelated
  state updates still leave transient sounds alone.
- Board saves share a queue per campaign within the browser runtime. The queue
  survives component remounts and retains only the latest waiting snapshot, so
  an outgoing board's request completes before a subsequent clear is saved.
  This is not conflict resolution between separate browser tabs.
- Bulk tag additions atomically require the resulting unique tag count to be
  at most thirty. Assets exceeding the limit are unchanged; other eligible
  assets may update. The response explains partial completion and the library
  refreshes after a refusal. Replace remains available to repair older oversized
  tag lists.
- Once-upload confirmation and rejection writes require the exact source key
  inspected by the request. A delayed request cannot act on a newer attachment.
- The client receives and displays `onceLastError` independently of the main
  asset's status. Starting a new attachment or completing it successfully clears
  the previous error.

Regression coverage includes real browser audio rendering, interleaved package
and board saves, upload-generation races, stored tag limits, rejected-upload
cleanup and retry, and rendering background attachment errors.
