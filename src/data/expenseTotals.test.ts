import { describe, expect, it } from 'vitest';
import type { Expense } from '../types';
import { summarizeExpenses } from './expenseTotals';

const expense = (id: string, amount: number, currency: string, category: string): Expense => ({
  id, amount, currency, category, title:id, date:'2026-10-01', notes:'', bookingId:null, destinationId:null,
});

describe('expense totals', () => {
  it('groups by currency and category without combining currencies', () => {
    expect(summarizeExpenses([
      expense('one', 10, 'EUR', 'Food'), expense('two', 5, 'EUR', 'Food'),
      expense('three', 20, 'USD', 'Food'), expense('four', 3, 'USD', 'Transit'),
    ])).toEqual({
      currencies:[{ currency:'EUR', amount:15 }, { currency:'USD', amount:23 }],
      categories:[
        { currency:'EUR', category:'Food', amount:15 },
        { currency:'USD', category:'Food', amount:20 },
        { currency:'USD', category:'Transit', amount:3 },
      ],
    });
  });
});
