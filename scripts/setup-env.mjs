import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

// Resolve against the project, including when a setup script is called directly.
try {
  loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
