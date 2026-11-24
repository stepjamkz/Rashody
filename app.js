(() => {
  'use strict';

  const STORAGE_KEY = 'rashody.expenses.v1';
  const categories = { 'Еда': ['♧', 'food'], 'Транспорт': ['↗', 'transport'], 'Дом': ['⌂', 'home'], 'Другое': ['◇', 'other'] };
  const form = document.querySelector('#expense-form');
  const amountInput = document.querySelector('#amount');
  const dateInput = document.querySelector('#date');
  const error = document.querySelector('#form-error');
  const money = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
  const dateFormatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
  let expenses = [];

  function localDate(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T12:00:00`);
    return Number.isFinite(parsed.getTime()) && localDate(parsed) === value;
  }

  function validExpense(item) {
    return item && Number.isSafeInteger(item.cents) && item.cents > 0 &&
      Object.hasOwn(categories, item.category) && validDate(item.date) &&
      typeof item.comment === 'string' && item.comment.length <= 250 && Number.isFinite(item.createdAt);
  }

  function element(tag, className, value) {
    const node = document.createElement(tag);
    node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  }

  function render() {
    const currentMonth = localDate().slice(0, 7);
    const monthly = expenses.filter(item => item.date.startsWith(currentMonth));
    const total = monthly.reduce((sum, item) => sum + BigInt(item.cents), 0n);
    const totalWhole = new Intl.NumberFormat('ru-RU').format(total / 100n);
    const fraction = Number(total % 100n);
    document.querySelector('#month-total').textContent = `${totalWhole}${fraction ? ',' + String(fraction).padStart(2, '0') : ''} ₸`;
    document.querySelector('#current-month').textContent = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(new Date());
    document.querySelector('#month-count').textContent = monthly.length ? `Записей за месяц: ${monthly.length}` : 'Пока без трат';
    document.querySelector('#expense-count').textContent = expenses.length;
    const list = document.querySelector('#expense-list');
    list.replaceChildren();
    if (!expenses.length) {
      const empty = element('div', 'empty-state');
      const icon = element('div', 'empty-icon', '↗');
      icon.setAttribute('aria-hidden', 'true');
      empty.append(icon, element('h3', '', 'Здесь начнётся ваша история'), element('p', '', 'Добавьте первую трату — она появится в этом списке.'));
      list.append(empty);
      return;
    }
    const fragment = document.createDocumentFragment();
    [...expenses].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).forEach(item => {
      const row = element('article', 'expense-row');
      const [symbol, color] = categories[item.category];
      const icon = element('span', `category-icon ${color}`, symbol);
      icon.setAttribute('aria-hidden', 'true');
      const info = element('div', 'expense-info');
      info.append(element('div', 'expense-category', item.category));
      if (item.comment) info.append(element('div', 'expense-comment', item.comment));
      const meta = element('div', 'expense-meta');
      const date = element('time', 'expense-date', dateFormatter.format(new Date(`${item.date}T12:00:00`)));
      date.dateTime = item.date;
      meta.append(element('div', 'expense-amount', `${money.format(item.cents / 100)} ₸`), date);
      row.append(icon, info, meta);
      fragment.append(row);
    });
    list.append(fragment);
  }

  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(saved) || !saved.every(validExpense)) throw new Error('Invalid saved data');
    expenses = saved;
  } catch {
    error.textContent = 'Не удалось прочитать сохранённые траты. Проверьте настройки хранилища браузера.';
  }
  dateInput.value = localDate();
  render();

  form.addEventListener('submit', event => {
    event.preventDefault();
    error.textContent = '';
    const raw = amountInput.value.trim().replace(',', '.');
    const cents = Math.round(Number(raw) * 100);
    if (!/^\d+(\.\d{1,2})?$/.test(raw) || !Number.isSafeInteger(cents) || cents <= 0 || cents > 999999999999) {
      error.textContent = 'Введите сумму от 0,01 до 9 999 999 999,99, не более двух знаков после запятой.';
      amountInput.focus();
      return;
    }
    if (!validDate(dateInput.value)) {
      error.textContent = 'Укажите корректную дату.';
      dateInput.focus();
      return;
    }
    const expense = { cents, category: form.elements.category.value, date: dateInput.value, comment: form.elements.comment.value.trim(), createdAt: Date.now() };
    if (!validExpense(expense)) return;
    const updated = [expense, ...expenses];
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {
      error.textContent = 'Не удалось сохранить трату. Проверьте доступность и свободное место в хранилище браузера.';
      return;
    }
    expenses = updated;
    form.reset();
    dateInput.value = localDate();
    render();
    document.querySelector('#status').textContent = `Трата добавлена: ${money.format(cents / 100)} ₸, ${expense.category}.`;
    amountInput.focus();
  });

  window.addEventListener('storage', event => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    try {
      const updated = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      if (Array.isArray(updated) && updated.every(validExpense)) { expenses = updated; render(); }
    } catch { /* Keep the last valid state if another tab writes invalid data. */ }
  });
  window.addEventListener('focus', render);
})();
