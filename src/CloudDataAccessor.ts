import type { Readable } from 'node:stream';
import type { Quad } from '@rdfjs/types';
import { CONTENT_TYPE_TERM, DC, DataAccessor, Guarded, IANA, LDP, NotFoundHttpError, POSIX, RDF, Representation, RepresentationMetadata, ResourceIdentifier, ResourceLink, SOLID_META, UnsupportedMediaTypeHttpError, XSD, addResourceMetadata, getLoggerFor, guardStream, isContainerIdentifier, isContainerPath, parseContentType, parseQuads, serializeQuads, toLiteral, toNamedTerm, updateModifiedDate } from '@solid/community-server';
import { CloudBlobClient, CloudBlobStat } from './CloudBlobClient';
import { CloudExtensionBasedMapper } from './CloudExtensionBasedMapper';

/**
 * DataAccessor that uses the file system to store documents as files and containers as folders.
 */
export class CloudDataAccessor implements DataAccessor {
  protected readonly logger = getLoggerFor(this);

  protected readonly resourceMapper: CloudExtensionBasedMapper;
  protected readonly blobClient: CloudBlobClient;

  public constructor(resourceMapper: CloudExtensionBasedMapper, rootFilePath: string) {
    this.resourceMapper = resourceMapper;
    this.blobClient = new CloudBlobClient(rootFilePath);
  }

  /**
   * Only binary data can be directly stored as files so will error on non-binary data.
   */
  public async canHandle(representation: Representation): Promise<void> {
    if (!representation.binary) {
      throw new UnsupportedMediaTypeHttpError('Only binary data is supported.');
    }
  }

  /**
   * Will return data stream directly to the file corresponding to the resource.
   * Will throw NotFoundHttpError if the input is a container.
   */
  public async getData(identifier: ResourceIdentifier): Promise<Guarded<Readable>> {
    const link = await this.resourceMapper.mapUrlToFilePath(identifier, false);
    const data = await this.blobClient.read(link.filePath);
    return guardStream(data);
  }

  /**
   * Will return corresponding metadata by reading the metadata file (if it exists)
   * and adding file system specific metadata elements.
   */
  public async getMetadata(identifier: ResourceIdentifier): Promise<RepresentationMetadata> {
    const link = await this.resourceMapper.mapUrlToFilePath(identifier, false);

    // always check for the resource so that you don't go pulling
    // metadata for a file or container that doesn't exist. 
    // a response for stat means there is either the resource (file exists), 
    // or there is a container file, that implies there is a container.
    const stats = await this.blobClient.stats(link.filePath);

    if (stats.container) {
      return this.getDirectoryMetadata(link, stats);
    } else {
      return this.getFileMetadata(link, stats);
    }
    // on the getMetadata call the response will always be a RepresentationMetadata, but
    // only on resources (file/container) that exist. The response will be the file/container
    // stat info, plus any metadata that was added externally, stored as a resource with suffix .meta.
  }

  public async* getChildren(identifier: ResourceIdentifier): AsyncIterableIterator<RepresentationMetadata> {
    const link = await this.resourceMapper.mapUrlToFilePath(identifier, false);
    yield* this.getChildMetadata(link);
  }

  /**
   * Generate metadata for all children in a container.
   *
   * @param link - Path related metadata.
   */
  private async* getChildMetadata(link: ResourceLink): AsyncIterableIterator<RepresentationMetadata> {
    const dir = await this.blobClient.list(link.filePath);
    // For every child in the container we want to generate specific metadata
    for await (const entry of dir) {
      // Obtain details of the entry, resolving any symbolic links
      // const childPath = joinFilePath(link.filePath, entry.name);
      let childStats;
      try {
        childStats = await this.blobClient.stats(entry);
      } catch (e) {
        // Skip this entry if details could not be retrieved (e.g., bad symbolic link)
        continue;
      }

      // Ignore non-file/directory entries in the folder
      // if (!childStats.isFile() && !childStats.isDirectory()) {
      //   continue;
      // }

      // Generate the URI corresponding to the child resource
      const childLink = await this.resourceMapper.mapFilePathToUrl(entry, childStats.container);

      // Hide metadata files
      if (childLink.isMetadata) {
        continue;
      }

      // Generate metadata of this specific child as described in
      // https://solidproject.org/TR/2021/protocol-20211217#contained-resource-metadata
      const metadata = new RepresentationMetadata(childLink.identifier);
      addResourceMetadata(metadata, childStats.container);
      this.addPosixMetadata(metadata, childStats);
      // Containers will not have a content-type
      const { contentType, identifier } = childLink;
      if (contentType) {
        // Make sure we don't generate invalid URIs
        try {
          const { value } = parseContentType(contentType);
          metadata.add(RDF.terms.type, toNamedTerm(`${IANA.namespace}${value}#Resource`));
        } catch {
          this.logger.warn(`Detected an invalid content-type "${contentType}" for ${identifier.path}`);
        }
      }

      yield metadata;
    }
  }

