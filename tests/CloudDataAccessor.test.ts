import test, { Test } from "tape-promise/tape";
import { createReadStream } from "fs";
import { CloudDataAccessor } from "../src/CloudDataAccessor";
import { CloudBlobClient } from "../src/CloudBlobClient";
import { CloudExtensionBasedMapper } from "../src/CloudExtensionBasedMapper";
import { base, rootFilepath, createDocument, within, data } from "./config";
import { APPLICATION_OCTET_STREAM, CONTENT_TYPE, DC, LDP, NotFoundHttpError, POSIX, RDF, Representation, RepresentationMetadata, SOLID_META, UnsupportedMediaTypeHttpError, XSD, isContainerPath, readableToString, toLiteral } from "@solid/community-server";

let client = new CloudBlobClient(rootFilepath);
let mapper = new CloudExtensionBasedMapper(base, rootFilepath);
let accessor = new CloudDataAccessor(mapper, rootFilepath);
let now: Date;
let metadata: RepresentationMetadata;

async function setup() {
  let plainText = createReadStream("./tests/fixtures/plain.txt");
  // setup a file such that a directory name could be matched.
  // write to the "root" to assure CloudExtensionBasedMapper rootFilepath is respected.
  await client.write("root/cloud-data-accessor/plain.txt", plainText);
  metadata = new RepresentationMetadata(APPLICATION_OCTET_STREAM);
  now = new Date();
  now.setMilliseconds(0);
};

test('CloudDataAccessor: Setup', async (t: Test) => {
  await setup();
  t.pass("Setup Completed.");
});

test('CloudDataAccessor: can only handle binary data.', async (t: Test) => {
  let handles = async () => { await accessor.canHandle({ binary: true } as Representation); }
  let notHandles = async () => { await accessor.canHandle({ binary: false } as Representation); }
  await t.doesNotReject(handles, UnsupportedMediaTypeHttpError, "Handles binary.");
  await t.rejects(notHandles, UnsupportedMediaTypeHttpError, "Does not handle non-binary.");
  t.end();
});

test('CloudDataAccessor: throws a 404 if the identifier does not start with the base.', async (t: Test) => {
  let notFound = async () => { await accessor.getData({ path: "badpath" }); };
  await t.rejects(notFound, NotFoundHttpError, "Not found bad path.");
  t.end();
});

test('CloudDataAccessor: throws a 404 if the identifier does not match an existing file.', async (t: Test) => {
  let notFound = async () => { await accessor.getData({ path: `${base}cloud-data-accessor/not-found` }); };
  await t.rejects(notFound, NotFoundHttpError, "Not found non-existent.");
  t.end();
});

test('CloudDataAccessor: throws a 404 if the identifier matches a directory.', async (t: Test) => {
  let notFound = async () => { await accessor.getData({ path: `${base}cloud-data-accessor/resource` }); };
  await t.rejects(notFound, NotFoundHttpError, "Not found directory.");
  t.end();
});

test('CloudDataAccessor: returns the corresponding data.', async (t: Test) => {
  let stream = await accessor.getData({ path: `${base}cloud-data-accessor/plain.txt` });
  let actual = await readableToString(stream);
  let expected = await readableToString(createReadStream("./tests/fixtures/plain.txt"));
  t.looseEqual(actual, expected, "Content matches.");
  stream.destroy(); // release blob storage handle
  t.end();
});

// it('throws an error if something else went wrong.', async(): Promise<void> => {
//   jest.requireMock('fs-extra').stat = (): any => {
//     throw new Error('error');
//   };
//   await expect(accessor.getData({ path: `${base}resource` })).rejects.toThrow('error');
// });

test('CloudDataAccessor: throws a 404 if the identifier does not start with the base.', async (t: Test) => {
  let notFound = async () => { await accessor.getMetadata({ path: "badpath" }); };
  await t.rejects(notFound, NotFoundHttpError, "Not found bad path.");
  t.end();
});

test('CloudDataAccessor: throws a 404 if the identifier does not match an existing file.', async (t: Test) => {
  let notFound = async () => { await accessor.getMetadata({ path: `${base}cloud-data-accessor/` }); };
  await t.rejects(notFound, NotFoundHttpError, "Not found non-existent.");
  t.end();
});

