# Client-only promise APIs in a server script

- **NetSuite version:** 2026.2
- **Account type:** production (three runs, and a read-only fourth for `ResultSet.each.promise`; every write was to a throwaway folder the script created and deleted)
- **Date:** 2026-11-23 to 2026-11-25
- **Method:** deployed scheduled script (SuiteScript 2.1), with an `async` `execute` entry point that awaits the checks
- **Probe:** none in `probes/`: it writes, so the suitescript-verify runner cannot run it. Its checks are below

Oracle's [Promise Object](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4387812940.html) page marks the promise forms of `record.create`, `load`, `copy`, `delete`, `submitFields`, `transform`, `Record.save`, `email.send`, `PagedData.fetch`, `ResultSet.each`, `ResultSet.getRange` and `Page.next` as client-only, and [Promises in SuiteScript 2.1 Server Scripts](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/subsect_24165317531.html) says that "Using Promises with unsupported module APIs results in an error". Do they work in a server script, and do they run asynchronously there?

**Status: verified** on 2026.2.

## Test

Each check calls the API without awaiting, so that the call (`callMs`) and the promise settling (`settleMs`) are timed apart: a call that does its work before returning has `callMs` close to `settleMs`. Excerpt of the TypeScript that ran:

```ts
const check = async (start: () => unknown): Promise<Outcome> => {
  const started = Date.now();
  let returned: unknown;
  try {
    returned = start();
  }
  catch (error: unknown) {
    return { callMs: Date.now() - started, error: `${(error as Error).name}: ${(error as Error).message}`, ok: false, returnedPromise: false, throwsSynchronously: true };
  }

  const callMs = Date.now() - started;
  const returnedPromise = typeof (returned as { then?: unknown } | null)?.then === 'function';
  try {
    const value = await returned;
    return { callMs, ok: true, returnedPromise, settleMs: Date.now() - started, value: describe(value) };
  }
  catch (error: unknown) {
    return { callMs, error: `${(error as Error).name}: ${(error as Error).message}`, ok: false, returnedPromise, settleMs: Date.now() - started };
  }
};

// ... inside the async scheduled execute() entry point, against a throwaway folder it creates and deletes:
// N/record, client-only per Oracle.
const createOutcome = await this.#run('record.create.promise', () => record.create.promise({ type: record.Type.FOLDER }));
const folder = createOutcome.ok ? await record.create.promise({ type: record.Type.FOLDER }) : record.create({ type: record.Type.FOLDER });
folder.setValue({ fieldId: 'name', value: `Server promise probe ${new Date().toISOString().replaceAll(':', '-')}` });
if (parentFolderId !== null) {
  folder.setValue({ fieldId: 'parent', value: Number(parentFolderId) });
}

const saveOutcome = await this.#run('Record.save.promise', () => folder.save.promise());
folderId = saveOutcome.ok ? (saveOutcome.value as number) : folder.save();
const savedFolderId = folderId;

await this.#run('record.load.promise', () => record.load.promise({ type: record.Type.FOLDER, id: savedFolderId }));
await this.#run('record.copy.promise (not saved)', () => record.copy.promise({ type: record.Type.FOLDER, id: savedFolderId }));
await this.#run('record.submitFields.promise', () => record.submitFields.promise({
  type: record.Type.FOLDER,
  id: savedFolderId,
  values: { description: 'Server promise probe: submitFields.promise' },
}));
if (estimateId === null) {
  log.audit({ title: `${PROBE_NAME}: record.transform.promise (not saved)`, details: 'Skipped: no open estimate.' });
}
else {
  await this.#run('record.transform.promise (not saved)', () => record.transform.promise({
    fromType: record.Type.ESTIMATE,
    fromId: Number(estimateId),
    toType: record.Type.SALES_ORDER,
  }));
}

// N/search results, client-only per Oracle.
const folderSearch = search.create({ type: search.Type.FOLDER, columns: ['internalid'] });
const pagedData = folderSearch.runPaged({ pageSize: 5 });
const pageOutcome = await this.#run('PagedData.fetch.promise', () => pagedData.fetch.promise({ index: 0 }));
const page = pageOutcome.ok && pagedData.pageRanges.length > 1 ? pagedData.fetch({ index: 0 }) : null;
if (page !== null) {
  await this.#run('Page.next.promise', () => page.next.promise());
}

await this.#run('ResultSet.getRange.promise', () => folderSearch.run().getRange.promise({ start: 0, end: 5 }));
let eachCount = 0;
await this.#run('ResultSet.each.promise', () => folderSearch.run().each.promise(() => {
  eachCount += 1;
  return eachCount < 5;
}));

// N/email, client-only per Oracle.
const emailEmployeeId = this.#emailEmployeeId;
if (emailEmployeeId !== null) {
  await this.#run('email.send.promise', () => email.send.promise({
    author: emailEmployeeId,
    recipients: [emailEmployeeId],
    subject: 'Server promise probe',
    body: 'Sent by the ServerPromiseProbe ad-hoc utility with email.send.promise in a scheduled script. Nothing to do.',
  }));
}

const deleteOutcome = await this.#run('record.delete.promise', () => record.delete.promise({ type: record.Type.FOLDER, id: savedFolderId }));
```

