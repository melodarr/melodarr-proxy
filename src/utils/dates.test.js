const test = require('node:test')
const assert = require('node:assert/strict')

const { toIsoDate } = require('./dates')

test('toIsoDate — empty / nullish inputs return empty string', () => {
  assert.equal(toIsoDate(null), '')
  assert.equal(toIsoDate(undefined), '')
  assert.equal(toIsoDate(''), '')
  assert.equal(toIsoDate('   '), '')
})

test('toIsoDate — full ISO timestamp passes through unchanged', () => {
  assert.equal(toIsoDate('1997-05-21T07:00:00Z'), '1997-05-21T07:00:00Z')
  assert.equal(toIsoDate('2020-01-01T00:00:00.000Z'), '2020-01-01T00:00:00.000Z')
})

test('toIsoDate — date-only YYYY-MM-DD pads to midnight UTC', () => {
  assert.equal(toIsoDate('1997-05-21'), '1997-05-21T00:00:00Z')
})

test('toIsoDate — year-month YYYY-MM pads to first of month', () => {
  assert.equal(toIsoDate('1997-05'), '1997-05-01T00:00:00Z')
})

test('toIsoDate — year-only YYYY pads to Jan 1', () => {
  assert.equal(toIsoDate('1997'), '1997-01-01T00:00:00Z')
})

test('toIsoDate — accepts numeric year (album.year fallback path)', () => {
  assert.equal(toIsoDate(1997), '1997-01-01T00:00:00Z')
  assert.equal(toIsoDate(2020), '2020-01-01T00:00:00Z')
})

test('toIsoDate — unrecognised formats pass through verbatim', () => {
  // Not our job to second-guess garbage from upstream; emit and let the
  // consumer decide. Skyhook never emits non-ISO so this is a defensive path.
  assert.equal(toIsoDate('not a date'), 'not a date')
  assert.equal(toIsoDate('1997/05/21'), '1997/05/21')
})
