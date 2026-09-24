#!/usr/bin/env node
const [name = 'world'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
console.log(`Hello ${name}`);
