export class ContentStreamTokenizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentStreamTokenizeError";
  }
}

export const CONTENT_STREAM_TOKENIZER_LIMITS = {
  /** Large enough for production PDF page streams. */
  MAX_CONTENT_LENGTH: 32 * 1024 * 1024,
  MAX_ITERATIONS: 8_000_000,
  MAX_TOKENS: 2_000_000,
  MAX_PAREN_DEPTH: 512,
  MAX_ARRAY_DEPTH: 512,
  MAX_DICTIONARY_SCAN: 512_000,
} as const;

export type TokenizeContentStreamResult =
  | { ok: true; tokens: string[] }
  | { ok: false; reason: string };

function abort(reason: string): TokenizeContentStreamResult {
  return { ok: false, reason };
}

/**
 * Tokenize a PDF content stream with hard progress guards. Every loop iteration
 * must advance the cursor or parsing terminates with a controlled failure.
 */
export function tokenizeContentStreamSafe(content: string): TokenizeContentStreamResult {
  if (content.length > CONTENT_STREAM_TOKENIZER_LIMITS.MAX_CONTENT_LENGTH) {
    return abort("content stream exceeds maximum supported size");
  }

  const tokens: string[] = [];
  let index = 0;
  let iterations = 0;

  function ensureProgress(previousIndex: number): TokenizeContentStreamResult | null {
    iterations += 1;
    if (iterations > CONTENT_STREAM_TOKENIZER_LIMITS.MAX_ITERATIONS) {
      return abort("content stream tokenization exceeded iteration limit");
    }
    if (tokens.length > CONTENT_STREAM_TOKENIZER_LIMITS.MAX_TOKENS) {
      return abort("content stream tokenization exceeded token limit");
    }
    if (index <= previousIndex) {
      return abort("content stream tokenizer made no progress");
    }
    return null;
  }

  while (index < content.length) {
    const previousIndex = index;
    const char = content[index];

    if (/\s/.test(char)) {
      index += 1;
      const progressError = ensureProgress(previousIndex);
      if (progressError) {
        return progressError;
      }
      continue;
    }

    if (char === "%") {
      while (index < content.length && content[index] !== "\n" && content[index] !== "\r") {
        index += 1;
      }
      const progressError = ensureProgress(previousIndex);
      if (progressError) {
        return progressError;
      }
      continue;
    }

    if (char === "(") {
      index += 1;
      let depth = 1;
      while (index < content.length && depth > 0) {
        if (depth > CONTENT_STREAM_TOKENIZER_LIMITS.MAX_PAREN_DEPTH) {
          return abort("literal string nesting exceeds maximum depth");
        }
        if (content[index] === "\\") {
          index += content[index + 1] != null ? 2 : 1;
          continue;
        }
        if (content[index] === "(") {
          depth += 1;
        }
        if (content[index] === ")") {
          depth -= 1;
        }
        index += 1;
      }
      if (depth > 0) {
        return abort("unterminated literal string");
      }
      const progressError = ensureProgress(previousIndex);
      if (progressError) {
        return progressError;
      }
      continue;
    }

    if (char === "<") {
      index += 1;
      if (content[index] === "<") {
        index += 1;
        let scanned = 0;
        while (index < content.length && !(content[index] === ">" && content[index + 1] === ">")) {
          index += 1;
          scanned += 1;
          if (scanned > CONTENT_STREAM_TOKENIZER_LIMITS.MAX_DICTIONARY_SCAN) {
            return abort("unterminated dictionary");
          }
        }
        if (index >= content.length - 1) {
          return abort("unterminated dictionary");
        }
        index += 2;
      } else {
        let scanned = 0;
        while (index < content.length && content[index] !== ">") {
          index += 1;
          scanned += 1;
          if (scanned > CONTENT_STREAM_TOKENIZER_LIMITS.MAX_DICTIONARY_SCAN) {
            return abort("unterminated hex string");
          }
        }
        if (index >= content.length) {
          return abort("unterminated hex string");
        }
        index += 1;
      }
      const progressError = ensureProgress(previousIndex);
      if (progressError) {
        return progressError;
      }
      continue;
    }

    if (char === "[") {
      index += 1;
      let depth = 1;
      while (index < content.length && depth > 0) {
        if (depth > CONTENT_STREAM_TOKENIZER_LIMITS.MAX_ARRAY_DEPTH) {
          return abort("array nesting exceeds maximum depth");
        }
        if (content[index] === "[") {
          depth += 1;
        }
        if (content[index] === "]") {
          depth -= 1;
        }
        index += 1;
      }
      if (depth > 0) {
        return abort("unterminated array");
      }
      const progressError = ensureProgress(previousIndex);
      if (progressError) {
        return progressError;
      }
      continue;
    }

    if (char === "]" || char === ")") {
      index += 1;
      const progressError = ensureProgress(previousIndex);
      if (progressError) {
        return progressError;
      }
      continue;
    }

    if (char === "/") {
      index += 1;
      let name = "/";
      while (index < content.length && !/[\s\[\]()<>]/.test(content[index])) {
        name += content[index];
        index += 1;
      }
      tokens.push(name);
      const progressError = ensureProgress(previousIndex);
      if (progressError) {
        return progressError;
      }
      continue;
    }

    if (char === "-" && index + 1 < content.length && /\d/.test(content[index + 1])) {
      let token = "-";
      index += 1;
      while (index < content.length && /[\d.]/.test(content[index])) {
        token += content[index];
        index += 1;
      }
      tokens.push(token);
      const progressError = ensureProgress(previousIndex);
      if (progressError) {
        return progressError;
      }
      continue;
    }

    let token = "";
    while (index < content.length && !/[\s\[\]()<>/%]/.test(content[index])) {
      token += content[index];
      index += 1;
    }

    if (token) {
      tokens.push(token);
      const progressError = ensureProgress(previousIndex);
      if (progressError) {
        return progressError;
      }
      continue;
    }

    index += 1;
    const progressError = ensureProgress(previousIndex);
    if (progressError) {
      return progressError;
    }
  }

  return { ok: true, tokens };
}

export function tokenizeContentStream(content: string): string[] {
  const result = tokenizeContentStreamSafe(content);
  if (!result.ok) {
    throw new ContentStreamTokenizeError(result.reason);
  }
  return result.tokens;
}
