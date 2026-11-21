export function validateEnvironment(env: Record<string, unknown>) {
  const secret = env.JWT_SECRET;
  if (typeof secret !== 'string' || Buffer.byteLength(secret.trim()) < 32) {
    throw new Error('JWT_SECRET must contain at least 32 bytes.');
  }

  const adminPassword = env.BOOTSTRAP_ADMIN_PASSWORD;
  if (adminPassword !== undefined && adminPassword !== '' &&
      (typeof adminPassword !== 'string' || adminPassword.length < 8 || adminPassword.length > 128)) {
    throw new Error('BOOTSTRAP_ADMIN_PASSWORD must contain 8 to 128 characters.');
  }

  const uri = env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017';
  if (typeof uri !== 'string' || !/^mongodb(?:\+srv)?:\/\//.test(uri)) {
    throw new Error('MONGODB_URI must use the mongodb:// or mongodb+srv:// scheme.');
  }

  const port = Number(env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  return { ...env, JWT_SECRET: secret, MONGODB_URI: uri, PORT: port };
}
