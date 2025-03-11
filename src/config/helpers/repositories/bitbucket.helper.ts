import * as atlassianJwt from 'atlassian-jwt';
import axios from 'axios';
import * as moment from 'moment';
export function getAuthToken(
  data: { sharedSecret: string; baseUrl: string; clientKey: string },
  method,
  resource,
) {
  const now = moment().utc();
  const installation = {
    sharedSecret: data.sharedSecret,
    baseUrl: data.baseUrl,
  };

  if (!installation) throw new Error('Installation not found');

  // console.log
  //   'atlassianJwt.fromMethodAndUrl(method, resource): ',
  //   atlassianJwt.fromMethodAndUrl(method, resource),
  // );

  const jwtToken = atlassianJwt.encodeSymmetric(
    {
      iss: 'hikaflow-app',
      iat: now.unix(),
      exp: now.add(5, 'minutes').unix(),
      qsh: atlassianJwt.createQueryStringHash(
        atlassianJwt.fromMethodAndUrl(method, resource),
      ),
      sub: data.clientKey,
    },
    installation.sharedSecret,
  );

  // const jwtToken = atlassianJwt.encodeSymmetric(
  //   {
  //     iss: 'hikaflow-app',
  //     iat: now.unix(),
  //     exp: now.add(5, 'minutes').unix(),
  //     sub: data.clientKey,
  //     qsh: atlassianJwt.createQueryStringHash(
  //       atlassianJwt.fromMethodAndUrl(method, resource),
  //     ),
  //   },
  //   installation.sharedSecret,
  // );

  return `JWT ${jwtToken}`;
}

export const fetchBitbucketRepositories = async (data: {
  // sharedSecret: string;
  // baseUrl: string;
  // clientKey: string;
  workspace: string;
  token: string;
}) => {
  try {
    let method = 'GET';
    let resource = `/2.0/repositories/${data.workspace}`; // Include /2.0 in the resource for QSH
    // let token = getAuthToken(data, method, resource);
    // // console.log`${data.baseUrl}${resource}`, token);
    const response = await axios.get(`https://api.bitbucket.org${resource}`, {
      headers: {
        Authorization: `${data.token}`, // Correct header name
      },
    });

    // console.log'response: ', JSON.stringify(response.data, null, 2));
    return response.data.values;
  } catch (error) {
    // console.logerror);
    // throw error; // It's better to throw the actual error for debugging
  }
};

export const fetchBitbucketRepositoryBranches = async (data: {
  // sharedSecret: string;
  // baseUrl: string;
  // clientKey: string;
  token: string;
  workspace: string;
  repoSlug: string;
}) => {
  try {
    let method = 'POST';
    // let resource = `/2.0/repositories/${data.workspace}/hiksflow-test-repo/pullrequests/2/comments`; // Include /2.0 in the resource for QSH

    let resource = `/2.0/repositories/${data.workspace}/${data.repoSlug}/refs/branches`; // Include /2.0 in the resource for QSH
    // let token = getAuthToken(data, method, resource);
    // // console.log`${data.baseUrl}${resource}`, token);
    const response: any = await axios.get(
      `https://api.bitbucket.org${resource}`,
      {
        headers: {
          Authorization: `${data.token}`, // Correct header name
        },
      },
    );

    // console.log'response: ', response);

    return response.data.values;
  } catch (error) {
    // console.logerror);
    // throw error; // It's better to throw the actual error for debugging
  }
};

export const fetchBitbucketPrCommits = async (data: {
  // sharedSecret: string;
  // baseUrl: string;
  // clientKey: string;
  token: string;
  workspace: string;
  repoSlug: string;
  prNumber: number;
}) => {
  try {
    let method = 'GET';
    let resource = `/2.0/repositories/${data.workspace}/${data.repoSlug}/pullrequests/${data.prNumber}/commits`;

    const response = await axios.get(`https://api.bitbucket.org${resource}`, {
      headers: {
        Authorization: `${data.token}`,
      },
    });

    return response.data.values;
  } catch (error) {
    console.log(error);
    throw error; // It's better to throw the actual error for debugging
  }
};

export const fetchBitbucketPr = async (data: {
  // sharedSecret: string;
  // baseUrl: string;
  // clientKey: string;
  token: string;
  workspace: string;
  repoSlug: string;
  prNumber: number;
}) => {
  try {
    let method = 'GET';
    let resource = `/2.0/repositories/${data.workspace}/${data.repoSlug}/pullrequests/${data.prNumber}`; // Include /2.0 in the resource for QSH
    // let token = getAuthToken(data, method, resource);
    const response = await axios.get(`https://api.bitbucket.org${resource}`, {
      headers: {
        Authorization: `${data.token}`, // Correct header name
      },
    });

    // console.log'response: ', JSON.stringify(response.data, null, 2));
    return response.data;
  } catch (error) {
    // console.logerror);
    // throw error; // It's better to throw the actual error for debugging
  }
};

