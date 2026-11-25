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
  let storageReadable = true;
  let periodDays = 0;
  let editing = null;
  let deleting = null;
  let deleteOpener = null;
  const deleteDialog = document.querySelector('#delete-dialog');

  // Legacy records get distinct identities without changing their amounts or timestamps.
  // Identities are persisted with the next successful user change.
  function readExpenses() {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(saved) || !saved.every(validExpense)) throw new Error('Invalid saved data');
    const records = saved.map((item, index) => ({ ...item, id: item.id || `legacy:${index}:${JSON.stringify(item)}` }));
    if (records.some(item => typeof item.id !== 'string') || new Set(records.map(item => item.id)).size !== records.length) throw new Error('Invalid identities');
    return records;
  }

  function sameRecord(a, b) {
    return a && b && ['id', 'cents', 'category', 'date', 'comment', 'createdAt'].every(key => a[key] === b[key]);
  }

  function resetEditor() {
    editing = null;
    form.reset();
    dateInput.value = localDate();
    document.querySelector('#form-heading').textContent = 'Добавить трату';
    document.querySelector('#submit-expense').textContent = 'Добавить трату';
    document.querySelector('#cancel-edit').hidden = true;
    error.textContent = '';
  }

  function beginEdit(item) {
    if (editing) {
      error.textContent = 'Сначала сохраните текущие правки или нажмите «Отмена».';
      amountInput.focus();
      return;
    }
    editing = { ...item };
    amountInput.value = `${Math.floor(item.cents / 100)},${String(item.cents % 100).padStart(2, '0')}`;
    form.elements.category.value = item.category;
    dateInput.value = item.date;
    form.elements.comment.value = item.comment;
    document.querySelector('#form-heading').textContent = 'Изменить трату';
    document.querySelector('#submit-expense').textContent = 'Сохранить';
    document.querySelector('#cancel-edit').hidden = false;
    error.textContent = '';
    amountInput.focus();
  }

  function persist(updated, messageNode) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      expenses = updated;
      storageReadable = true;
      return true;
    } catch {
      messageNode.textContent = 'Не удалось сохранить трату. Проверьте доступность и свободное место в хранилище браузера.';
      return false;
    }
  }

  function latestRecords(snapshot, messageNode) {
    try {
      const latest = readExpenses();
      if (snapshot && !sameRecord(snapshot, latest.find(item => item.id === snapshot.id))) {
        expenses = latest;
        render();
        messageNode.textContent = 'Трата изменена или удалена в другой вкладке. Отмените действие и откройте актуальную запись заново.';
        return null;
      }
      return latest;
    } catch {
      messageNode.textContent = 'Не удалось прочитать сохранённые траты. Прежние данные не перезаписаны.';
      return null;
    }
  }

  function beginDelete(item, opener) {
    deleting = { ...item };
    deleteOpener = opener;
    document.querySelector('#delete-details').textContent = `${money.format(item.cents / 100)} ₸ · ${item.category} · ${dateFormatter.format(new Date(`${item.date}T12:00:00`))}`;
    document.querySelector('#delete-error').textContent = '';
    deleteDialog.showModal();
  }

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
    const today = localDate();
    const start = new Date(`${today}T12:00:00`);
    start.setDate(start.getDate() - Math.max(0, periodDays - 1));
    const startDate = localDate(start);
    const visible = periodDays ? expenses.filter(item => item.date >= startDate && item.date <= today) : expenses;
    document.querySelector('#expense-count').textContent = periodDays ? `${visible.length} из ${expenses.length}` : expenses.length;
    document.querySelector('#period-hint').textContent = periodDays
      ? `С ${startDate.split('-').reverse().join('.')} по ${today.split('-').reverse().join('.')}. Итог сверху — за текущий месяц.`
      : 'Все траты. Итог сверху — за текущий месяц.';
    const list = document.querySelector('#expense-list');
    list.replaceChildren();
    if (!visible.length) {
      const empty = element('div', 'empty-state');
      const icon = element('div', 'empty-icon', '↗');
      icon.setAttribute('aria-hidden', 'true');
      empty.append(icon, element('h3', '', expenses.length ? 'За этот период трат нет' : 'Здесь начнётся ваша история'), element('p', '', expenses.length ? 'Выберите другой период или всё время.' : 'Добавьте первую трату — она появится в этом списке.'));
      list.append(empty);
      return;
    }
    const fragment = document.createDocumentFragment();
    [...visible].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).forEach(item => {
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
      const actions = element('div', 'expense-actions');
      const editButton = element('button', 'secondary-button', 'Изменить');
      const deleteButton = element('button', 'secondary-button delete-button', 'Удалить');
      editButton.type = deleteButton.type = 'button';
      editButton.addEventListener('click', () => beginEdit(item));
      deleteButton.addEventListener('click', () => beginDelete(item, deleteButton));
      actions.append(editButton, deleteButton);
      row.append(actions);
      fragment.append(row);
    });
    list.append(fragment);
  }

  try {
    expenses = readExpenses();
  } catch {
    storageReadable = false;
    error.textContent = 'Не удалось прочитать сохранённые траты. Проверьте настройки хранилища браузера.';
  }
  dateInput.value = localDate();
  render();

  form.addEventListener('submit', event => {
    event.preventDefault();
    error.textContent = '';
    if (!storageReadable) {
      error.textContent = 'Не удалось прочитать сохранённые траты. Проверьте хранилище и обновите страницу: прежние данные не перезаписаны.';
      return;
    }
    const raw = amountInput.value.trim().replace(',', '.');
    const [whole, fraction = ''] = raw.split('.');
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
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
    const expense = { ...(editing || {}), cents, category: form.elements.category.value, date: dateInput.value, comment: form.elements.comment.value.trim(), createdAt: editing ? editing.createdAt : Date.now() };
    if (!validExpense(expense)) {
      error.textContent = 'Выберите категорию и укажите комментарий не длиннее 250 символов.';
      return;
    }
    const latest = latestRecords(editing, error);
    if (!latest) return;
    const wasEditing = Boolean(editing);
    if (!wasEditing) expense.id = globalThis.crypto?.randomUUID?.() || `new:${Date.now()}:${Math.random()}`;
    const updated = wasEditing ? latest.map(item => item.id === editing.id ? expense : item) : [expense, ...latest];
    if (!persist(updated, error)) return;
    resetEditor();
    render();
    document.querySelector('#status').textContent = wasEditing ? 'Трата изменена' : `Трата добавлена: ${money.format(cents / 100)} ₸, ${expense.category}.`;
    amountInput.focus();
  });

  document.querySelector('#cancel-edit').addEventListener('click', () => { resetEditor(); amountInput.focus(); });
  document.querySelector('#cancel-delete').addEventListener('click', () => deleteDialog.close());
  deleteDialog.addEventListener('close', () => {
    deleting = null;
    if (deleteOpener?.isConnected) deleteOpener.focus();
    else document.querySelector('#expenses-heading').focus();
    deleteOpener = null;
  });
  document.querySelector('#confirm-delete').addEventListener('click', () => {
    if (!deleting) return;
    const messageNode = document.querySelector('#delete-error');
    messageNode.textContent = '';
    const latest = latestRecords(deleting, messageNode);
    if (!latest || !persist(latest.filter(item => item.id !== deleting.id), messageNode)) return;
    if (editing?.id === deleting.id) resetEditor();
    render();
    document.querySelector('#status').textContent = 'Трата удалена';
    deleteDialog.close();
  });

  document.querySelector('#period-buttons').addEventListener('click', event => {
    const button = event.target.closest('button[data-days]');
    if (!button || !event.currentTarget.contains(button)) return;
    const days = Number(button.dataset.days);
    if (![0, 1, 7, 14, 30].includes(days)) return;
    periodDays = days;
    for (const item of event.currentTarget.querySelectorAll('button')) {
      item.setAttribute('aria-pressed', String(item === button));
    }
    render();
  });

  window.addEventListener('storage', event => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    try {
      const updated = readExpenses();
      expenses = updated;
      storageReadable = true;
      render();
      if (editing && !sameRecord(editing, updated.find(item => item.id === editing.id))) {
        error.textContent = 'Трата изменена или удалена в другой вкладке. Нажмите «Отмена» и откройте актуальную запись заново.';
      }
    } catch { /* Keep the last valid state if another tab writes invalid data. */ }
  });
  window.addEventListener('focus', render);
})();
