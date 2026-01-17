// eslint-disable-next-line
// @ts-ignore
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const schema = require('../config.schema.json') as { pluginAlias: string };
const { pluginAlias } = schema;

// eslint-disable-next-line
// @ts-ignore
import { readFileSync } from 'node:fs';

const configSchema = JSON.parse(
  readFileSync(new URL('../config.schema.json', import.meta.url), 'utf8'),
) as { pluginAlias: string };

const platformName = configSchema.pluginAlias;

const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
) as { name: string };

export const pluginName = pkg.name;

/**
 * This is the name of the platform that users will use to register the plugin in the Homebridge config.json
 */

export const PLATFORM_NAME = platformName;

/**
 * This must match the name of your plugin as defined the package.json
 */
export const PLUGIN_NAME = pluginName;
