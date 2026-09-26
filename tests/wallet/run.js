// Runs every wallet test in this folder (npm test). Each file prints its own summary and sets the exit code on failure.
const fs = require('fs'), path = require('path');
fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort().forEach(f => require(path.join(__dirname, f)));