  /**
   * Writes the given data as a file (and potential metadata as additional file).
   * The metadata file will be written first and will be deleted if something goes wrong writing the actual data.
   */
  public async writeDocument(identifier: ResourceIdentifier, data: Guarded<Readable>, metadata: RepresentationMetadata):
    Promise<void> {
    const link = await this.resourceMapper.mapUrlToFilePath(identifier, false, metadata.contentType);

    // Check if we already have a corresponding file with a different extension
    await this.verifyExistingExtension(link);

    const wroteMetadata = await this.writeMetadataFile(link, metadata);

    try {
      await this.blobClient.write(link.filePath, data);
    } catch (error: unknown) {
      // Delete the metadata if there was an error writing the file
      if (wroteMetadata) {
        const metaLink = await this.resourceMapper.mapUrlToFilePath(identifier, true);
        await this.blobClient.delete(metaLink.filePath);
      }
      throw error;
    }
  }

  /**
   * Creates corresponding folder if necessary and writes metadata to metadata file if necessary.
   */
  public async writeContainer(identifier: ResourceIdentifier, metadata: RepresentationMetadata): Promise<void> {
    const link = await this.resourceMapper.mapUrlToFilePath(identifier, false);
    let written = await this.blobClient.writeContainer(link.filePath);
    if (written) {
      await this.writeMetadataFile(link, metadata);
    }
  }

  public async writeMetadata(identifier: ResourceIdentifier, metadata: RepresentationMetadata): Promise<void> {
    const metadataLink = await this.resourceMapper.mapUrlToFilePath(identifier, true);
    await this.writeMetadataFile(metadataLink, metadata);
  }

  /**
   * Removes the corresponding file/folder (and metadata file).
   */
  public async deleteResource(identifier: ResourceIdentifier): Promise<void> {
    const metaLink = await this.resourceMapper.mapUrlToFilePath(identifier, true);
    await this.blobClient.delete(metaLink.filePath);

    const link = await this.resourceMapper.mapUrlToFilePath(identifier, false);

    if (!isContainerIdentifier(identifier)) {
      await this.blobClient.delete(link.filePath);
    } else if (isContainerIdentifier(identifier)) {
      await this.blobClient.delete(link.filePath);
    } else {
      throw new NotFoundHttpError(`Failed to delete !(container/file): ${link.filePath}`);
    }
  }

  /**
   * Reads and generates all metadata relevant for the given file,
   * ingesting it into a RepresentationMetadata object.
   *
   * @param link - Path related metadata.
   * @param stats - Stats object of the corresponding file.
   */
  private async getFileMetadata(link: ResourceLink, stats: CloudBlobStat): Promise<RepresentationMetadata> {
    const metadata = await this.getBaseMetadata(link, stats, false);
    // If the resource is using an unsupported contentType, the original contentType was written to the metadata file.
    // As a result, we should only set the contentType derived from the file path,
    // when no previous metadata entry for contentType is present.
    if (typeof metadata.contentType === 'undefined') {
      metadata.set(CONTENT_TYPE_TERM, link.contentType);
    }
    return metadata;
  }

  /**
   * Reads and generates all metadata relevant for the given directory,
   * ingesting it into a RepresentationMetadata object.
   *
   * @param link - Path related metadata.
   * @param stats - Stats object of the corresponding directory.
   */
  private async getDirectoryMetadata(link: ResourceLink, stats: CloudBlobStat): Promise<RepresentationMetadata> {
    return await this.getBaseMetadata(link, stats, true);
  }

