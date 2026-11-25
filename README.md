# SuiteScript 2.1 Typings

[![npm version](https://img.shields.io/npm/v/@hitc/netsuite-types.svg)](https://www.npmjs.com/package/@hitc/netsuite-types)

## Installation Instructions

`npm install --save-dev @hitc/netsuite-types`

## Usage

Once installed, you need to configure TypeScript to find the library declarations and `import` the libraries as needed
into your scripts.

### TSC (TypeScript Compiler) Configuration

You can import the modules and use them like normal using standard TypeScript syntax. NetSuite loads each script as an AMD module: one `define` call per file, with the `@NApiVersion` comment block above it. How you produce that depends on your TypeScript version:

- **TypeScript 5 or 6:** `tsc` can compile straight to AMD.
- **TypeScript 7** can no longer emit AMD (it removed `module: "amd"`), so use `tsc` to type-check only and another tool to build the scripts.

The typings themselves work with all three.

#### TypeScript 5 or 6: compile with tsc

Create a file called `tsconfig.json` in your project root and have these options configured:

```json
{
  "compilerOptions": {
    "module": "amd",
    "target": "es2023",
    "moduleResolution": "node10",
    "sourceMap": false,
    "newLine": "LF",
    "experimentalDecorators": true,
    "lib": ["es2023", "dom"],
    "paths": {
      "N": ["./node_modules/@hitc/netsuite-types/N"],
      "N/*": ["./node_modules/@hitc/netsuite-types/N/*"]
    }
  },
  "exclude": ["node_modules"]
}
```

The key component is **paths**, which points `N/*` imports at these typings. For the `target` to choose, see [which JavaScript features SuiteScript 2.1 supports](https://suiteadvanced.com/suitescript-caniuse/).

TypeScript 6 deprecates `module: "amd"` and `moduleResolution: "node10"`, so on TypeScript 6 also add `"ignoreDeprecations": "6.0"` to `compilerOptions` (TypeScript 5 rejects that value, so leave it out there). To keep this setup when TypeScript 7 is the latest version, install an earlier one: `npm install --save-dev typescript@5`.

#### TypeScript 7: type-check with tsc, build with SWC

Use this `tsconfig.json`, which only type-checks (it also works on TypeScript 5 and 6). Set `include` to the folder that holds your scripts:

```json
{
  "compilerOptions": {
    "noEmit": true,
    "module": "preserve",
    "moduleResolution": "bundler",
    "target": "es2023",
    "strict": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "paths": {
      "N": ["./node_modules/@hitc/netsuite-types/N"],
      "N/*": ["./node_modules/@hitc/netsuite-types/N/*"]
    }
  },
  "include": ["src"]
}
```

Then build the AMD files with [SWC](https://swc.rs/) (`npm install --save-dev @swc/cli @swc/core`), using this `.swcrc`:

```json
{
  "$schema": "https://swc.rs/schema.json",
  "jsc": { "parser": { "syntax": "typescript" }, "target": "es2023" },
  "module": { "type": "amd", "importInterop": "none" }
}
```

and a build script in `package.json`:

```json
"scripts": { "build": "tsc && swc src -d dist --strip-leading-paths" }
```

- `importInterop: "none"` passes each `N/*` module through unchanged, rather than copying it into a new object.
- Leave SWC's comment handling at its default: with `jsc.preserveAllComments: true`, the `@NApiVersion` block ends up inside `define`.
- Babel can also build AMD, but it moves the `@NApiVersion` block inside `define`, so it needs a small plugin to move it back. See [#474](https://github.com/headintheclouddev/typings-suitescript-2.1/issues/474) for the setup.

Then simply import your modules and go.

### Writing SuiteScript

At the top of every script you will want to have the following lines added:

```typescript
/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 */

import type {EntryPoints} from 'N/types';
```

`N/types` and `EntryPoints` isn't actually in the NetSuite API, but it is something that is included with this library to give you type definitons for your entry point functions. For example:

```typescript
import type {EntryPoints} from 'N/types';
export const pageInit: EntryPoints.Client.pageInit = (context: EntryPoints.Client.pageInitContext) => {
  //Your IDE will now autocomplete from the context argument. For instance use this to access context.mode and context.currentRecord in this pageInit example
};
```

Notice that we are exporting the function `pageInit` that will need to be referenced in the NetSuite Client Script record as an entry point.

Whichever tool builds your scripts, follow these three rules, as the compiler can't always catch a mistake:

- **Import `N/*` modules as namespaces:** `import * as record from 'N/record'`, not `import record from 'N/record'`. The modules have no default export. A default import still compiles, but with SWC's `importInterop: "none"` (or Babel's `noInterop`) it fails at runtime with `TypeError: Cannot read properties of undefined`.
- **Import `N/types` with `import type`.** It exists only in these typings, not in NetSuite, so it must not end up in `define`'s dependency list. Some per-file transpilers keep a plain `import` of it; `import type` is always removed, and `verbatimModuleSyntax` makes the compiler insist on it.
- **Export entry points by name:** `export const beforeSubmit = ...` or `export { beforeSubmit }`, not `export default { beforeSubmit }`. NetSuite looks for entry point functions on the module itself, and a default export puts them under a single `default` property, where NetSuite doesn't find them.

Then if you're using a TypeScript-aware text editor you'll get syntax highlighting, error detection, embedded apidocs, type-checking, and autocomplete for all of the SuiteScript 2.1 modules and types. For instance the free [VSCode](https://code.visualstudio.com/) from Microsoft will work out of the box.

## User Event Example

Full example for a User Event Script might look something like this:

```typescript
/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */

import type {EntryPoints} from 'N/types';
import * as log from 'N/log';

export const beforeSubmit: EntryPoints.UserEvent.beforeSubmit = (context: EntryPoints.UserEvent.beforeSubmitContext) => {
  const x = context.newRecord.getValue({fieldId: 'companyname'});
  log.audit('value', `companyname is: ${x}`);
};
```

## Suitelet Example

```typescript
/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */

import type {EntryPoints} from 'N/types';
import * as record from 'N/record';

export const onRequest: EntryPoints.Suitelet.onRequest = (context: EntryPoints.Suitelet.onRequestContext) => {
  const folder = record.load({type: 'folder', id: 36464});
  const allfields = folder.getFields().join(', ');
  context.response.write(`<br>all fields: ${allfields}`);
};
```

This example exports the function `onRequest` that needs to be referenced in the script record.

## Updates

You can download the latest published typings library at any time by simply running the command:

`npm install --save-dev @hitc/netsuite-types`
