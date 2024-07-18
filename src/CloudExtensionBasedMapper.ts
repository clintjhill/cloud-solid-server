import * as path from "path";
import * as mime from 'mime-types';
import { BaseFileIdentifierMapper, DEFAULT_CUSTOM_TYPES, FileIdentifierMapperFactory, InternalServerError, NotImplementedHttpError, ResourceIdentifier, ResourceLink, encodeUriPathComponents, ensureTrailingSlash, getExtension, trimTrailingSlashes } from '@solid/community-server';
import { CloudBlobClient } from './CloudBlobClient';

/**
 * Supports the behaviour described in https://www.w3.org/DesignIssues/HTTPFilenameMapping.html
 * Determines content-type based on the file extension.
 * In case an identifier does not end on an extension matching its content-type,
 * the corresponding file will be appended with the correct extension, preceded by $.
 */
export class CloudExtensionBasedMapper extends BaseFileIdentifierMapper {
  private readonly customTypes: Record<string, string>;
  private readonly customExtensions: Record<string, string>;
  private readonly blobClient: CloudBlobClient;
  private readonly internalRootFilepath: string;
  private readonly templatePath: string;

  public constructor(baseUrl: string, rootFilepath: string, customTypes?: Record<string, string>) {
    // We abstract the rootFilepath because we intend to use it instead as a bucket name. 
    // This makes the rootFilepath of the bucket "root", and maintains functionality of original community-server.
    super(baseUrl, "root");
    this.internalRootFilepath = "root";
    this.templatePath = path.join(process.cwd(), 'node_modules', '@solid', 'community-server', 'templates');
    this.blobClient = new CloudBlobClient(rootFilepath);

    // Workaround for https://github.com/LinkedSoftwareDependencies/Components.js/issues/20
    if (!customTypes || Object.keys(customTypes).length === 0) {
      this.customTypes = DEFAULT_CUSTOM_TYPES;
    } else {
      this.customTypes = customTypes;
    }

    this.customExtensions = {};
    for (const [extension, contentType] of Object.entries(this.customTypes)) {
      this.customExtensions[contentType] = extension;
    }
  }

  protected async mapUrlToDocumentPath(identifier: ResourceIdentifier, filePath: string, contentType?: string): Promise<ResourceLink> {
    // Would conflict with how new extensions are stored
    if (/\$\.\w+$/u.test(filePath)) {
      this.logger.warn(`Identifier ${identifier.path} contains a dollar sign before its extension`);
      throw new NotImplementedHttpError('Identifiers cannot contain a dollar sign before their extension');
    }

    // Existing file
    if (!contentType) {
      // Find a matching file
      const [, folder, documentName] = /^(.*\/)(.*)$/u.exec(filePath)!;
      let fileName: string | undefined;
      try {
        const files = await this.blobClient.list(folder);
        fileName = files.find((file): boolean => {
          let starts = file.startsWith(folder + documentName);
          let ext = /(?:\$\..+)?$/u.test(file.slice(documentName.length));
          return starts && ext;
        });
      } catch {
        // Parent folder does not exist (or is not a folder)
      }
      if (fileName) {
        filePath = fileName;
      }
      contentType = await this.getContentTypeFromPath(filePath);

      // If the extension of the identifier matches a different content-type than the one that is given,
      // we need to add a new extension to match the correct type.
    } else if (contentType !== await this.getContentTypeFromPath(filePath)) {
      let extension: string = mime.extension(contentType) || this.customExtensions[contentType];
      if (!extension) {
        // When no extension is found for the provided content-type, use a fallback extension.
        extension = this.unknownMediaTypeExtension;
        // Signal the fallback by setting the content-type to undefined in the output link.
        contentType = undefined;
      }
      filePath += `$.${extension}`;
    }
    return super.mapUrlToDocumentPath(identifier, filePath, contentType);
  }

  protected async getContentTypeFromPath(filePath: string): Promise<string> {
    const extension = getExtension(filePath).toLowerCase();
    return mime.lookup(extension) ||
      this.customTypes[extension] ||
      await super.getContentTypeFromPath(filePath);
  }

  public async mapFilePathToUrl(filePath: string, isContainer: boolean): Promise<ResourceLink> {
    if (!filePath.startsWith(this.internalRootFilepath) && !filePath.startsWith(this.templatePath)) {
      this.logger.error(`Trying to access file ${filePath} outside of ${this.rootFilepath}`);
      throw new InternalServerError(`File ${filePath} is not part of the file storage at ${this.rootFilepath}`);
    }
    const relative = filePath.slice(this.rootFilepath.length);
    let url: string;
    let contentType: string | undefined;

    if (isContainer) {
      url = await this.getContainerUrl(relative);
      this.logger.debug(`Container filepath ${filePath} maps to URL ${url}`);
    } else {
      url = await this.getDocumentUrl(relative);
      this.logger.debug(`Document ${filePath} maps to URL ${url}`);
      contentType = await this.getContentTypeFromPath(filePath);
    }
    const isMetadata = this.isMetadataPath(filePath);
    if (isMetadata) {
      url = url.slice(0, -".meta".length);
    }
    return { identifier: { path: url }, filePath, contentType, isMetadata };
  }

  protected async getDocumentUrl(relative: string): Promise<string> {
    return super.getDocumentUrl(this.stripExtension(relative));
  }

  protected stripExtension(path: string): string {
    const extension = getExtension(path);
    if (extension && path.endsWith(`$.${extension}`)) {
      path = path.slice(0, -(extension.length + 2));
    }
    return path;
  }
}

export class CloudExtensionBasedMapperFactory implements FileIdentifierMapperFactory<CloudExtensionBasedMapper> {
  public async create(base: string, rootFilePath: string): Promise<CloudExtensionBasedMapper> {
    return new CloudExtensionBasedMapper(base, rootFilePath);
  }
}