  /**
   * Writes the metadata of the resource to a meta file.
   *
   * @param link - Path related metadata of the resource.
   * @param metadata - Metadata to write.
   *
   * @returns True if data was written to a file.
   */
  protected async writeMetadataFile(link: ResourceLink, metadata: RepresentationMetadata): Promise<boolean> {
    // These are stored by file system conventions
    metadata.remove(RDF.terms.type, LDP.terms.Resource);
    metadata.remove(RDF.terms.type, LDP.terms.Container);
    metadata.remove(RDF.terms.type, LDP.terms.BasicContainer);
    metadata.removeAll(DC.terms.modified);
    // When writing metadata for a document, only remove the content-type when dealing with a supported media type.
    // A media type is supported if the FileIdentifierMapper can correctly store it.
    // This allows restoring the appropriate content-type on data read (see getFileMetadata).
    if (isContainerPath(link.filePath) || typeof link.contentType !== 'undefined') {
      metadata.removeAll(CONTENT_TYPE_TERM);
    }
    const quads = metadata.quads();
    const metadataLink = await this.resourceMapper.mapUrlToFilePath(link.identifier, true);
    let wroteMetadata: boolean;

    // Write metadata to file if there are quads remaining
    if (quads.length > 0 || isContainerPath(link.filePath)) {
      // Determine required content-type based on mapper
      const serializedMetadata = serializeQuads(quads, metadataLink.contentType);
      await this.blobClient.write(metadataLink.filePath, serializedMetadata);
      wroteMetadata = true;

      // Delete (potentially) existing metadata file if no metadata needs to be stored
    } else {
      await this.blobClient.delete(metadataLink.filePath);
      wroteMetadata = false;
    }
    return wroteMetadata;
  }

  /**
   * Generates metadata relevant for any resources stored by this accessor.
   *
   * @param link - Path related metadata.
   * @param stats - Stats objects of the corresponding directory.
   * @param isContainer - If the path points to a container (directory) or not.
   */
  private async getBaseMetadata(link: ResourceLink, stats: CloudBlobStat, isContainer: boolean):
    Promise<RepresentationMetadata> {
    // this is the metadata that was added externally and might not exist.
    let raw = await this.getRawMetadata(link.identifier);
    const metadata = new RepresentationMetadata(link.identifier).addQuads(raw);
    addResourceMetadata(metadata, isContainer);
    this.addPosixMetadata(metadata, stats);
    return metadata;
  }

  /**
   * Reads the metadata from the corresponding metadata file.
   * Returns an empty array if there is no metadata file.
   *
   * @param identifier - Identifier of the resource (not the metadata!).
   */
  private async getRawMetadata(identifier: ResourceIdentifier): Promise<Quad[]> {
    const metadataLink = await this.resourceMapper.mapUrlToFilePath(identifier, true);
    try {
      let readMetadataStream = await this.blobClient.read(metadataLink.filePath);
      return await parseQuads(guardStream(readMetadataStream), { format: metadataLink.contentType, baseIRI: identifier.path });
    } catch (error: unknown) {
      // Metadata file doesn't exist so lets keep `rawMetaData` an empty array.
      if (!NotFoundHttpError.isInstance(error)) {
        throw error;
      }
      return [];
    }
  }

  /**
   * Helper function to add file system related metadata.
   *
   * @param metadata - metadata object to add to
   * @param stats - Stats of the file/directory corresponding to the resource.
   */
  private addPosixMetadata(metadata: RepresentationMetadata, stats: CloudBlobStat): void {
    updateModifiedDate(metadata, stats.lastModified);
    metadata.add(
      POSIX.terms.mtime,
      toLiteral(Math.floor(stats.lastModified.getTime() / 1000), XSD.terms.integer),
      SOLID_META.terms.ResponseMetadata,
    );
    if (!stats.container) {
      metadata.add(POSIX.terms.size, toLiteral(stats.size, XSD.terms.integer), SOLID_META.terms.ResponseMetadata);
    }
  }

  /**
   * Verifies if there already is a file corresponding to the given resource.
   * If yes, that file is removed if it does not match the path given in the input ResourceLink.
   * This can happen if the content-type differs from the one that was stored.
   *
   * @param link - ResourceLink corresponding to the new resource data.
   */
  protected async verifyExistingExtension(link: ResourceLink): Promise<void> {
    // Delete the old file with the (now) wrong extension
    const oldLink = await this.resourceMapper.mapUrlToFilePath(link.identifier, false);
    if (oldLink.filePath !== link.filePath) {
      await this.blobClient.delete(oldLink.filePath);
    }
  }
}
