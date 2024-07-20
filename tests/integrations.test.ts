import test, { Test } from "tape-promise/tape";
import { getDefaultVariables, getTestConfigPath, instantiateFromConfig, internalRootFilepath, rootFilepath } from "./config";
import { App, NotFoundHttpError } from "@solid/community-server";
import { CloudBlobClient } from "../src/CloudBlobClient";

const port = 6001;
const baseUrl = `http://localhost:${port}/`;
let app: App;
let client = new CloudBlobClient(rootFilepath);

test("Integration Tests", async (t: Test) => {

  const variables = {
    ...getDefaultVariables(port, baseUrl),
    'urn:solid-server:default:variable:rootFilePath': rootFilepath,
  };

  // Create and start the server
  const instances = await instantiateFromConfig(
    'urn:solid-server:test:Instances',
    [
      getTestConfigPath('server-file.json'),
    ],
    variables,
  ) as Record<string, any>;
  ({ app } = instances);

  await app.start();
  t.pass("Test Server Started.");
});

test("Integration: can put a document for which the URI path contains URL-encoded separator characters.", async (t: Test) => {
  const url = `${baseUrl}c1/c2/t1%2f`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'text/plain' },
    body: 'abc'
  });
  t.equal(res.status, 201, "Status code.");
  t.equal(res.headers.get('location'), `${baseUrl}c1/c2/t1%2F`, "Location.");

  const check1 = await fetch(`${baseUrl}c1/c2/t1/}`, {
    method: 'GET',
    headers: { accept: 'text/plain' }
  });
  t.equal(check1.status, 404, "Check 1.");

  const check2 = await fetch(url, {
    method: 'GET',
    headers: { accept: 'text/plain' }
  });
  const headers = check2.headers.get('link')!.split(',').map((item: string) => item.trim());
  t.notOk(headers.includes('<http://www.w3.org/ns/ldp#Container>; rel="type"'), "Not Container.");
  let exists = async () => {
    let data = await client.read(`${internalRootFilepath}c1/c2/t1%2F$.txt`);
    data.destroy();
  };
  await t.doesNotReject(exists, NotFoundHttpError, "Exists.");
});

test('Integration: can post a document using a slug that contains URL-encoded separator characters.', async (t: Test) => {
  const slug = 't1%2Faa';
  const res = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      'content-type': 'text/plain',
      slug,
    },
    body: 'abc',
  });
  t.equal(res.status, 201, "201 Status.");
  t.equal(res.headers.get('location'), `${baseUrl}${slug}`, "Location header.");
  let exists = async () => {
    let data = await client.read(`${internalRootFilepath}${slug}$.txt`);
    data.destroy();
  };
  await t.doesNotReject(exists, NotFoundHttpError, "Exists.");
});

test('Integration: prevents accessing a document via a different identifier that results in the same path after URL decoding.', async (t: Test) => {
  // First put a resource using a path without encoded separator characters: foo/bar
  const url = `${baseUrl}foo/bar`;
  await fetch(url, {
    method: 'PUT',
    headers: {
      'content-type': 'text/plain',
    },
    body: 'abc',
  });

  // The resource at foo/bar should not be accessible using the url encoded variant of this path: foo%2Fbar
  const check1 = await fetch(`${baseUrl}foo%2Fbar`, {
    method: 'GET',
    headers: {
      accept: 'text/plain',
    },
  });

  t.equal(check1.status, 404, "Not Found.");
  let exists = async () => {
    let data = await client.read(`${internalRootFilepath}foo/bar$.txt`);
    data.destroy();
  };
  await t.doesNotReject(exists, NotFoundHttpError, "Exists.");
});
// it(
//   'prevents accessing a document via a different identifier that results in the same path after URL decoding.',
//   async(): Promise<void> => {

//     // Next, put a resource using a path with an encoded separator character: bar%2Ffoo
//     await fetch(`${baseUrl}bar%2Ffoo`, {
//       method: 'PUT',
//       headers: {
//         'content-type': 'text/plain',
//       },
//       body: 'abc',
//     });

//     // The resource at bar%2Ffoo should not be accessible through bar/foo
//     const check3 = await fetch(`${baseUrl}bar/foo`, {
//       method: 'GET',
//       headers: {
//         accept: 'text/plain',
//       },
//     });
//     // Expect bar/foo to correctly refer to a different document, which does not exist.
//     expect(check3.status).toBe(404);

//     // Check that the the appropriate file path for bar%foo exists
//     const check4 = await pathExists(`${rootFilePath}/bar%2Ffoo$.txt`);
//     expect(check4).toBe(true);
//   },
// );
test("Stop Integration Tests.", async (t: Test) => {
  await app.stop();
  t.pass("Test Server Stopped.");
});
