import { app } from 'electron';
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { getClawXConfigDir } from './paths';
import { logger } from './logger';

const DEFAULT_MANIFEST_FILE = '.provisioned-manifest.json';

function getBundledGovernanceDefaultsDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'resources', 'governance', 'defaults');
  }
  return join(__dirname, '../../resources/governance/defaults');
}

export function getUserGovernanceDir(): string {
  return join(getClawXConfigDir(), 'governance');
}

async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

async function listFilesRecursively(root: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(fullPath)));
      continue;
    }
    if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

async function copyMissingFiles(sourceRoot: string, targetRoot: string): Promise<{ copied: number; skipped: number }> {
  const sourceFiles = await listFilesRecursively(sourceRoot);
  let copied = 0;
  let skipped = 0;

  for (const sourceFile of sourceFiles) {
    const relPath = relative(sourceRoot, sourceFile);
    const targetFile = join(targetRoot, relPath);
    if (existsSync(targetFile)) {
      skipped += 1;
      continue;
    }
    await ensureDirectory(dirname(targetFile));
    await copyFile(sourceFile, targetFile);
    copied += 1;
  }

  return { copied, skipped };
}

async function writeProvisionManifest(
  targetRoot: string,
  sourceRoot: string,
  copied: number,
  skipped: number
): Promise<void> {
  const manifestPath = join(targetRoot, DEFAULT_MANIFEST_FILE);
  const existingManifest = existsSync(manifestPath)
    ? JSON.parse(await readFile(manifestPath, 'utf8'))
    : {};

  const manifest = {
    ...existingManifest,
    updatedAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    sourceRoot,
    copied,
    skipped,
  };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

export async function ensureGovernanceBundleInstalled(): Promise<void> {
  const sourceRoot = getBundledGovernanceDefaultsDir();
  if (!existsSync(sourceRoot)) {
    logger.warn(`Governance defaults not found at ${sourceRoot}`);
    return;
  }

  const targetRoot = getUserGovernanceDir();
  await ensureDirectory(targetRoot);

  const sourceStats = await stat(sourceRoot);
  if (!sourceStats.isDirectory()) {
    logger.warn(`Governance defaults path is not a directory: ${sourceRoot}`);
    return;
  }

  const { copied, skipped } = await copyMissingFiles(sourceRoot, targetRoot);
  await writeProvisionManifest(targetRoot, sourceRoot, copied, skipped);

  logger.info(
    `Governance bundle provisioned to ${targetRoot} (copied=${copied}, preserved=${skipped})`
  );
}

