import { describe, expect, test } from './harness';
import {
  derivePascal,
  deriveCamel,
  deriveTitle,
  findItemDef,
  isDuplicate,
  NEW_ITEMS,
  newItemCommandId,
  resolveExtension,
  resolveFileName,
  templateContext,
  validateItemName,
} from '../src/renderer/explorer/newItem';
import { baseName, dirName, joinPath } from '../src/renderer/explorer/paths';

describe('newItem — catalog', () => {
  test('exposes the full required menu in order', () => {
    expect(NEW_ITEMS.map((i) => i.label)).toEqual([
      'Zornux File',
      'Zornux Class',
      'Zornux Contract',
      'Zornux Record',
      'Zornux Service',
      'Zornux Route',
      'Zornux Test',
      'Zoijs Component',
      'Zoijs Service',
      'Zoijs Store',
      'Zoijs Route',
      'JavaScript File',
      'TypeScript File',
      'JSON File',
      'Markdown File',
      'Folder',
    ]);
  });

  test('command id is namespaced per type', () => {
    expect(newItemCommandId('zornuxClass')).toBe('znxstudio.explorer.new.zornuxClass');
    expect(findItemDef('folder')?.category).toBe('folder');
  });
});

describe('newItem — extensions', () => {
  test('Zornux types use .zx; JSON/MD/JS/TS use their own; Zoijs follows the project script ext', () => {
    expect(resolveExtension(findItemDef('zornuxClass')!, '.js')).toBe('.zx');
    expect(resolveExtension(findItemDef('jsonFile')!, '.js')).toBe('.json');
    expect(resolveExtension(findItemDef('markdownFile')!, '.js')).toBe('.md');
    expect(resolveExtension(findItemDef('zoijsComponent')!, '.js')).toBe('.js');
    expect(resolveExtension(findItemDef('zoijsComponent')!, '.ts')).toBe('.ts');
    expect(resolveExtension(findItemDef('folder')!, '.js')).toBe('');
  });

  test('applies the extension, and does NOT duplicate one the user already typed', () => {
    expect(resolveFileName('User', '.zx')).toBe('User.zx');
    expect(resolveFileName('User.zx', '.zx')).toBe('User.zx'); // no double .zx
    expect(resolveFileName('User.ZX', '.zx')).toBe('User.ZX'); // case-insensitive match
    expect(resolveFileName('data', '.json')).toBe('data.json');
    expect(resolveFileName('  spaced  ', '.md')).toBe('spaced.md'); // trims
    expect(resolveFileName('assets', '')).toBe('assets'); // folder keeps its name
  });
});

describe('newItem — symbol derivation', () => {
  test('PascalCase / camelCase / Title from messy filenames', () => {
    expect(derivePascal('my-user.zx')).toBe('MyUser');
    expect(derivePascal('user_profile.zx')).toBe('UserProfile');
    expect(deriveCamel('user-store.js')).toBe('userStore');
    expect(deriveTitle('getting-started.md')).toBe('Getting Started');
  });

  test('names that start with a digit still yield a valid identifier', () => {
    expect(derivePascal('123.zx')).toBe('Item123');
    expect(/^[A-Za-z]/.test(derivePascal('9lives'))).toBe(true);
  });
});

describe('newItem — validation', () => {
  test('accepts ordinary names (letters, digits, hyphens, dots, underscores)', () => {
    expect(validateItemName('User')).toBe(null);
    expect(validateItemName('my-user.zx')).toBe(null);
    expect(validateItemName('user_profile')).toBe(null);
  });

  test('rejects empty, traversal, separators, invalid chars, reserved, trailing dot/space', () => {
    const rejected = (name: string): boolean => validateItemName(name) !== null;
    expect(rejected('   ')).toBe(true);
    expect(rejected('..')).toBe(true);
    expect(rejected('a/b')).toBe(true);
    expect(rejected('a\\b')).toBe(true);
    expect(rejected('../evil')).toBe(true);
    expect(rejected('a<b')).toBe(true);
    expect(rejected('a:b')).toBe(true);
    expect(rejected('a*b')).toBe(true);
    expect(rejected('CON')).toBe(true);
    expect(rejected('nul.zx')).toBe(true);
    expect(rejected('name.')).toBe(true);
  });

  test('trailing spaces are trimmed and accepted (not rejected)', () => {
    expect(validateItemName('name ')).toBe(null);
    expect(resolveFileName('name ', '.zx')).toBe('name.zx');
  });

  test('duplicate detection is case-insensitive', () => {
    expect(isDuplicate('App.zx', ['main.zx', 'app.zx'])).toBe(true);
    expect(isDuplicate('New.zx', ['main.zx'])).toBe(false);
  });
});

