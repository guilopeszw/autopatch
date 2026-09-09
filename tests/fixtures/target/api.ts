/** Local SDK contract explicitly bound to the OpenAPI document. */
export interface CreateUser {
  name: string;
}

/** Demo transport: a real SDK would send this payload to POST /users. */
export function createUser(input: CreateUser): string {
  return input.name;
}
