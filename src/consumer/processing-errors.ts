export class TransientProcessingError extends Error {
  constructor(message = 'transient processing failure') {
    super(message);
    this.name = 'TransientProcessingError';
  }
}

export class PermanentProcessingError extends Error {
  constructor(message = 'permanent processing failure') {
    super(message);
    this.name = 'PermanentProcessingError';
  }
}
