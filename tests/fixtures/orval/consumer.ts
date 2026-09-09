import { listPets as loadPets } from './barrel';

/** Repository-owned observation of the unmodified upstream generated SDK. */
export async function observe(): Promise<{ status: number; names: string[] }> {
  const result = await loadPets({ limit: '2' });
  return { status: result.status, names: result.data.map(pet => pet.name) };
}
