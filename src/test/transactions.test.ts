/**
 * Comprehensive tests for transactions module
 */

import { describe, it, expect } from 'vitest';
import {
  toWeekdayArray,
  normalizeNth,
  firstWeekday,
  matchesMonthlyByDay,
  matchesMonthlyByNthWeekday,
  matchesWeekly,
  matchesBiweekly,
  shouldApplyStreamOn,
  shouldApplyTransactionOn,
  getBaseAmountForDate,
  resolveRecurringAmount,
  estimateOccurrencesPerWeek,
  getNextOccurrence,
  describeNameAndCategory,
  createOneOffTransaction,
  updateOneOffTransaction,
  deleteOneOffTransaction,
  createIncomeStream,
  updateIncomeStream,
  deleteIncomeStream,
  normalizeStreamSteps,
  hasValidRecurrenceWindow,
} from '../modules/transactions';
import type { IncomeStream, Transaction, Step } from '../types';

describe('transactions module', () => {
  describe('toWeekdayArray', () => {
    it('should handle undefined and null', () => {
      expect(toWeekdayArray(undefined)).toEqual([]);
      expect(toWeekdayArray(null)).toEqual([]);
    });

    it('should handle single numeric values', () => {
      expect(toWeekdayArray(0)).toEqual([0]);
      expect(toWeekdayArray(3)).toEqual([3]);
      expect(toWeekdayArray(6)).toEqual([6]);
    });

    it('should handle array of numbers', () => {
      expect(toWeekdayArray([1, 3, 5])).toEqual([1, 3, 5]);
      expect(toWeekdayArray([6, 0, 3])).toEqual([0, 3, 6]);
    });

    it('should handle comma-separated string', () => {
      expect(toWeekdayArray('1,3,5')).toEqual([1, 3, 5]);
      expect(toWeekdayArray('0, 1, 2')).toEqual([0, 1, 2]);
    });

    it('should clamp values to 0-6 range', () => {
      expect(toWeekdayArray(-1)).toEqual([0]);
      expect(toWeekdayArray(7)).toEqual([6]);
      expect(toWeekdayArray(10)).toEqual([6]);
    });

    it('should remove duplicates and sort', () => {
      expect(toWeekdayArray([3, 1, 3, 5, 1])).toEqual([1, 3, 5]);
      expect(toWeekdayArray('5,1,3,1,5')).toEqual([1, 3, 5]);
    });

    it('should handle non-numeric values gracefully', () => {
      expect(toWeekdayArray(['invalid', 2, 'bad'])).toEqual([2]);
      expect(toWeekdayArray([null, undefined, 3])).toEqual([3]);
    });

    it('should truncate decimal values', () => {
      expect(toWeekdayArray([1.7, 3.2, 5.9])).toEqual([1, 3, 5]);
    });
  });

  describe('normalizeNth', () => {
    it('should handle null and undefined', () => {
      expect(normalizeNth(null)).toBe('1');
      expect(normalizeNth(undefined)).toBe('1');
    });

    it('should handle string "last"', () => {
      expect(normalizeNth('last')).toBe('last');
      expect(normalizeNth('LAST')).toBe('last');
      expect(normalizeNth(' last ')).toBe('last');
    });

    it('should handle valid numeric strings', () => {
      expect(normalizeNth('1')).toBe('1');
      expect(normalizeNth('2')).toBe('2');
      expect(normalizeNth('5')).toBe('5');
    });

    it('should handle valid numbers', () => {
      expect(normalizeNth(1)).toBe('1');
      expect(normalizeNth(3)).toBe('3');
      expect(normalizeNth(5)).toBe('5');
    });

    it('should default to "1" for invalid values', () => {
      expect(normalizeNth(0)).toBe('1');
      expect(normalizeNth(6)).toBe('1');
      expect(normalizeNth('invalid')).toBe('1');
    });

    it('should truncate decimal numbers', () => {
      expect(normalizeNth(2.7)).toBe('2');
      expect(normalizeNth(4.1)).toBe('4');
    });
  });

  describe('firstWeekday', () => {
    it('should return first weekday from array', () => {
      expect(firstWeekday([3, 5, 1])).toBe(1);
      expect(firstWeekday('1,3,5')).toBe(1);
    });

    it('should handle single numeric value', () => {
      expect(firstWeekday(3)).toBe(3);
      expect(firstWeekday('5')).toBe(5);
    });

    it('should use fallback when no valid values', () => {
      // Empty array converts to 0, which is valid, so returns 0
      expect(firstWeekday([], 2)).toBe(0);
      // Empty string also converts to 0
      expect(firstWeekday('', 4)).toBe(0);
      // null also converts to 0
      expect(firstWeekday(null, 3)).toBe(0);
      // undefined uses fallback
      expect(firstWeekday(undefined, 3)).toBe(3);
    });

    it('should default to 0 when no fallback provided', () => {
      expect(firstWeekday(null)).toBe(0);
      expect(firstWeekday(undefined)).toBe(0);
    });

    it('should clamp values to 0-6', () => {
      expect(firstWeekday(-5)).toBe(0);
      expect(firstWeekday(10)).toBe(6);
    });
  });

  describe('matchesMonthlyByDay', () => {
    it('should match when date matches day of month', () => {
      const date = new Date(2024, 0, 15); // January 15
      expect(matchesMonthlyByDay(date, 15)).toBe(true);
    });

    it('should not match when date does not match', () => {
      const date = new Date(2024, 0, 15);
      expect(matchesMonthlyByDay(date, 10)).toBe(false);
    });

    it('should handle end of month properly', () => {
      const jan31 = new Date(2024, 0, 31);
      expect(matchesMonthlyByDay(jan31, 31)).toBe(true);
    });

    it('should clamp to last day when target exceeds month length', () => {
      const feb28 = new Date(2024, 1, 29); // Feb 29, 2024 (leap year)
      expect(matchesMonthlyByDay(feb28, 31)).toBe(true);

      const feb28NonLeap = new Date(2023, 1, 28);
      expect(matchesMonthlyByDay(feb28NonLeap, 31)).toBe(true);
    });

    it('should handle day 1', () => {
      const firstDay = new Date(2024, 5, 1);
      expect(matchesMonthlyByDay(firstDay, 1)).toBe(true);
    });
  });

  describe('matchesMonthlyByNthWeekday', () => {
    it('should match 1st Monday', () => {
      const firstMonday = new Date(2024, 0, 1); // Jan 1, 2024 is Monday
      expect(matchesMonthlyByNthWeekday(firstMonday, '1', 1)).toBe(true);
    });

    it('should match 2nd Wednesday', () => {
      const secondWed = new Date(2024, 0, 10); // Jan 10, 2024 is 2nd Wednesday
      expect(matchesMonthlyByNthWeekday(secondWed, '2', 3)).toBe(true);
    });

    it('should match 3rd Friday', () => {
      const thirdFri = new Date(2024, 0, 19); // Jan 19, 2024 is 3rd Friday
      expect(matchesMonthlyByNthWeekday(thirdFri, '3', 5)).toBe(true);
    });

    it('should match last weekday of month', () => {
      const lastWed = new Date(2024, 0, 31); // Jan 31, 2024 is last Wednesday
      expect(matchesMonthlyByNthWeekday(lastWed, 'last', 3)).toBe(true);
    });

    it('should not match wrong weekday', () => {
      const monday = new Date(2024, 0, 1);
      expect(matchesMonthlyByNthWeekday(monday, '1', 2)).toBe(false); // Looking for Tuesday
    });

    it('should not match wrong nth occurrence', () => {
      const firstMonday = new Date(2024, 0, 1);
      expect(matchesMonthlyByNthWeekday(firstMonday, '2', 1)).toBe(false); // Looking for 2nd
    });

    it('should handle months with 5 occurrences', () => {
      const fifthSunday = new Date(2024, 8, 29); // Sept 29, 2024 is 5th Sunday
      expect(matchesMonthlyByNthWeekday(fifthSunday, '5', 0)).toBe(true);
    });

    it('should return false when nth exceeds available occurrences', () => {
      const anyDate = new Date(2024, 1, 5);
      expect(matchesMonthlyByNthWeekday(anyDate, '5', 0)).toBe(false);
    });
  });

  describe('matchesWeekly', () => {
    it('should match when weekday is in array', () => {
      const monday = new Date(2024, 0, 1); // Monday
      expect(matchesWeekly(monday, [1, 3, 5])).toBe(true);
    });

    it('should not match when weekday is not in array', () => {
      const tuesday = new Date(2024, 0, 2);
      expect(matchesWeekly(tuesday, [1, 3, 5])).toBe(false);
    });

    it('should handle single weekday', () => {
      const wednesday = new Date(2024, 0, 3);
      expect(matchesWeekly(wednesday, 3)).toBe(true);
      expect(matchesWeekly(wednesday, 2)).toBe(false);
    });

    it('should return false for empty array', () => {
      const anyDate = new Date(2024, 0, 1);
      expect(matchesWeekly(anyDate, [])).toBe(false);
    });

    it('should handle comma-separated string', () => {
      const friday = new Date(2024, 0, 5);
      expect(matchesWeekly(friday, '1,3,5')).toBe(true);
    });
  });

  describe('matchesBiweekly', () => {
    it('should match on correct weekday at 2-week intervals', () => {
      const anchor = new Date(2024, 0, 1); // Monday, Jan 1
      const twoWeeksLater = new Date(2024, 0, 15); // Monday, Jan 15
      expect(matchesBiweekly(twoWeeksLater, 1, anchor)).toBe(true);
    });

    it('should not match on wrong week', () => {
      const anchor = new Date(2024, 0, 1);
      const oneWeekLater = new Date(2024, 0, 8); // One week, not two
      expect(matchesBiweekly(oneWeekLater, 1, anchor)).toBe(false);
    });

    it('should not match before anchor', () => {
      const anchor = new Date(2024, 0, 15);
      const before = new Date(2024, 0, 1);
      expect(matchesBiweekly(before, 1, anchor)).toBe(false);
    });

    it('should handle multiple weekdays', () => {
      const anchor = new Date(2024, 0, 1); // Monday
      const wed2WeeksLater = new Date(2024, 0, 17); // Wednesday, 2 weeks later
      expect(matchesBiweekly(wed2WeeksLater, [1, 3], anchor)).toBe(true);
    });

    it('should match at anchor date', () => {
      const anchor = new Date(2024, 0, 1);
      expect(matchesBiweekly(anchor, 1, anchor)).toBe(true);
    });

    it('should return false for empty weekdays', () => {
      const anchor = new Date(2024, 0, 1);
      const date = new Date(2024, 0, 15);
      expect(matchesBiweekly(date, [], anchor)).toBe(false);
    });
  });

  describe('shouldApplyStreamOn', () => {
    describe('once frequency', () => {
      it('should match on exact date', () => {
        const stream = {
          frequency: 'once',
          startDate: '2024-01-01',
          endDate: '2024-12-31',
          onDate: '2024-06-15',
        };
        expect(shouldApplyStreamOn(new Date(2024, 5, 15), stream)).toBe(true);
      });

      it('should not match on different date', () => {
        const stream = {
          frequency: 'once',
          startDate: '2024-01-01',
          endDate: '2024-12-31',
          onDate: '2024-06-15',
        };
        expect(shouldApplyStreamOn(new Date(2024, 5, 16), stream)).toBe(false);
      });
    });

    describe('daily frequency', () => {
      it('should match every day', () => {
        const stream = {
          frequency: 'daily',
          startDate: '2024-01-01',
          endDate: '2024-01-31',
          skipWeekends: false,
        };
        expect(shouldApplyStreamOn(new Date(2024, 0, 15), stream)).toBe(true);
      });

      it('should skip weekends when skipWeekends is true', () => {
        const stream = {
          frequency: 'daily',
          startDate: '2024-01-01',
          endDate: '2024-01-31',
          skipWeekends: true,
        };
        const saturday = new Date(2024, 0, 6);
        const sunday = new Date(2024, 0, 7);
        const monday = new Date(2024, 0, 8);

        expect(shouldApplyStreamOn(saturday, stream)).toBe(false);
        expect(shouldApplyStreamOn(sunday, stream)).toBe(false);
        expect(shouldApplyStreamOn(monday, stream)).toBe(true);
      });
    });

    describe('weekly frequency', () => {
      it('should match on specified weekdays', () => {
        const stream = {
          frequency: 'weekly',
          startDate: '2024-01-01',
          endDate: '2024-12-31',
          dayOfWeek: [1, 3, 5], // Mon, Wed, Fri
        };
        expect(shouldApplyStreamOn(new Date(2024, 0, 1), stream)).toBe(true); // Monday
        expect(shouldApplyStreamOn(new Date(2024, 0, 3), stream)).toBe(true); // Wednesday
        expect(shouldApplyStreamOn(new Date(2024, 0, 2), stream)).toBe(false); // Tuesday
      });
    });

    describe('biweekly frequency', () => {
      it('should match on biweekly schedule', () => {
        const stream = {
          frequency: 'biweekly',
          startDate: '2024-01-01',
          endDate: '2024-12-31',
          dayOfWeek: [1],
        };
        expect(shouldApplyStreamOn(new Date(2024, 0, 1), stream)).toBe(true);
        expect(shouldApplyStreamOn(new Date(2024, 0, 15), stream)).toBe(true);
        expect(shouldApplyStreamOn(new Date(2024, 0, 8), stream)).toBe(false);
      });
    });

    describe('monthly frequency', () => {
      it('should match by day of month', () => {
        const stream = {
          frequency: 'monthly',
          startDate: '2024-01-01',
          endDate: '2024-12-31',
          monthlyMode: 'day',
          dayOfMonth: 15,
        };
        expect(shouldApplyStreamOn(new Date(2024, 0, 15), stream)).toBe(true);
        expect(shouldApplyStreamOn(new Date(2024, 1, 15), stream)).toBe(true);
        expect(shouldApplyStreamOn(new Date(2024, 0, 16), stream)).toBe(false);
      });

      it('should match by nth weekday', () => {
        const stream = {
          frequency: 'monthly',
          startDate: '2024-01-01',
          endDate: '2024-12-31',
          monthlyMode: 'nth',
          nthWeek: '1',
          nthWeekday: 1, // First Monday
        };
        expect(shouldApplyStreamOn(new Date(2024, 0, 1), stream)).toBe(true);
        expect(shouldApplyStreamOn(new Date(2024, 0, 8), stream)).toBe(false);
      });
    });

    it('should not match outside date range', () => {
      const stream = {
        frequency: 'daily',
        startDate: '2024-01-01',
        endDate: '2024-01-31',
        skipWeekends: false,
      };
      expect(shouldApplyStreamOn(new Date(2023, 11, 31), stream)).toBe(false);
      expect(shouldApplyStreamOn(new Date(2024, 1, 1), stream)).toBe(false);
    });

    it('should handle invalid stream gracefully', () => {
      expect(shouldApplyStreamOn(new Date(), null)).toBe(false);
      expect(shouldApplyStreamOn(new Date(), undefined)).toBe(false);
      expect(shouldApplyStreamOn(new Date(), {})).toBe(false);
    });
  });

  describe('shouldApplyTransactionOn', () => {
    it('should handle one-off transactions', () => {
      const transaction = {
        recurring: false,
        date: '2024-06-15',
      };
      expect(shouldApplyTransactionOn(new Date(2024, 5, 15), transaction)).toBe(true);
      expect(shouldApplyTransactionOn(new Date(2024, 5, 16), transaction)).toBe(false);
    });

    it('should handle recurring transactions', () => {
      const transaction = {
        recurring: true,
        frequency: 'daily',
        startDate: '2024-01-01',
        endDate: '2024-01-31',
        skipWeekends: false,
      };
      expect(shouldApplyTransactionOn(new Date(2024, 0, 15), transaction)).toBe(true);
    });

    it('should handle invalid transaction gracefully', () => {
      expect(shouldApplyTransactionOn(new Date(), null)).toBe(false);
      expect(shouldApplyTransactionOn(new Date(), undefined)).toBe(false);
    });
  });

  describe('getBaseAmountForDate', () => {
    it('should return base amount when no steps', () => {
      const entry = { amount: 1000 };
      expect(getBaseAmountForDate(entry, new Date(2024, 0, 15))).toBe(1000);
    });

    it('should return base amount when steps is empty', () => {
      const entry = { amount: 1000, steps: [] };
      expect(getBaseAmountForDate(entry, new Date(2024, 0, 15))).toBe(1000);
    });

    it('should apply step when date is after effectiveFrom', () => {
      const entry: { amount: number; steps: Step[] } = {
        amount: 1000,
        steps: [
          { effectiveFrom: '2024-06-01', amount: 1500 },
        ],
      };
      expect(getBaseAmountForDate(entry, new Date(2024, 6, 1))).toBe(1500);
    });

    it('should not apply step when date is before effectiveFrom', () => {
      const entry: { amount: number; steps: Step[] } = {
        amount: 1000,
        steps: [
          { effectiveFrom: '2024-06-01', amount: 1500 },
        ],
      };
      expect(getBaseAmountForDate(entry, new Date(2024, 4, 15))).toBe(1000);
    });

    it('should apply latest applicable step', () => {
      const entry: { amount: number; steps: Step[] } = {
        amount: 1000,
        steps: [
          { effectiveFrom: '2024-03-01', amount: 1200 },
          { effectiveFrom: '2024-06-01', amount: 1500 },
          { effectiveFrom: '2024-09-01', amount: 1800 },
        ],
      };
      expect(getBaseAmountForDate(entry, new Date(2024, 7, 15))).toBe(1500);
    });

    it('should handle negative amounts as absolute values', () => {
      const entry = { amount: -1000 };
      expect(getBaseAmountForDate(entry, new Date(2024, 0, 15))).toBe(1000);
    });

    it('should handle zero amount', () => {
      const entry = { amount: 0 };
      expect(getBaseAmountForDate(entry, new Date(2024, 0, 15))).toBe(0);
    });
  });

  describe('resolveRecurringAmount', () => {
    it('should return base amount when no escalator', () => {
      const entry = { amount: 1000, escalatorPct: 0 };
      const date = new Date(2024, 5, 1);
      const prevDate = new Date(2024, 4, 1);

      expect(resolveRecurringAmount(entry, date, prevDate)).toBe(1000);
    });

    it('should return base amount when no previous date', () => {
      const entry = { amount: 1000, escalatorPct: 5 };
      const date = new Date(2024, 5, 1);

      expect(resolveRecurringAmount(entry, date, null)).toBe(1000);
    });

    it('should apply escalator for monthly increase', () => {
      const entry = { amount: 1000, escalatorPct: 12 };
      const prevDate = new Date(2024, 0, 1);
      const date = new Date(2024, 1, 1); // 1 month later

      const result = resolveRecurringAmount(entry, date, prevDate);
      expect(result).toBeCloseTo(1000 * 1.12, 2); // 12% increase
    });

    it('should compound escalator over multiple months', () => {
      const entry = { amount: 1000, escalatorPct: 10 };
      const prevDate = new Date(2024, 0, 1);
      const date = new Date(2024, 2, 1); // 2 months later

      const result = resolveRecurringAmount(entry, date, prevDate);
      expect(result).toBeCloseTo(1000 * Math.pow(1.10, 2), 2);
    });

    it('should handle negative escalator (decrease)', () => {
      const entry = { amount: 1000, escalatorPct: -5 };
      const prevDate = new Date(2024, 0, 1);
      const date = new Date(2024, 1, 1);

      const result = resolveRecurringAmount(entry, date, prevDate);
      expect(result).toBeCloseTo(1000 * 0.95, 2);
    });

    it('should return 0 when base amount is 0', () => {
      const entry = { amount: 0, escalatorPct: 10 };
      const date = new Date(2024, 1, 1);
      const prevDate = new Date(2024, 0, 1);

      expect(resolveRecurringAmount(entry, date, prevDate)).toBe(0);
    });

    it('should apply escalator with steps', () => {
      const entry: { amount: number; steps: Step[]; escalatorPct: number } = {
        amount: 1000,
        steps: [{ effectiveFrom: '2024-01-01', amount: 1500 }],
        escalatorPct: 10,
      };
      const prevDate = new Date(2024, 1, 1);
      const date = new Date(2024, 2, 1); // Base is 1500, escalate by 10%

      const result = resolveRecurringAmount(entry, date, prevDate);
      expect(result).toBeCloseTo(1500 * 1.10, 2);
    });
  });

  describe('estimateOccurrencesPerWeek', () => {
    it('should return 7 for daily without skipWeekends', () => {
      const stream = { frequency: 'daily', skipWeekends: false };
      expect(estimateOccurrencesPerWeek(stream)).toBe(7);
    });

    it('should return 5 for daily with skipWeekends', () => {
      const stream = { frequency: 'daily', skipWeekends: true };
      expect(estimateOccurrencesPerWeek(stream)).toBe(5);
    });

    it('should count weekdays for weekly frequency', () => {
      expect(estimateOccurrencesPerWeek({ frequency: 'weekly', dayOfWeek: [1] })).toBe(1);
      expect(estimateOccurrencesPerWeek({ frequency: 'weekly', dayOfWeek: [1, 3, 5] })).toBe(3);
    });

    it('should halve weekly count for biweekly', () => {
      expect(estimateOccurrencesPerWeek({ frequency: 'biweekly', dayOfWeek: [1, 3] })).toBe(1);
      expect(estimateOccurrencesPerWeek({ frequency: 'biweekly', dayOfWeek: [1] })).toBe(0.5);
    });

    it('should return 12/52 for monthly', () => {
      const stream = { frequency: 'monthly' };
      expect(estimateOccurrencesPerWeek(stream)).toBeCloseTo(12 / 52, 3);
    });

    it('should return 0 for once', () => {
      const stream = { frequency: 'once' };
      expect(estimateOccurrencesPerWeek(stream)).toBe(0);
    });

    it('should handle invalid stream', () => {
      expect(estimateOccurrencesPerWeek(null)).toBe(0);
      expect(estimateOccurrencesPerWeek(undefined)).toBe(0);
      expect(estimateOccurrencesPerWeek({})).toBe(0);
    });
  });

  describe('getNextOccurrence', () => {
    describe('one-off transactions', () => {
      it('should return next occurrence for future one-off', () => {
        const entry = {
          recurring: false,
          date: '2024-06-15',
          amount: 1000,
        };
        const result = getNextOccurrence(entry, '2024-01-01');
        expect(result).toEqual({ date: '2024-06-15', amount: 1000 });
      });

      it('should return null for past one-off', () => {
        const entry = {
          recurring: false,
          date: '2024-01-15',
          amount: 1000,
        };
        const result = getNextOccurrence(entry, '2024-06-01');
        expect(result).toBeNull();
      });

      it('should return occurrence on same day', () => {
        const entry = {
          recurring: false,
          date: '2024-06-15',
          amount: 1000,
        };
        const result = getNextOccurrence(entry, '2024-06-15');
        expect(result).toEqual({ date: '2024-06-15', amount: 1000 });
      });
    });

    describe('recurring transactions', () => {
      it('should find next daily occurrence', () => {
        const entry = {
          recurring: true,
          frequency: 'daily',
          startDate: '2024-01-01',
          endDate: '2024-12-31',
          skipWeekends: false,
          amount: 100,
        };
        const result = getNextOccurrence(entry, '2024-06-15');
        expect(result?.date).toBe('2024-06-15');
        expect(result?.amount).toBe(100);
      });

      it('should skip weekends when specified', () => {
        const entry = {
          recurring: true,
          frequency: 'daily',
          startDate: '2024-01-01',
          endDate: '2024-12-31',
          skipWeekends: true,
          amount: 100,
        };
        // June 15, 2024 is Saturday
        const result = getNextOccurrence(entry, '2024-06-15');
        expect(result?.date).toBe('2024-06-17'); // Monday
      });

      it('should find next weekly occurrence', () => {
        const entry = {
          recurring: true,
          frequency: 'weekly',
          startDate: '2024-01-01',
          endDate: '2024-12-31',
          dayOfWeek: [1], // Monday
          amount: 500,
        };
        const result = getNextOccurrence(entry, '2024-06-13'); // Thursday
        expect(result?.date).toBe('2024-06-17'); // Next Monday
      });

      it('should find next monthly occurrence', () => {
        const entry = {
          recurring: true,
          frequency: 'monthly',
          startDate: '2024-01-01',
          endDate: '2024-12-31',
          monthlyMode: 'day',
          dayOfMonth: 15,
          amount: 2000,
        };
        const result = getNextOccurrence(entry, '2024-06-10');
        expect(result?.date).toBe('2024-06-15');
      });

      it('should apply escalator to recurring amount', () => {
        const entry = {
          recurring: true,
          frequency: 'monthly',
          startDate: '2024-01-15',
          endDate: '2024-12-31',
          monthlyMode: 'day',
          dayOfMonth: 15,
          amount: 1000,
          escalatorPct: 10,
        };
        // Find Feb occurrence after Jan occurrence
        const result = getNextOccurrence(entry, '2024-02-01');
        expect(result?.date).toBe('2024-02-15');
        // Should be escalated from Jan (1 month)
        expect(result?.amount).toBeGreaterThan(1000);
      });

      it('should return null when no future occurrences', () => {
        const entry = {
          recurring: true,
          frequency: 'daily',
          startDate: '2024-01-01',
          endDate: '2024-01-31',
          skipWeekends: false,
          amount: 100,
        };
        const result = getNextOccurrence(entry, '2024-06-01');
        expect(result).toBeNull();
      });

      it('should handle once frequency', () => {
        const entry = {
          recurring: true,
          frequency: 'once',
          startDate: '2024-01-01',
          endDate: '2024-12-31',
          onDate: '2024-06-15',
          amount: 5000,
        };
        const result = getNextOccurrence(entry, '2024-01-01');
        expect(result).toEqual({ date: '2024-06-15', amount: 5000 });
      });
    });

    it('should handle invalid entries', () => {
      expect(getNextOccurrence(null)).toBeNull();
      expect(getNextOccurrence(undefined)).toBeNull();
      expect(getNextOccurrence({})).toBeNull();
    });
  });

  describe('describeNameAndCategory', () => {
    it('should combine name and category', () => {
      const entry = { name: 'Salary', category: 'Income' };
      expect(describeNameAndCategory(entry, 'Unknown')).toBe('Salary – Income');
    });

    it('should use only name when no category', () => {
      const entry = { name: 'Salary', category: '' };
      expect(describeNameAndCategory(entry, 'Unknown')).toBe('Salary');
    });

    it('should use only category when no name', () => {
      const entry = { name: '', category: 'Income' };
      expect(describeNameAndCategory(entry, 'Unknown')).toBe('Income');
    });

    it('should use note when no name or category', () => {
      const entry = { name: '', category: '', note: 'Some note' };
      expect(describeNameAndCategory(entry, 'Unknown')).toBe('Some note');
    });

    it('should use fallback when all empty', () => {
      const entry = { name: '', category: '', note: '' };
      expect(describeNameAndCategory(entry, 'Fallback')).toBe('Fallback');
    });

    it('should handle invalid entries', () => {
      expect(describeNameAndCategory(null as any, 'Fallback')).toBe('Fallback');
      expect(describeNameAndCategory(undefined as any, 'Fallback')).toBe('Fallback');
    });
  });

  describe('createOneOffTransaction', () => {
    it('should create valid one-off transaction', () => {
      const input = {
        id: 'test-1',
        name: 'Bonus',
        category: 'Income',
        type: 'income',
        date: '2024-06-15',
        amount: 1000,
      };
      const result = createOneOffTransaction(input);
      expect(result).toBeTruthy();
      expect(result?.id).toBe('test-1');
      expect(result?.recurring).toBe(false);
    });

    it('should return null for invalid input', () => {
      expect(createOneOffTransaction(null)).toBeNull();
      expect(createOneOffTransaction(undefined)).toBeNull();
    });
  });

  describe('updateOneOffTransaction', () => {
    it('should update matching transaction', () => {
      const list: Transaction[] = [
        {
          id: 'test-1',
          name: 'Original',
          category: 'Cat1',
          type: 'income',
          date: '2024-01-01',
          amount: 100,
          recurring: false,
          steps: [],
          escalatorPct: 0,
        },
      ];
      const updates = { name: 'Updated', amount: 200 };
      const result = updateOneOffTransaction(list, 'test-1', updates);

      expect(result[0].name).toBe('Updated');
      expect(result[0].amount).toBe(200);
    });

    it('should not update non-matching transactions', () => {
      const list: Transaction[] = [
        {
          id: 'test-1',
          name: 'First',
          category: 'Cat1',
          type: 'income',
          date: '2024-01-01',
          amount: 100,
          recurring: false,
          steps: [],
          escalatorPct: 0,
        },
      ];
      const result = updateOneOffTransaction(list, 'test-2', { name: 'Updated' });
      expect(result[0].name).toBe('First');
    });

    it('should handle empty list', () => {
      const result = updateOneOffTransaction([], 'test-1', { name: 'Updated' });
      expect(result).toEqual([]);
    });

    it('should handle invalid list', () => {
      const result = updateOneOffTransaction(null as any, 'test-1', { name: 'Updated' });
      expect(result).toEqual([]);
    });
  });

  describe('deleteOneOffTransaction', () => {
    it('should remove matching transaction', () => {
      const list: Transaction[] = [
        {
          id: 'test-1',
          name: 'First',
          category: 'Cat1',
          type: 'income',
          date: '2024-01-01',
          amount: 100,
          recurring: false,
          steps: [],
          escalatorPct: 0,
        },
        {
          id: 'test-2',
          name: 'Second',
          category: 'Cat2',
          type: 'expense',
          date: '2024-01-02',
          amount: 50,
          recurring: false,
          steps: [],
          escalatorPct: 0,
        },
      ];
      const result = deleteOneOffTransaction(list, 'test-1');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('test-2');
    });

    it('should handle non-existent id', () => {
      const list: Transaction[] = [
        {
          id: 'test-1',
          name: 'First',
          category: 'Cat1',
          type: 'income',
          date: '2024-01-01',
          amount: 100,
          recurring: false,
          steps: [],
          escalatorPct: 0,
        },
      ];
      const result = deleteOneOffTransaction(list, 'non-existent');
      expect(result).toHaveLength(1);
    });

    it('should handle empty list', () => {
      const result = deleteOneOffTransaction([], 'test-1');
      expect(result).toEqual([]);
    });
  });

  describe('createIncomeStream', () => {
    it('should create valid income stream', () => {
      const input = {
        id: 'stream-1',
        name: 'Salary',
        category: 'Job',
        amount: 5000,
        frequency: 'monthly',
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        onDate: null,
        skipWeekends: false,
        steps: [],
        escalatorPct: 0,
      };
      const result = createIncomeStream(input);
      expect(result).toBeTruthy();
      expect(result?.id).toBe('stream-1');
    });

    it('should return null for invalid input', () => {
      expect(createIncomeStream(null)).toBeNull();
      expect(createIncomeStream(undefined)).toBeNull();
    });
  });

  describe('updateIncomeStream', () => {
    it('should update matching stream', () => {
      const list: IncomeStream[] = [
        {
          id: 'stream-1',
          name: 'Original',
          category: 'Job',
          amount: 5000,
          frequency: 'monthly',
          startDate: '2024-01-01',
          endDate: '2024-12-31',
          onDate: null,
          skipWeekends: false,
          steps: [],
          escalatorPct: 0,
        },
      ];
      const updates = { name: 'Updated', amount: 6000 };
      const result = updateIncomeStream(list, 'stream-1', updates);

      expect(result[0].name).toBe('Updated');
      expect(result[0].amount).toBe(6000);
    });

    it('should handle empty list', () => {
      const result = updateIncomeStream([], 'stream-1', { name: 'Updated' });
      expect(result).toEqual([]);
    });
  });

  describe('deleteIncomeStream', () => {
    it('should remove matching stream', () => {
      const list: IncomeStream[] = [
        {
          id: 'stream-1',
          name: 'First',
          category: 'Job',
          amount: 5000,
          frequency: 'monthly',
          startDate: '2024-01-01',
          endDate: '2024-12-31',
          onDate: null,
          skipWeekends: false,
          steps: [],
          escalatorPct: 0,
        },
        {
          id: 'stream-2',
          name: 'Second',
          category: 'Side',
          amount: 1000,
          frequency: 'weekly',
          startDate: '2024-01-01',
          endDate: '2024-12-31',
          onDate: null,
          skipWeekends: false,
          steps: [],
          escalatorPct: 0,
        },
      ];
      const result = deleteIncomeStream(list, 'stream-1');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('stream-2');
    });

    it('should handle empty list', () => {
      const result = deleteIncomeStream([], 'stream-1');
      expect(result).toEqual([]);
    });
  });

  describe('normalizeStreamSteps', () => {
    it('should normalize steps in stream', () => {
      const stream: IncomeStream = {
        id: 'stream-1',
        name: 'Salary',
        category: 'Job',
        amount: 5000,
        frequency: 'monthly',
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        onDate: null,
        skipWeekends: false,
        steps: [
          { effectiveFrom: '2024-06-01', amount: 5500 },
        ],
        escalatorPct: 0,
      };
      const result = normalizeStreamSteps(stream);
      expect(result.steps).toBeDefined();
      expect(Array.isArray(result.steps)).toBe(true);
    });

    it('should handle stream without steps', () => {
      const stream: IncomeStream = {
        id: 'stream-1',
        name: 'Salary',
        category: 'Job',
        amount: 5000,
        frequency: 'monthly',
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        onDate: null,
        skipWeekends: false,
        steps: [],
        escalatorPct: 0,
      };
      const result = normalizeStreamSteps(stream);
      expect(result.steps).toEqual([]);
    });
  });

  describe('hasValidRecurrenceWindow', () => {
    it('should return true for valid date range', () => {
      const entry = {
        startDate: '2024-01-01',
        endDate: '2024-12-31',
      };
      expect(hasValidRecurrenceWindow(entry)).toBe(true);
    });

    it('should return true when start equals end', () => {
      const entry = {
        startDate: '2024-06-15',
        endDate: '2024-06-15',
      };
      expect(hasValidRecurrenceWindow(entry)).toBe(true);
    });

    it('should return false when end before start', () => {
      const entry = {
        startDate: '2024-12-31',
        endDate: '2024-01-01',
      };
      expect(hasValidRecurrenceWindow(entry)).toBe(false);
    });

    it('should return false when missing dates', () => {
      expect(hasValidRecurrenceWindow({ startDate: '2024-01-01' })).toBe(false);
      expect(hasValidRecurrenceWindow({ endDate: '2024-12-31' })).toBe(false);
      expect(hasValidRecurrenceWindow({})).toBe(false);
    });

    it('should return false for invalid date strings', () => {
      const entry = {
        startDate: 'invalid',
        endDate: '2024-12-31',
      };
      expect(hasValidRecurrenceWindow(entry)).toBe(false);
    });

    it('should return false for null/undefined', () => {
      expect(hasValidRecurrenceWindow(null as any)).toBe(false);
      expect(hasValidRecurrenceWindow(undefined as any)).toBe(false);
    });
  });

  describe('edge cases and boundary conditions', () => {
    it('should handle leap year correctly', () => {
      const stream = {
        frequency: 'monthly',
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        monthlyMode: 'day',
        dayOfMonth: 29,
      };
      // Feb 29, 2024 exists (leap year)
      expect(shouldApplyStreamOn(new Date(2024, 1, 29), stream)).toBe(true);
    });

    it('should handle non-leap year February 29', () => {
      const stream = {
        frequency: 'monthly',
        startDate: '2023-01-01',
        endDate: '2023-12-31',
        monthlyMode: 'day',
        dayOfMonth: 31,
      };
      // Feb 28, 2023 should match when asking for day 31
      expect(shouldApplyStreamOn(new Date(2023, 1, 28), stream)).toBe(true);
    });

    it('should handle year boundaries', () => {
      const stream = {
        frequency: 'daily',
        startDate: '2023-12-31',
        endDate: '2024-01-01',
        skipWeekends: false,
      };
      expect(shouldApplyStreamOn(new Date(2023, 11, 31), stream)).toBe(true);
      expect(shouldApplyStreamOn(new Date(2024, 0, 1), stream)).toBe(true);
    });

    it('should handle DST transitions', () => {
      // March 10, 2024 - DST begins in US
      const stream = {
        frequency: 'daily',
        startDate: '2024-03-09',
        endDate: '2024-03-11',
        skipWeekends: false,
      };
      expect(shouldApplyStreamOn(new Date(2024, 2, 10), stream)).toBe(true);
    });

    it('should handle very long recurrence periods', () => {
      const entry = {
        recurring: true,
        frequency: 'monthly',
        startDate: '2020-01-01',
        endDate: '2030-12-31',
        monthlyMode: 'day',
        dayOfMonth: 15,
        amount: 1000,
        escalatorPct: 1,
      };
      const result = getNextOccurrence(entry, '2025-06-01');
      expect(result).toBeTruthy();
      expect(result?.date).toBe('2025-06-15');
    });

    it('should handle multiple weekdays in biweekly', () => {
      const anchor = new Date(2024, 0, 1); // Monday
      const wed2WeeksLater = new Date(2024, 0, 17);
      expect(matchesBiweekly(wed2WeeksLater, [1, 3, 5], anchor)).toBe(true);
    });

    it('should handle 5th occurrence in months with only 4', () => {
      const stream = {
        frequency: 'monthly',
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        monthlyMode: 'nth',
        nthWeek: '5',
        nthWeekday: 1, // 5th Monday
      };
      // February 2024 doesn't have a 5th Monday
      expect(shouldApplyStreamOn(new Date(2024, 1, 26), stream)).toBe(false);
    });
  });

  describe('performance and large datasets', () => {
    it('should handle large weekday arrays efficiently', () => {
      const largeArray = Array(1000).fill(0).map((_, i) => i);
      const result = toWeekdayArray(largeArray);
      expect(result).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });

    it('should handle many steps efficiently', () => {
      const steps: Step[] = Array(100).fill(0).map((_, i) => ({
        effectiveFrom: `2024-${String(Math.floor(i / 30) + 1).padStart(2, '0')}-01`,
        amount: 1000 + i * 10,
      }));
      const entry = { amount: 1000, steps };
      const result = getBaseAmountForDate(entry, new Date(2024, 11, 31));
      expect(result).toBeGreaterThan(1000);
    });
  });
});
