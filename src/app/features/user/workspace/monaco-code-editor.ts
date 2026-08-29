import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  effect,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import * as monaco from 'monaco-editor';

export interface EditorCursorPosition {
  line: number;
  column: number;
}

interface MonacoWorkerGlobal {
  MonacoEnvironment?: {
    getWorker(moduleId: string, label: string): Worker;
  };
}

let editorLanguageFeaturesConfigured = false;

@Component({
  selector: 'app-monaco-code-editor',
  template: `
    <div #editorHost class="monaco-host"></div>
    @if (!ready()) {
      <div class="editor-loading" role="status">
        <span aria-hidden="true"></span>
        <p>{{ loadError() || 'Loading editor…' }}</p>
      </div>
    }
  `,
  styleUrl: './monaco-code-editor.css',
  host: {
    '[class.editor-ready]': 'ready()',
  },
})
export class MonacoCodeEditor implements AfterViewInit, OnDestroy {
  readonly filePath = input.required<string>();
  readonly value = input.required<string>();
  readonly language = input.required<string>();
  readonly ariaLabel = input('Source code editor');

  readonly valueChange = output<string>();
  readonly cursorChange = output<EditorCursorPosition>();
  readonly saveRequested = output<void>();

  private readonly editorHost = viewChild.required<ElementRef<HTMLElement>>('editorHost');
  private readonly models = new Map<string, monaco.editor.ITextModel>();
  private readonly viewStates = new Map<string, monaco.editor.ICodeEditorViewState | null>();
  private readonly disposables: monaco.IDisposable[] = [];
  private editor: monaco.editor.IStandaloneCodeEditor | null = null;
  private activePath = '';
  private syncingModel = false;

  protected readonly ready = signal(false);
  protected readonly loadError = signal('');

  private readonly syncActiveFile = effect(() => {
    const ready = this.ready();
    const path = this.filePath();
    const value = this.value();
    const language = this.language();
    if (!ready) return;

    this.activateFile(path, value, language);
  });

  ngAfterViewInit(): void {
    try {
      this.configureWorker();
      this.configureLanguageFeatures();
      this.createEditor();
      this.ready.set(true);
    } catch (error: unknown) {
      this.loadError.set(error instanceof Error ? error.message : 'Editor could not be loaded');
    }
  }

  ngOnDestroy(): void {
    this.disposables.forEach((disposable) => disposable.dispose());
    this.editor?.dispose();
    this.models.forEach((model) => model.dispose());
    this.models.clear();
  }