// for PR and commits
export const fetchBitbucketDiff = async (data: {
  token: string;
  diffUrl: string;
}) => {
  try {
    // let method = 'GET';
    // let resource = data.diffUrl.replace(`https://`, '');
    // let token = getAuthToken(data, method, resource);
    // // console.log`data.diffUrl: ${data.diffUrl}`, token);
    const response = await axios.get(`${data.diffUrl}`, {
      headers: {
        Authorization: `${data.token}`,
      },
    });

    // console.logdata.token);

    // console.log'response: ', JSON.stringify(response.data.values, null, 2));
    let fileChangesMapping = response.data.values.map(
      (data) => data.new.links.self.href,
    );

    // console.log'fileChangesMapping: ', fileChangesMapping);

    let changes = [];
    for (let i = 0; i < fileChangesMapping.length; i++) {
      let fileData = await axios.get(fileChangesMapping[i], {
        headers: {
          Authorization: `${data.token}`,
        },
      });
      changes.push(fileData.data);
      // console.logfileData.data);
    }
    // console.log'fileChanges: ', JSON.stringify(changes, null, 2));

    let files = response.data.values.map((data, index) => ({
      fileName: data.new.path, // need to check this path with proper repository like is it entire path
      content: changes[index],
    }));

    // console.log'response: ', JSON.stringify(files, null, 2));
    return files;
  } catch (error) {
    // console.logerror.message);
    // throw error; // It's better to throw the actual error for debugging
  }
};

export const fetchBitbucketPrPatch = async (data: {
  token: string;
  diffUrl: string;
}) => {
  try {
    // let method = 'GET';
    // let resource = data.diffUrl.replace(`https://`, '');
    // let token = getAuthToken(data, method, resource);
    // // console.log`data.diffUrl: ${data.diffUrl}`, token);
    const response = await axios.get(`${data.diffUrl}`, {
      headers: {
        Authorization: `${data.token}`,
      },
    });

    return processDiff(response.data);
  } catch (error) {
    // console.logerror.message);
    // throw error; // It's better to throw the actual error for debugging
  }
};

export const commentBitbucketPr = async (data: {
  token: string;
  commentUrl: string;
  body: {
    content: { raw: string };
    inline: {
      to: number;
      path: string;
    };
  };
}) => {
  try {
    // let method = 'GET';
    // let resource = data.diffUrl.replace(`https://`, '');
    // let token = getAuthToken(data, method, resource);
    // // console.log`data.diffUrl: ${data.diffUrl}`, token);
    const response = await axios.post(`${data.commentUrl}`, data.body, {
      headers: {
        Authorization: `${data.token}`,
      },
    });

    // console.logdata.token);

    // console.log'response: ', JSON.stringify(response.data, null, 2));
    return response;
  } catch (error) {
    // console.logerror);
    return null;
    // throw error; // It's better to throw the actual error for debugging
  }
};

export async function commitInfoBitbucket(
  data: { token; commitDiffUrl },
  diff: boolean = false,
) {
  const response = await axios.get(`${data.commitDiffUrl}`, {
    headers: {
      Authorization: `${data.token}`,
    },
  });

  console.log('diffData: ', response.data);

  if (diff) {
    return response.data;
  }
  return processDiff(response.data);
}

function parsePatch(rawDiff) {
  // Split the diff into individual file patches
  const filePatches = rawDiff
    .split(/^diff --git/m)
    .filter((patch) => patch.trim() !== '')
    .map((patch) => `diff --git${patch}`);

  // Parse each file patch
  return filePatches.map((filePatch) => {
    const lines = filePatch.split('\n');

    // Extract filename
    const filename =
      lines
        .find((line) => line.startsWith('--- a/') || line.startsWith('+++ b/'))
        ?.substring(6) || 'Unknown File';

    // Determine file status
    let fileStatus = 'unknown';
    let initialHash = null;

    // Look for index line to check initial hash
    const indexLine = lines.find((line) => line.startsWith('index '));
    if (indexLine) {
      const hashMatch = indexLine.match(/^index\s+([0-9a-f]+)\.\.[0-9a-f]+/);
      if (hashMatch) {
        initialHash = hashMatch[1];
      }
    }

    // Detailed status detection
    if (lines.some((line) => line.includes('new file mode'))) {
      fileStatus = 'added';
    } else if (lines.some((line) => line.includes('deleted file mode'))) {
      fileStatus = 'deleted';
    } else if (initialHash === '0000000') {
      fileStatus = 'added';
    } else {
      fileStatus = 'modified';
    }

    const changes = [];
    let currentChange = null;
    let currentLine = null;

    // Loop through each line in the patch
    lines.forEach((line) => {
      if (line.startsWith('@@')) {
        // This line marks the start of a new chunk
        if (currentChange) {
          changes.push(currentChange);
        }

        const match = line.match(/@@ -\d+(,\d+)? \+(\d+)(,\d+)? @@/);
        if (match) {
          currentLine = parseInt(match[2], 10); // Extract the starting line for additions
          currentChange = null; // Reset current change
        }
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        // Addition
        if (!currentChange || currentChange.type !== 'addition') {
          if (currentChange) {
            changes.push(currentChange);
          }
          currentChange = {
            type: 'addition',
            lines: [],
            startLine: currentLine,
            endLine: currentLine,
          };
        }
        currentChange.lines.push(line.substring(1)); // Remove the "+" sign
        currentLine++; // Increment the line number for additions
        currentChange.endLine = currentLine - 1;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        // Deletion
        if (!currentChange || currentChange.type !== 'deletion') {
          if (currentChange) {
            changes.push(currentChange);
          }
          currentChange = {
            type: 'deletion',
            lines: [],
            startLine: currentLine,
            endLine: currentLine,
          };
        }
        currentChange.lines.push(line.substring(1)); // Remove the "-" sign
        currentChange.endLine = currentLine;
      } else if (!line.startsWith('\\')) {
        // Context or unchanged lines
        if (currentChange) {
          changes.push(currentChange);
          currentChange = null;
        }
        currentLine++; // Increment the line number for unchanged lines
      }
    });

    if (currentChange) {
      changes.push(currentChange);
    }

    return {
      filename,
      patch: filePatch,
      status: fileStatus,
      initialHash, // Added to provide additional context
      changes: changes.map((change) => ({
        type: change.type,
        lines: change.lines,
        startLine: change.startLine,
        endLine: change.endLine,
      })),
    };
  });
}

