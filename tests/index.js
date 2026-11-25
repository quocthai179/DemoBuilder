// Entry point so that `node --test tests/` works on Node 22 (a directory argument is resolved as a module there).
// With a glob (`node --test "tests/**/*.test.mjs"`) or no argument, Node discovers the *.test.mjs files itself and this file is not used.
(async () => {
  for (const f of ['unit', 'hardening', 'video-regression', 'e2e']) await import(`./guide/${f}.test.mjs`);
})();
