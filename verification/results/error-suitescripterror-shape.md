# What a SuiteScriptError carries

- **NetSuite version:** 2026.2
- **Account type:** sandbox
- **Date:** 2026-11-25
- **Method:** deployed Suitelet (SuiteScript 2.1), requested from the browser
- **Probe:** none in `probes/`: one of its cases saves a record, which a user event refuses. The relevant code is below

The typings declare `SuiteScriptError` with `id: string`, `stack: string[]` and `cause: any`. What does an error that NetSuite's own modules throw carry, and does one made with `error.create` carry the same?

**Status: verified** on 2026.2.

## Test

Each case provokes an error, catches it and describes what was caught: its constructor, whether it is an `Error`, its own property names, and the type and value of each property. Excerpt:

```js
const describeThrown = thrown => ({
  constructorName: thrown.constructor && thrown.constructor.name,
  instanceOfError: thrown instanceof Error,
  ownNames: Object.getOwnPropertyNames(thrown),
  properties: Object.fromEntries(['name', 'message', 'id', 'type', 'stack', 'cause', 'notifyOff', 'userFacing']
    .filter(name => typeof thrown[name] !== 'undefined')
    .map(name => [name, { isArray: Array.isArray(thrown[name]), typeof: typeof thrown[name], value: thrown[name] }])),
});

const provoke = async action => {
  try {
    await action();
    return { threw: false };
  }
  catch (e) {
    return describeThrown(e);
  }
};

const results = {
  'error.create, thrown by the script': await provoke(() => {
    throw error.create({ name: 'UH_PROBE', message: 'Made by error.create.' });
  }),
  'file.load, missing file': await provoke(() => file.load({ id: 'SuiteScripts/probes/no-such-file.js' })),
  'https.get, unresolvable host': await provoke(() => https.get({ url: 'https://no-such-host.invalid/' })),
  'query.runSuiteQL, bad SQL': await provoke(() => query.runSuiteQL({ query: 'SELECT nothing FROM no_such_table' })),
  'query.runSuiteQL.promise, bad SQL': await provoke(() => query.runSuiteQL.promise({ query: 'SELECT nothing FROM no_such_table' })),
  'record.load, invalid type': await provoke(() => record.load({ type: 'no_such_type', id: 1 })),
  'record.load, missing record': await provoke(() => record.load({ type: record.Type.CUSTOMER, id: 999999999 })),
  'record.load.promise, missing record': await provoke(() => record.load.promise({ type: record.Type.CUSTOMER, id: 999999999 })),
  'record.save, missing mandatory field': await provoke(() => record.create({ type: record.Type.CUSTOMER }).save()),
  'record.save, user event beforeSubmit throws': await provoke(() => probeRecordWhoseUserEventThrows().save()),
  'search.lookupFields, invalid column': await provoke(() => search.lookupFields({ type: search.Type.CUSTOMER, id: 1, columns: ['no_such_column'] })),
};
```

A native `TypeError` and an `Error` with an `Error` cause were described the same way, for comparison.

## Results

Every error from a NetSuite module, and the one made with `error.create`, had the constructor `SuiteScriptError`, was **not** an instance of `Error`, and had the same own properties: `type`, `id`, `name`, `message`, `stack`, `cause`, `notifyOff`, `userFacing`, `toJSON` and `toString`. In every case `type` was `'error.SuiteScriptError'`, `notifyOff` was `false` and `userFacing` was `true`.

| Case | `name` | `id` | `stack` |
| --- | --- | --- | --- |
| `error.create`, thrown by the script | `UH_PROBE` | `null` | array of 6 strings, one per line |
| `file.load`, missing file | `RCRD_DSNT_EXIST` | `''` | array of 1 string, holding every line |
| `https.get`, unresolvable host | `SSS_UNKNOWN_HOST` | `''` | array of 1 string |
| `query.runSuiteQL`, bad SQL | `INVALID_SEARCH_TYPE` | `''` | array of 1 string |
| `query.runSuiteQL.promise`, bad SQL | `INVALID_SEARCH_TYPE` | `''` | array of 1 string |
| `record.load`, invalid type | `INVALID_RCRD_TYPE` | `''` | array of 1 string |
| `record.load`, missing record | `RCRD_DSNT_EXIST` | `'999999999'` | array of 1 string |
| `record.load.promise`, missing record | `RCRD_DSNT_EXIST` | `'999999999'` | array of 1 string |
| `record.save`, missing mandatory field | `USER_ERROR` | `''` | array of 1 string |
| `record.save`, user event `beforeSubmit` throws | the name the user event gave | `'null'` (the text) | array of 1 string |
| `search.lookupFields`, invalid column | `SSS_INVALID_SRCH_COL` | `''` | array of 1 string |

The single string of a NetSuite error's stack begins `Error\n    at ...` and has a line per call. The promise forms rejected with the same shape as the plain calls threw.

`cause` was always a plain object that repeats the error:

- For `error.create`: `{ name, message }`, with the same values as the error.
- For every other case: NetSuite's internal error, whose JSON is `{ type: 'internal error', code, details, userEvent, stackTrace, notifyOff }`. `code` equals the error's `name`, `details` its `message` and `stackTrace` its `stack`. `userEvent` was `null` in every case, including the one a user event threw.

The native errors, by contrast, were instances of `Error` with a string `stack`, and serialised to `{}`.

## Explanation

A `SuiteScriptError` is a plain object, so `instanceof Error` cannot find one, but its `type` can. Its `id` is not always a string: `error.create` leaves it `null`. Its `stack` is always an array, as typed, though in two layouts, and joining it with a line break reads either. Its `cause` adds nothing to the error that carries it.

Not tested: a `UserEventError`, which a user event script receives; `eventType` and `recordId` were not seen on any error here, as each was caught outside a user event.

## Decision

`SuiteScriptError.id` is `string | null`, and `SuiteScriptError` gains `type: string`. The doc comments on the interface, `stack` and `cause` say what was seen. `notifyOff` stays optional and `userFacing` is not added: Oracle does not document `userFacing`, and one run does not show what it means.
