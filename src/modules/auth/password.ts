import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const parameters = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, parameters, (error, hash) => {
      if (error) reject(error);
      else resolve(hash);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(password, salt);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, storedHash?: string): Promise<boolean> {
  const match = /^scrypt:([0-9a-f]{32}):([0-9a-f]{128})$/.exec(storedHash ?? '');
  // Run the same derivation for an unknown account before returning a failure.
  const salt = match ? Buffer.from(match[1], 'hex') : Buffer.alloc(16);
  const expected = match ? Buffer.from(match[2], 'hex') : Buffer.alloc(64);
  const actual = await derive(password, salt);
  return timingSafeEqual(actual, expected) && match !== null;
}
