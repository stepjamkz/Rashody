const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(`${__dirname}/app.js`, 'utf8');

function setup(saved = []) {
  class Element {
    constructor() { this.children = []; this.value = ''; this.textContent = ''; this.listeners = {}; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute() {}
    addEventListener(name, callback) { this.listeners[name] = callback; }
    focus() {}
  }
  const nodes = {};
  const get = id => nodes[id] ||= new Element();
  const form = get('#expense-form');
  form.elements = { category: { value: 'Еда' }, comment: { value: '' } };
  form.reset = () => { get('#amount').value = ''; form.elements.comment.value = ''; };
  let stored = JSON.stringify(saved);
  let failSave = false;
  vm.runInNewContext(source, {
    document: { querySelector: get, createElement: () => new Element(), createDocumentFragment: () => new Element() },
    localStorage: { getItem: () => stored, setItem: (_, value) => { if (failSave) throw Error('Full'); stored = value; } },
    window: { addEventListener() {} }, Intl, Date,
  });
  return {
    get, read: () => JSON.parse(stored), failSave: () => { failSave = true; },
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
