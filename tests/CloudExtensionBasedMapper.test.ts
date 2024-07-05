import test, { Test } from "tape-promise/tape";
import { createReadStream } from "fs";
import { CloudExtensionBasedMapper } from "../src/CloudExtensionBasedMapper";
import { base, internalRootFilepath, rootFilepath } from "./config";
import { BadRequestHttpError, NotFoundHttpError, NotImplementedHttpError, trimTrailingSlashes } from "@solid/community-server";
import { CloudBlobClient } from "../src/CloudBlobClient";

const mapper = new CloudExtensionBasedMapper(base, rootFilepath);
const client = new CloudBlobClient(rootFilepath);

test('CloudExtensionBasedMapper: throws 404 if the input path does not contain the base.', async (t: Test) => {
  let notFound = async () => { await mapper.mapUrlToFilePath({ path: 'invalid' }, false); };
  await t.rejects(notFound, NotFoundHttpError, "Invalid NotFound.");
  t.end();
});

test('CloudExtensionBasedMapper: throws 404 if the relative path does not start with a slash.', async (t: Test) => {
  let badRequest = async () => { await mapper.mapUrlToFilePath({ path: `${trimTrailingSlashes(base)}test` }, false); };
  await t.rejects(badRequest, BadRequestHttpError, "Bad Request.");
  await t.rejects(badRequest, /URL needs a \/ after the base/, "Bad Request message.");
  t.end();
});

test('CloudExtensionBasedMapper: throws 400 if the input path contains relative parts.', async (t: Test) => {
  let badRequest = async () => { await mapper.mapUrlToFilePath({ path: `${base}test/../test2` }, false); };
  await t.rejects(badRequest, BadRequestHttpError, "Bad Request.");
  await t.rejects(badRequest, /Disallowed \/..\/ segment in URL/, "Bad Request message.");
  t.end();
});

test('CloudExtensionBasedMapper: returns the corresponding file path for container identifiers.', async (t: Test) => {
  let actual = await mapper.mapUrlToFilePath({ path: `${base}container/` }, false);
  let expected = {
    identifier: { path: `${base}container/` },
    filePath: `${internalRootFilepath}container/`,
    isMetadata: false
  };
  t.deepEqual(actual, expected, "Container Identifier.");
  t.end();
});

test('CloudExtensionBasedMapper: rejects URLs that end with "$.{extension}".', async (t: Test) => {
  let notImplemented = async () => { await mapper.mapUrlToFilePath({ path: `${base}test$.txt` }, false); };
  await t.rejects(notImplemented, NotImplementedHttpError, "Not Implemented.");
  await t.rejects(notImplemented, /Identifiers cannot contain a dollar sign before their extension/, "Not Implemented message.");
  t.end();
});

test('CloudExtensionBasedMapper: determines content-type by extension when looking in a folder that does not exist.', async (t: Test) => {
  let actual = await mapper.mapUrlToFilePath({ path: `${base}not-exist/test.txt` }, false);
  let expected = {
    identifier: { path: `${base}not-exist/test.txt` },
    filePath: `${internalRootFilepath}not-exist/test.txt`,
    contentType: 'text/plain',
    isMetadata: false
  };
  t.deepEqual(actual, expected, "Text plain Content-Type.");
});

test('CloudExtensionBasedMapper: determines content-type by extension when looking for a file that does not exist.', async (t: Test) => {
  let actual = await mapper.mapUrlToFilePath({ path: `${base}not-exist.txt` }, false);
  let expected = {
    identifier: { path: `${base}not-exist.txt` },
    filePath: `${internalRootFilepath}not-exist.txt`,
    contentType: 'text/plain',
    isMetadata: false
  };
  t.deepEqual(actual, expected, "Text plain Content-Type.");
});

