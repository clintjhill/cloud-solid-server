import test, { Test } from "tape-promise/tape";
import { createReadStream } from "fs";
import { CloudDataAccessor } from "../src/CloudDataAccessor";
import { CloudBlobClient } from "../src/CloudBlobClient";
import { CloudExtensionBasedMapper } from "../src/CloudExtensionBasedMapper";
import { NotFoundHttpError, Representation, UnsupportedMediaTypeHttpError } from "@solid/community-server";
import { base, rootFilePath } from "./config";

let mapper = new CloudExtensionBasedMapper(base, rootFilePath);
let client = new CloudBlobClient(rootFilePath);
let accessor = new CloudDataAccessor(mapper, rootFilePath);

test("Handles Binary data only", async (t: Test) => {
  let handles = async () => { await accessor.canHandle({ binary: true } as Representation); }
  let notHandles = async () => { await accessor.canHandle({ binary: false } as Representation); }
  await t.doesNotReject(handles, UnsupportedMediaTypeHttpError, "Handles binary.");
  await t.rejects(notHandles, UnsupportedMediaTypeHttpError, "Does not handle non-binary.");
  t.end();
});

test("Throws 404 if identifier does not start with base.", async (t: Test) => {
  let notFound = async () => { await accessor.getData({ path: "badpath" }); };
  await t.rejects(notFound, NotFoundHttpError, "Not found bad path.");
  t.end();
});

test("Throws 404 if identifier does not match an existing file.", async (t: Test) => {
  let notFound = async () => { await accessor.getData({ path: `${base}cloud-data-accessor/resource` }); };
  await t.rejects(notFound, NotFoundHttpError, "Not found non-existent.");
  t.end();
});

test("Throws 404 if identifier matches a directory.", async (t: Test) => {
  let plainText = createReadStream("./tests/fixtures/plain.txt");
  // setup a file such that a directory name could be matched.
  await client.write("cloud-data-accessor/resource/plain.txt", plainText);
  let notFound = async () => { await accessor.getData({ path: `${base}cloud-data-accessor/resource` }); };
  await t.rejects(notFound, NotFoundHttpError, "Not found directory.");
  t.end();
});

test("Returns the corresponding data.", async (t: Test) => {
  let plainText = createReadStream("./tests/fixtures/plain.txt");
  await client.write("cloud-data-accessor/plain.txt", plainText);
  let stream = await accessor.getData({ path: `${base}cloud-data-accessor/plain.txt` });
  t.ok(stream);
  stream.destroy();
  t.end();
});

