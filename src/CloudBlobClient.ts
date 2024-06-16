import { Readable } from "stream";
import { DataFactory } from 'n3';
import { BucketItem, BucketStream, Client as minio } from "minio";
import { LDP, NotFoundHttpError, RDF, RepresentationMetadata, SOLID_META, getLoggerFor, serializeQuads } from "@solid/community-server";
let namedNode = DataFactory.namedNode;
let literal = DataFactory.literal;

export type CloudBlobStat = {
  size: number,
  etag: string,
  versionId?: string | null,
  metaData: Record<string, any>,
  lastModified: Date,
  container: boolean
}

export class CloudBlobClient {
  protected readonly logger = getLoggerFor(this);
  protected client: minio;
  protected minioUser: string;
  protected minioPass: string;
  protected bucket: string;
  protected bucketCreated: boolean = false;

  /**
  * @param {string} bucket The name of the bucket to use for this client.
  */
  public constructor(bucket: string) {
    this.bucket = bucket;
    this.minioUser = process.env.MINIO_USER || "ROOTNAME";
    this.minioPass = process.env.MINIO_PASS || "CHANGEME123";
    this.client = new minio({
      endPoint: "127.0.0.1",
      port: 9000,
      useSSL: false,
      accessKey: this.minioUser,
      secretKey: this.minioPass
    });
  }

  public async createBucket(bucket?: string) {
    if (this.bucketCreated) return;
    try {
      this.bucket = bucket || this.bucket;
      this.bucketCreated = await this.client.bucketExists(this.bucket);
      if (!this.bucketCreated) {
        await this.client.makeBucket(this.bucket);
        this.bucketCreated = true;
      }
    } catch (e) {
      this.logger.error(`Failed to create bucket: ${this.bucket}. ${e}`);
      throw e;
    }
  }

  public async stats(path: string): Promise<CloudBlobStat> {
    await this.createBucket();
    try {
      let container = path.endsWith("/");
      if (container) {
        // we don't have directories in the cloud, but if the container
        // hass been previously written we save a .meta file that acts as
        // both the literal metadata, but also a "flag" that the container
        // exists. (getting a .meta file in a container equals a directory)
        path = this.containerFileName(path);
      }
      let stat = await this.client.statObject(this.bucket, path) as CloudBlobStat;
      stat.container = container;
      return stat;
    } catch (e) {
      this.logger.debug(`Failed to stat: ${path}. ${e}`);
      throw new NotFoundHttpError(`Failed to stat: ${path}. ${e}`);
    }
  }

  public async write(path: string, data: Readable): Promise<boolean> {
    await this.createBucket();
    try {
      await this.client.putObject(this.bucket, path, data);
      return true;
    } catch (e) {
      this.logger.error(`Failed to write: ${path}. ${e}`);
      return false;
    }
  }

  public async writeContainer(path: string): Promise<boolean> {
    await this.createBucket();
    let containerName = this.containerFileName(path);
    let containerContent = this.containerFileContent(path);
    try {
      await this.client.putObject(this.bucket, containerName, containerContent);
      return true;
    } catch (e) {
      this.logger.error(`Failed to write container: ${path} ${containerName}. ${e}`);
      return false;
    }
  }

  public async delete(path: string): Promise<boolean> {
    try {
      await this.client.removeObject(this.bucket, path);
      return true;
    } catch (e) {
      this.logger.debug(`Failed to delete: ${path}. ${e}`);
      return false;
    }
  }

  public async read(path: string): Promise<Readable> {
    await this.createBucket();
    try {
      return await this.client.getObject(this.bucket, path);
    } catch (e) {
      this.logger.debug(`Failed to read: ${path}. ${e}`);
      throw new NotFoundHttpError(`Failed to read: ${path}. ${e}`);
    }
  }

  public async list(path: string): Promise<Array<string>> {
    await this.createBucket();
    return new Promise((res, rej) => {
      try {
        if (!path.endsWith("/")) {
          path = path + "/";
        }
        let items: string[] = [];
        let dir: BucketStream<BucketItem> = this.client.listObjectsV2(this.bucket, path);
        dir.on('data', (bi) => {
          if (bi.name && bi.name != this.containerFileName(path)) items.push(bi.name);
        });
        dir.on('end', () => { res(items); });
        dir.on('error', rej);
      } catch (e) {
        this.logger.error(`Failed to list: ${path}. ${e}`);
        rej(new NotFoundHttpError(`Failed to list: ${path}. ${e}`));
      }
    });
  }

  /**
   * Super helpful debugging tool
   */
  public logStream(stream: Readable) {
    let chunks: Buffer[] = [];
    let size = 0;
    stream.on('data', chunk => {
      size = size + chunk.length;
      chunks.push(Buffer.from(chunk));
    });
    stream.on('error', e => { console.error(e); });
    stream.on('end', () => {
      console.log(Buffer.concat(chunks).toString('utf8'));
      console.log('Total Size (bytes):', size);
    });
  }

  /**
   * Makes the path with .meta extension, so that you create the 
   * concept of a directory in the cloud. 
   *
   * Safe to assume you'll always get a path ending with a '/'
   */
  private containerFileName(path: string) {
    path = `${path}.meta`;
    return path;
  }

  private containerFileContent(path: string): Readable {
    let metadata = new RepresentationMetadata();
    metadata.add(RDF.terms.type, LDP.terms.Container);
    metadata.add(RDF.terms.type, LDP.terms.BasicContainer);
    metadata.add(namedNode('http://example.com/path'), literal(path));
    metadata.add(namedNode('http://example.com/version'), literal(1.0));
    return serializeQuads(metadata.quads());
  }

}
