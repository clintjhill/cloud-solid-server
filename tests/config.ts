import type { Term } from '@rdfjs/types';
import { XSD, toLiteral } from '@solid/community-server';

/**
 * A localhost base URL for testing purposes.
 */
let base = "http://localhost:9001/";

/**
 * This is the "bucket name" rootFilepath that we abstract away
 * from the original intent. 
 */
let rootFilepath = "test-data";

/**
 * This is the true rootFilepath that is the root container in 
 * the cloud storage. 
 */
let internalRootFilepath = "root/";

/**
  * This helps to accomodate a 1-2 second diff in times between the Resource creation times,
  * and the times used in the tests. If there is even the slightest latency on read/writes,
  * the test datetimes can be off by 1-2 seconds.
*/
function within(literal: Term | undefined, s: number, now: Date, isDateStr: boolean = false): boolean {
  if (!literal) return false;
  let dateInt = toLiteral(Math.floor(now.getTime() / 1000), XSD.terms.integer);
  let dateString = toLiteral(now.toISOString(), XSD.terms.dateTime);
  let delta: number;

  if (isDateStr) {
    delta = parseInt(dateString.value) - parseInt(literal?.value);
  } else {
    delta = parseInt(dateInt.value) - parseInt(literal?.value);
  }
  return delta <= s;
}

export { base, rootFilepath, internalRootFilepath, within };
