import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import { Initializer, getLoggerFor } from "@solid/community-server";
import { CloudBlobClient } from "./CloudBlobClient";

export class CloudInitializer extends Initializer {
  protected readonly logger = getLoggerFor(this);
  private readonly blobClient: CloudBlobClient;

  public constructor(rootFilepath: string) {
    super();
    this.blobClient = new CloudBlobClient(rootFilepath);
  }

  public async handle(): Promise<void> {
    let templatesPath = path.join(process.cwd(), 'node_modules', '@solid', 'community-server', 'templates');
    await walk(templatesPath, async (err: Error, pathname: string, dirent: fs.Stats) => {
      if (err) {
        console.log(err);
      }
      if (!dirent.isDirectory()) {
        let template = pathname.substring(pathname.indexOf('templates'));
        let data = fs.createReadStream(pathname);
        await this.blobClient.write(template, data);
      }
    });
    this.logger.info("Loaded Templates to Cloud.");
  }

}

// a port of Go's filepath.Walk
async function walk(pathname: string, walkFunc: Function, dirent?: fs.Stats) {
  const _pass = (err: any) => err;
  let err: any;

  // special case: walk the very first file or folder
  if (!dirent) {
    let filename = path.basename(path.resolve(pathname));
    dirent = await fsp.lstat(pathname).catch(_pass);
    if (dirent instanceof Error) {
      err = dirent;
    } else {
      // @ts-ignore
      dirent.name = filename;
    }
  }

  // run the user-supplied function and either skip, bail, or continue
  err = await walkFunc(err, pathname, dirent).catch(_pass);
  if (false === err) {
    // walkFunc can return false to skip
    return;
  }
  if (err instanceof Error) {
    // if walkFunc throws, we throw
    throw err;
  }

  // "walk does not follow symbolic links"
  // (doing so could cause infinite loops)
  // @ts-ignore
  if (!dirent.isDirectory()) {
    return;
  }
  let result = await fsp.readdir(pathname, { withFileTypes: true }).catch(_pass);
  if (result instanceof Error) {
    // notify on directory read error
    return walkFunc(result, pathname, dirent);
  }
  for (let entity of result) {
    await walk(path.join(pathname, entity.name), walkFunc, entity);
  }
}