test('CloudDataAccessor: throws 404 if it matches something that is no file or directory.', async (t: Test) => {
  let notFound = async () => { await accessor.getMetadata({ path: base }) };
  await t.rejects(notFound, NotFoundHttpError, "Not found not file.");
  t.end();
});

test('CloudDataAccessor: throws a 404 if the trailing slash does not match its type.', async (t: Test) => {
  let fileSlashed = async () => await accessor.getMetadata({ path: `${base}cloud-data-accessor/plain/` });
  let containerUnslashed = async () => await accessor.getMetadata({ path: `${base}cloud-data-accessor` });
  await t.rejects(fileSlashed, NotFoundHttpError, "File slashed.");
  await t.rejects(containerUnslashed, NotFoundHttpError, "Container unslashed.");
});

test('CloudDataAccessor: generates the metadata for a resource.', async (t: Test) => {
  let metadata = await accessor.getMetadata({ path: `${base}cloud-data-accessor/plain.txt` });
  t.equal(metadata.identifier.value, `${base}cloud-data-accessor/plain.txt`, "Identifier Value.");
  t.equal(metadata.contentType, "text/plain", "Content Type.");
  t.equal(metadata.get(RDF.terms.type)?.value, LDP.Resource, "RDF Resource.");
  t.deepEqual(metadata.get(POSIX.terms.size), toLiteral(19, XSD.terms.integer), "POSIX Size.");
  t.ok(within(metadata.get(DC.terms.modified), 2, now, true), "LastModified.");
  t.ok(within(metadata.get(POSIX.terms.mtime), 2, now), "POSIX mtime.");
  t.equal(metadata.quads(null, null, null, SOLID_META.terms.ResponseMetadata).length, 2, "ResponseMetadata.");
  t.end();
});

test('CloudDataAccessor: does not generate size metadata for a container.', async (t: Test) => {
  let identifier = { path: `${base}cloud-data-accessor/container/` };
  await accessor.writeContainer(identifier, new RepresentationMetadata(identifier));
  let metadata = await accessor.getMetadata(identifier);
  t.notOk(metadata.get(POSIX.terms.size), "No size.");
  t.ok(within(metadata.get(DC.terms.modified), 2, now, true), "LastModified.");
});

test('CloudDataAccessor: generates the metadata for a container.', async (t: Test) => {
  let identifier = { path: `${base}cloud-data-accessor/container/` };
  let metadata = await accessor.getMetadata(identifier);
  t.equal(metadata.identifier.value, identifier.path, "Identifier.");
  t.deepEqual(metadata.getAll(RDF.terms.type), [LDP.terms.Container, LDP.terms.BasicContainer, LDP.terms.Resource], "Container Resource type.");
  t.notOk(metadata.get(POSIX.terms.size), "No size.");
  t.ok(within(metadata.get(DC.terms.modified), 2, now, true), "LastModified.");
  t.ok(within(metadata.get(POSIX.terms.mtime), 2, now), "POSIX mtime.");
  t.equal(metadata.quads(null, null, null, SOLID_META.terms.ResponseMetadata).length, 1, "ResponseMetadata.");
});

