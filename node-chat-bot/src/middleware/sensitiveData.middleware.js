const redactions = [
  [
    /\b[\w.!#$%&'*+/=?^`{|}~-]+@[\w-]+(?:\.[\w-]+)+\b/gi,
    "[REDACTED_EMAIL]",
  ],
  [
    /\b(?:ssn|social security number)\s*[:#=-]?\s*\d{3}[- ]?\d{2}[- ]?\d{4}\b/gi,
    "[REDACTED_SSN]",
  ],
  [
    /\b\d{3}[- ]?\d{2}[- ]?\d{4}\b/g,
    "[REDACTED_SSN]",
  ],
  [
    /\b(?:aadhaar|aadhar|uid)\s*(?:number|no\.?)?\s*[:#=-]?\s*\d{4}[ -]?\d{4}[ -]?\d{4}\b/gi,
    "[REDACTED_GOVERNMENT_ID]",
  ],
  [
    /\b\d{4}[ -]?\d{4}[ -]?\d{4}\b/g,
    "[REDACTED_GOVERNMENT_ID]",
  ],
  [
    /\b(?:credit|debit|payment)\s*card(?:\s*(?:number|no\.?))?\s*[:#=-]?\s*(?:\d[ -]?){13,19}\b/gi,
    "[REDACTED_PAYMENT_CARD]",
  ],
  [
    /(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g,
    "[REDACTED_PAYMENT_CARD]",
  ],
  [
    /\b(?:mrn|medical record(?:s)?(?: number)?|patient id|health insurance(?: number| id)?)\s*[:#=-]?\s*[a-z0-9][a-z0-9-]{3,}\b/gi,
    "[REDACTED_MEDICAL_ID]",
  ],
  [
    /\b(?:date of birth|birth date|dob)\s*[:#=-]?\s*(?:\d{1,4}[/-]){1,2}\d{1,4}\b/gi,
    "[REDACTED_DOB]",
  ],
  [
    /\b(?:address|home address|street address)\s*[:=-]\s*[^,\n;]+(?:,\s*[^,\n;]+){0,3}/gi,
    "[REDACTED_ADDRESS]",
  ],
  [
    /\b(?:phone|mobile|telephone|contact number)\s*[:#=-]?\s*\+?[\d(][\d ().-]{6,}\d\b/gi,
    "[REDACTED_PHONE]",
  ],
  [
    /(?<!\w)\+\d{1,3}(?:[\s.-]?\d){7,14}(?!\w)/g,
    "[REDACTED_PHONE]",
  ],
  [
    /(?<!\d)[6-9]\d{9}(?!\d)/g,
    "[REDACTED_PHONE]",
  ],
  [
    /(?<!\d)(?:\+?1[\s.-]?)?\(?[2-9]\d{2}\)?[\s.-]?[2-9]\d{2}[\s.-]?\d{4}(?!\d)/g,
    "[REDACTED_PHONE]",
  ],
];

export function redactSensitiveData(value) {
  return redactions.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    value,
  );
}

export function redactChatQuery(req, res, next) {
  if (typeof req.body?.query === "string") {
    req.body.query = redactSensitiveData(req.body.query);
  }
  return next();
}
