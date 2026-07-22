# Contributing

Contributions are welcome for noncommercial use under the repository license.

Use Node.js 24 and follow the [setup guide](docs/setup.md) before making changes.

## Before submitting

1. Open an issue before a substantial behavior or architecture change.
2. Keep each change focused and include tests for changed behavior.
3. Use synthetic fixture data. Do not commit secrets, personal names, customer data, live meeting links, or vendor identifiers.
4. Run the verification commands before opening a pull request.
5. Update active documentation when behavior, routes, environment variables, commands, or access rules change.
6. Preserve dated files under `docs/superpowers` as historical records. Add a status note instead of rewriting the original plan.

```bash
npm install
npm run verify
```

Run `npm run verify:all` on macOS before a release. See [testing architecture](docs/testing.md) for coverage thresholds, runtime boundaries, and individual commands.

Pull requests should explain the problem, the chosen approach, and how the result was verified.
