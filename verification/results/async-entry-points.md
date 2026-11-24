# Async user event, Suitelet and client entry points

- **NetSuite version:** 2026.2
- **Account type:** production (every write was to a custom record type made for this test)
- **Date:** 2026-11-24
- **Method:** deployed user event, Suitelet and client scripts on a custom record type, driven by a scheduled script and by hand in the browser
- **Probe:** none in `probes/`: it writes, and it needs user event and client deployments the suitescript-verify runner cannot host. The relevant code is below

The typings declare the user event, Suitelet and client entry points as returning `void` (or `boolean`), while scheduled, Map/Reduce and RESTlet entry points may return a promise. Does NetSuite wait for an async user event, Suitelet or client entry point to finish?

**Status: verified** on 2026.2.

## Test

Each entry point first awaits three genuinely asynchronous calls (`search.lookupFields.promise`, which returns at once and settles later), then does something observable. Excerpts:

```js
const deferredWork = async () => {
  for (let index = 0; index < 3; index++) {
    await search.lookupFields.promise({ type: search.Type.CURRENCY, id: 1, columns: ['name'] });
  }
};

// User event
const beforeLoad = async context => {
  await deferredWork();
  context.form.addField({ id: 'custpage_before_load', type: 'inlinehtml', label: 'beforeLoad' }).defaultValue = '<p>beforeLoad finished after awaiting</p>';
};
const beforeSubmit = async context => {
  await deferredWork();
  context.newRecord.setValue({ fieldId: 'custrecord_before_submit', value: 'Set by beforeSubmit after awaiting' });
  if (scenario === 'throw-in-before-submit') throw error.create({ name: 'PROBE_BEFORE_SUBMIT', message: 'Thrown after awaiting' });
};
const afterSubmit = async context => {
  await deferredWork();
  record.submitFields({ type: context.newRecord.type, id: context.newRecord.id, values: { custrecord_after_submit: 'Set by afterSubmit after awaiting' } });
  if (scenario === 'throw-in-after-submit') throw error.create({ name: 'PROBE_AFTER_SUBMIT', message: 'Thrown after awaiting' });
};

// Suitelet
const onRequest = async context => {
  await deferredWork();
  if (context.request.parameters.mode === 'throw') throw error.create({ name: 'PROBE_SUITELET', message: 'Thrown after awaiting' });
  context.response.write('Written by the Suitelet after awaiting');
};

// Client script
const pageInit = async context => {
  await deferredWork();
  context.currentRecord.setValue({ fieldId: 'custrecord_page_init', value: 'Set by pageInit after awaiting' });
};
const saveRecord = async context => {
  await deferredWork();
  return context.currentRecord.getValue({ fieldId: 'custrecord_scenario' }) !== 'block-save';
};
```

A scheduled script saved records in each scenario and read the fields straight after `save()` and again five seconds later, and called the Suitelet with `https.requestSuitelet`. The client tests, and the Suitelet again, were done by hand in the browser.

## Results

| Entry point | What happened |
| --- | --- |
| `beforeLoad` | The field added after the awaits showed on the page. It also ran, awaits and all, for a scripted `record.create` and `record.load`. |
| `beforeSubmit` | The field set after the awaits was saved. Thrown after the awaits, the error failed `save()` with `PROBE_BEFORE_SUBMIT`, and no record was made. |
| `afterSubmit` | The field set after the awaits was there straight after `save()` returned. Thrown after the awaits, the error reached the caller of `save()`, after the record had saved. |
| `onRequest` | The response written after the awaits arrived (HTTP 200). Thrown after the awaits, the error gave an HTTP 500 error page. |
| `pageInit` | The field set after the awaits filled in. |
| `saveRecord` | With `return false` after the awaits, the record **still saved**. |

Whenever an async entry point rejected, the script's execution log showed only `UNEXPECTED_ERROR: An unexpected SuiteScript error has occurred`, and a page showed NetSuite's generic notice; a scripted `save()` received the real error.

## Explanation

NetSuite waits for the promise an async user event or Suitelet entry point returns, and a rejection behaves like a throw. It does not wait for an async `saveRecord`: it treats the returned promise as `true`, so the record saves whatever the promise resolves to. `pageInit` ran to completion, but NetSuite uses no return value from it, so it cannot show whether NetSuite waited.

## Decision

The user event and Suitelet entry points, and the client `pageInit`, `postSourcing`, `sublistChanged` and `lineInit` (whose return values NetSuite ignores), are typed `void | Promise<void>`, with a doc comment on how each behaves when async. `saveRecord` and the validate entry points stay `boolean`, with a doc comment that they must be synchronous, so an async one does not compile. `fieldChanged` stays `void`, with a doc comment that an async version runs without NetSuite waiting for it.
