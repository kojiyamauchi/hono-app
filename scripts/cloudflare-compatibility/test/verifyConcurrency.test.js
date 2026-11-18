import { expect, test } from 'bun:test'

import { calculateDatabaseOverlapMs } from '../verifyConcurrency.mjs'

test('DB時刻の秒をミリ秒へ変換し、境界が接するだけのSQLを並行と扱わない', () => {
  expect(
    calculateDatabaseOverlapMs([
      { startedAt: 1, finishedAt: 1.2 },
      { startedAt: 1.1, finishedAt: 1.3 },
    ]),
  ).toBe(100)
  expect(
    calculateDatabaseOverlapMs([
      { startedAt: 1, finishedAt: 1.2 },
      { startedAt: 1.2, finishedAt: 1.4 },
    ]),
  ).toBe(0)
  expect(
    calculateDatabaseOverlapMs([
      { startedAt: 2, finishedAt: 2.2 },
      { startedAt: 1, finishedAt: 1.2 },
    ]),
  ).toBe(0)
  expect(() => calculateDatabaseOverlapMs([{ startedAt: NaN, finishedAt: 1.2 }])).toThrow()
  expect(() => calculateDatabaseOverlapMs([{ startedAt: 2, finishedAt: 1.2 }])).toThrow()
})
