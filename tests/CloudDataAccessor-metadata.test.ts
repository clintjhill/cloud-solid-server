import test, { Test } from "tape-promise/tape";
import { createReadStream } from "fs";
import { Readable } from "stream";
import { CloudDataAccessor } from "../src/CloudDataAccessor";
import { CloudBlobClient } from "../src/CloudBlobClient";
import { CloudExtensionBasedMapper } from "../src/CloudExtensionBasedMapper";
import { DC, LDP, NotFoundHttpError, POSIX, RDF, RepresentationMetadata, SOLID_META, XSD, guardStream, toLiteral } from "@solid/community-server";
import { base, rootFilePath } from "./config";

let mapper = new CloudExtensionBasedMapper(base, rootFilePath);
let client = new CloudBlobClient(rootFilePath);
let accessor = new CloudDataAccessor(mapper, rootFilePath);

let now = new Date();
now.setMilliseconds(0);

test("Throws 404 if identifier does not start with base.", async (t: Test) => {
  let notFound = async () => { await accessor.getMetadata({ path: "badpath" }); };
  await t.rejects(notFound, NotFoundHttpError, "Not found bad path.");
  t.end();
});

test("Throws 404 if identifier does not match an existing file.", async (t: Test) => {
  let notFound = async () => { await accessor.getMetadata({ path: `${base}cloud-data-accessor/` }); };
  await t.rejects(notFound, NotFoundHttpError, "Not found non-existent.");
  t.end();
});

test("Generate the metadata for a resource.", async (t: Test) => {
  let plainText = createReadStream("./tests/fixtures/plain.txt");
  await client.write("cloud-data-accessor/plain.txt", plainText);
  let metadata = await accessor.getMetadata({ path: `${base}cloud-data-accessor/plain.txt` });
  t.equal(metadata.identifier.value, `${base}cloud-data-accessor/plain.txt`, "Identifier Value.");
  t.equal(metadata.contentType, "text/plain", "Content Type.");
  t.equal(metadata.get(RDF.terms.type)?.value, LDP.Resource, "RDF Resource.");
  t.deepEqual(metadata.get(POSIX.terms.size), toLiteral(19, XSD.terms.integer), "POSIX Size.");
  t.deepEqual(metadata.get(DC.terms.modified), toLiteral(now.toISOString(), XSD.terms.dateTime), "LastModified.");
  t.deepEqual(metadata.get(POSIX.terms.mtime), toLiteral(Math.floor(now.getTime() / 1000), XSD.terms.integer), "POSIX mtime.");
  t.equal(metadata.quads(null, null, null, SOLID_META.terms.ResponseMetadata).length, 2, "ResponseMetadata.");
  t.end();
});

test("Does not generate size metadata for a container", async (t: Test) => {
  let identifier = { path: `${base}cloud-data-accessor/container/` };
  await accessor.writeContainer(identifier, new RepresentationMetadata(identifier));
  let metadata = await accessor.getMetadata(identifier);
  t.notOk(metadata.get(POSIX.terms.size), "No size.");
  t.deepEqual(metadata.get(DC.terms.modified), toLiteral(now.toISOString(), XSD.terms.dateTime), "LastModified.");
});

test("Generates the metadata for a container.", async (t: Test) => {
  let identifier = { path: `${base}cloud-data-accessor/container/` };
  let metadata = await accessor.getMetadata(identifier);
  t.equal(metadata.identifier.value, identifier.path, "Identifier.");
  t.deepEqual(metadata.getAll(RDF.terms.type), [LDP.terms.Container, LDP.terms.BasicContainer, LDP.terms.Resource], "Container Resource type.");
  t.notOk(metadata.get(POSIX.terms.size), "No size.");
  t.deepEqual(metadata.get(DC.terms.modified), toLiteral(now.toISOString(), XSD.terms.dateTime), "LastModified.");
  t.deepEqual(metadata.get(POSIX.terms.mtime), toLiteral(Math.floor(now.getTime() / 1000), XSD.terms.integer), "POSIX mtime.");
  t.equal(metadata.quads(null, null, null, SOLID_META.terms.ResponseMetadata).length, 1, "ResponseMetadata.");
});

test("Generates metadata for container child resources.", async (t: Test) => {
  let container = { path: `${base}cloud-data-accessor/container/` };
  await accessor.writeContainer(container, new RepresentationMetadata(container));
  let resource = { path: `${base}cloud-data-accessor/container/resource` };
  await accessor.writeDocument(resource, guardStream(Readable.from(["data"])), new RepresentationMetadata(resource));

  const children: RepresentationMetadata[] = [];
  for await (const child of accessor.getChildren(container)) {
    children.push(child);
  }

  t.equal(children.length, 2, "Resource and it's meta file.");
});



// it('generates metadata for container child resources.', async(): Promise<void> => {
//   cache.data = {
//     container: {
//       resource: 'data',
//       'resource.meta': 'metadata',
//       symlink: Symbol(`${rootFilePath}/container/resource`),
//       symlinkContainer: Symbol(`${rootFilePath}/container/container2`),
//       symlinkInvalid: Symbol(`${rootFilePath}/invalid`),
//       notAFile: 5,
//       container2: {},
//     },
//   };

//   const children = [];
//   for await (const child of accessor.getChildren({ path: `${base}container/` })) {
//     children.push(child);
//   }

//   // Identifiers
//   expect(children).toHaveLength(4);
//   expect(new Set(children.map((child): string => child.identifier.value))).toEqual(new Set([
//     `${base}container/container2/`,
//     `${base}container/resource`,
//     `${base}container/symlink`,
//     `${base}container/symlinkContainer/`,
//   ]));

//   // Containers
//   for (const child of children.filter(({ identifier }): boolean => identifier.value.endsWith('/'))) {
//     const types = child.getAll(RDF.terms.type).map((term): string => term.value);
//     expect(types).toContain(LDP.Resource);
//     expect(types).toContain(LDP.Container);
//     expect(types).toContain(LDP.BasicContainer);
//   }

//   // Documents
//   for (const child of children.filter(({ identifier }): boolean => !identifier.value.endsWith('/'))) {
//     const types = child.getAll(RDF.terms.type).map((term): string => term.value);
//     expect(types).toContain(LDP.Resource);
//     expect(types).toContain('http://www.w3.org/ns/iana/media-types/application/octet-stream#Resource');
//     expect(types).not.toContain(LDP.Container);
//     expect(types).not.toContain(LDP.BasicContainer);
//   }

//   // All resources
//   for (const child of children) {
//     expect(child.get(DC.terms.modified)).toEqualRdfTerm(toLiteral(now.toISOString(), XSD.terms.dateTime));
//     expect(child.get(POSIX.terms.mtime))
//       .toEqualRdfTerm(toLiteral(Math.floor(now.getTime() / 1000), XSD.terms.integer));
//     // `dc:modified` is in the default graph
//     expect(child.quads(null, null, null, SOLID_META.terms.ResponseMetadata))
//       .toHaveLength(isContainerPath(child.identifier.value) ? 1 : 2);
//   }
// });

