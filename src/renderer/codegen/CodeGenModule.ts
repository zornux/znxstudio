import * as monaco from 'monaco-editor';
import { ServiceKeys, type EditorService } from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { LanguageServiceKeys } from '../language/api';
import type { DocumentManager } from '../language/DocumentManager';
import {
  GENERATORS,
  generatorsFor,
  parseList,
  pascalCase,
  type CodeGenerator,
} from './generators';

/**
 * Code Generation (Phase 7H). Each generator is a first-class palette command
 * ("Generate: Zornux Service", …). On invoke it prompts for the generator's
 * parameters and inserts the produced code at the cursor. The generator logic is
 * pure; this module only wires prompts + the Editor service insert.
 */
export class CodeGenModule implements IModule {
  readonly id = 'znxstudio.codegen';
  readonly displayName = 'Code Generation';

  private context!: ModuleContext;
  private editor!: EditorService;
  private documents!: DocumentManager;

  activate(context: ModuleContext): void {
    this.context = context;
    this.editor = context.services.get<EditorService>(ServiceKeys.Editor);
    this.documents = context.services.get<DocumentManager>(LanguageServiceKeys.Documents);

    for (const generator of GENERATORS) {
      context.commands.register(
        `znxstudio.codegen.${generator.id}`,
        () => this.run(generator),
        `Generate: ${generator.title}`,
      );
    }

    void selfTestCoordinator.run('codegen', () => this.maybeSelfTest());
  }

  private run(generator: CodeGenerator): void {
    const language = this.documents.getActive()?.languageId;
    if (!language || !generator.languages.includes(language)) {
      this.context.layout.showToast(
        `Open a ${generator.languages.join('/')} file to generate a ${generator.title}.`,
        'error',
      );
      return;
    }

    const values: Record<string, string> = {};
    for (const param of generator.params) {
      const answer = window.prompt(param.label, param.placeholder ?? '');
      if (answer === null) return; // cancelled
      if (param.required && !answer.trim()) {
        this.context.layout.showToast(`${param.label} is required.`, 'error');
        return;
      }
      values[param.name] = answer;
    }

    const code = generator.generate(values);
    this.editor.insertText(code);
    this.context.layout.showToast(`Generated ${generator.title}.`, 'success');
  }

  /* ----- optional headless self-test (ZNXSTUDIO_SELFTEST=1) ----- */
  private async maybeSelfTest(): Promise<void> {
    let enabled = false;
    try {
      enabled = (await window.znxstudio.app.getInfo()).selftest === true;
    } catch {
      enabled = false;
    }
    if (!enabled) return;
    const log = (message: string) => console.info(`[selftest] ${message}`);

    log(`codegen: generators=${GENERATORS.length} zornux=${generatorsFor('zornux').length} js=${generatorsFor('javascript').length}`);

    const record = GENERATORS.find((g) => g.id === 'zx-record')!;
    const recordCode = record.generate({ name: 'user profile', fields: 'name, email, age' });
    log(`codegen record: firstLine="${recordCode.split('\n')[0]}" hasFields=${recordCode.includes('has email')} pascal=${pascalCase('user profile')}`);

    const service = GENERATORS.find((g) => g.id === 'zx-service')!;
    const serviceCode = service.generate({ name: 'Greeter', routes: 'GET /greeting, POST /users', port: '9000' });
    log(`codegen service: routes=${(serviceCode.match(/on \w+ "/g) ?? []).length} publish="${serviceCode.split('\n').find((l) => l.startsWith('publish'))}"`);

    const config = GENERATORS.find((g) => g.id === 'zx-configuration')!;
    const configCode = config.generate({ name: 'AppConfig', fields: 'host:text, port:whole, debug:truth' });
    log(`codegen config: portLine="${configCode.split('\n').find((l) => l.includes('port'))?.trim()}"`);

    const component = GENERATORS.find((g) => g.id === 'zoijs-component')!;
    const componentCode = component.generate({ name: 'user card' });
    log(`codegen component: export=${componentCode.includes('export function UserCard()')} cls=${componentCode.includes('class="user-card"')}`);

    log(`codegen parseList: [${parseList('a, b ,, c').join('|')}]`);

    // Prove insertText lands generated code in a REAL Monaco editor at the cursor.
    let host: HTMLElement | undefined;
    let editor: monaco.editor.IStandaloneCodeEditor | undefined;
    let model: monaco.editor.ITextModel | undefined;
    try {
      host = document.createElement('div');
      host.style.cssText = 'position:absolute;left:-9999px;width:400px;height:200px';
      document.body.appendChild(host);
      model = monaco.editor.createModel('', 'zornux');
      editor = monaco.editor.create(host, { model });
      editor.setSelection(new monaco.Selection(1, 1, 1, 1));
      editor.executeEdits('codegen', [{ range: editor.getSelection()!, text: recordCode, forceMoveMarkers: true }]);
      log(`codegen insert: firstLine="${model.getValue().split('\n')[0]}" lines=${model.getLineCount()}`);
    } catch (error) {
      log(`codegen insert failed: ${(error as Error).message}`);
    } finally {
      editor?.dispose();
      model?.dispose();
      host?.remove();
    }
  }
}
