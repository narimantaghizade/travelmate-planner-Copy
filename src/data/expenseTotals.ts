import type { Expense } from '../types';

export type CurrencyTotal = { currency: string; amount: number };
export type CategoryTotal = { currency: string; category: string; amount: number };

export function summarizeExpenses(expenses: Expense[]): { currencies: CurrencyTotal[]; categories: CategoryTotal[] } {
  const currencies = new Map<string, number>();
  const categories = new Map<string, number>();
  for (const expense of expenses) {
    const currency = expense.currency.trim().toUpperCase();
    currencies.set(currency, (currencies.get(currency) ?? 0) + expense.amount);
    const key = `${currency}\u0000${expense.category}`;
    categories.set(key, (categories.get(key) ?? 0) + expense.amount);
  }
  return {
    currencies: [...currencies].map(([currency, amount]) => ({ currency, amount })).sort((a, b) => a.currency.localeCompare(b.currency)),
    categories: [...categories].map(([key, amount]) => {
      const [currency, category] = key.split('\u0000');
      return { currency, category, amount };
    }).sort((a, b) => a.currency.localeCompare(b.currency) || a.category.localeCompare(b.category)),
  };
}

export function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(amount);
}
