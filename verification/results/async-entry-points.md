# Async user event, Suitelet and client entry points

- **NetSuite version:** 2026.2
- **Account type:** production, and repeated in a sandbox (every write was to a custom record type made for this test)
- **Date:** 2026-11-24, and 2026-11-25 in the sandbox
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

### A plain function that returns a promise

The types allow any function that returns a promise, not only an `async` one, so the user event and Suitelet tests were repeated in a sandbox (2026-11-25) with each entry point exported through a wrapper. What NetSuite called was then a plain function that returns the handler's promise, having first attached its own handling of a rejection:

```js
const logged = (name, handler) => context => {
  const result = handler(context);
  return typeof result?.then === 'function' ? logRejection(name, result) : result;
};
const logRejection = async (name, promise) => {
  try {
    await promise;
  }
  catch (e) {
    log.error({ title: `${name} failed`, details: { name: e.name, message: e.message } });
    throw e;
  }
};

return { beforeLoad: logged('beforeLoad', beforeLoad), beforeSubmit: logged('beforeSubmit', beforeSubmit), afterSubmit: logged('afterSubmit', afterSubmit) };
```

The records were saved on their form in the browser, and the Suitelet was requested from it.

| Entry point | What happened |
| --- | --- |
| `beforeLoad` | The field added after the awaits showed on the form. |
| `beforeSubmit` | The field set after the awaits was saved. Thrown after the awaits, the error stopped the save, with NetSuite's generic notice. |
| `afterSubmit` | The field set after the awaits was there when the page reloaded. Thrown after the awaits, the error gave NetSuite's generic notice. |
| `onRequest` | The response written after the awaits arrived (HTTP 200). Thrown after the awaits, the error gave an HTTP 500 error page. |

Each rejection left the wrapper's own entry in the execution log, with the error's name and message, beside NetSuite's `UNEXPECTED_ERROR`.

## Explanation

NetSuite waits for the promise a user event or Suitelet entry point returns, whether the entry point is an `async` function or a plain one that returns a promise, and a rejection behaves like a throw. An entry point that catches the rejection, logs it and rethrows gets the real error into the execution log. It does not wait for an async `saveRecord`: it treats the returned promise as `true`, so the record saves whatever the promise resolves to. `pageInit` ran to completion, but NetSuite uses no return value from it, so it cannot show whether NetSuite waited.

## Decision

`Promise` appears in an entry point's type only where NetSuite waits for it. The user event entry points and the Suitelet's `onRequest` are typed `void | Promise<void>`. Every client entry point keeps its type: `pageInit`, `postSourcing`, `sublistChanged`, `lineInit` and `fieldChanged` stay `void`, and `saveRecord` and the validate entry points stay `boolean`. Each has a doc comment on how it behaves when async.

The types did not stop an async entry point before: TypeScript lets a function that returns a promise fill a `void` return type, so only the `boolean` ones refuse one. The change matters to lint rules that check for a promise where none is expected, and to what the types tell a reader.
