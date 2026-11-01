export class RecordingImportError extends Error {
  constructor(message: string, public status: 403 | 409 = 409) {
    super(message);
    this.name = "RecordingImportError";
  }
}
