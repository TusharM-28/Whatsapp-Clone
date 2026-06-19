const { run } = require('node:test');
const { spec } = require('node:test/reporters');
const path = require('path');
const fs = require('fs');

const testsDir = __dirname;
const files = fs.readdirSync(testsDir)
  .filter(file => file.endsWith('.test.js'))
  .map(file => path.join(testsDir, file));

console.log(`Starting test runner. Found ${files.length} test file(s):`);
files.forEach(f => console.log(`  - ${path.basename(f)}`));

const stream = run({
  files: files
});

let hasFailures = false;
stream.on('test:fail', () => {
  hasFailures = true;
});

stream.compose(new spec()).pipe(process.stdout);

process.on('exit', () => {
  if (hasFailures) {
    process.exit(1);
  }
});
