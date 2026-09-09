import { submit } from "./api.js";

/** Sentinel: this surrounding context must never appear in a provider request. */
export const unrelatedContext = "not part of the affected call";
submit({ count: "3" });