A further series loaded the same record 10 times with `record.load`, 10 times with `await record.load.promise` one at a time, and 10 times at once with `Promise.allSettled`.

## Results

Every check returned a promise and settled without an error (the third run, 2026-11-24; the other runs agree):

| API | callMs | settleMs |
| --- | --- | --- |
| `record.create.promise` | 17 | 19 |
| `Record.save.promise` | 117 | 117 |
| `record.load.promise` | 105 | 108 |
| `record.copy.promise` (not saved) | 128 | 131 |
| `record.submitFields.promise` | 344 | 344 |
| `record.transform.promise` (estimate to sales order, not saved) | 6192 | 6194 |
| `record.delete.promise` | 187 | 188 |
| `ResultSet.each.promise` | 840 | 858 |
| `PagedData.fetch.promise` | 0 | 303 |
| `Page.next.promise` | 1 | 314 |
| `ResultSet.getRange.promise` | 0 | 962 |
| `email.send.promise` | 396 | 1382 |
| `search.lookupFields.promise` (documented for servers, for comparison) | 3 | 96 |

Ten loads of one record took 730 ms with `record.load`, 638 ms with `await record.load.promise` one at a time, and 749 ms with `Promise.allSettled`.

### `ResultSet.each.promise`, with its callbacks counted

Timing alone cannot tell whether `each.promise` ran its callbacks before returning, as a search that runs inside the call looks the same. A fourth, read-only run (2026-11-25) counted them: it noted how many callbacks had run when the call returned, after one `await Promise.resolve()`, and when the promise settled, and timed each callback from the call. Each check ran three times, with plain `each` for comparison:

| Check | callMs | Callbacks run at return | After one microtask | At settle | settleMs |
| --- | --- | --- | --- | --- | --- |
| `each.promise`, `run()` inside the call, stop after 5 | 778 to 1024 | 0 | 5 | 5 | 1040 to 4320 |
| `each.promise`, `run()` before the call, stop after 3 | 744 to 897 | 0 | 3 | 3 | 3956 to 4555 |
| `each.promise`, `run()` before the call, stop after 25 | 934 to 1033 | 0 | 25 | 25 | 4359 to 4921 |
| `each`, `run()` before the call, stop after 3 | 748 to 1011 | 3 | | | |

Every callback of a call ran within the same millisecond, 15 to 31 ms after the call returned, and the promise resolved to `true`.

## Explanation

All the APIs work in a server script; none raised an error. The `record` promises do their work inside the call and return a settled promise, so in a server script they give no concurrency: `Promise.allSettled` was no faster than loading one record after another. `PagedData.fetch`, `Page.next`, `ResultSet.getRange` and `email.send` return at once and settle later, like the documented `search.lookupFields.promise`.

`ResultSet.each.promise` is neither. The call blocks while the search runs, for as long as plain `each` (the first three runs read its 840 ms call as the whole `each` running inside it), but it invokes the callbacks only after it returns, and the promise settles later still. So it gives no concurrency either. A RESTlet check in a sandbox on 2026.2 (see #477) also found no callbacks run at return, with a call of 39 to 53 ms, presumably because its search was quicker.

Not tested: `record.attach.promise` and `record.detach.promise` (they would write to a real record), `email.sendBulk.promise`, `email.sendCampaignEvent.promise` and `Page.prev.promise`.

## Decision

The typings already declare all these promise methods without restriction, which matches what NetSuite does. Their doc comments now say that Oracle documents them as client-only, that they work in server scripts, and whether they run asynchronously there.
