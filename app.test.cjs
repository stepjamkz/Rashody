const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(`${__dirname}/app.js`, 'utf8');

function setup(saved = [], clock = Date) {
  class Element {
    constructor() { this.children = []; this.value = ''; this.textContent = ''; this.listeners = {}; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute() {}
    addEventListener(name, callback) { this.listeners[name] = callback; }
    focus() {}
    showModal() { this.open = true; }
    close() { this.open = false; this.listeners.close?.(); }
  }
  const nodes = {};
  const get = id => nodes[id] ||= new Element();
  const form = get('#expense-form');
  form.elements = { category: { value: 'Еда' }, comment: { value: '' } };
  form.reset = () => { get('#amount').value = ''; form.elements.comment.value = ''; form.elements.category.value = 'Еда'; };
  let stored = JSON.stringify(saved);
  let failSave = false;
  const windowListeners = {};
  vm.runInNewContext(source, {
    document: { querySelector: get, createElement: () => new Element(), createDocumentFragment: () => new Element() },
    localStorage: { getItem: () => stored, setItem: (_, value) => { if (failSave) throw Error('Full'); stored = value; } },
    window: { addEventListener(name, callback) { windowListeners[name] = callback; } }, Intl, Date: clock,
  });
  return {
    get, read: () => JSON.parse(stored), failSave: () => { failSave = true; },
    storageEvent(saved, key = 'rashody.expenses.v1') { stored = JSON.stringify(saved); windowListeners.storage({ key }); },
    focus() { windowListeners.focus(); },
    rows() { return get('#expense-list').children[0].children; },
    edit(index = 0) { this.rows()[index].children[3].children[0].listeners.click(); },
    remove(index = 0) { this.rows()[index].children[3].children[1].listeners.click(); },
    click(id) { get(id).listeners.click(); },
    external(saved) { stored = JSON.stringify(saved); },
    period(days) {
      const buttons = [0, 1, 7, 14, 30].map(value => ({ dataset: { days: String(value) }, setAttribute() {} }));
      const selected = buttons.find(button => Number(button.dataset.days) === days);
      get('#period-buttons').listeners.click({ target: { closest: () => selected }, currentTarget: { contains: () => true, querySelectorAll: () => buttons } });
    },
    submit(amount, date = get('#date').value, category = 'Еда', comment = '') {
      get('#amount').value = amount;
      get('#date').value = date;
      form.elements.category.value = category;
      form.elements.comment.value = comment;
      form.listeners.submit({ preventDefault() {} });
    },
  };
}

test('adds decimal amounts, persists comments as text, and totals the current month', () => {
  const app = setup();
  app.submit('10,25', undefined, 'Еда', '<img src=x onerror=alert(1)>');
  app.submit('0.10');
  assert.equal(app.read().length, 2);
  assert.equal(app.read()[1].cents, 1025);
  assert.equal(app.read()[1].comment, '<img src=x onerror=alert(1)>');
  assert.equal(app.get('#month-total').textContent, '10,35 ₸');
  assert.equal(setup(app.read()).get('#month-total').textContent, '10,35 ₸');
});

test('excludes other months and sorts expenses by date with newest first', () => {
  const app = setup();
  app.submit('100', '2020-01-01');
  app.submit('200', '2021-01-01');
  assert.equal(app.get('#month-total').textContent, '0 ₸');
  const rows = app.get('#expense-list').children[0].children;
  assert.equal(rows[0].children[2].children[1].dateTime, '2021-01-01');
  assert.equal(rows[1].children[2].children[1].dateTime, '2020-01-01');
});

test('rejects invalid amounts and dates without saving', () => {
  const app = setup();
  for (const amount of ['0', '-1', '1.234', 'NaN', '1e3', '10000000000']) app.submit(amount);
  app.submit('10', '2026-02-30');
  assert.equal(app.read().length, 0);
  assert.ok(app.get('#form-error').textContent);
});

test('keeps the form and list intact when saving fails', () => {
  const app = setup();
  app.failSave();
  app.submit('25');
  assert.equal(app.read().length, 0);
  assert.equal(app.get('#amount').value, '25');
  assert.match(app.get('#form-error').textContent, /Не удалось сохранить/);
});

test('matches specification examples and excludes the same month of a different year', () => {
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-11-24T12:00:00'])); }
    static now() { return new Clock().getTime(); }
  }
  const app = setup([], Clock);
  app.submit('1250,50', '2026-11-24', 'Еда', 'Продукты');
  app.submit('300', '2026-11-23', 'Транспорт');
  app.submit('500', '2026-10-31', 'Дом');
  app.submit('900', '2025-11-24');
  assert.equal(app.get('#month-total').textContent.replace(/\s/g, ' '), '1 550,50 ₸');
  assert.equal(app.get('#month-count').textContent, 'Записей за месяц: 2');
  assert.equal(app.get('#expense-count').textContent, 4);
  app.submit('12.30'); app.submit('12,30');
  assert.equal(app.get('#month-total').textContent.replace(/\s/g, ' '), '1 575,10 ₸');
  assert.equal(app.get('#date').value, '2026-11-24');
});

