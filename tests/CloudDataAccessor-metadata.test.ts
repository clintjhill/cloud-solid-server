import test, { Test } from "tape-promise/tape";
import { createReadStream } from "fs";
import { CloudDataAccessor } from "../src/CloudDataAccessor";
import { CloudBlobClient } from "../src/CloudBlobClient";
import { CloudExtensionBasedMapper } from "../src/CloudExtensionBasedMapper";
import { DC, LDP, NotFoundHttpError, POSIX, RDF, RepresentationMetadata, SOLID_META, XSD, toLiteral } from "@solid/community-server";
import { base, rootFilePath } from "./config";

let mapper = new CloudExtensionBasedMapper(base, rootFilePath);
let client = new CloudBlobClient(rootFilePath);
let accessor = new CloudDataAccessor(mapper, rootFilePath);

function getNow() {
  let now = new Date();
  now.setMilliseconds(0);
  return now;
}

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
  let now = getNow();
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
  let now = getNow();
  let identifier = { path: `${base}cloud-data-accessor/container/` };
  await accessor.writeContainer(identifier, new RepresentationMetadata(identifier));
  let metadata = await accessor.getMetadata(identifier);
  t.notOk(metadata.get(POSIX.terms.size), "No size.");
  t.equal(metadata.get(DC.terms.modified), toLiteral(now.toISOString(), XSD.terms.dateTime), "LastModified.");
});
