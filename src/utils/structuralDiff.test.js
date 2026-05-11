const test = require('node:test')
const assert = require('node:assert/strict')

const { structuralDiff } = require('./structuralDiff')

test('structuralDiff flags empty actual arrays when expected is non-empty', () => {
  assert.deepEqual(
    structuralDiff([{ id: 'expected' }], [], 'root.items'),
    ['root.items: expected non-empty array, got empty array']
  )
})

test('structuralDiff still compares the first array element shape when both arrays are non-empty', () => {
  assert.deepEqual(
    structuralDiff([{ id: 'expected' }], [{}], 'root.items'),
    ['root.items[0].id: missing key']
  )
})
