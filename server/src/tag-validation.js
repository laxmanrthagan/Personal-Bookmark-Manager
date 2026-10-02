const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 40;

export class TagValidationError extends Error {
  constructor(message = 'Tags must be a list of short text labels.') {
    super(message);
    this.name = 'TagValidationError';
  }
}

export function normalizeTags(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new TagValidationError(`Provide no more than ${MAX_TAGS} tags.`);
  }

  const uniqueTags = new Map();
  for (const candidate of value) {
    if (typeof candidate !== 'string') throw new TagValidationError();
    const name = candidate.trim().replace(/\s+/gu, ' ');
    if (!name) continue;
    if (name.length > MAX_TAG_LENGTH) {
      throw new TagValidationError(`Each tag must be ${MAX_TAG_LENGTH} characters or fewer.`);
    }

    const normalizedName = name.toLowerCase();
    if (!uniqueTags.has(normalizedName)) uniqueTags.set(normalizedName, { name, normalizedName });
  }

  if (uniqueTags.size > MAX_TAGS) {
    throw new TagValidationError(`Provide no more than ${MAX_TAGS} tags.`);
  }

  return [...uniqueTags.values()];
}