test('CloudExtensionBasedMapper: determines the content-type based on the extension.', async (t: Test) => {
  let plainText = createReadStream("./tests/fixtures/plain.txt");
  await client.write("cloud-extension-mapper/resource/plain.txt", plainText);
  let actual = await mapper.mapUrlToFilePath({ path: `${base}cloud-extension-mapper/resource/plain.txt` }, false);
  let expected = {
    identifier: { path: `${base}cloud-extension-mapper/resource/plain.txt` },
    filePath: `${internalRootFilepath}cloud-extension-mapper/resource/plain.txt`,
    contentType: 'text/plain',
    isMetadata: false
  };
  t.deepEqual(actual, expected, "Text plain Content-Type.");
});

test('CloudExtensionBasedMapper: determines the content-type correctly for metadata files.', async (t: Test) => {
  let metaFile = createReadStream("./tests/fixtures/test.meta");
  await client.write("root/cloud-extension-mapper/test.meta", metaFile);
  let actual = await mapper.mapUrlToFilePath({ path: `${base}cloud-extension-mapper/test` }, false);
  let expected = {
    identifier: { path: `${base}cloud-extension-mapper/test` },
    filePath: `${internalRootFilepath}cloud-extension-mapper/test.meta`,
    contentType: 'text/turtle',
    isMetadata: true
  };
  t.deepEqual(actual, expected, "Turtle Content-Type.");
});

test('CloudExtensionBasedMapper: matches even if the content-type does not match the extension.', async (t: Test) => {
  let metaFile = createReadStream("./tests/fixtures/test.meta");
  await client.write("root/cloud-extension-mapper/test.txt$.ttl", metaFile);
  let actual = await mapper.mapUrlToFilePath({ path: `${base}cloud-extension-mapper/test.txt` }, false);
  let expected = {
    identifier: { path: `${base}cloud-extension-mapper/test.txt` },
    filePath: `${internalRootFilepath}cloud-extension-mapper/test.txt$.ttl`,
    contentType: 'text/turtle',
    isMetadata: false
  };
  t.deepEqual(actual, expected, "Match Content-Type even with wrong extension.");
});

test('CloudExtensionBasedMapper: generates a file path if the content-type was provided.', async (t: Test) => {
  let actual = await mapper.mapUrlToFilePath({ path: `${base}test.txt` }, false, 'text/plain');
  let expected = {
    identifier: { path: `${base}test.txt` },
    filePath: `${internalRootFilepath}test.txt`,
    contentType: 'text/plain',
    isMetadata: false
  };
  t.deepEqual(actual, expected, "File path with content-type.");
});

test('CloudExtensionBasedMapper: adds an extension if the given extension does not match the given content-type.', async (t: Test) => {
  let actual = await mapper.mapUrlToFilePath({ path: `${base}test.txt` }, false, "text/turtle");
  let expected = {
    identifier: { path: `${base}test.txt` },
    filePath: `${internalRootFilepath}test.txt$.ttl`,
    contentType: 'text/turtle',
    isMetadata: false
  };
  t.deepEqual(actual, expected, "Extension added.");
});

test('CloudExtensionBasedMapper: falls back to custom extension for unknown types (for which no custom mapping exists).', async (t: Test) => {
  let actual = await mapper.mapUrlToFilePath({ path: `${base}test` }, false, 'unknown/content-type');
  let expected = {
    identifier: { path: `${base}test` },
    filePath: `${internalRootFilepath}test$.unknown`,
    contentType: undefined,
    isMetadata: false
  };
  t.deepEqual(actual, expected, "Custom Extension.");
});

test('CloudExtensionBasedMapper: supports custom types.', async (t: Test) => {
  const customMapper = new CloudExtensionBasedMapper(base, rootFilepath, { cstm: "text/custom" });
  let actual = await customMapper.mapUrlToFilePath({ path: `${base}test.cstm` }, false);
  let expected = {
    identifier: { path: `${base}test.cstm` },
    filePath: `${internalRootFilepath}test.cstm`,
    contentType: 'text/custom',
    isMetadata: false,
  };
  t.deepEqual(actual, expected, "Custom Types.");
});


