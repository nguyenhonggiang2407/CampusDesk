import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url),
  { transformSync } = require('esbuild');
type Node = { type: any; props: any };
const nodes = (value: any): Node[] =>
  Array.isArray(value)
    ? value.flatMap(nodes)
    : value && typeof value === 'object' && 'props' in value
      ? [value, ...nodes(value.props.children)]
      : [];
const text = (value: any): string =>
  Array.isArray(value)
    ? value.map(text).join('')
    : value && typeof value === 'object'
      ? text(value.props?.children)
      : typeof value === 'string'
        ? value
        : '';

// Actual RequestDetail handlers and rendered props, with hook/effect adapters.
// The modal/browser layout and real transport belong to separate browser/API QA.
function fixture() {
  const initial: any = {
    id: 'fictional-ticket',
    reference: 'CD-1001',
    title: 'Fictional library Wi-Fi',
    description: 'A fictional network request for the test.',
    category: 'it',
    status: 'new',
    priority: 'normal',
    assignedTo: null,
    assignedName: null,
    studentName: 'Fictional Student',
    dueDate: '2030-04-19',
    createdAt: '2030-04-01T10:00:00Z',
    version: 1,
    comments: [],
    events: [],
  };
  const slots: any[] = [];
  let cursor = 0,
    dirty = false,
    tree: Node,
    effects: (() => void)[] = [],
    component: any;
  const jsx = (type: any, props: any) => ({ type, props: props || {} });
  const hooks = {
    useState(initial: any) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [
        slots[index],
        (value: any) => {
          const next = typeof value === 'function' ? value(slots[index]) : value;
          if (!Object.is(next, slots[index])) {
            slots[index] = next;
            dirty = true;
          }
        },
      ];
    },
    useEffect(effect: () => void, deps: any[]) {
      const index = cursor++,
        previous = slots[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous[i]))) {
        slots[index] = deps;
        effects.push(effect);
      }
    },
    useRef(initial: any) {
      const index = cursor++;
      return (slots[index] ||= { current: initial });
    },
  };
  const calls: { path: string; options: any }[] = [];
  let pending: { resolve: (ticket: any) => void; reject: (error: Error) => void };
  const api = (path: string, options: any) => {
    calls.push({ path, options });
    return new Promise((resolve, reject) => {
      pending = { resolve, reject };
    });
  };
  const compile = (source: string) =>
    transformSync(source, { loader: 'tsx', format: 'cjs', jsx: 'automatic', target: 'es2022' })
      .code;
  const shared = { exports: {} };
  runInNewContext(
    compile(readFileSync(new URL('../shared/types.ts', import.meta.url), 'utf8')),
    { module: shared, exports: shared.exports },
    { timeout: 1000 },
  );
  const module: any = { exports: {} };
  runInNewContext(
    compile(readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')) +
      '\nmodule.exports.TestDetail = RequestDetail;',
    {
      module,
      exports: module.exports,
      Error,
      require(id: string) {
        if (id === 'react') return hooks;
        if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: Symbol('fragment') };
        if (id === './KnowledgeBase') return { KnowledgeBase() {}, RelatedGuides() {} };
        if (id === './api') return { api, RequestError: Error, setCsrf() {} };
        if (id === '../shared/types') return shared.exports;
        if (id === 'lucide-react') return new Proxy({}, { get: () => () => null });
        throw Error('Unexpected module: ' + id);
      },
    },
    { timeout: 1000 },
  );
  component = module.exports.TestDetail;
  const props = {
    ticketId: initial.id,
    initial,
    user: { id: 9, role: 'staff', name: 'Fictional Staff' },
    staff: [{ id: 9, name: 'Fictional Staff' }],
    onClose() {},
    onUpdated() {},
  };
  function render() {
    for (let attempt = 0; attempt < 5; attempt++) {
      dirty = false;
      cursor = 0;
      tree = component(props);
      const queued = effects;
      effects = [];
      queued.forEach((effect) => effect());
      if (!dirty) return tree;
    }
    throw Error('Unexpected render loop');
  }
  const button = (label: string) =>
    nodes(tree).find((node) => node.type === 'button' && text(node.props.children) === label)!;
  const reply = () =>
    nodes(tree).find((node) => node.type === 'textarea' && node.props.id === 'reply')!;
  const metadata = (label: string) => {
    const parent = nodes(tree).find(
      (node) =>
        node.type === 'label' &&
        (Array.isArray(node.props.children) ? node.props.children[0] : '') === label,
    )!;
    return nodes(parent).find((node) => ['input', 'select'].includes(node.type))!;
  };
  const input = (node: Node, value: string) => {
    if (!node.props.disabled) {
      node.props.onChange({ target: { value } });
      render();
    }
  };
  const click = (node: Node) => {
    if (!node.props.disabled) {
      const promise = node.props.onClick();
      render();
      return promise;
    }
  };
  render();
  return {
    calls,
    initial,
    button,
    reply,
    metadata,
    input,
    click,
    render,
    pending: () => pending,
    submit: () =>
      nodes(tree)
        .find((node) => node.type === 'form' && node.props.onSubmit.name === 'send')!
        .props.onSubmit({ preventDefault() {} }),
    busy: () =>
      nodes(tree).find((node) => node.type === 'form' && node.props.onSubmit.name === 'send')!
        .props['aria-busy'],
    allControls: () => [
      reply(),
      button('Public reply'),
      button('Internal note'),
      ...['Status', 'Assigned to', 'Priority', 'Target date'].map(metadata),
    ],
    error: () => nodes(tree).find((node) => node.props.role === 'alert'),
  };
}

