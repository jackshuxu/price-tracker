#!/usr/bin/env node

/*
Extract all text from an HTML page.
Usage: input > ./getText.js > output
*/

const {convert} = require('html-to-text');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
});

const inputLines = [];

rl.on('line', (line) => {
  // 1. Read HTML input from standard input, line by line using the `readline` module
  inputLines.push(line);
});

// 2. after all input is received, use convert to output plain text.
rl.on('close', () => {
  const html = inputLines.join('\n');
  const text = convert(html);
  console.log(text);
});