test('matches AGENTS whole-tenge example and restores records', () => {
  const app = setup();
  for (const sum of ['5000', '2500', '12000']) app.submit(sum);
  assert.equal(app.get('#month-total').textContent.replace(/\s/g, ' '), '19 500 ₸');
  const restored = setup(app.read());
  assert.equal(restored.get('#month-total').textContent, app.get('#month-total').textContent);
  assert.equal(restored.get('#expense-count').textContent, 3);
});

test('sorts identical dates by creation time and renders comments literally', () => {
  const saved = [
    { cents: 100, category: 'Еда', date: '2026-11-24', comment: 'Раньше', createdAt: 1 },
    { cents: 200, category: 'Дом', date: '2026-11-24', comment: '<b>кофе</b>', createdAt: 2 },
  ];
  const app = setup(saved);
  const rows = app.get('#expense-list').children[0].children;
  assert.equal(rows[0].children[1].children[1].textContent, '<b>кофе</b>');
  assert.equal(rows[1].children[1].children[1].textContent, 'Раньше');
});

test('updates records from another tab and ignores invalid external data', () => {
  const app = setup();
  app.submit('10');
  const saved = app.read();
  app.storageEvent([...saved, { ...saved[0], id: 'other-tab-record', cents: 2000 }]);
  assert.equal(app.get('#month-total').textContent, '30 ₸');
  app.storageEvent([{ cents: -1 }]);
  assert.equal(app.get('#month-total').textContent, '30 ₸');
  app.storageEvent([], null);
  assert.equal(app.get('#month-total').textContent, '0 ₸');
});

test('rejects invalid category, oversized comment and blank amount with feedback', () => {
  const app = setup();
  app.submit('10', undefined, 'Нет');
  assert.ok(app.get('#form-error').textContent);
  app.submit('10', undefined, 'Еда', 'x'.repeat(251));
  assert.ok(app.get('#form-error').textContent);
  app.submit('');
  assert.ok(app.get('#form-error').textContent);
  assert.equal(app.read().length, 0);
});

test('preserves unreadable saved records instead of overwriting them', () => {
  const app = setup([{ legacy: true }]);
  app.submit('10');
  assert.deepEqual(app.read(), [{ legacy: true }]);
  assert.match(app.get('#form-error').textContent, /не перезаписаны/);
});

test('filters inclusive calendar periods and excludes future dates without changing monthly totals', () => {
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-11-24T12:00:00'])); }
  }
  const dates = ['2026-11-25', '2026-11-24', '2026-11-23', '2026-11-18', '2026-11-17', '2026-11-11', '2026-11-10', '2026-10-26', '2026-10-25'];
  const saved = dates.map((date, index) => ({ cents: 100, category: 'Еда', date, comment: '', createdAt: index }));
  const app = setup(saved, Clock);
  const total = app.get('#month-total').textContent;
  const date = app.get('#date').value;
  for (const [days, count] of [[1, 1], [7, 3], [14, 5], [30, 7]]) {
    app.period(days);
    assert.equal(app.get('#expense-count').textContent, `${count} из 9`);
    assert.equal(app.get('#expense-list').children[0].children.length, count);
    assert.equal(app.get('#month-total').textContent, total);
    assert.equal(app.get('#date').value, date);
  }
  app.period(0);
  assert.equal(app.get('#expense-count').textContent, 9);
  assert.equal(app.get('#expense-list').children[0].children.length, 9);
});

test('recalculates the current month when the page regains focus', () => {
  let today = '2026-11-30T12:00:00';
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [today])); }
  }
  const app = setup([{ cents: 1000, category: 'Еда', date: '2026-11-30', comment: '', createdAt: 1 }], Clock);
  assert.equal(app.get('#month-total').textContent, '10 ₸');
  today = '2026-12-01T12:00:00';
  app.focus();
  assert.equal(app.get('#month-total').textContent, '0 ₸');
});

test('edits and deletes with totals 19500, 20000, 15000 and restores the result', () => {
  const app = setup();
  for (const amount of ['5000', '2500', '12000']) app.submit(amount);
  const target = app.read().find(item => item.cents === 250000);
  const index = app.rows().findIndex(row => row.children[2].children[0].textContent.replace(/\s/g, '') === '2500₸');
  app.edit(index);
  assert.equal(app.get('#form-heading').textContent, 'Изменить трату');
  assert.equal(app.get('#cancel-edit').hidden, false);
  app.submit('3000', target.date, 'Дом', 'Исправлено');
  assert.equal(app.read().length, 3);
  assert.equal(app.read().find(item => item.id === target.id).createdAt, target.createdAt);
  assert.equal(app.get('#month-total').textContent.replace(/\s/g, ' '), '20 000 ₸');
  assert.equal(app.get('#status').textContent, 'Трата изменена');
  const removeIndex = app.rows().findIndex(row => row.children[2].children[0].textContent.replace(/\s/g, '') === '5000₸');
  app.remove(removeIndex);
  assert.equal(app.get('#delete-dialog').open, true);
  assert.equal(app.read().length, 3);
  assert.match(app.get('#delete-details').textContent.replace(/\s/g, ''), /5000₸/);
  app.click('#confirm-delete');
  assert.equal(app.get('#delete-dialog').open, false);
  assert.equal(app.get('#status').textContent, 'Трата удалена');
  const restored = setup(app.read());
  assert.equal(restored.read().length, 2);
  assert.equal(restored.get('#month-total').textContent.replace(/\s/g, ' '), '15 000 ₸');
});