test('CloudExtensionBasedMapper: supports custom extensions.', async (t: Test) => {
  const customMapper = new CloudExtensionBasedMapper(base, rootFilepath, { cstm: "text/custom" });
  let actual = await customMapper.mapUrlToFilePath({ path: `${base}test.cstm` }, false, "text/custom");
  let expected = {
    identifier: { path: `${base}test.cstm` },
    filePath: `${internalRootFilepath}test.cstm`,
    contentType: 'text/custom',
    isMetadata: false,
  };
  t.deepEqual(actual, expected, "Custom Extensions.");
});

test('CloudExtensionBasedMapper: throws an error if the input path does not contain the root file path.', async (t: Test) => {
  let invalid = async () => { await mapper.mapFilePathToUrl('invalid', true); };
  await t.rejects(invalid, Error, "Invalid Error.");
});

test('CloudExtensionBasedMapper: returns a generated identifier for directories.', async (t: Test) => {
  let actual = await mapper.mapFilePathToUrl(`${internalRootFilepath}container/`, true);
  let expected = {
    identifier: { path: `${base}container/` },
    filePath: `${internalRootFilepath}container/`,
    contentType: undefined,
    isMetadata: false,
  };
  t.deepEqual(actual, expected, "Directory Identifier.");
});

test('CloudExtensionBasedMapper: returns a generated identifier for files with corresponding content-type.', async (t: Test) => {
  let actual = await mapper.mapFilePathToUrl(`${internalRootFilepath}test.txt`, false);
  let expected = {
    identifier: { path: `${base}test.txt` },
    filePath: `${internalRootFilepath}test.txt`,
    contentType: 'text/plain',
    isMetadata: false,
  };
  t.deepEqual(actual, expected, "Identifier with Content-Type.");
});

test('CloudExtensionBasedMapper: returns a generated identifier for metadata files.', async (t: Test) => {
  let actual = await mapper.mapFilePathToUrl(`${internalRootFilepath}test.meta`, false);
  let expected = {
    identifier: { path: `${base}test` },
    filePath: `${internalRootFilepath}test.meta`,
    contentType: 'text/turtle',
    isMetadata: true,
  };
  t.deepEqual(actual, expected, "Metadata Identifier.");
});

test('CloudExtensionBasedMapper: removes appended extensions.', async (t: Test) => {
  let actual = await mapper.mapFilePathToUrl(`${internalRootFilepath}test.txt$.ttl`, false);
  let expected = {
    identifier: { path: `${base}test.txt` },
    filePath: `${internalRootFilepath}test.txt$.ttl`,
    contentType: 'text/turtle',
    isMetadata: false,
  };
  t.deepEqual(actual, expected, "Removed appended.");
});

test('CloudExtensionBasedMapper: sets the content-type to application/octet-stream if there is no extension.', async (t: Test) => {
  let actual = await mapper.mapFilePathToUrl(`${internalRootFilepath}test`, false);
  let expected = {
    identifier: { path: `${base}test` },
    filePath: `${internalRootFilepath}test`,
    contentType: 'application/octet-stream',
    isMetadata: false,
  };
  t.deepEqual(actual, expected, "Octet Stream content-type.");
});

test('CloudExtensionBasedMapper: supports custom extensions.', async (t: Test) => {
  let customMapper = new CloudExtensionBasedMapper(base, rootFilepath, { cstm: 'text/custom' });
  let actual = await customMapper.mapFilePathToUrl(`${internalRootFilepath}test$.cstm`, false);
  let expected = {
    identifier: { path: `${base}test` },
    filePath: `${internalRootFilepath}test$.cstm`,
    contentType: 'text/custom',
    isMetadata: false,
  };
  t.deepEqual(actual, expected, "Custom Extensions.");
});
