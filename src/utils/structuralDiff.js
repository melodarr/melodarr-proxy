function structuralDiff (expected, actual, path = 'root') {
  const errors = []

  if (expected === null) {
    if (actual !== null && actual !== undefined) {
      errors.push(`${path}: expected null, got ${typeof actual}`)
    }
    return errors
  }

  if (actual === null || actual === undefined) {
    errors.push(`${path}: missing or null, expected ${typeof expected}`)
    return errors
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      errors.push(`${path}: expected array, got ${typeof actual}`)
      return errors
    }
    if (expected.length > 0 && actual.length === 0) {
      errors.push(`${path}: expected non-empty array, got empty array`)
      return errors
    }
    // For non-empty arrays, compare the first element to ensure the shape matches
    if (expected.length > 0) {
      // Compare the first element as a representative type
      errors.push(...structuralDiff(expected[0], actual[0], `${path}[0]`))
    }
    return errors
  }

  if (typeof expected === 'object') {
    if (typeof actual !== 'object' || Array.isArray(actual)) {
      errors.push(`${path}: expected object, got ${Array.isArray(actual) ? 'array' : typeof actual}`)
      return errors
    }

    const expectedKeys = Object.keys(expected)
    const actualKeys = Object.keys(actual)

    for (const key of expectedKeys) {
      if (!actualKeys.includes(key)) {
        errors.push(`${path}.${key}: missing key`)
      } else {
        errors.push(...structuralDiff(expected[key], actual[key], `${path}.${key}`))
      }
    }

    // Flag extra keys so fixture contract checks enforce an exact key set.
    for (const key of actualKeys) {
      if (!expectedKeys.includes(key)) {
        errors.push(`${path}.${key}: extraneous key found in actual`)
      }
    }

    return errors
  }

  // Primitive check
  if (typeof expected !== typeof actual) {
    errors.push(`${path}: type mismatch, expected ${typeof expected}, got ${typeof actual}`)
  }

  return errors
}

module.exports = { structuralDiff }