test('CloudDataAccessor: generates metadata for container child resources.', async (t: Test) => {

  let container = { path: `${base}cloud-data-accessor/container/` };
  await accessor.writeContainer(container, new RepresentationMetadata(container));
  let internalContainerOne = { path: `${base}cloud-data-accessor/container/internalContainerOne/` };
  await accessor.writeContainer(internalContainerOne, new RepresentationMetadata(internalContainerOne));
  let internalContainerTwo = { path: `${base}cloud-data-accessor/container/internalContainerTwo/` };
  await accessor.writeContainer(internalContainerTwo, new RepresentationMetadata(internalContainerTwo));

  await createDocument(accessor, "cloud-data-accessor/container/extraFile");
  await createDocument(accessor, "cloud-data-accessor/container/resource");
  await createDocument(accessor, "cloud-data-accessor/container/internalContainerOne/shouldNotSeeMe");
  await createDocument(accessor, "cloud-data-accessor/container/internalContainerTwo/shouldNotSeeMeEither");

  const children: RepresentationMetadata[] = [];
  for await (const child of accessor.getChildren(container)) {
    children.push(child);
  }

  t.equal(children.length, 4, "Children match 4.");

  t.deepLooseEqual(new Set(children.map(c => c.identifier.value)), new Set([
    `${base}cloud-data-accessor/container/extraFile`,
    `${base}cloud-data-accessor/container/resource`,
    `${base}cloud-data-accessor/container/internalContainerOne/`,
    `${base}cloud-data-accessor/container/internalContainerTwo/`
  ]), "Identifiers match.");

  for (const c of children.filter(({ identifier }): boolean => identifier.value.endsWith('/'))) {
    const types = c.getAll(RDF.terms.type).map((t): string => t.value);
    t.ok(types.includes(LDP.Resource), "Container is Resource.");
    t.ok(types.includes(LDP.Container), "Container is Container.");
    t.ok(types.includes(LDP.BasicContainer), "Container is BasicContainer");
  }

  for (const c of children.filter(({ identifier }): boolean => !identifier.value.endsWith('/'))) {
    const types = c.getAll(RDF.terms.type).map((t): string => t.value);
    t.ok(types.includes(LDP.Resource), "Document is Resource.");
    t.ok(types.includes("http://www.w3.org/ns/iana/media-types/application/octet-stream#Resource"), "Special Case Resource.");
    t.notOk(types.includes(LDP.Container), "Document is not Container.");
    t.notOk(types.includes(LDP.BasicContainer), "Document is not BasicContainer");
  }

  for (const c of children) {
    t.ok(within(c.get(DC.terms.modified), 2, now, true), "LastModified.");
    t.ok(within(c.get(POSIX.terms.mtime), 2, now), "POSIX mtime.");
    t.deepLooseEqual(c.quads(null, null, null, SOLID_META.terms.ResponseMetadata).length,
      isContainerPath(c.identifier.value) ? 1 : 2, "ResponseMetadata.");
  }
});

test.skip('does not generate IANA URIs for children with invalid content-types.', async (t: Test) => {
  t.fail("Not tested.");
});

test.skip('adds stored metadata when requesting metadata.', async (t: Test) => {
  t.fail("Not tested.");
});

test.skip('throws an error if there is a problem with the internal metadata.', async (t: Test) => {
  t.fail("Not tested.");
});

test('CloudDataAccessor: throws a 404 if the identifier does not start with the base.', async (t: Test) => {
  let notFound = async () => accessor.writeDocument({ path: 'badpath' }, data(), metadata);
  await t.rejects(notFound, NotFoundHttpError, "Bad Path.");
});

test('CloudDataAccessor: writes the data to the corresponding file.', async (t: Test) => {
  let write = async () => { await accessor.writeDocument({ path: `${base}cloud-data-accessor/resource` }, data(), metadata) };
  await t.doesNotReject(write, "Successful write.");
  let actual = await readableToString(await client.read('root/cloud-data-accessor/resource'));
  let expected = "data";
  t.equal(actual, expected, "File written.");
});

test('CloudDataAccessor: writes metadata to the corresponding file.', async (t: Test) => {
  let identifier = { path: `${base}cloud-data-accessor/res.ttl` };
  let likesMetadata = new RepresentationMetadata(
    identifier,
    { [CONTENT_TYPE]: 'text/turtle', likes: 'apples' },
  );

  let writeMetadata = async () => { await accessor.writeDocument(identifier, data(), likesMetadata); };
  await t.doesNotReject(writeMetadata, "Successful write.");

  let actualFile = await readableToString(await client.read('root/cloud-data-accessor/res.ttl'));
  t.equal(actualFile, "data", "Data file.");

  let actualMetadataFile = await readableToString(await client.read('root/cloud-data-accessor/res.ttl.meta'));
  t.match(actualMetadataFile, new RegExp(`<${base}cloud-data-accessor/res.ttl> <likes> "apples".`), "Metadata file.");
});

