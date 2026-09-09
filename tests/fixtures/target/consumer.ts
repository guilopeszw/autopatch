import { createUser as saveUser } from "./api.js";
import type { CreateUser } from "./api.js";

const name = "Ada";
const input: CreateUser = { name };
export const result = saveUser(input);
export const secondResult = saveUser({ name: "Grace" });

// A same-name field with a different symbol must survive the migration.
export const unrelated = { name: "untouched" };