test('cancel editing, cancel deletion and closing the dialog preserve saved data', () => {
  const app = setup(); app.submit('10'); app.submit('20');
  const saved = app.read();
  app.edit(); app.get('#amount').value = '999';
  app.edit(1);
  assert.equal(app.get('#amount').value, '999');
  assert.match(app.get('#form-error').textContent, /Сначала сохраните/);
  app.click('#cancel-edit');
  assert.deepEqual(app.read(), saved);
  assert.equal(app.get('#cancel-edit').hidden, true);
  app.remove(); app.click('#cancel-delete');
  assert.deepEqual(app.read(), saved);
  app.remove(); app.get('#delete-dialog').close();
  assert.deepEqual(app.read(), saved);
});

test('identical legacy records remain independently editable and deletable', () => {
  const item = { cents: 1230, category: 'Еда', date: '2026-11-25', comment: '', createdAt: 1 };
  const app = setup([item, { ...item }]);
  app.edit(0); app.submit('15', item.date);
  assert.equal(app.read().length, 2);
  assert.equal(app.read()[0].cents, 1500);
  assert.equal(app.read()[1].cents, 1230);
  assert.notEqual(app.read()[0].id, app.read()[1].id);
  app.remove(1); app.click('#confirm-delete');
  assert.equal(app.read().length, 1);
  assert.equal(app.read()[0].cents, 1500);
});

test('invalid edit and storage failures preserve original records and entered values', () => {
  const app = setup(); app.submit('100');
  const saved = app.read(); app.edit();
  for (const amount of ['', '0', '-10', 'text']) app.submit(amount);
  app.submit('10', '');
  assert.deepEqual(app.read(), saved);
  app.failSave(); app.submit('200', saved[0].date, 'Дом', 'Правки');
  assert.deepEqual(app.read(), saved);
  assert.equal(app.get('#amount').value, '200');
  assert.equal(app.get('#expense-form').elements.comment.value, 'Правки');
  assert.equal(app.get('#month-total').textContent, '100 ₸');
  app.remove(); app.click('#confirm-delete');
  assert.deepEqual(app.read(), saved);
  assert.equal(app.get('#delete-dialog').open, true);
  assert.match(app.get('#delete-error').textContent, /Не удалось сохранить/);
});

test('date edits reapply filters and deletion shows empty states', () => {
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : ['2026-11-25T12:00:00'])); } }
  const app = setup([], Clock); app.submit('5000'); app.period(7);
  app.edit(); app.submit('5000', '2026-10-31');
  assert.equal(app.get('#expense-count').textContent, '0 из 1');
  assert.equal(app.get('#month-total').textContent, '0 ₸');
  assert.equal(app.get('#expense-list').children[0].children[1].textContent, 'За этот период трат нет');
  app.period(0); app.edit(); app.remove(); app.click('#confirm-delete');
  assert.equal(app.read().length, 0);
  assert.equal(app.get('#form-heading').textContent, 'Добавить трату');
  assert.equal(app.get('#expense-list').children[0].children[1].textContent, 'Здесь начнётся ваша история');
});

test('external changes and removals cannot be overwritten by stale edits or deletion', () => {
  for (const remove of [false, true]) {
    const app = setup(); app.submit('10'); app.edit();
    const latest = remove ? [] : [{ ...app.read()[0], cents: 2000 }];
    app.storageEvent(latest);
    assert.match(app.get('#form-error').textContent, /другой вкладке/);
    app.submit('99');
    assert.deepEqual(app.read(), latest);
  }
  const app = setup(); app.submit('10'); app.remove();
  const latest = [{ ...app.read()[0], comment: 'Из другой вкладки' }];
  app.external(latest); app.click('#confirm-delete');
  assert.deepEqual(app.read(), latest);
  assert.match(app.get('#delete-error').textContent, /другой вкладке/);
});

test('saving an edit preserves unrelated records added by another tab', () => {
  const app = setup(); app.submit('10'); app.edit();
  const saved = app.read();
  app.external([...saved, { ...saved[0], id: 'external', cents: 3000 }]);
  app.submit('20');
  assert.equal(app.read().length, 2);
  assert.equal(app.get('#month-total').textContent, '50 ₸');
});
