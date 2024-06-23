import test, { Test } from "tape-promise/tape";
import { createReadStream } from "fs";
import { Readable } from "stream";
import { CloudDataAccessor } from "../src/CloudDataAccessor";
import { CloudBlobClient } from "../src/CloudBlobClient";
import { CloudExtensionBasedMapper } from "../src/CloudExtensionBasedMapper";
import { DC, LDP, NotFoundHttpError, POSIX, RDF, RepresentationMetadata, SOLID_META, XSD, guardStream, isContainerPath, toLiteral } from "@solid/community-server";
import { base, rootFilePath, within } from "./config";

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
  t.ok(within(metadata.get(DC.terms.modified), 2, now, true), "LastModified.");
  t.ok(within(metadata.get(POSIX.terms.mtime), 2, now), "POSIX mtime.");
  t.equal(metadata.quads(null, null, null, SOLID_META.terms.ResponseMetadata).length, 2, "ResponseMetadata.");
  t.end();
});

test("Does not generate size metadata for a container", async (t: Test) => {
  let identifier = { path: `${base}cloud-data-accessor/container/` };
  await accessor.writeContainer(identifier, new RepresentationMetadata(identifier));
  let metadata = await accessor.getMetadata(identifier);
  t.notOk(metadata.get(POSIX.terms.size), "No size.");
  t.ok(within(metadata.get(DC.terms.modified), 2, now, true), "LastModified.");
});

test("Generates the metadata for a container.", async (t: Test) => {
  let identifier = { path: `${base}cloud-data-accessor/container/` };
  let metadata = await accessor.getMetadata(identifier);
  t.equal(metadata.identifier.value, identifier.path, "Identifier.");
  t.deepEqual(metadata.getAll(RDF.terms.type), [LDP.terms.Container, LDP.terms.BasicContainer, LDP.terms.Resource], "Container Resource type.");
  t.notOk(metadata.get(POSIX.terms.size), "No size.");
  t.ok(within(metadata.get(DC.terms.modified), 2, now, true), "LastModified.");
  t.ok(within(metadata.get(POSIX.terms.mtime), 2, now), "POSIX mtime.");
  t.equal(metadata.quads(null, null, null, SOLID_META.terms.ResponseMetadata).length, 1, "ResponseMetadata.");
});

async function createDocument(path: string): Promise<string> {
  let data = guardStream(Readable.from(["data"]));
  path = `${base}${path}`;
  let doc = { path };
  let meta = new RepresentationMetadata(doc);
  await accessor.writeDocument(doc, data, meta);
  return path;
}

test("Generates metadata for container child resources.", async (t: Test) => {

  let container = { path: `${base}cloud-data-accessor/container/` };
  await accessor.writeContainer(container, new RepresentationMetadata(container));
  let internalContainerOne = { path: `${base}cloud-data-accessor/container/internalContainerOne/` };
  await accessor.writeContainer(internalContainerOne, new RepresentationMetadata(internalContainerOne));
  let internalContainerTwo = { path: `${base}cloud-data-accessor/container/internalContainerTwo/` };
  await accessor.writeContainer(internalContainerTwo, new RepresentationMetadata(internalContainerTwo));

  await createDocument("cloud-data-accessor/container/extraFile");
  await createDocument("cloud-data-accessor/container/resource");
  await createDocument("cloud-data-accessor/container/internalContainerOne/shouldNotSeeMe");
  await createDocument("cloud-data-accessor/container/internalContainerTwo/shouldNotSeeMeEither");

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