test('CloudDataAccessor: does not write metadata that is stored by the file system.', async (t: Test) => {
  metadata.add(RDF.terms.type, LDP.terms.Resource);
  let writeMetadata = async () => { await accessor.writeDocument({ path: `${base}cloud-data-accessor/no-meta-test` }, data(), metadata); };
  await t.doesNotReject(writeMetadata, "Successful write.");
  let notFound = async () => { await client.read('root/cloud-data-accessor/no-meta-test.meta'); };
  await t.rejects(notFound, NotFoundHttpError, "No metadata.");
});

test('CloudDataAccessor: deletes existing metadata if nothing new needs to be stored.', async (t: Test) => {
  await client.write('root/cloud-data-accessor/delete-meata', data());
  await client.write('root/cloud-data-accessor/delete-meata.meta', data());
  let deleteMeta = async () => { await accessor.writeDocument({ path: `${base}cloud-data-accessor/delete-meata` }, data(), metadata) };
  await t.doesNotReject(deleteMeta, "Deleted meta.");
  let notFound = async () => { await client.read('root/cloud-data-accessor/delete-meata.meta'); };
  await t.rejects(notFound, NotFoundHttpError, "No metadata.");
});

// describe('writing a document', (): void => {

//   it('errors if there is a problem deleting the old metadata file.', async(): Promise<void> => {
//     cache.data = { resource: 'data', 'resource.meta': 'metadata!' };
//     jest.requireMock('fs-extra').remove = (): any => {
//       throw new Error('error');
//     };
//     await expect(accessor.writeDocument({ path: `${base}resource` }, data, metadata))
//       .rejects.toThrow('error');
//   });

//   it('throws if something went wrong writing a file.', async(): Promise<void> => {
//     data.read = (): any => {
//       data.emit('error', new Error('error'));
//       return null;
//     };
//     await expect(accessor.writeDocument({ path: `${base}resource` }, data, metadata))
//       .rejects.toThrow('error');
//   });

//   it('deletes the metadata file if something went wrong writing the file.', async(): Promise<void> => {
//     data.read = (): any => {
//       data.emit('error', new Error('error'));
//       return null;
//     };
//     metadata.add(namedNode('likes'), 'apples');
//     await expect(accessor.writeDocument({ path: `${base}resource` }, data, metadata))
//       .rejects.toThrow('error');
//     expect(cache.data['resource.meta']).toBeUndefined();
//   });

//   it('updates the filename if the content-type gets updated.', async(): Promise<void> => {
//     cache.data = { 'resource$.ttl': '<this> <is> <data>.', 'resource.meta': '<this> <is> <metadata>.' };
//     metadata.identifier = DataFactory.namedNode(`${base}resource`);
//     metadata.contentType = 'text/plain';
//     metadata.add(namedNode('new'), 'metadata');
//     await expect(accessor.writeDocument({ path: `${base}resource` }, data, metadata))
//       .resolves.toBeUndefined();
//     expect(cache.data).toEqual({
//       'resource$.txt': 'data',
//       'resource.meta': expect.stringMatching(`<${base}resource> <new> "metadata".`),
//     });
//   });

//   it('does not try to update the content-type if there is no original file.', async(): Promise<void> => {
//     metadata.identifier = DataFactory.namedNode(`${base}resource.txt`);
//     metadata.contentType = 'text/turtle';
//     metadata.add(namedNode('new'), 'metadata');
//     await expect(accessor.writeDocument({ path: `${base}resource.txt` }, data, metadata))
//       .resolves.toBeUndefined();
//     expect(cache.data).toEqual({
//       'resource.txt$.ttl': 'data',
//       'resource.txt.meta': expect.stringMatching(`<${base}resource.txt> <new> "metadata".`),
//     });
//   });

//   it('throws an error if there is an issue deleting the original file.', async(): Promise<void> => {
//     cache.data = { 'resource$.ttl': '<this> <is> <data>.' };
//     jest.requireMock('fs-extra').remove = (): any => {
//       const error = new Error('error') as SystemError;
//       error.code = 'EISDIR';
//       error.syscall = 'unlink';
//       throw error;
//     };

//     metadata.contentType = 'text/plain';
//     await expect(accessor.writeDocument({ path: `${base}resource` }, data, metadata))
//       .rejects.toThrow('error');
//   });
// });