// Example usage
function processDiff(rawDiff) {
  const parsedFiles = parsePatch(rawDiff);
  // console.log'parsedFiles: ', parsedFiles);
  // Optional: Pretty print the results
  parsedFiles.forEach((file) => {
    // // console.log`File: ${file.filename}`);
    // // console.log`Status: ${file.status}`);
    // // console.log`Initial Hash: ${file.initialHash}`);
    file.changes.forEach((change) => {
      // // console.log
      //   `- ${change.type} (Lines ${change.startLine}-${change.endLine}):`,
      //   change.lines,
      // );
    });
    // // console.log'---');
  });

  return parsedFiles;
}

// export function extractChangesFromPatch(rawDiff) {
//   let additions = [];
//   let deletions = [];
//   let additionCount = 0;
//   let deletionCount = 0;

//   const lines = rawDiff.split('\n');

//   lines.forEach((line) => {
//     if (line.startsWith('+') && !line.startsWith('+++')) {
//       additions.push(line.substring(1));
//       additionCount;
//     } else if (line.startsWith('-') && !line.startsWith('---')) {
//       deletions.push(line.substring(1));
//       deletionCount++;
//     }
//   });

//   return {
//     additions,
//     deletions,
//     additionCount,
//     deletionCount,
//   };
// }

export function extractChangesFromPatch(rawDiff) {
  let additions = [];
  let deletions = [];
  let additionCount = 0;
  let deletionCount = 0;

  const lines = rawDiff.split('\n');
  let currentLine = 0;

  lines.forEach((line) => {
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -\d+(,\d+)? \+(\d+)(,\d+)? @@/);
      if (match) {
        currentLine = parseInt(match[2], 10);
      }
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      additions.push({ line: currentLine, content: line.substring(1) });
      additionCount++;
      currentLine++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      deletions.push({ line: currentLine, content: line.substring(1) });
      deletionCount++;
    } else if (!line.startsWith(' ')) {
      currentLine++;
    }
  });

  return {
    additions,
    deletions,
    additionCount,
    deletionCount,
  };
}

export function parseGitDiff(rawDiff) {
  console.log('rawDiff: ', rawDiff);
  const fileChanges = [];
  const files = rawDiff.split(/diff --git a\//).slice(1);

  let totalAdditions = 0;
  let totalDeletions = 0;

  files.forEach((file) => {
    const lines = file.split('\n');
    if (lines.length === 0) return; // Ensure lines exist

    const fileName = lines[0] ? lines[0].split(' ')[0] : 'unknown_file';
    const additions = [];
    const deletions = [];
    let additionCount = 0;
    let deletionCount = 0;
    let currentLine = 0;

    lines.forEach((line) => {
      if (line.startsWith('@@')) {
        const match = line.match(/\+(\d+)/);
        if (match) currentLine = parseInt(match[1]) || 0;
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        additions.push({ line: currentLine, content: line.substring(1) });
        additionCount++;
        totalAdditions++;
        currentLine++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        deletions.push({ line: currentLine, content: line.substring(1) });
        deletionCount++;
        totalDeletions++;
      }
    });

    fileChanges.push({
      filename: fileName,
      fileAdditions: additions,
      fileDeletions: deletions,
      additions: additionCount,
      deletions: deletionCount,
    });
  });

  return { fileChanges, totalAdditions, totalDeletions };
}

export function parseGitDiffByFile(files, patch) {
  const patchesByFile = {};

  files.forEach((file) => {
    patchesByFile[file] = [];
  });

  let currentFile = null;
  patch.forEach((diff) => {
    const match = diff.match(/^diff --git a\/(.*?) b\/(.*?)\n/);
    if (match) {
      currentFile = match[1];
      if (!patchesByFile[currentFile]) {
        patchesByFile[currentFile] = [];
      }
      patchesByFile[currentFile].push(diff);
    }
  });

  return patchesByFile;
}
