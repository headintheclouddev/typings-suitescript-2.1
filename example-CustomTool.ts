/**
 * @NApiVersion 2.1
 * @NScriptType CustomTool
 */

import type { EntryPoints } from "N/types";

export const add: EntryPoints.CustomTool.toolMethod<{ a: number; b: number }, { result: number; error: string }> = async (args) => {
	return { result: args.a + args.b, error: "" };
};

export const reverseText: EntryPoints.CustomTool.toolMethod<{ text: string }, { result: string; error: string }> = async (args) => {
	return { result: args.text.split("").reverse().join(""), error: "" };
};