  private createEditor(): void {
    monaco.editor.defineTheme('iot-hub-light', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '008000', fontStyle: 'italic' },
        { token: 'keyword', foreground: '0000FF' },
        { token: 'type', foreground: '267F99' },
        { token: 'string', foreground: 'A31515' },
        { token: 'number', foreground: '098658' },
      ],
      colors: {
        'editor.background': '#FFFFFF',
        'editor.foreground': '#263142',
        'editor.lineHighlightBackground': '#F7F8FF',
        'editor.lineHighlightBorder': '#00000000',
        'editorLineNumber.foreground': '#A0AABA',
        'editorLineNumber.activeForeground': '#4F46E5',
        'editorCursor.foreground': '#4F46E5',
        'editor.selectionBackground': '#635BFF33',
        'editor.inactiveSelectionBackground': '#635BFF1F',
        'editorIndentGuide.background1': '#E8ECF2',
        'editorIndentGuide.activeBackground1': '#C5BFEE',
        'editorBracketMatch.background': '#635BFF1A',
        'editorBracketMatch.border': '#635BFF66',
        'minimap.background': '#FBFCFE',
        'scrollbarSlider.background': '#B9C1CD55',
        'scrollbarSlider.hoverBackground': '#8B96A688',
      },
    });

    this.editor = monaco.editor.create(this.editorHost().nativeElement, {
      model: null,
      theme: 'iot-hub-light',
      ariaLabel: this.ariaLabel(),
      automaticLayout: true,
      fontFamily: "'Cascadia Code', 'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
      fontLigatures: false,
      fontSize: 12,
      lineHeight: 20,
      padding: { top: 14, bottom: 28 },
      lineNumbersMinChars: 3,
      glyphMargin: false,
      folding: true,
      foldingHighlight: true,
      showFoldingControls: 'mouseover',
      minimap: {
        enabled: true,
        renderCharacters: false,
        showSlider: 'mouseover',
        size: 'proportional',
        maxColumn: 80,
      },
      bracketPairColorization: { enabled: true },
      guides: {
        bracketPairs: true,
        indentation: true,
        highlightActiveIndentation: true,
      },
      quickSuggestions: { other: true, comments: false, strings: false },
      suggest: { preview: true, showSnippets: true },
      wordBasedSuggestions: 'currentDocument',
      snippetSuggestions: 'top',
      smoothScrolling: true,
      cursorSmoothCaretAnimation: 'on',
      cursorBlinking: 'smooth',
      renderLineHighlight: 'all',
      renderWhitespace: 'selection',
      scrollBeyondLastLine: false,
      stickyScroll: { enabled: false },
      tabSize: 2,
      insertSpaces: true,
      detectIndentation: true,
      fixedOverflowWidgets: true,
      contextmenu: true,
    });

    this.disposables.push(
      this.editor.onDidChangeModelContent(() => {
        if (this.syncingModel || !this.editor?.getModel()) return;
        this.valueChange.emit(this.editor.getValue());
      }),
      this.editor.onDidChangeCursorPosition(({ position }) => {
        this.cursorChange.emit({ line: position.lineNumber, column: position.column });
      }),
      this.editor.addAction({
        id: 'iot-hub.save-file',
        label: 'Save file',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
        run: () => {
          this.saveRequested.emit();
        },
      }),
    );
  }

  private activateFile(path: string, value: string, language: string): void {
    if (!this.editor) return;

    if (this.activePath && this.activePath !== path) {
      this.viewStates.set(this.activePath, this.editor.saveViewState());
    }

    let model = this.models.get(path);
    if (!model) {
      const uri = monaco.Uri.from({ scheme: 'file', path: `/iot-hub/${path}` });
      model = monaco.editor.createModel(value, language, uri);
      this.models.set(path, model);
    } else {
      if (model.getLanguageId() !== language) monaco.editor.setModelLanguage(model, language);
      if (model.getValue() !== value) {
        this.syncingModel = true;
        model.setValue(value);
        this.syncingModel = false;
      }
    }

    if (this.editor.getModel() !== model) {
      this.editor.setModel(model);
      const viewState = this.viewStates.get(path);
      if (viewState) this.editor.restoreViewState(viewState);
    }

    this.activePath = path;
    const position = this.editor.getPosition();
    if (position) this.cursorChange.emit({ line: position.lineNumber, column: position.column });
  }

  private configureWorker(): void {
    const workerGlobal = globalThis as unknown as MonacoWorkerGlobal;
    if (workerGlobal.MonacoEnvironment) return;

    workerGlobal.MonacoEnvironment = {
      getWorker: () =>
        new Worker(new URL('./monaco-editor.worker', import.meta.url), {
          name: 'monaco-editor-worker',
          type: 'module',
        }),
    };
  }

  private configureLanguageFeatures(): void {
    if (editorLanguageFeaturesConfigured) return;
    editorLanguageFeaturesConfigured = true;

    monaco.languages.registerCompletionItemProvider('cpp', {
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position);
        const range = new monaco.Range(
          position.lineNumber,
          word.startColumn,
          position.lineNumber,
          word.endColumn,
        );
        const snippet = monaco.languages.CompletionItemKind.Snippet;
        const fn = monaco.languages.CompletionItemKind.Function;
        return {
          suggestions: [
            {
              label: 'setup',
              kind: snippet,
              detail: 'Arduino setup function',
              insertText: 'void setup() {\n  ${1}\n}',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
            },
            {
              label: 'loop',
              kind: snippet,
              detail: 'Arduino loop function',
              insertText: 'void loop() {\n  ${1}\n}',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
            },
            {
              label: 'Serial.begin',
              kind: fn,
              detail: 'Start the serial monitor',
              insertText: 'Serial.begin(${1:115200});',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
            },
            {
              label: 'pinMode',
              kind: fn,
              detail: 'Configure a GPIO pin',
              insertText: 'pinMode(${1:pin}, ${2:OUTPUT});',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
            },
            {
              label: 'digitalWrite',
              kind: fn,
              detail: 'Write a digital GPIO value',
              insertText: 'digitalWrite(${1:pin}, ${2:HIGH});',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
            },
          ],
        };
      },
    });
  }
}
