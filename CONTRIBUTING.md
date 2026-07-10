# Contributing

Contributions are welcome for noncommercial use under the repository license.

Follow the [setup guide](docs/setup.md) before making changes.

## Before submitting

1. Open an issue before a substantial behavior or architecture change.
2. Keep each change focused and include tests for changed behavior.
3. Use synthetic fixture data. Do not commit secrets, personal names, customer data, live meeting links, or vendor identifiers.
4. Run the verification commands before opening a pull request.

```bash
npm install
npm run lint
npm run test
npm run build
```

Pull requests should explain the problem, the chosen approach, and how the result was verified.
