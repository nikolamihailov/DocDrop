// Vercel entry point (see vercel.json).
// Vercel checks that the entrypoint exists BEFORE it runs the build, so it can't
// point straight at dist/index.cjs (that file is only created by `npm run build`).
// This small committed file loads the bundle that the build produces: our code plus
// all dependencies in one file, so nothing else needs to be deployed next to it.
module.exports = require('./dist/index.cjs');