describe('newItem — templates use only verified syntax', () => {
  const render = (id: string, fileName: string): string => {
    const def = findItemDef(id)!;
    return def.template!(templateContext(fileName));
  };

  test('Zornux class/contract/record/service/route/test match the filename symbol and close with end', () => {
    const cls = render('zornuxClass', 'Account.zx');
    expect(cls.startsWith('class Account')).toBe(true);
    expect(cls.includes('has name')).toBe(true);
    expect(cls.includes('give back')).toBe(true);
    expect(cls.trimEnd().endsWith('end')).toBe(true);

    expect(render('zornuxContract', 'Printable.zx').startsWith('contract Printable')).toBe(true);
    expect(render('zornuxContract', 'Printable.zx').includes('requires function')).toBe(true);
    expect(render('zornuxRecord', 'Signup.zx').startsWith('record Signup')).toBe(true);
    expect(render('zornuxService', 'Users.zx').startsWith('service Users')).toBe(true);

    const route = render('zornuxRoute', 'Api.zx');
    expect(route.includes('on GET "/"')).toBe(true);
    expect(route.includes('publish Api on port')).toBe(true);

    const t = render('zornuxTest', 'math.zx');
    expect(t.startsWith('test "math works"')).toBe(true);
    expect(t.includes('expect 1 + 1 to equal 2')).toBe(true);
  });

  test('Zornux templates never use block comments (only # is valid)', () => {
    for (const def of NEW_ITEMS.filter((d) => d.category === 'zornux')) {
      const content = def.template!(templateContext(`Thing${def.ext}`));
      expect(content.includes('/*')).toBe(false);
      expect(content.includes('//')).toBe(false);
    }
  });

  test('Zoijs component/store/route/service use real @zoijs imports and createState', () => {
    const comp = render('zoijsComponent', 'Counter.js');
    expect(comp.includes('from "@zoijs/core"')).toBe(true);
    expect(comp.includes('export function Counter()')).toBe(true);
    expect(comp.includes('createState(0)')).toBe(true);
    expect(comp.includes('html`')).toBe(true);

    const store = render('zoijsStore', 'cart-store.js');
    expect(store.includes('export const cartStore = createState(0)')).toBe(true);
    expect(store.includes('computed(')).toBe(true);

    expect(render('zoijsRoute', 'routes.js').includes('createRouter(routes)')).toBe(true);
    expect(render('zoijsService', 'todos.js').includes('export function getTodos()')).toBe(true);
  });

  test('standard files: JSON is valid, Markdown has a title heading, TS is a module', () => {
    expect(JSON.parse(render('jsonFile', 'data.json'))).toEqual({});
    expect(render('markdownFile', 'read-me.md').startsWith('# Read Me')).toBe(true);
    expect(render('typescriptFile', 'util.ts').includes('export {};')).toBe(true);
  });
});

describe('paths helpers (OS-aware)', () => {
  test('baseName / dirName / joinPath preserve the separator style', () => {
    expect(baseName('C:\\a\\b\\file.zx')).toBe('file.zx');
    expect(dirName('C:\\a\\b\\file.zx')).toBe('C:\\a\\b');
    expect(joinPath('C:\\a\\b', 'x.zx')).toBe('C:\\a\\b\\x.zx');

    expect(baseName('/home/me/proj/a.zx')).toBe('a.zx');
    expect(dirName('/home/me/proj/a.zx')).toBe('/home/me/proj');
    expect(joinPath('/home/me/proj', 'a.zx')).toBe('/home/me/proj/a.zx');
    expect(joinPath('/home/me/proj/', 'a.zx')).toBe('/home/me/proj/a.zx'); // trailing slash
  });
});
