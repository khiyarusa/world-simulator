import { describe, expect, it } from 'vitest';
import { calendarOf, DAYS_PER_YEAR, formatDate, isMonthBoundary, isYearBoundary } from '../../src/core/clock.ts';
import { clamp, lerpInt, mulDiv, perMille, scaleTo, smoothstep } from '../../src/core/math.ts';
import { crc32, crcHex } from '../../src/core/crc32.ts';
import { parseSeedText, seedOf, seedToText } from '../../src/core/seed.ts';

describe('calendar', () => {
  it('maps day 1 to year 1, first month, winter', () => {
    const c = calendarOf(1);
    expect(c.year).toBe(1);
    expect(c.month).toBe(1);
    expect(c.dayOfMonth).toBe(1);
    expect(c.season).toBe(0);
  });

  it('rolls over exactly at 360 days', () => {
    expect(calendarOf(DAYS_PER_YEAR).year).toBe(1);
    expect(calendarOf(DAYS_PER_YEAR).month).toBe(12);
    expect(calendarOf(DAYS_PER_YEAR + 1).year).toBe(2);
    expect(calendarOf(DAYS_PER_YEAR + 1).dayOfYear).toBe(1);
  });

  it('keeps month and season boundaries consistent', () => {
    expect(isMonthBoundary(30)).toBe(true);
    expect(isMonthBoundary(31)).toBe(false);
    expect(isYearBoundary(360)).toBe(true);
    expect(calendarOf(90).season).toBe(0);
    expect(calendarOf(91).season).toBe(1);
    expect(calendarOf(360).season).toBe(3);
  });

  it('rejects invalid days', () => {
    expect(() => calendarOf(0)).toThrow(RangeError);
    expect(() => calendarOf(1.5)).toThrow(RangeError);
  });

  it('formats a readable date', () => {
    expect(formatDate(1)).toContain('Year 1');
    expect(formatDate(400)).toContain('Year 2');
  });
});

describe('integer math', () => {
  it('clamps', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-5, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });

  it('multiplies and divides without float drift on representable inputs', () => {
    expect(mulDiv(1000, 1500, 1000)).toBe(1500);
    expect(perMille(1000, 250)).toBe(250);
    expect(perMille(3, 500)).toBe(2);
    expect(() => mulDiv(1, 1, 0)).toThrow(RangeError);
  });

  it('interpolates integers at the ends', () => {
    expect(lerpInt(10, 20, 0)).toBe(10);
    expect(lerpInt(10, 20, 1000)).toBe(20);
    expect(lerpInt(10, 20, 500)).toBe(15);
  });

  it('maps ranges monotonically', () => {
    expect(scaleTo(0, 0, 10, 100, 200)).toBe(100);
    expect(scaleTo(10, 0, 10, 100, 200)).toBe(200);
    expect(scaleTo(5, 0, 10, 100, 200)).toBe(150);
    expect(scaleTo(5, 4, 4, 7, 9)).toBe(7);
  });

  it('smoothsteps between 0 and 1000', () => {
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(1000)).toBe(1000);
    expect(smoothstep(500)).toBe(500);
    expect(smoothstep(-20)).toBe(0);
  });
});

describe('crc32', () => {
  it('matches the published check value', () => {
    const bytes = new TextEncoder().encode('123456789');
    expect(crcHex(crc32(bytes))).toBe('cbf43926');
  });

  it('detects a single flipped bit', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const before = crc32(bytes);
    bytes[2] = 3 ^ 0x01;
    expect(crc32(bytes)).not.toBe(before);
  });
});

describe('seed transport', () => {
  it('round-trips through text without losing bits', () => {
    const seed = seedOf(0xdeadbeef, 0x12345678);
    const text = seedToText(seed);
    expect(text).toBe('12345678-DEADBEEF');
    expect(parseSeedText(text)).toEqual(seed);
  });

  it('accepts a paste without the dash and in lowercase', () => {
    const parsed = parseSeedText(' 12345678deadbeef ');
    expect(parsed).toEqual(seedOf(0xdeadbeef, 0x12345678));
  });

  it('rejects malformed seeds instead of guessing', () => {
    expect(parseSeedText('')).toBeNull();
    expect(parseSeedText('1234')).toBeNull();
    expect(parseSeedText('zzzzzzzz-12345678')).toBeNull();
  });
});
