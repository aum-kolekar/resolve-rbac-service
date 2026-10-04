const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const specPath = path.join(__dirname, '..', '..', 'docs', 'openapi.yaml');
const openapiSpec = yaml.load(fs.readFileSync(specPath, 'utf8'));

module.exports = openapiSpec;
