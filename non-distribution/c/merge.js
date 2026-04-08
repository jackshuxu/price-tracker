#!/usr/bin/env node

/*
Merge the current inverted index (assuming the right structure) with the global index file
Usage: input > ./merge.js global-index > output

The inverted indices have the different structures!

Each line of a local index is formatted as:
  - `<word/ngram> | <frequency> | <url>`

Each line of a global index is be formatted as:
  - `<word/ngram> | <url_1> <frequency_1> <url_2> <frequency_2> ... <url_n> <frequency_n>`
  - Where pairs of `url` and `frequency` are in descending order of frequency
  - Everything after `|` is space-separated

-------------------------------------------------------------------------------------
Example:

local index:
  word1 word2 | 8 | url1
  word3 | 1 | url9
EXISTING global index:
  word1 word2 | url4 2
  word3 | url3 2

merge into the NEW global index:
  word1 word2 | url1 8 url4 2
  word3 | url3 2 url9 1

Remember to error gracefully, particularly when reading the global index file.
*/

const fs = require('fs');
const readline = require('readline');
// The `compare` function can be used for sorting.
const compare = (a, b) => {
  if (a.freq > b.freq) {
    return -1;
  } else if (a.freq < b.freq) {
    return 1;
  } else {
    return 0;
  }
};
const rl = readline.createInterface({
  input: process.stdin,
});

// 1. Read the incoming local index data from standard input (stdin) line by line.
let localIndex = '';
rl.on('line', (line) => {
  localIndex += line + '\n';
});

rl.on('close', () => {
  // 2. Read the global index name/location, using process.argv
  // and call printMerged as a callback
  const globalIndexPath = process.argv[2];
  fs.readFile(globalIndexPath, 'utf8', printMerged);
});

const printMerged = (err, data) => {
  if (err) {
    console.error('Error reading file:', err);
    return;
  }

  // Split the data into an array of lines
  const localIndexLines = localIndex.split('\n');
  const globalIndexLines = data.split('\n');

  localIndexLines.pop();
  globalIndexLines.pop();

  const local = {};
  const global = {};

  // 3. For each line in `localIndexLines`, parse them and add them to the `local` object
  // where keys are terms and values store a url->freq map (one entry per url).
  for (const line of localIndexLines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const parts = trimmed.split('|').map((part) => part.trim());
    if (parts.length < 3) {
      continue;
    }
    const term = parts[0];
    const freq = parseInt(parts[1], 10);
    const url = parts[2];
    if (!term || !url || Number.isNaN(freq)) {
      continue;
    }
    if (!local[term]) {
      local[term] = new Map();
    }
    local[term].set(url, (local[term].get(url) || 0) + freq);
  }

  // 4. For each line in `globalIndexLines`, parse them and add them to the `global` object
  // where keys are terms and values are url->freq maps (one entry per url).
  // Use the .trim() method to remove leading and trailing whitespace from a string.
  for (const line of globalIndexLines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const parts = trimmed.split('|').map((part) => part.trim());
    if (parts.length < 2) {
      continue;
    }
    const term = parts[0];
    const grouped = new Map();
    const tokens = parts[1].split(/\s+/).filter(Boolean);
    for (let i = 0; i < tokens.length; i += 2) {
      const url = tokens[i];
      const freq = parseInt(tokens[i + 1], 10);
      if (!url || Number.isNaN(freq)) {
        continue;
      }
      grouped.set(url, (grouped.get(url) || 0) + freq);
    }
    global[term] = grouped; // Map<url, freq>
  }

  // 5. Merge the local index into the global index:
  // - For each term in the local index, if the term exists in the global index:
  //     - Merge by url so there is at most one entry per url.
  //     - Sum frequencies for duplicate urls.
  // - If the term does not exist in the global index:
  //     - Add it as a new entry with the local index's data.
  // 6. Print the merged index to the console in the same format as the global index file:
  //    - Each line contains a term, followed by a pipe (`|`), followed by space-separated pairs of `url` and `freq`.
  //    - Terms should be printed in alphabetical order.
  for (const [term, urlMap] of Object.entries(local)) {
    if (!global[term]) {
      global[term] = new Map();
    }
    for (const [url, freq] of urlMap.entries()) {
      global[term].set(url, (global[term].get(url) || 0) + freq);
    }
  }

  const terms = Object.keys(global).sort((a, b) => a.localeCompare(b));
  for (const term of terms) {
    const entries = Array.from(global[term].entries()).map(([url, freq]) => ({
      url,
      freq,
    }));
    entries.sort((a, b) => {
      if (a.freq !== b.freq) {
        return compare(a, b);
      }
      return a.url.localeCompare(b.url);
    });
    const pairs = entries.map((entry) => `${entry.url} ${entry.freq}`).join(' ');
    process.stdout.write(`${term} | ${pairs}\n`);
  }
};
