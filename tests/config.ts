import { Readable } from "stream";
import path from "path";
import type { Term } from '@rdfjs/types';
import { Guarded, RepresentationMetadata, XSD, guardedStreamFrom, toLiteral } from '@solid/community-server';
import { CloudDataAccessor } from "../src/CloudDataAccessor";
import { ComponentsManager } from 'componentsjs';
import type { IModuleState } from 'componentsjs';
import { CloudBlobClient } from "../src/CloudBlobClient";

/**
 * A localhost base URL for testing purposes.
 */
let base = "http://localhost:9001/";

/**
 * This is the "bucket name" rootFilepath that we abstract away
 * from the original intent. 
 */
let rootFilepath = "test-data";

/**
 * This is the true rootFilepath that is the root container in 
 * the cloud storage. 
 */
let internalRootFilepath = "root/";

/**
  * This helps to accomodate a 1-2 second diff in times between the Resource creation times,
  * and the times used in the tests. If there is even the slightest latency on read/writes,
  * the test datetimes can be off by 1-2 seconds.
*/
function within(literal: Term | undefined, s: number, now: Date, isDateStr: boolean = false): boolean {
  if (!literal) return false;
  let dateInt = toLiteral(Math.floor(now.getTime() / 1000), XSD.terms.integer);
  let dateString = toLiteral(now.toISOString(), XSD.terms.dateTime);
  let delta: number;

  if (isDateStr) {
    delta = parseInt(dateString.value) - parseInt(literal?.value);
  } else {
    delta = parseInt(dateInt.value) - parseInt(literal?.value);
  }
  return delta <= s;
}

function data(): Guarded<Readable> {
  return guardedStreamFrom(['data']);
}

async function createDocument(accessor: CloudDataAccessor, path: string): Promise<string> {
  path = `${base}${path}`;
  let doc = { path };
  let meta = new RepresentationMetadata(doc);
  await accessor.writeDocument(doc, data(), meta);
  return path;
}

let cachedModuleState: IModuleState;
async function instantiateFromConfig(componentUrl: string, configPaths: string | string[], variables?: Record<string, any>,): Promise<any> {
  // Initialize the Components.js loader
  const mainModulePath = process.cwd();
  const manager = await ComponentsManager.build({
    mainModulePath,
    logLevel: 'error',
    moduleState: cachedModuleState,
    typeChecking: false,
  });
  cachedModuleState = manager.moduleState;

  if (!Array.isArray(configPaths)) {
    configPaths = [configPaths];
  }

  // Instantiate the component from the config(s)
  for (const configPath of configPaths) {
    await manager.configRegistry.register(configPath);
  }
  return await manager.instantiate(componentUrl, { variables });
}

function getTestConfigPath(configFile: string): string {
  return path.join(__dirname, 'configs', configFile);
}

function getDefaultVariables(port: number, baseUrl?: string): Record<string, any> {
  return {
    'urn:solid-server:default:variable:baseUrl': baseUrl ?? `http://localhost:${port}/`,
    'urn:solid-server:default:variable:port': port,
    'urn:solid-server:default:variable:socket': null,
    'urn:solid-server:default:variable:loggingLevel': 'off',
    'urn:solid-server:default:variable:showStackTrace': true,
    'urn:solid-server:default:variable:seedConfig': null,
    'urn:solid-server:default:variable:workers': 1,
    'urn:solid-server:default:variable:confirmMigration': false,
  };
}

/**
  * Utility for testing existence of a resource, that it does not
  * throw NotFoundHttpError.
  *
  * used: t.doesNotReject(exists(client, "a/path/to/data"));
  */
function exists(client: CloudBlobClient, path: string): () => Promise<void> {
  return async () => {
    let data = await client.read(path);
    data.destroy();
  };
}

export { base, rootFilepath, internalRootFilepath, within, createDocument, data, instantiateFromConfig, getTestConfigPath, getDefaultVariables, exists };
