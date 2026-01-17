import { readFileSync } from 'node:fs';
import path from 'node:path';

// config.schema.json lives at repo root, and also beside dist/ after build
const schemaPath = path.resolve(__dirname, '../config.schema.json');
const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as { pluginAlias: string };

// package.json lives at repo root, and also beside dist/ after build
const pkgPath = path.resolve(__dirname, '../package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name: string };

export const PLATFORM_NAME = schema.pluginAlias;
export const PLUGIN_NAME = pkg.name;