test('pending replies keep their original audience/text and retain a failed draft for corrected retry', async () => {
  const f = fixture();
  f.input(f.reply(), 'Fictional private reminder.');
  f.click(f.button('Internal note'));
  const failed = f.submit();
  f.render();
  assert.ok(f.allControls().every((node) => node.props.disabled));
  assert.equal(f.busy(), true);
  f.input(f.reply(), 'Late text absent from the submitted snapshot');
  f.click(f.button('Public reply'));
  assert.equal(f.reply().props.value, 'Fictional private reminder.');
  assert.equal(f.button('Internal note').props['aria-pressed'], true);
  await f.submit();
  assert.equal(f.calls.length, 1);
  assert.deepEqual(JSON.parse(f.calls[0].options.body), {
    body: 'Fictional private reminder.',
    visibility: 'private',
  });
  f.pending().reject(Error('Fictional offline failure'));
  await failed;
  f.render();
  assert.ok(f.allControls().every((node) => !node.props.disabled));
  assert.equal(f.busy(), false);
  assert.equal(f.reply().props.value, 'Fictional private reminder.');
  assert.equal(f.button('Internal note').props['aria-pressed'], true);
  assert.ok(text(f.error()).includes('Fictional offline failure'));
  f.input(f.reply(), 'Corrected fictional private reminder.');
  const saved = f.submit();
  f.render();
  const data = JSON.parse(f.calls[1].options.body);
  assert.equal(data.body, 'Corrected fictional private reminder.');
  assert.equal(data.visibility, 'private');
  f.pending().resolve({
    ...f.initial,
    version: 2,
    comments: [
      {
        id: 1,
        body: data.body,
        visibility: data.visibility,
        authorName: 'Fictional Staff',
        createdAt: '2030-04-01T11:00:00Z',
      },
    ],
  });
  await saved;
  f.render();
  assert.equal(f.reply().props.value, '');
  assert.ok(f.allControls().every((node) => !node.props.disabled));
  assert.equal(f.calls.length, 2);
});

test('pending detail updates lock metadata and retain unsuccessful choices before retry', async () => {
  const f = fixture();
  f.input(f.metadata('Priority'), 'high');
  f.input(f.metadata('Assigned to'), '9');
  f.input(f.metadata('Target date'), '2030-04-22');
  const failed = f.click(f.button('Save changes'));
  assert.ok(f.allControls().every((node) => node.props.disabled));
  f.input(f.metadata('Priority'), 'urgent');
  assert.equal(f.metadata('Priority').props.value, 'high');
  assert.equal(f.calls[0].options.method, 'PATCH');
  assert.deepEqual(JSON.parse(f.calls[0].options.body), {
    version: 1,
    status: 'new',
    priority: 'high',
    assignedTo: 9,
    dueDate: '2030-04-22',
  });
  f.pending().reject(Error('Fictional save failure'));
  await failed;
  f.render();
  assert.ok(f.allControls().every((node) => !node.props.disabled));
  assert.equal(f.metadata('Priority').props.value, 'high');
  assert.equal(f.metadata('Target date').props.value, '2030-04-22');
  const saved = f.click(f.button('Save changes')),
    data = JSON.parse(f.calls[1].options.body);
  f.pending().resolve({ ...f.initial, ...data, assignedName: 'Fictional Staff', version: 2 });
  await saved;
  f.render();
  assert.equal(f.metadata('Priority').props.value, 'high');
  assert.equal(
    f.button('Save changes').props.disabled,
    true,
    'successful choices now match the ticket',
  );
  assert.equal(f.calls.length, 2);
});
