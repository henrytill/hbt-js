// @ts-check
// Deletes the dist/ of the directory it is run in: the root's, or a
// package's, since pnpm runs each package's scripts in its own
// directory. Unlike build.mjs it does not move to the root: each
// package's prepack runs it, through that package's clean, to
// delete that package's dist/ alone before rebuilding it.
import * as fs from 'node:fs';

fs.rmSync('dist', { recursive: true, force: true });
